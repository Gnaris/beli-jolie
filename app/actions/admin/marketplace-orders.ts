"use server";

/**
 * Server actions unifiées pour la vue « Marketplaces » qui fusionne les
 * commandes PFS et eFashion Paris. Les tables restent séparées (PfsOrder /
 * EfashionOrder), la fusion se fait à l'affichage :
 *
 *   - listMarketplaceOrders : UNION triée par date, pagination applicative
 *   - getMarketplaceStats  : KPIs cumulés + top clients cross-marketplace
 *                             + top produits avec drill-down couleur × source
 *   - getMarketplaceSyncMeta : dernière synchro chaque source
 *
 * Ajouter Ankorstore/Faire consistera à étendre l'UNION avec une 3ᵉ source.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { getImageSrc } from "@/lib/image-utils";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

// ─────────────────────────────────────────────
// Types partagés
// ─────────────────────────────────────────────

export type MarketplaceSource = "PFS" | "EFASHION" | "ANKORSTORE" | "FAIRE" | "MICROSTORE";

export type MarketplacePeriodKey =
  | "today"
  | "3d"
  | "week"
  | "15d"
  | "month"
  | "3m"
  | "6m"
  | "year"
  | "all"
  | "custom";

export type MarketplaceStockFilter = "all" | "pending" | "done" | "nothing";

/**
 * Statut unifié pour l'affichage :
 *  - NEW      → PFS.NEW / eFashion.NEW
 *  - VALIDATED (PFS only)
 *  - SHIPPED  → PFS.SENT / eFashion.SHIPPED
 *  - CANCELLED
 */
export type MarketplaceUnifiedStatus =
  | "NEW"
  | "VALIDATED"
  | "SHIPPED"
  | "CANCELLED";

export type MarketplaceStockDeductionState =
  | "NOT_APPLICABLE"
  | "NOTHING_TO_DEDUCT"
  | "PENDING"
  | "DONE";

export interface MarketplaceOrderListItem {
  id: string;
  source: MarketplaceSource;
  orderNumber: string;
  createdAt: string; // ISO
  status: MarketplaceUnifiedStatus;
  statusRawLabel: string; // libellé natif (ex "Envoyé" PFS, "Pickup colis effectué" eFashion)
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  carrier: string | null;
  totalTTC: number;
  totalHT: number;
  hasInvoice: boolean;
  stockDeductionState: MarketplaceStockDeductionState;
}

// ─────────────────────────────────────────────
// Période
// ─────────────────────────────────────────────

interface PeriodRange {
  from: Date | null;
  to: Date | null;
}

function parseYmd(ymd: string | null | undefined, endOfDay = false): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function subDays(d: Date, days: number): Date {
  const c = new Date(d.getTime());
  c.setDate(c.getDate() - days);
  return c;
}

function resolvePeriod(
  period: MarketplacePeriodKey,
  customFrom?: string | null,
  customTo?: string | null,
): PeriodRange {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case "today":
      return { from: startOfDay, to: null };
    case "3d":
      return { from: subDays(startOfDay, 3), to: null };
    case "week":
      return { from: subDays(startOfDay, 7), to: null };
    case "15d":
      return { from: subDays(startOfDay, 15), to: null };
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case "3m":
      return { from: subDays(startOfDay, 90), to: null };
    case "6m":
      return { from: subDays(startOfDay, 180), to: null };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: null };
    case "custom": {
      const from = parseYmd(customFrom, false);
      const to = parseYmd(customTo, true);
      if (from && to && to.getTime() < from.getTime()) return { from, to: null };
      return { from, to };
    }
    case "all":
    default:
      return { from: null, to: null };
  }
}

function decimalToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return Number((v as { toString: () => string }).toString());
}

function normalizePfsToUnified(
  s: "NEW" | "VALIDATED" | "SENT" | "CANCELLED",
): MarketplaceUnifiedStatus {
  if (s === "SENT") return "SHIPPED";
  return s;
}

function normalizeEfashionToUnified(
  s: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED",
): MarketplaceUnifiedStatus {
  return s;
}

function normalizeAnkorstoreToUnified(
  s: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED",
): MarketplaceUnifiedStatus {
  return s;
}

function normalizeFaireBddToUnified(
  s: "NEW" | "SHIPPED" | "CANCELLED",
): MarketplaceUnifiedStatus {
  return s;
}

/**
 * Libellé lisible d'un statut brut Faire (NEW, PROCESSING, BACKORDERED,
 * SHIPPED, DELIVERED, CANCELLED). Voir docs/faire-api.md §11.2.
 */
function faireStatusRawLabel(raw: string): string {
  const map: Record<string, string> = {
    NEW: "Nouvelle",
    PROCESSING: "En traitement",
    BACKORDERED: "En rupture partielle",
    SHIPPED: "Expédiée",
    PRE_TRANSIT: "Étiquette générée",
    IN_TRANSIT: "En cours de livraison",
    DELIVERED: "Livrée",
    CANCELLED: "Annulée",
    CANCELED: "Annulée",
  };
  return (
    map[raw] ??
    raw
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
  );
}

const PFS_STATUS_LABEL: Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", string> = {
  NEW: "Nouveau",
  VALIDATED: "Validé",
  SENT: "Envoyé",
  CANCELLED: "Annulé",
};

/**
 * Libellé lisible d'un statut brut Ankorstore ("brand_paid", "ankor_confirmed"…).
 * Retombe sur une capitalisation propre pour les valeurs inconnues.
 */
function ankorstoreStatusRawLabel(raw: string): string {
  const map: Record<string, string> = {
    submitted: "Soumise",
    ankor_confirmed: "Confirmée par Ankor",
    brand_confirmed: "Confirmée",
    brand_paid: "Payée à la marque",
    retailer_paid: "Payée par le retailer",
    shipped: "Expédiée",
    delivered: "Livrée",
    cancelled: "Annulée",
    canceled: "Annulée",
    rejected: "Rejetée",
    brand_rejected: "Rejetée par la marque",
    retailer_rejected: "Rejetée par le retailer",
    refunded: "Remboursée",
  };
  return (
    map[raw] ??
    raw
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

// ─────────────────────────────────────────────
// Stock deduction state — helpers
// ─────────────────────────────────────────────

async function computePfsStockDeductionMap(
  tenantId: string,
  rows: Array<{ id: string; status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED" }>,
): Promise<Map<string, MarketplaceStockDeductionState>> {
  const result = new Map<string, MarketplaceStockDeductionState>();
  if (!rows.length) return result;
  const orderIds = rows.map((r) => r.id);
  const [eligible, deducted] = await Promise.all([
    prisma.pfsOrderItem.groupBy({
      by: ["pfsOrderId"],
      where: {
        tenantId,
        pfsOrderId: { in: orderIds },
        productId: { not: null },
        productColorId: { not: null },
      },
      _count: { id: true },
    }),
    prisma.pfsOrderItem.groupBy({
      by: ["pfsOrderId"],
      where: { tenantId, pfsOrderId: { in: orderIds }, stockDeductedAt: { not: null } },
      _count: { id: true },
    }),
  ]);
  const elMap = new Map(eligible.map((g) => [g.pfsOrderId, g._count.id]));
  const dedMap = new Map(deducted.map((g) => [g.pfsOrderId, g._count.id]));
  for (const r of rows) {
    if (r.status === "NEW" || r.status === "CANCELLED") {
      result.set(r.id, "NOT_APPLICABLE");
    } else if ((dedMap.get(r.id) ?? 0) > 0) {
      result.set(r.id, "DONE");
    } else if ((elMap.get(r.id) ?? 0) === 0) {
      result.set(r.id, "NOTHING_TO_DEDUCT");
    } else {
      result.set(r.id, "PENDING");
    }
  }
  return result;
}

async function computeAnkorstoreStockDeductionMap(
  tenantId: string,
  rows: Array<{ id: string; status: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED" }>,
): Promise<Map<string, MarketplaceStockDeductionState>> {
  // Même logique que PFS/eFashion : on renvoie NOT_APPLICABLE / NOTHING_TO_DEDUCT
  // / PENDING / DONE selon l'état réel côté BDD. Le bouton « À déduire » côté UI
  // (tableau) est désactivé pour ANKORSTORE tant que la modale de déduction
  // dédiée n'est pas livrée — cf. MarketplaceOrdersTable.
  const result = new Map<string, MarketplaceStockDeductionState>();
  if (!rows.length) return result;
  const orderIds = rows.map((r) => r.id);
  const [eligible, deducted] = await Promise.all([
    prisma.ankorstoreOrderItem.groupBy({
      by: ["ankorstoreOrderId"],
      where: {
        tenantId,
        ankorstoreOrderId: { in: orderIds },
        productId: { not: null },
        productColorId: { not: null },
      },
      _count: { id: true },
    }),
    prisma.ankorstoreOrderItem.groupBy({
      by: ["ankorstoreOrderId"],
      where: { tenantId, ankorstoreOrderId: { in: orderIds }, stockDeductedAt: { not: null } },
      _count: { id: true },
    }),
  ]);
  const elMap = new Map(eligible.map((g) => [g.ankorstoreOrderId, g._count.id]));
  const dedMap = new Map(deducted.map((g) => [g.ankorstoreOrderId, g._count.id]));
  for (const r of rows) {
    if (r.status === "NEW" || r.status === "CANCELLED") {
      result.set(r.id, "NOT_APPLICABLE");
    } else if ((dedMap.get(r.id) ?? 0) > 0) {
      result.set(r.id, "DONE");
    } else if ((elMap.get(r.id) ?? 0) === 0) {
      result.set(r.id, "NOTHING_TO_DEDUCT");
    } else {
      result.set(r.id, "PENDING");
    }
  }
  return result;
}

async function computeFaireStockDeductionMap(
  tenantId: string,
  rows: Array<{ id: string; status: "NEW" | "SHIPPED" | "CANCELLED" }>,
): Promise<Map<string, MarketplaceStockDeductionState>> {
  const result = new Map<string, MarketplaceStockDeductionState>();
  if (!rows.length) return result;
  const orderIds = rows.map((r) => r.id);
  const [eligible, deducted] = await Promise.all([
    prisma.faireOrderItem.groupBy({
      by: ["faireOrderId"],
      where: {
        tenantId,
        faireOrderId: { in: orderIds },
        productId: { not: null },
        productColorId: { not: null },
      },
      _count: { id: true },
    }),
    prisma.faireOrderItem.groupBy({
      by: ["faireOrderId"],
      where: { tenantId, faireOrderId: { in: orderIds }, stockDeductedAt: { not: null } },
      _count: { id: true },
    }),
  ]);
  const elMap = new Map(eligible.map((g) => [g.faireOrderId, g._count.id]));
  const dedMap = new Map(deducted.map((g) => [g.faireOrderId, g._count.id]));
  for (const r of rows) {
    if (r.status === "NEW" || r.status === "CANCELLED") {
      result.set(r.id, "NOT_APPLICABLE");
    } else if ((dedMap.get(r.id) ?? 0) > 0) {
      result.set(r.id, "DONE");
    } else if ((elMap.get(r.id) ?? 0) === 0) {
      result.set(r.id, "NOTHING_TO_DEDUCT");
    } else {
      result.set(r.id, "PENDING");
    }
  }
  return result;
}

async function computeEfashionStockDeductionMap(
  tenantId: string,
  rows: Array<{ id: string; status: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED" }>,
): Promise<Map<string, MarketplaceStockDeductionState>> {
  const result = new Map<string, MarketplaceStockDeductionState>();
  if (!rows.length) return result;
  const orderIds = rows.map((r) => r.id);
  const [eligible, deducted] = await Promise.all([
    prisma.efashionOrderItem.groupBy({
      by: ["efashionOrderId"],
      where: {
        tenantId,
        efashionOrderId: { in: orderIds },
        productId: { not: null },
        productColorId: { not: null },
      },
      _count: { id: true },
    }),
    prisma.efashionOrderItem.groupBy({
      by: ["efashionOrderId"],
      where: { tenantId, efashionOrderId: { in: orderIds }, stockDeductedAt: { not: null } },
      _count: { id: true },
    }),
  ]);
  const elMap = new Map(eligible.map((g) => [g.efashionOrderId, g._count.id]));
  const dedMap = new Map(deducted.map((g) => [g.efashionOrderId, g._count.id]));
  for (const r of rows) {
    if (r.status === "NEW" || r.status === "CANCELLED") {
      result.set(r.id, "NOT_APPLICABLE");
    } else if ((dedMap.get(r.id) ?? 0) > 0) {
      result.set(r.id, "DONE");
    } else if ((elMap.get(r.id) ?? 0) === 0) {
      result.set(r.id, "NOTHING_TO_DEDUCT");
    } else {
      result.set(r.id, "PENDING");
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// LIST UNIFIÉE (paginée)
// ─────────────────────────────────────────────

export interface ListMarketplaceOrdersInput {
  page?: number;
  perPage?: number;
  q?: string;
  status?: MarketplaceUnifiedStatus | null;
  sources?: MarketplaceSource[]; // filtre optionnel par marketplace
  period?: MarketplacePeriodKey;
  customFrom?: string | null;
  customTo?: string | null;
  stockFilter?: MarketplaceStockFilter;
}

export interface ListMarketplaceOrdersResult {
  items: MarketplaceOrderListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  countsBySource: {
    PFS: number;
    EFASHION: number;
    ANKORSTORE: number;
    FAIRE: number;
    MICROSTORE: number;
  };
}

/**
 * UNION applicative des 2 tables. On récupère jusqu'à N lignes de chaque source
 * (borne large) puis on trie et pagine en mémoire. Suffisant tant que le volume
 * combiné reste raisonnable ; sur des dizaines de milliers de commandes on
 * bascule sur un vrai UNION SQL à ce moment-là.
 */
export async function listMarketplaceOrders(
  input: ListMarketplaceOrdersInput,
): Promise<ListMarketplaceOrdersResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(200, Math.max(1, input.perPage ?? 30));
  const sources =
    input.sources && input.sources.length > 0
      ? input.sources
      : (["PFS", "EFASHION", "ANKORSTORE", "FAIRE", "MICROSTORE"] as MarketplaceSource[]);
  const wantsPfs = sources.includes("PFS");
  const wantsEfashion = sources.includes("EFASHION");
  const wantsAnkorstore = sources.includes("ANKORSTORE");
  const wantsFaire = sources.includes("FAIRE");
  const wantsMicrostore = sources.includes("MICROSTORE");

  const range = resolvePeriod(input.period ?? "all", input.customFrom, input.customTo);
  const dateFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) dateFilter.gte = range.from;
  if (range.to) dateFilter.lte = range.to;
  const q = input.q?.trim() || "";

  // ── PFS ─────────
  const pfsPromise = wantsPfs
    ? (async () => {
        const pfsStatusMap: Record<MarketplaceUnifiedStatus, "NEW" | "VALIDATED" | "SENT" | "CANCELLED"> = {
          NEW: "NEW",
          VALIDATED: "VALIDATED",
          SHIPPED: "SENT",
          CANCELLED: "CANCELLED",
        };
        const where: Record<string, unknown> = {
          tenantId: tenant.id,
          ...(input.status ? { status: pfsStatusMap[input.status] } : {}),
          ...(Object.keys(dateFilter).length ? { createdAtPfs: dateFilter } : {}),
          ...(q
            ? {
                OR: [
                  { orderNumber: { contains: q } },
                  { customerName: { contains: q } },
                  { customerShop: { contains: q } },
                  { customerCountry: { contains: q } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.pfsOrder.findMany({
            where,
            orderBy: { createdAtPfs: "desc" },
            take: 500,
            select: {
              id: true,
              orderNumber: true,
              createdAtPfs: true,
              status: true,
              customerName: true,
              customerShop: true,
              customerCountry: true,
              carrier: true,
              totalTTC: true,
              totalHT: true,
              hasInvoice: true,
            },
          }),
          prisma.pfsOrder.count({ where }),
        ]);
        const stockMap = await computePfsStockDeductionMap(
          tenant.id,
          rows.map((r) => ({ id: r.id, status: r.status })),
        );
        const items: MarketplaceOrderListItem[] = rows.map((r) => ({
          id: r.id,
          source: "PFS" as const,
          orderNumber: r.orderNumber,
          createdAt: r.createdAtPfs.toISOString(),
          status: normalizePfsToUnified(r.status),
          statusRawLabel: PFS_STATUS_LABEL[r.status],
          customerName: r.customerName,
          customerShop: r.customerShop,
          customerCountry: r.customerCountry,
          carrier: r.carrier,
          totalTTC: decimalToNumber(r.totalTTC),
          totalHT: decimalToNumber(r.totalHT),
          hasInvoice: r.hasInvoice,
          stockDeductionState: stockMap.get(r.id) ?? "NOT_APPLICABLE",
        }));
        return { items, total };
      })()
    : Promise.resolve({ items: [] as MarketplaceOrderListItem[], total: 0 });

  // ── eFashion ────
  const efashionPromise = wantsEfashion
    ? (async () => {
        const efashionStatusMap: Record<
          MarketplaceUnifiedStatus,
          "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED" | null
        > = {
          NEW: "NEW",
          VALIDATED: "VALIDATED",
          SHIPPED: "SHIPPED",
          CANCELLED: "CANCELLED",
        };
        const efashionStatus = input.status ? efashionStatusMap[input.status] : null;
        if (input.status && !efashionStatus) {
          return { items: [] as MarketplaceOrderListItem[], total: 0 };
        }
        const where: Record<string, unknown> = {
          tenantId: tenant.id,
          ...(efashionStatus ? { status: efashionStatus } : {}),
          ...(Object.keys(dateFilter).length ? { createdAtEfashion: dateFilter } : {}),
          ...(q
            ? {
                OR: [
                  { efashionOrderName: { contains: q } },
                  { customerName: { contains: q } },
                  { customerCountry: { contains: q } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.efashionOrder.findMany({
            where,
            orderBy: { createdAtEfashion: "desc" },
            take: 500,
            select: {
              id: true,
              efashionOrderName: true,
              createdAtEfashion: true,
              status: true,
              statusLabelFr: true,
              customerName: true,
              customerCountry: true,
              carrier: true,
              totalHT: true,
              totalAfterDiscount: true,
            },
          }),
          prisma.efashionOrder.count({ where }),
        ]);
        const stockMap = await computeEfashionStockDeductionMap(
          tenant.id,
          rows.map((r) => ({ id: r.id, status: r.status })),
        );
        const items: MarketplaceOrderListItem[] = rows.map((r) => ({
          id: r.id,
          source: "EFASHION" as const,
          orderNumber: r.efashionOrderName,
          createdAt: r.createdAtEfashion.toISOString(),
          status: normalizeEfashionToUnified(r.status),
          statusRawLabel: r.statusLabelFr,
          customerName: r.customerName,
          customerShop: null,
          customerCountry: r.customerCountry,
          carrier: r.carrier,
          totalTTC: decimalToNumber(r.totalHT), // eFashion HT (pas de TTC séparé)
          totalHT: decimalToNumber(r.totalHT),
          hasInvoice: false,
          stockDeductionState: stockMap.get(r.id) ?? "NOT_APPLICABLE",
        }));
        return { items, total };
      })()
    : Promise.resolve({ items: [] as MarketplaceOrderListItem[], total: 0 });

  // ── Ankorstore ──
  const ankorstorePromise = wantsAnkorstore
    ? (async () => {
        const ankorStatusMap: Record<
          MarketplaceUnifiedStatus,
          "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED"
        > = {
          NEW: "NEW",
          VALIDATED: "VALIDATED",
          SHIPPED: "SHIPPED",
          CANCELLED: "CANCELLED",
        };
        const where: Record<string, unknown> = {
          tenantId: tenant.id,
          ...(input.status ? { status: ankorStatusMap[input.status] } : {}),
          ...(Object.keys(dateFilter).length ? { createdAtAnkor: dateFilter } : {}),
          ...(q
            ? {
                OR: [
                  { reference: { contains: q } },
                  { customerName: { contains: q } },
                  { customerShop: { contains: q } },
                  { customerCountry: { contains: q } },
                  { trackingNumber: { contains: q } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.ankorstoreOrder.findMany({
            where,
            orderBy: { createdAtAnkor: "desc" },
            take: 500,
            select: {
              id: true,
              reference: true,
              createdAtAnkor: true,
              status: true,
              statusRaw: true,
              customerName: true,
              customerShop: true,
              customerCountry: true,
              carrier: true,
              brandTotalAmount: true,
              brandTotalAmountWithVat: true,
            },
          }),
          prisma.ankorstoreOrder.count({ where }),
        ]);
        const stockMap = await computeAnkorstoreStockDeductionMap(
          tenant.id,
          rows.map((r) => ({ id: r.id, status: r.status })),
        );
        const items: MarketplaceOrderListItem[] = rows.map((r) => ({
          id: r.id,
          source: "ANKORSTORE" as const,
          orderNumber: r.reference,
          createdAt: r.createdAtAnkor.toISOString(),
          status: normalizeAnkorstoreToUnified(r.status),
          statusRawLabel: ankorstoreStatusRawLabel(r.statusRaw),
          customerName: r.customerName,
          customerShop: r.customerShop,
          customerCountry: r.customerCountry,
          carrier: r.carrier,
          totalTTC: decimalToNumber(r.brandTotalAmountWithVat),
          totalHT: decimalToNumber(r.brandTotalAmount),
          hasInvoice: false, // Ankorstore facture pour la marque — pas gérée localement
          stockDeductionState: stockMap.get(r.id) ?? "NOT_APPLICABLE",
        }));
        return { items, total };
      })()
    : Promise.resolve({ items: [] as MarketplaceOrderListItem[], total: 0 });

  // ── Faire ──
  const fairePromise = wantsFaire
    ? (async () => {
        const faireStatusMap: Record<MarketplaceUnifiedStatus, "NEW" | "SHIPPED" | "CANCELLED" | null> = {
          NEW: "NEW",
          VALIDATED: null, // Faire n'a pas de statut VALIDATED distinct — masqué si filtré
          SHIPPED: "SHIPPED",
          CANCELLED: "CANCELLED",
        };
        const faireStatus = input.status ? faireStatusMap[input.status] : null;
        if (input.status && !faireStatus) {
          return { items: [] as MarketplaceOrderListItem[], total: 0 };
        }
        const where: Record<string, unknown> = {
          tenantId: tenant.id,
          ...(faireStatus ? { status: faireStatus } : {}),
          ...(Object.keys(dateFilter).length ? { createdAtFaire: dateFilter } : {}),
          ...(q
            ? {
                OR: [
                  { displayId: { contains: q } },
                  { faireOrderId: { contains: q } },
                  { customerName: { contains: q } },
                  { customerShop: { contains: q } },
                  { customerCountry: { contains: q } },
                  { trackingCode: { contains: q } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.faireOrder.findMany({
            where,
            orderBy: { createdAtFaire: "desc" },
            take: 500,
            select: {
              id: true,
              faireOrderId: true,
              displayId: true,
              createdAtFaire: true,
              status: true,
              statusRaw: true,
              customerName: true,
              customerShop: true,
              customerCountry: true,
              carrier: true,
              totalHT: true,
              netAmount: true,
            },
          }),
          prisma.faireOrder.count({ where }),
        ]);
        const stockMap = await computeFaireStockDeductionMap(
          tenant.id,
          rows.map((r) => ({ id: r.id, status: r.status })),
        );
        const items: MarketplaceOrderListItem[] = rows.map((r) => ({
          id: r.id,
          source: "FAIRE" as const,
          orderNumber: r.displayId ?? r.faireOrderId,
          createdAt: r.createdAtFaire.toISOString(),
          status: normalizeFaireBddToUnified(r.status),
          statusRawLabel: faireStatusRawLabel(r.statusRaw),
          customerName: r.customerName,
          customerShop: r.customerShop,
          customerCountry: r.customerCountry,
          carrier: r.carrier,
          totalTTC: decimalToNumber(r.totalHT), // Faire ne détaille pas la VAT — HT = TTC
          totalHT: decimalToNumber(r.totalHT),
          hasInvoice: false, // Facturation gérée directement par Faire
          stockDeductionState: stockMap.get(r.id) ?? "NOT_APPLICABLE",
        }));
        return { items, total };
      })()
    : Promise.resolve({ items: [] as MarketplaceOrderListItem[], total: 0 });

  // ── Microstore ─
  const microstorePromise = wantsMicrostore
    ? (async () => {
        const microstoreStatusMap: Record<
          MarketplaceUnifiedStatus,
          "NEW" | "SHIPPED" | "CANCELLED" | null
        > = {
          NEW: "NEW",
          VALIDATED: null, // Microstore n'a pas de statut VALIDATED
          SHIPPED: "SHIPPED",
          CANCELLED: "CANCELLED",
        };
        const microstoreStatus = input.status ? microstoreStatusMap[input.status] : null;
        if (input.status && !microstoreStatus) {
          return { items: [] as MarketplaceOrderListItem[], total: 0 };
        }
        const where: Record<string, unknown> = {
          tenantId: tenant.id,
          ...(microstoreStatus ? { status: microstoreStatus } : {}),
          ...(Object.keys(dateFilter).length ? { createdAtMicrostore: dateFilter } : {}),
          ...(q
            ? {
                OR: [
                  { microstoreOrderId: { contains: q } },
                  { customerName: { contains: q } },
                  { customerCompany: { contains: q } },
                  { customerCountry: { contains: q } },
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          prisma.microstoreOrder.findMany({
            where,
            orderBy: { createdAtMicrostore: "desc" },
            take: 500,
            select: {
              id: true,
              microstoreOrderId: true,
              createdAtMicrostore: true,
              status: true,
              customerName: true,
              customerCompany: true,
              customerCountry: true,
              totalHT: true,
              shippingLabel: true,
            },
          }),
          prisma.microstoreOrder.count({ where }),
        ]);
        const items: MarketplaceOrderListItem[] = rows.map((r) => ({
          id: r.id,
          source: "MICROSTORE" as const,
          orderNumber: r.microstoreOrderId,
          createdAt: r.createdAtMicrostore.toISOString(),
          status: r.status === "SHIPPED"
            ? "SHIPPED"
            : r.status === "CANCELLED"
            ? "CANCELLED"
            : "NEW",
          statusRawLabel:
            r.status === "SHIPPED"
              ? "Expédiée"
              : r.status === "CANCELLED"
              ? "Annulée"
              : "À préparer",
          customerName: r.customerName,
          customerShop: r.customerCompany,
          customerCountry: r.customerCountry,
          carrier: r.shippingLabel, // mode de livraison texte
          totalTTC: decimalToNumber(r.totalHT), // Microstore ne détaille pas la TVA
          totalHT: decimalToNumber(r.totalHT),
          hasInvoice: false,
          stockDeductionState: "NOT_APPLICABLE",
        }));
        return { items, total };
      })()
    : Promise.resolve({ items: [] as MarketplaceOrderListItem[], total: 0 });

  const [pfs, efashion, ankorstore, faire, microstore] = await Promise.all([
    pfsPromise,
    efashionPromise,
    ankorstorePromise,
    fairePromise,
    microstorePromise,
  ]);
  const merged = [
    ...pfs.items,
    ...efashion.items,
    ...ankorstore.items,
    ...faire.items,
    ...microstore.items,
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  // Filtre stockFilter appliqué en mémoire pour rester générique.
  const stockFilter = input.stockFilter ?? "all";
  const filtered = stockFilter === "all"
    ? merged
    : merged.filter((r) => {
        if (stockFilter === "pending") return r.stockDeductionState === "PENDING";
        if (stockFilter === "done") return r.stockDeductionState === "DONE";
        if (stockFilter === "nothing") return r.stockDeductionState === "NOTHING_TO_DEDUCT";
        return true;
      });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const items = filtered.slice((page - 1) * perPage, page * perPage);

  return {
    items,
    total,
    page,
    perPage,
    totalPages,
    countsBySource: {
      PFS: pfs.total,
      EFASHION: efashion.total,
      ANKORSTORE: ankorstore.total,
      FAIRE: faire.total,
      MICROSTORE: microstore.total,
    },
  };
}

// ─────────────────────────────────────────────
// STATS UNIFIÉES (KPI + top clients + top produits)
// ─────────────────────────────────────────────

export interface MarketplaceStatsKpis {
  ordersCount: number;
  totalHT: number;
  avgBasketHT: number;
  uniqueCustomers: number;
  itemsSold: number;
  bySource: {
    PFS: { ordersCount: number; totalHT: number };
    EFASHION: { ordersCount: number; totalHT: number };
    ANKORSTORE: { ordersCount: number; totalHT: number };
    FAIRE: { ordersCount: number; totalHT: number };
    MICROSTORE: { ordersCount: number; totalHT: number };
  };
}

export interface MarketplaceTopClientRow {
  /** Clé de dédoublonnage (email OU nomSociete normalisé). */
  key: string;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  customerEmail: string | null;
  adminClientCardId: string | null;
  sources: MarketplaceSource[]; // Marketplaces où le client a commandé
  ordersCount: number;
  totalHT: number;
  lastOrderAt: string | null;
}

export interface MarketplaceTopProductColorSourceBreakdown {
  source: MarketplaceSource;
  quantitySold: number;
  totalHT: number;
}

export interface MarketplaceTopProductColor {
  productColorId: string | null;
  colorLabel: string | null;
  hex: string | null;
  patternImage: string | null;
  quantitySold: number;
  totalHT: number;
  bySource: MarketplaceTopProductColorSourceBreakdown[];
}

export interface MarketplaceTopProductRow {
  productId: string | null;
  productName: string | null;
  productImage: string | null;
  productReference: string;
  quantitySold: number;
  totalHT: number;
  colors: MarketplaceTopProductColor[];
  bySource: Array<{ source: MarketplaceSource; quantitySold: number; totalHT: number }>;
}

export interface MarketplaceStatsBundle {
  period: MarketplacePeriodKey;
  kpis: MarketplaceStatsKpis;
  topClients: MarketplaceTopClientRow[];
  topProducts: MarketplaceTopProductRow[];
  statusCounts: Record<MarketplaceUnifiedStatus, number>;
}

export interface GetMarketplaceStatsInput {
  period: MarketplacePeriodKey;
  customFrom?: string | null;
  customTo?: string | null;
  sources?: MarketplaceSource[];
  topClientsLimit?: number;
  topProductsLimit?: number;
}

export async function getMarketplaceStats(
  input: GetMarketplaceStatsInput,
): Promise<MarketplaceStatsBundle> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const range = resolvePeriod(input.period, input.customFrom, input.customTo);
  const sources =
    input.sources && input.sources.length > 0
      ? input.sources
      : (["PFS", "EFASHION", "ANKORSTORE", "FAIRE", "MICROSTORE"] as MarketplaceSource[]);
  const wantsPfs = sources.includes("PFS");
  const wantsEfashion = sources.includes("EFASHION");
  const wantsAnkorstore = sources.includes("ANKORSTORE");
  const wantsFaire = sources.includes("FAIRE");
  const wantsMicrostore = sources.includes("MICROSTORE");
  // Défaut généreux : le filtre local par marketplace (chip dans les cartes
  // Top clients / Top produits) est une intersection appliquée sur ce que le
  // serveur a renvoyé. Une limite trop basse (ex. 50) fait disparaître les
  // marketplaces minoritaires (Ankor / eFashion / Faire) avant même que le
  // filtre local ne s'applique. 500 couvre tous les cas réalistes.
  const topClientsLimit = input.topClientsLimit ?? 500;
  const topProductsLimit = input.topProductsLimit ?? 500;

  const pfsDateFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) pfsDateFilter.gte = range.from;
  if (range.to) pfsDateFilter.lte = range.to;
  const efashionDateFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) efashionDateFilter.gte = range.from;
  if (range.to) efashionDateFilter.lte = range.to;
  const ankorstoreDateFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) ankorstoreDateFilter.gte = range.from;
  if (range.to) ankorstoreDateFilter.lte = range.to;
  const faireDateFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) faireDateFilter.gte = range.from;
  if (range.to) faireDateFilter.lte = range.to;
  const microstoreDateFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) microstoreDateFilter.gte = range.from;
  if (range.to) microstoreDateFilter.lte = range.to;

  const pfsOrderWhere = wantsPfs
    ? {
        tenantId: tenant.id,
        status: { in: ["VALIDATED", "SENT"] as ("VALIDATED" | "SENT")[] },
        ...(Object.keys(pfsDateFilter).length ? { createdAtPfs: pfsDateFilter } : {}),
      }
    : null;
  const efashionOrderWhere = wantsEfashion
    ? {
        tenantId: tenant.id,
        status: "SHIPPED" as const,
        ...(Object.keys(efashionDateFilter).length ? { createdAtEfashion: efashionDateFilter } : {}),
      }
    : null;
  // Ankorstore : on comptabilise VALIDATED (ankor_confirmed) + SHIPPED (post-expé).
  // NEW = pas encore confirmée ; CANCELLED = jamais vendue.
  const ankorstoreOrderWhere = wantsAnkorstore
    ? {
        tenantId: tenant.id,
        status: { in: ["VALIDATED", "SHIPPED"] as ("VALIDATED" | "SHIPPED")[] },
        ...(Object.keys(ankorstoreDateFilter).length
          ? { createdAtAnkor: ankorstoreDateFilter }
          : {}),
      }
    : null;
  // Faire : on comptabilise SHIPPED uniquement. NEW = PROCESSING/BACKORDERED
  // (encore à traiter, la vente n'est pas confirmée). CANCELLED = jamais vendue.
  const faireOrderWhere = wantsFaire
    ? {
        tenantId: tenant.id,
        status: "SHIPPED" as const,
        ...(Object.keys(faireDateFilter).length ? { createdAtFaire: faireDateFilter } : {}),
      }
    : null;

  // ─── KPIs ─────
  const [
    pfsAgg,
    pfsItemsAgg,
    efashionAgg,
    efashionItemsAgg,
    ankorstoreAgg,
    ankorstoreItemsAgg,
    faireAgg,
    faireItemsAgg,
  ] = await Promise.all([
    pfsOrderWhere
      ? prisma.pfsOrder.aggregate({
          where: pfsOrderWhere,
          _count: { _all: true },
          _sum: { totalHT: true },
        })
      : Promise.resolve({ _count: { _all: 0 }, _sum: { totalHT: null as unknown as number | null } }),
    pfsOrderWhere
      ? prisma.pfsOrderItem.aggregate({
          where: { tenantId: tenant.id, pfsOrder: pfsOrderWhere },
          _sum: { qtyValidated: true },
        })
      : Promise.resolve({ _sum: { qtyValidated: 0 } }),
    efashionOrderWhere
      ? prisma.efashionOrder.aggregate({
          where: efashionOrderWhere,
          _count: { _all: true },
          _sum: { totalHT: true },
        })
      : Promise.resolve({ _count: { _all: 0 }, _sum: { totalHT: null as unknown as number | null } }),
    efashionOrderWhere
      ? prisma.efashionOrderItem.aggregate({
          where: { tenantId: tenant.id, efashionOrder: efashionOrderWhere },
          _sum: { qtyTotal: true },
        })
      : Promise.resolve({ _sum: { qtyTotal: 0 } }),
    ankorstoreOrderWhere
      ? prisma.ankorstoreOrder.aggregate({
          where: ankorstoreOrderWhere,
          _count: { _all: true },
          _sum: { brandTotalAmount: true },
        })
      : Promise.resolve({
          _count: { _all: 0 },
          _sum: { brandTotalAmount: null as unknown as number | null },
        }),
    ankorstoreOrderWhere
      ? prisma.ankorstoreOrderItem.aggregate({
          where: { tenantId: tenant.id, ankorstoreOrder: ankorstoreOrderWhere },
          _sum: { multipliedQuantity: true },
        })
      : Promise.resolve({ _sum: { multipliedQuantity: 0 } }),
    faireOrderWhere
      ? prisma.faireOrder.aggregate({
          where: faireOrderWhere,
          _count: { _all: true },
          _sum: { totalHT: true },
        })
      : Promise.resolve({
          _count: { _all: 0 },
          _sum: { totalHT: null as unknown as number | null },
        }),
    faireOrderWhere
      ? prisma.faireOrderItem.aggregate({
          where: { tenantId: tenant.id, faireOrder: faireOrderWhere },
          _sum: { quantity: true },
        })
      : Promise.resolve({ _sum: { quantity: 0 } }),
  ]);

  // Microstore : NEW + SHIPPED comptent (déjà payées côté client). Pas
  // d'items groupby ici pour rester léger : on somme quantity depuis les
  // MicrostoreOrderItem.
  const microstoreOrderWhere = wantsMicrostore
    ? {
        tenantId: tenant.id,
        status: { in: ["NEW", "SHIPPED"] as ("NEW" | "SHIPPED")[] },
        ...(Object.keys(microstoreDateFilter).length
          ? { createdAtMicrostore: microstoreDateFilter }
          : {}),
      }
    : null;
  const [microstoreAgg, microstoreItemsAgg] = await Promise.all([
    microstoreOrderWhere
      ? prisma.microstoreOrder.aggregate({
          where: microstoreOrderWhere,
          _count: { _all: true },
          _sum: { totalHT: true },
        })
      : Promise.resolve({
          _count: { _all: 0 },
          _sum: { totalHT: null as unknown as number | null },
        }),
    microstoreOrderWhere
      ? prisma.microstoreOrderItem.aggregate({
          where: { tenantId: tenant.id, microstoreOrder: microstoreOrderWhere },
          _sum: { quantity: true },
        })
      : Promise.resolve({ _sum: { quantity: 0 } }),
  ]);

  const pfsOrdersCount = pfsAgg._count._all;
  const pfsTotalHT = decimalToNumber(pfsAgg._sum.totalHT);
  const efashionOrdersCount = efashionAgg._count._all;
  const efashionTotalHT = decimalToNumber(efashionAgg._sum.totalHT);
  const ankorstoreOrdersCount = ankorstoreAgg._count._all;
  const ankorstoreTotalHT = decimalToNumber(ankorstoreAgg._sum.brandTotalAmount);
  const faireOrdersCount = faireAgg._count._all;
  const faireTotalHT = decimalToNumber(faireAgg._sum.totalHT);
  const microstoreOrdersCount = microstoreAgg._count._all;
  const microstoreTotalHT = decimalToNumber(microstoreAgg._sum.totalHT);
  const totalOrders =
    pfsOrdersCount +
    efashionOrdersCount +
    ankorstoreOrdersCount +
    faireOrdersCount +
    microstoreOrdersCount;
  const totalHT =
    pfsTotalHT + efashionTotalHT + ankorstoreTotalHT + faireTotalHT + microstoreTotalHT;
  const itemsSold =
    (pfsItemsAgg._sum.qtyValidated ?? 0) +
    (efashionItemsAgg._sum.qtyTotal ?? 0) +
    (ankorstoreItemsAgg._sum.multipliedQuantity ?? 0) +
    (faireItemsAgg._sum.quantity ?? 0) +
    (microstoreItemsAgg._sum.quantity ?? 0);

  // Compte des clients uniques cross-marketplace (par email/société normalisés)
  const [pfsClientRows, efashionClientRows, ankorstoreClientRows, faireClientRows] = await Promise.all([
    pfsOrderWhere
      ? prisma.pfsOrder.findMany({
          where: pfsOrderWhere,
          select: {
            id: true,
            pfsCustomerId: true,
            customerName: true,
            customerShop: true,
            customerCountry: true,
            adminClientCardId: true,
            totalHT: true,
            createdAtPfs: true,
          },
        })
      : Promise.resolve([]),
    efashionOrderWhere
      ? prisma.efashionOrder.findMany({
          where: efashionOrderWhere,
          select: {
            id: true,
            efashionCustomerId: true,
            customerName: true,
            customerEmail: true,
            customerCountry: true,
            adminClientCardId: true,
            totalHT: true,
            createdAtEfashion: true,
          },
        })
      : Promise.resolve([]),
    ankorstoreOrderWhere
      ? prisma.ankorstoreOrder.findMany({
          where: ankorstoreOrderWhere,
          select: {
            id: true,
            ankorstoreRetailerId: true,
            customerName: true,
            customerShop: true,
            customerEmail: true,
            customerCountry: true,
            adminClientCardId: true,
            brandTotalAmount: true,
            createdAtAnkor: true,
          },
        })
      : Promise.resolve([]),
    faireOrderWhere
      ? prisma.faireOrder.findMany({
          where: faireOrderWhere,
          select: {
            id: true,
            faireRetailerId: true,
            customerName: true,
            customerShop: true,
            customerEmail: true,
            customerCountry: true,
            adminClientCardId: true,
            totalHT: true,
            createdAtFaire: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // Clé de dédoublonnage cross-marketplace : email s'il existe, sinon
  // adminClientCardId (fiche déjà rapprochée), sinon nom société normalisé.
  const normalizeKey = (
    email: string | null | undefined,
    cardId: string | null | undefined,
    company: string | null | undefined,
  ): string => {
    const e = email?.trim().toLowerCase();
    if (e) return `email:${e}`;
    if (cardId) return `card:${cardId}`;
    const c = company?.trim().toLowerCase().replace(/\s+/g, " ");
    if (c) return `co:${c}`;
    return `unk:${Math.random().toString(36).slice(2)}`;
  };

  interface ClientAcc {
    key: string;
    customerName: string;
    customerShop: string | null;
    customerCountry: string | null;
    customerEmail: string | null;
    adminClientCardId: string | null;
    sources: Set<MarketplaceSource>;
    ordersCount: number;
    totalHT: number;
    lastOrderAt: Date | null;
  }
  const clientMap = new Map<string, ClientAcc>();
  const upsertClient = (key: string, patch: Partial<ClientAcc> & { source: MarketplaceSource; orderTotal: number; orderDate: Date }) => {
    const existing = clientMap.get(key);
    if (existing) {
      existing.sources.add(patch.source);
      existing.ordersCount += 1;
      existing.totalHT += patch.orderTotal;
      if (!existing.lastOrderAt || patch.orderDate > existing.lastOrderAt) {
        existing.lastOrderAt = patch.orderDate;
      }
      // Enrichissements manquants
      if (!existing.customerEmail && patch.customerEmail) existing.customerEmail = patch.customerEmail;
      if (!existing.adminClientCardId && patch.adminClientCardId) existing.adminClientCardId = patch.adminClientCardId;
      if (!existing.customerCountry && patch.customerCountry) existing.customerCountry = patch.customerCountry;
    } else {
      clientMap.set(key, {
        key,
        customerName: patch.customerName ?? "(inconnu)",
        customerShop: patch.customerShop ?? null,
        customerCountry: patch.customerCountry ?? null,
        customerEmail: patch.customerEmail ?? null,
        adminClientCardId: patch.adminClientCardId ?? null,
        sources: new Set([patch.source]),
        ordersCount: 1,
        totalHT: patch.orderTotal,
        lastOrderAt: patch.orderDate,
      });
    }
  };

  for (const r of pfsClientRows) {
    const key = normalizeKey(null, r.adminClientCardId, r.customerShop ?? r.customerName);
    upsertClient(key, {
      source: "PFS",
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      customerEmail: null,
      adminClientCardId: r.adminClientCardId,
      orderTotal: decimalToNumber(r.totalHT),
      orderDate: r.createdAtPfs,
    });
  }
  for (const r of efashionClientRows) {
    const key = normalizeKey(r.customerEmail, r.adminClientCardId, r.customerName);
    upsertClient(key, {
      source: "EFASHION",
      customerName: r.customerName,
      customerShop: r.customerName,
      customerCountry: r.customerCountry,
      customerEmail: r.customerEmail,
      adminClientCardId: r.adminClientCardId,
      orderTotal: decimalToNumber(r.totalHT),
      orderDate: r.createdAtEfashion,
    });
  }
  for (const r of ankorstoreClientRows) {
    const key = normalizeKey(r.customerEmail, r.adminClientCardId, r.customerShop ?? r.customerName);
    upsertClient(key, {
      source: "ANKORSTORE",
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      customerEmail: r.customerEmail,
      adminClientCardId: r.adminClientCardId,
      orderTotal: decimalToNumber(r.brandTotalAmount),
      orderDate: r.createdAtAnkor,
    });
  }
  for (const r of faireClientRows) {
    const key = normalizeKey(r.customerEmail, r.adminClientCardId, r.customerShop ?? r.customerName);
    upsertClient(key, {
      source: "FAIRE",
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      customerEmail: r.customerEmail,
      adminClientCardId: r.adminClientCardId,
      orderTotal: decimalToNumber(r.totalHT),
      orderDate: r.createdAtFaire,
    });
  }

  const uniqueCustomers = clientMap.size;
  const topClients: MarketplaceTopClientRow[] = Array.from(clientMap.values())
    .sort((a, b) => b.totalHT - a.totalHT)
    .slice(0, topClientsLimit)
    .map((c) => ({
      key: c.key,
      customerName: c.customerName,
      customerShop: c.customerShop,
      customerCountry: c.customerCountry,
      customerEmail: c.customerEmail,
      adminClientCardId: c.adminClientCardId,
      sources: Array.from(c.sources).sort(),
      ordersCount: c.ordersCount,
      totalHT: c.totalHT,
      lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
    }));

  const kpis: MarketplaceStatsKpis = {
    ordersCount: totalOrders,
    totalHT,
    avgBasketHT: totalOrders > 0 ? totalHT / totalOrders : 0,
    uniqueCustomers,
    itemsSold,
    bySource: {
      PFS: { ordersCount: pfsOrdersCount, totalHT: pfsTotalHT },
      EFASHION: { ordersCount: efashionOrdersCount, totalHT: efashionTotalHT },
      ANKORSTORE: { ordersCount: ankorstoreOrdersCount, totalHT: ankorstoreTotalHT },
      FAIRE: { ordersCount: faireOrdersCount, totalHT: faireTotalHT },
      MICROSTORE: { ordersCount: microstoreOrdersCount, totalHT: microstoreTotalHT },
    },
  };

  // ─── Top produits cross-marketplace avec drill-down couleur × source ─
  // On inclut aussi les items dont le productId est null (produit non
  // rattaché à la boutique) — ils apparaîtront comme « Produit non présent
  // sur notre site » avec leur référence marketplace. Clé de groupement =
  // productId si rattaché, sinon "ref:{reference}" pour dédoublonner les
  // items non rattachés d'un même produit.
  const [pfsItemGrouped, efashionItemGrouped, ankorstoreItemGrouped, faireItemGrouped] = await Promise.all([
    pfsOrderWhere
      ? prisma.pfsOrderItem.groupBy({
          where: { tenantId: tenant.id, pfsOrder: pfsOrderWhere },
          by: ["productId", "pfsProductRef", "productColorId", "colorLabelFr"],
          _sum: { qtyValidated: true, totalPriceHT: true },
        })
      : Promise.resolve([]),
    efashionOrderWhere
      ? prisma.efashionOrderItem.groupBy({
          where: { tenantId: tenant.id, efashionOrder: efashionOrderWhere },
          by: ["productId", "referenceBase", "productColorId", "colorLabelFr"],
          _sum: { qtyTotal: true, totalLineHT: true },
        })
      : Promise.resolve([]),
    ankorstoreOrderWhere
      ? prisma.ankorstoreOrderItem.groupBy({
          where: { tenantId: tenant.id, ankorstoreOrder: ankorstoreOrderWhere },
          by: ["productId", "referenceBase", "productColorId", "variantOptionLabel"],
          _sum: { multipliedQuantity: true, totalPriceHT: true },
        })
      : Promise.resolve([]),
    faireOrderWhere
      ? prisma.faireOrderItem.groupBy({
          where: { tenantId: tenant.id, faireOrder: faireOrderWhere },
          by: ["productId", "referenceBase", "productColorId", "variantOptionLabel"],
          _sum: { quantity: true, totalPriceHT: true },
        })
      : Promise.resolve([]),
  ]);

  interface ProductAgg {
    productId: string | null;
    reference: string; // reference boutique (si rattaché) ou marketplace (sinon)
    quantitySold: number;
    totalHT: number;
    bySource: Map<MarketplaceSource, { quantitySold: number; totalHT: number }>;
    colorsByPcId: Map<
      string,
      {
        productColorId: string | null;
        colorLabel: string | null;
        quantitySold: number;
        totalHT: number;
        bySource: Map<MarketplaceSource, { quantitySold: number; totalHT: number }>;
      }
    >;
  }
  const productMap = new Map<string, ProductAgg>();
  const upsertProduct = (
    productId: string | null,
    reference: string | null,
    productColorId: string | null,
    colorLabel: string | null,
    source: MarketplaceSource,
    qty: number,
    total: number,
  ) => {
    const cleanRef = reference?.trim() || "(sans référence)";
    // Si le produit est rattaché, la clé est son productId (unique cross-source).
    // Sinon on utilise la référence pour dédoublonner les items non rattachés
    // d'un même produit vendu sur plusieurs marketplaces.
    const key = productId ?? `ref:${cleanRef.toLowerCase()}`;
    let acc = productMap.get(key);
    if (!acc) {
      acc = {
        productId,
        reference: cleanRef,
        quantitySold: 0,
        totalHT: 0,
        bySource: new Map(),
        colorsByPcId: new Map(),
      };
      productMap.set(key, acc);
    }
    acc.quantitySold += qty;
    acc.totalHT += total;
    const sourceAgg = acc.bySource.get(source) ?? { quantitySold: 0, totalHT: 0 };
    sourceAgg.quantitySold += qty;
    sourceAgg.totalHT += total;
    acc.bySource.set(source, sourceAgg);

    const colorKey = productColorId ?? `label:${colorLabel ?? "?"}`;
    let colorAgg = acc.colorsByPcId.get(colorKey);
    if (!colorAgg) {
      colorAgg = {
        productColorId,
        colorLabel,
        quantitySold: 0,
        totalHT: 0,
        bySource: new Map(),
      };
      acc.colorsByPcId.set(colorKey, colorAgg);
    }
    colorAgg.quantitySold += qty;
    colorAgg.totalHT += total;
    const colorSourceAgg = colorAgg.bySource.get(source) ?? { quantitySold: 0, totalHT: 0 };
    colorSourceAgg.quantitySold += qty;
    colorSourceAgg.totalHT += total;
    colorAgg.bySource.set(source, colorSourceAgg);
  };

  for (const g of pfsItemGrouped) {
    upsertProduct(
      g.productId,
      g.pfsProductRef,
      g.productColorId,
      g.colorLabelFr,
      "PFS",
      g._sum.qtyValidated ?? 0,
      decimalToNumber(g._sum.totalPriceHT),
    );
  }
  for (const g of efashionItemGrouped) {
    upsertProduct(
      g.productId,
      g.referenceBase,
      g.productColorId,
      g.colorLabelFr,
      "EFASHION",
      g._sum.qtyTotal ?? 0,
      decimalToNumber(g._sum.totalLineHT),
    );
  }
  for (const g of ankorstoreItemGrouped) {
    upsertProduct(
      g.productId,
      g.referenceBase,
      g.productColorId,
      g.variantOptionLabel,
      "ANKORSTORE",
      g._sum.multipliedQuantity ?? 0,
      decimalToNumber(g._sum.totalPriceHT),
    );
  }
  for (const g of faireItemGrouped) {
    upsertProduct(
      g.productId,
      g.referenceBase,
      g.productColorId,
      g.variantOptionLabel,
      "FAIRE",
      g._sum.quantity ?? 0,
      decimalToNumber(g._sum.totalPriceHT),
    );
  }

  const topProductAccs = Array.from(productMap.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, topProductsLimit);

  // Enrichissement produit (nom, image, ref) + couleur (hex, pattern).
  // Les produits non rattachés (productId=null) n'ont pas de meta à fetcher.
  const productIds = topProductAccs
    .map((p) => p.productId)
    .filter((id): id is string => Boolean(id));
  const [productRows, imageRows, colorRows] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { tenantId: tenant.id, id: { in: productIds } },
          select: { id: true, name: true, reference: true },
        })
      : Promise.resolve([]),
    productIds.length
      ? prisma.productColorImage.findMany({
          where: { tenantId: tenant.id, productId: { in: productIds }, order: 0 },
          select: {
            productId: true,
            path: true,
            productColor: { select: { isPrimary: true } },
          },
        })
      : Promise.resolve([]),
    (async () => {
      const colorIds: string[] = [];
      for (const p of topProductAccs) {
        for (const c of p.colorsByPcId.values()) {
          if (c.productColorId) colorIds.push(c.productColorId);
        }
      }
      if (colorIds.length === 0) return [];
      return prisma.productColor.findMany({
        where: { tenantId: tenant.id, id: { in: colorIds } },
        select: {
          id: true,
          color: { select: { hex: true, patternImage: true } },
        },
      });
    })(),
  ]);
  const productMeta = new Map(productRows.map((p) => [p.id, p]));
  const imageByProduct = new Map<string, string>();
  for (const row of imageRows) {
    const existing = imageByProduct.get(row.productId);
    const primary = row.productColor?.isPrimary ?? false;
    if (!existing || primary) imageByProduct.set(row.productId, row.path);
  }
  const productColorMeta = new Map(colorRows.map((r) => [r.id, r.color]));

  const topProducts: MarketplaceTopProductRow[] = topProductAccs.map((acc) => {
    const meta = acc.productId ? productMeta.get(acc.productId) : null;
    const rawImage = acc.productId ? imageByProduct.get(acc.productId) ?? null : null;
    return {
      productId: acc.productId,
      productName: meta?.name ?? null,
      productImage: rawImage ? getImageSrc(rawImage, "thumb") : null,
      productReference: meta?.reference ?? acc.reference,
      quantitySold: acc.quantitySold,
      totalHT: acc.totalHT,
      bySource: Array.from(acc.bySource.entries())
        .map(([source, agg]) => ({ source, quantitySold: agg.quantitySold, totalHT: agg.totalHT }))
        .sort((a, b) => b.quantitySold - a.quantitySold),
      colors: Array.from(acc.colorsByPcId.values())
        .sort((a, b) => b.quantitySold - a.quantitySold)
        .map((c) => {
          const meta = c.productColorId ? productColorMeta.get(c.productColorId) : null;
          return {
            productColorId: c.productColorId,
            colorLabel: c.colorLabel,
            hex: meta?.hex ?? null,
            patternImage: meta?.patternImage ?? null,
            quantitySold: c.quantitySold,
            totalHT: c.totalHT,
            bySource: Array.from(c.bySource.entries())
              .map(([source, agg]) => ({ source, quantitySold: agg.quantitySold, totalHT: agg.totalHT }))
              .sort((a, b) => b.quantitySold - a.quantitySold),
          };
        }),
    };
  });

  // ─── Compteurs par statut unifié ─
  const [pfsStatusRows, efashionStatusRows, ankorstoreStatusRows, faireStatusRows] = await Promise.all([
    wantsPfs
      ? prisma.pfsOrder.groupBy({
          where: {
            tenantId: tenant.id,
            ...(Object.keys(pfsDateFilter).length ? { createdAtPfs: pfsDateFilter } : {}),
          },
          by: ["status"],
          _count: { _all: true },
        })
      : Promise.resolve([]),
    wantsEfashion
      ? prisma.efashionOrder.groupBy({
          where: {
            tenantId: tenant.id,
            ...(Object.keys(efashionDateFilter).length ? { createdAtEfashion: efashionDateFilter } : {}),
          },
          by: ["status"],
          _count: { _all: true },
        })
      : Promise.resolve([]),
    wantsAnkorstore
      ? prisma.ankorstoreOrder.groupBy({
          where: {
            tenantId: tenant.id,
            ...(Object.keys(ankorstoreDateFilter).length
              ? { createdAtAnkor: ankorstoreDateFilter }
              : {}),
          },
          by: ["status"],
          _count: { _all: true },
        })
      : Promise.resolve([]),
    wantsFaire
      ? prisma.faireOrder.groupBy({
          where: {
            tenantId: tenant.id,
            ...(Object.keys(faireDateFilter).length ? { createdAtFaire: faireDateFilter } : {}),
          },
          by: ["status"],
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const statusCounts: Record<MarketplaceUnifiedStatus, number> = {
    NEW: 0,
    VALIDATED: 0,
    SHIPPED: 0,
    CANCELLED: 0,
  };
  for (const r of pfsStatusRows) statusCounts[normalizePfsToUnified(r.status)] += r._count._all;
  for (const r of efashionStatusRows)
    statusCounts[normalizeEfashionToUnified(r.status)] += r._count._all;
  for (const r of ankorstoreStatusRows)
    statusCounts[normalizeAnkorstoreToUnified(r.status)] += r._count._all;
  for (const r of faireStatusRows)
    statusCounts[normalizeFaireBddToUnified(r.status)] += r._count._all;

  return {
    period: input.period,
    kpis,
    topClients,
    topProducts,
    statusCounts,
  };
}

// ─────────────────────────────────────────────
// Meta synchro combinée
// ─────────────────────────────────────────────

export async function getMarketplaceSyncMeta(): Promise<{
  pfs: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
  efashion: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
  ankorstore: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
  faire: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
  microstore: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const [
    pfsLast,
    efashionLast,
    ankorstoreLast,
    faireLast,
    pfsCreds,
    efashionCreds,
    ankorstoreCreds,
    faireCreds,
    pfsCount,
    efashionCount,
    ankorstoreCount,
    faireCount,
  ] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "pfs_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "efashion_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "ankorstore_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "faire_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findMany({
      where: { tenantId: tenant.id, key: { in: ["pfs_email", "pfs_password"] } },
      select: { key: true, value: true },
    }),
    prisma.siteConfig.findMany({
      where: { tenantId: tenant.id, key: { in: ["efashion_email", "efashion_password"] } },
      select: { key: true, value: true },
    }),
    prisma.siteConfig.findMany({
      where: {
        tenantId: tenant.id,
        key: { in: ["ankors_client_id", "ankors_client_secret"] },
      },
      select: { key: true, value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "faire_api_key" },
      select: { value: true },
    }),
    prisma.pfsOrder.count({ where: { tenantId: tenant.id } }),
    prisma.efashionOrder.count({ where: { tenantId: tenant.id } }),
    prisma.ankorstoreOrder.count({ where: { tenantId: tenant.id } }),
    prisma.faireOrder.count({ where: { tenantId: tenant.id } }),
  ]);
  const [microstoreLast, microstoreCreds, microstoreCount] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "microstore_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "microstore_session_key" },
      select: { value: true },
    }),
    prisma.microstoreOrder.count({ where: { tenantId: tenant.id } }),
  ]);
  const pfsMap = new Map(pfsCreds.map((r) => [r.key, r.value]));
  const efashionMap = new Map(efashionCreds.map((r) => [r.key, r.value]));
  const ankorstoreMap = new Map(ankorstoreCreds.map((r) => [r.key, r.value]));
  return {
    pfs: {
      lastSyncedAt: pfsLast?.value ? new Date(parseInt(pfsLast.value, 10)).toISOString() : null,
      totalOrdersInDb: pfsCount,
      hasCredentials:
        (pfsMap.get("pfs_email") || "").trim().length > 0 &&
        (pfsMap.get("pfs_password") || "").trim().length > 0,
    },
    efashion: {
      lastSyncedAt: efashionLast?.value
        ? new Date(parseInt(efashionLast.value, 10)).toISOString()
        : null,
      totalOrdersInDb: efashionCount,
      hasCredentials:
        (efashionMap.get("efashion_email") || "").trim().length > 0 &&
        (efashionMap.get("efashion_password") || "").trim().length > 0,
    },
    ankorstore: {
      lastSyncedAt: ankorstoreLast?.value
        ? new Date(parseInt(ankorstoreLast.value, 10)).toISOString()
        : null,
      totalOrdersInDb: ankorstoreCount,
      hasCredentials:
        (ankorstoreMap.get("ankors_client_id") || "").trim().length > 0 &&
        (ankorstoreMap.get("ankors_client_secret") || "").trim().length > 0,
    },
    faire: {
      lastSyncedAt: faireLast?.value
        ? new Date(parseInt(faireLast.value, 10)).toISOString()
        : null,
      totalOrdersInDb: faireCount,
      hasCredentials: (faireCreds?.value || "").trim().length > 0,
    },
    microstore: {
      lastSyncedAt: microstoreLast?.value
        ? new Date(parseInt(microstoreLast.value, 10)).toISOString()
        : null,
      totalOrdersInDb: microstoreCount,
      hasCredentials: (microstoreCreds?.value || "").trim().length > 0,
    },
  };
}
