"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  getPfsImportState,
  startPfsHistoricalImportInBackground,
  requestStopPfsHistoricalImport,
  resetPfsImportState,
} from "@/lib/pfs-orders-import-state";
export type {
  PfsImportState,
  PfsImportRecentEvent,
  PfsImportCurrentOrder,
} from "@/lib/pfs-orders-import-state";
import type { PfsImportState } from "@/lib/pfs-orders-import-state";
import { syncRecentPfsOrders, syncSinglePfsOrder } from "@/lib/pfs-orders-sync";
import { getImageSrc } from "@/lib/image-utils";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

export type PfsPeriodKey =
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

interface PeriodRange {
  from: Date | null;
  to: Date | null;
}

function parseYmd(ymd: string | null | undefined, endOfDay = false): Date | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo) - 1;
  const day = Number(d);
  const date = endOfDay
    ? new Date(year, month, day, 23, 59, 59, 999)
    : new Date(year, month, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolvePeriod(
  period: PfsPeriodKey,
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
      if (from && to && to.getTime() < from.getTime()) {
        return { from, to: null };
      }
      return { from, to };
    }
    case "all":
    default:
      return { from: null, to: null };
  }
}

function subDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() - days);
  return copy;
}

function decimalToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  const asString = (v as { toString: () => string }).toString();
  return Number(asString);
}

// ─────────────────────────────────────────────
// Liste paginée + filtres
// ─────────────────────────────────────────────

export interface ListPfsOrdersInput {
  page?: number;
  perPage?: number;
  q?: string; // orderNumber, customerName, customerShop
  status?: "NEW" | "VALIDATED" | "SENT" | "CANCELLED" | null;
  carrier?: string | null;
  period?: PfsPeriodKey;
  /** Format YYYY-MM-DD ; utilisé uniquement quand period === "custom". */
  customFrom?: string | null;
  /** Format YYYY-MM-DD (inclus jusqu'à 23:59:59) ; utilisé uniquement quand period === "custom". */
  customTo?: string | null;
  /** Filtre par état de déduction de stock. Défaut : "all" (aucun filtre). */
  stockFilter?: PfsStockFilter;
}

export type PfsStockFilter = "all" | "pending" | "done" | "nothing";

export type PfsStockDeductionState =
  | "NOT_APPLICABLE" // Commande NEW ou CANCELLED — pas concerné par la déduction.
  | "NOTHING_TO_DEDUCT" // Commande VALIDATED/SENT mais aucun article rattaché à la boutique.
  | "PENDING" // Au moins un article rattaché, aucun clic « Déduire » encore effectué.
  | "DONE"; // Le bouton « Déduire stock PFS » a déjà été activé (irréversible, non rejouable).

export interface PfsUnlinkedItem {
  pfsProductRef: string;
  productName: string | null;
  colorLabel: string | null;
  sizeLabel: string | null;
}

export interface PfsNothingToDeductReason {
  hasNoItems: boolean; // La commande PFS ne contient aucun article.
  totalUnlinkedCount: number; // Total articles non rattachés.
  sampleUnlinkedItems: PfsUnlinkedItem[]; // Échantillon (max 5).
}

export interface PfsOrderListItem {
  id: string;
  pfsOrderId: string;
  orderNumber: string;
  createdAtPfs: string; // ISO
  status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED";
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  carrier: string | null;
  totalTTC: number;
  totalHT: number;
  hasInvoice: boolean;
  hasCredit: boolean;
  stockDeductionState: PfsStockDeductionState;
  stockDeductionReason?: PfsNothingToDeductReason;
}

export interface ListPfsOrdersResult {
  items: PfsOrderListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export async function listPfsOrders(input: ListPfsOrdersInput): Promise<ListPfsOrdersResult> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(200, Math.max(1, input.perPage ?? 30));
  const range = resolvePeriod(input.period ?? "all", input.customFrom, input.customTo);

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) createdAtFilter.gte = range.from;
  if (range.to) createdAtFilter.lte = range.to;

  const stockFilter: PfsStockFilter = input.stockFilter ?? "all";
  const stockFilterWhere = buildStockFilterWhere(stockFilter);

  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    ...(input.status ? { status: input.status } : {}),
    ...(input.carrier ? { carrier: input.carrier } : {}),
    ...(Object.keys(createdAtFilter).length ? { createdAtPfs: createdAtFilter } : {}),
    ...(input.q
      ? {
          OR: [
            { orderNumber: { contains: input.q } },
            { customerName: { contains: input.q } },
            { customerShop: { contains: input.q } },
            { customerCountry: { contains: input.q } },
          ],
        }
      : {}),
    ...stockFilterWhere,
  };

  const [rows, total] = await Promise.all([
    prisma.pfsOrder.findMany({
      where,
      orderBy: { createdAtPfs: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        pfsOrderId: true,
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
        hasCredit: true,
      },
    }),
    prisma.pfsOrder.count({ where }),
  ]);

  const stockDeductionByOrder = await computeStockDeductionMap(
    tenant.id,
    rows.map((r) => ({ id: r.id, status: r.status })),
  );

  const items: PfsOrderListItem[] = rows.map((r) => {
    const stock = stockDeductionByOrder.get(r.id)!;
    return {
      id: r.id,
      pfsOrderId: r.pfsOrderId,
      orderNumber: r.orderNumber,
      createdAtPfs: r.createdAtPfs.toISOString(),
      status: r.status,
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      carrier: r.carrier,
      totalTTC: decimalToNumber(r.totalTTC),
      totalHT: decimalToNumber(r.totalHT),
      hasInvoice: r.hasInvoice,
      hasCredit: r.hasCredit,
      stockDeductionState: stock.state,
      ...(stock.reason ? { stockDeductionReason: stock.reason } : {}),
    };
  });

  return {
    items,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

// ─────────────────────────────────────────────
// Stats KPI + top clients + top produits
// ─────────────────────────────────────────────

export interface PfsStatsKpis {
  ordersCount: number;
  totalHT: number;
  totalTTC: number;
  avgBasketTTC: number;
  uniqueCustomers: number;
  itemsSold: number;
  newCustomers: number; // Fiches créées via l'import PFS sur la période
}

export interface PfsTopClientRow {
  adminClientCardId: string | null;
  pfsCustomerId: string;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  /** Téléphone joint depuis AdminClientCard (si la fiche existe). */
  customerPhone: string | null;
  ordersCount: number;
  totalHT: number;
  totalTTC: number;
  lastOrderAt: string | null;
}

export interface PfsTopProductColorBreakdown {
  productColorId: string | null;
  colorLabelFr: string | null;
  colorCodePfs: string | null;
  quantitySold: number;
  totalHT: number;
  hex: string | null;
  patternImage: string | null;
}

export interface PfsTopProductRow {
  productId: string | null;
  productName: string | null;
  productImage: string | null;
  pfsProductRef: string;
  quantitySold: number;
  totalHT: number;
  colors: PfsTopProductColorBreakdown[];
}

export interface PfsStatsBundle {
  period: PfsPeriodKey;
  kpis: PfsStatsKpis;
  topClients: PfsTopClientRow[];
  topProducts: PfsTopProductRow[];
  statusCounts: Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", number>;
}

export interface GetPfsStatsInput {
  period: PfsPeriodKey;
  /** Format YYYY-MM-DD ; utilisé uniquement quand period === "custom". */
  customFrom?: string | null;
  /** Format YYYY-MM-DD (inclus jusqu'à 23:59:59) ; utilisé uniquement quand period === "custom". */
  customTo?: string | null;
  topClientsLimit?: number;
  topProductsLimit?: number;
  topClientsSort?: "totalHT" | "ordersCount";
  topProductsSort?: "quantity" | "totalHT";
}

export async function getPfsStats(input: GetPfsStatsInput): Promise<PfsStatsBundle> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const range = resolvePeriod(input.period, input.customFrom, input.customTo);
  // Cap dur : sur "Tout" on peut avoir des milliers de produits/clients et le
  // groupBy + colorGrouped derrière fait exploser mémoire+CPU du serveur Next
  // (observé : 7000+ refs → action de plusieurs dizaines de secondes, ce qui
  // simule un blocage "Compiling…" côté dev). 100 lignes suffit largement pour
  // un top ; l'appelant peut toujours demander plus explicitement.
  const DEFAULT_TOP_LIMIT = 100;
  const topClientsLimit = input.topClientsLimit ?? DEFAULT_TOP_LIMIT;
  const topProductsLimit = input.topProductsLimit ?? DEFAULT_TOP_LIMIT;
  const topClientsSort = input.topClientsSort ?? "totalHT";
  const topProductsSort = input.topProductsSort ?? "quantity";

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (range.from) createdAtFilter.gte = range.from;
  if (range.to) createdAtFilter.lte = range.to;

  // Base : tenant + période (utilisé pour statusCounts qui doit refléter TOUS les statuts).
  const statusScopeWhere = {
    tenantId: tenant.id,
    ...(Object.keys(createdAtFilter).length ? { createdAtPfs: createdAtFilter } : {}),
  };
  // Stats "métier" (KPIs, top clients, top produits) : uniquement commandes validées ou envoyées.
  // Les nouvelles (NEW) ne sont pas encore confirmées côté PFS et les annulées ne doivent pas gonfler le CA.
  const orderWhere = {
    ...statusScopeWhere,
    status: { in: ["VALIDATED", "SENT"] as ("VALIDATED" | "SENT")[] },
  };

  const [ordersAggregate, itemsAggregate, statusRows, customerGrouped, itemGrouped, newCustomersCount] =
    await Promise.all([
      prisma.pfsOrder.aggregate({
        where: orderWhere,
        _count: { _all: true },
        _sum: { totalHT: true, totalTTC: true },
      }),
      prisma.pfsOrderItem.aggregate({
        where: { tenantId: tenant.id, pfsOrder: orderWhere },
        _sum: { qtyValidated: true },
      }),
      prisma.pfsOrder.groupBy({
        where: statusScopeWhere,
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.pfsOrder.groupBy({
        where: orderWhere,
        by: ["pfsCustomerId"],
        _count: { _all: true },
        _sum: { totalHT: true, totalTTC: true },
        _max: { createdAtPfs: true },
        orderBy:
          topClientsSort === "ordersCount"
            ? { _count: { pfsCustomerId: "desc" } }
            : { _sum: { totalHT: "desc" } },
        ...(topClientsLimit ? { take: topClientsLimit } : {}),
      }),
      prisma.pfsOrderItem.groupBy({
        where: { tenantId: tenant.id, pfsOrder: orderWhere },
        by: ["pfsProductRef", "productId"],
        _sum: { qtyValidated: true, totalPriceHT: true },
        orderBy:
          topProductsSort === "quantity"
            ? { _sum: { qtyValidated: "desc" } }
            : { _sum: { totalPriceHT: "desc" } },
        ...(topProductsLimit ? { take: topProductsLimit } : {}),
      }),
      prisma.adminClientCard.count({
        where: {
          tenantId: tenant.id,
          importedFromMarketplace: "PFS",
          ...(Object.keys(createdAtFilter).length
            ? { createdAt: { ...createdAtFilter } }
            : {}),
        },
      }),
    ]);

  const ordersCount = ordersAggregate._count._all;
  const totalHT = decimalToNumber(ordersAggregate._sum.totalHT);
  const totalTTC = decimalToNumber(ordersAggregate._sum.totalTTC);
  const itemsSold = itemsAggregate._sum.qtyValidated ?? 0;
  const uniqueCustomers = customerGrouped.length; // sur la limite du top, mais uniqueCustomers doit être le total réel — refaire une count distinct
  // Compte les distinct pfsCustomerId au niveau global via GROUP BY :
  // plus efficace que `findMany distinct + select` (MySQL fait le regroupement
  // en SQL sans transférer chaque valeur au client Prisma).
  const distinctCustomers = await prisma.pfsOrder.groupBy({
    where: orderWhere,
    by: ["pfsCustomerId"],
  });

  const kpis: PfsStatsKpis = {
    ordersCount,
    totalHT,
    totalTTC,
    avgBasketTTC: ordersCount > 0 ? totalTTC / ordersCount : 0,
    uniqueCustomers: distinctCustomers.length,
    itemsSold,
    newCustomers: newCustomersCount,
  };

  // Enrichir top clients avec name/shop/country
  const topClientPfsIds = customerGrouped.map((c) => c.pfsCustomerId);
  const clientNameRows = topClientPfsIds.length
    ? await prisma.pfsOrder.findMany({
        where: { tenantId: tenant.id, pfsCustomerId: { in: topClientPfsIds } },
        distinct: ["pfsCustomerId"],
        orderBy: { createdAtPfs: "desc" },
        select: {
          pfsCustomerId: true,
          customerName: true,
          customerShop: true,
          customerCountry: true,
          adminClientCardId: true,
        },
      })
    : [];
  const clientNameMap = new Map(clientNameRows.map((r) => [r.pfsCustomerId, r]));

  // Téléphone (facultatif) : joint depuis AdminClientCard quand la fiche existe.
  const topClientCardIds = Array.from(
    new Set(clientNameRows.map((r) => r.adminClientCardId).filter((x): x is string => !!x)),
  );
  const cardPhoneRows = topClientCardIds.length
    ? await prisma.adminClientCard.findMany({
        where: { tenantId: tenant.id, id: { in: topClientCardIds } },
        select: { id: true, phone: true },
      })
    : [];
  const phoneByCardId = new Map(cardPhoneRows.map((r) => [r.id, r.phone]));

  const topClients: PfsTopClientRow[] = customerGrouped.map((c) => {
    const meta = clientNameMap.get(c.pfsCustomerId);
    return {
      adminClientCardId: meta?.adminClientCardId ?? null,
      pfsCustomerId: c.pfsCustomerId,
      customerName: meta?.customerName ?? "(inconnu)",
      customerShop: meta?.customerShop ?? null,
      customerCountry: meta?.customerCountry ?? null,
      customerPhone: meta?.adminClientCardId ? phoneByCardId.get(meta.adminClientCardId) ?? null : null,
      ordersCount: c._count._all,
      totalHT: decimalToNumber(c._sum.totalHT),
      totalTTC: decimalToNumber(c._sum.totalTTC),
      lastOrderAt: c._max.createdAtPfs?.toISOString() ?? null,
    };
  });

  // Enrichir top produits avec le nom
  const productIds = itemGrouped.map((r) => r.productId).filter((x): x is string => Boolean(x));
  const productRows = productIds.length
    ? await prisma.product.findMany({
        where: { tenantId: tenant.id, id: { in: productIds } },
        select: { id: true, name: true },
      })
    : [];
  const productNameMap = new Map(productRows.map((p) => [p.id, p.name]));

  // Récupérer une image de vignette par produit (préférence : variante isPrimary).
  const productImageMap = new Map<string, string>();
  if (productIds.length) {
    const imageRows = await prisma.productColorImage.findMany({
      where: { tenantId: tenant.id, productId: { in: productIds }, order: 0 },
      select: {
        productId: true,
        path: true,
        productColor: { select: { isPrimary: true } },
      },
    });
    for (const row of imageRows) {
      const existing = productImageMap.get(row.productId);
      const isPrimary = row.productColor?.isPrimary ?? false;
      if (!existing || isPrimary) {
        productImageMap.set(row.productId, row.path);
      }
    }
  }

  // Répartition des ventes par couleur pour chaque top produit
  const topProductRefs = itemGrouped.map((r) => r.pfsProductRef);
  const colorGrouped = topProductRefs.length
    ? await prisma.pfsOrderItem.groupBy({
        where: {
          tenantId: tenant.id,
          pfsOrder: orderWhere,
          pfsProductRef: { in: topProductRefs },
        },
        by: ["pfsProductRef", "productColorId", "colorLabelFr", "colorCodePfs"],
        _sum: { qtyValidated: true, totalPriceHT: true },
      })
    : [];

  const colorPcIds = colorGrouped
    .map((c) => c.productColorId)
    .filter((x): x is string => Boolean(x));
  const productColorRows = colorPcIds.length
    ? await prisma.productColor.findMany({
        where: { tenantId: tenant.id, id: { in: colorPcIds } },
        select: {
          id: true,
          color: { select: { hex: true, patternImage: true } },
        },
      })
    : [];
  const productColorMap = new Map(productColorRows.map((r) => [r.id, r.color]));

  // Fallback : matcher par pfsColorRef (colorCodePfs) ou par nom de couleur
  const pfsColorRefs = Array.from(
    new Set(
      colorGrouped
        .map((c) => c.colorCodePfs)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const colorLabels = Array.from(
    new Set(
      colorGrouped
        .map((c) => c.colorLabelFr)
        .filter((x): x is string => Boolean(x)),
    ),
  );
  const fallbackColorRows = pfsColorRefs.length || colorLabels.length
    ? await prisma.color.findMany({
        where: {
          tenantId: tenant.id,
          OR: [
            ...(pfsColorRefs.length ? [{ pfsColorRef: { in: pfsColorRefs } }] : []),
            ...(colorLabels.length ? [{ name: { in: colorLabels } }] : []),
          ],
        },
        select: { name: true, hex: true, patternImage: true, pfsColorRef: true },
      })
    : [];
  const colorByPfsRef = new Map<string, { hex: string | null; patternImage: string | null }>();
  const colorByName = new Map<string, { hex: string | null; patternImage: string | null }>();
  for (const c of fallbackColorRows) {
    if (c.pfsColorRef) {
      colorByPfsRef.set(c.pfsColorRef, { hex: c.hex, patternImage: c.patternImage });
    }
    colorByName.set(c.name.toLowerCase(), { hex: c.hex, patternImage: c.patternImage });
  }

  const colorsByRef = new Map<string, PfsTopProductColorBreakdown[]>();
  for (const c of colorGrouped) {
    const arr = colorsByRef.get(c.pfsProductRef) ?? [];
    const fromPc = c.productColorId ? productColorMap.get(c.productColorId) : null;
    const fromPfsRef = c.colorCodePfs ? colorByPfsRef.get(c.colorCodePfs) : null;
    const fromName = c.colorLabelFr ? colorByName.get(c.colorLabelFr.toLowerCase()) : null;
    const hex = fromPc?.hex ?? fromPfsRef?.hex ?? fromName?.hex ?? null;
    const patternImage =
      fromPc?.patternImage ?? fromPfsRef?.patternImage ?? fromName?.patternImage ?? null;
    arr.push({
      productColorId: c.productColorId,
      colorLabelFr: c.colorLabelFr,
      colorCodePfs: c.colorCodePfs,
      quantitySold: c._sum.qtyValidated ?? 0,
      totalHT: decimalToNumber(c._sum.totalPriceHT),
      hex,
      patternImage,
    });
    colorsByRef.set(c.pfsProductRef, arr);
  }
  for (const arr of colorsByRef.values()) {
    arr.sort((a, b) => b.quantitySold - a.quantitySold);
  }

  const topProducts: PfsTopProductRow[] = itemGrouped.map((r) => {
    const rawImage = r.productId ? productImageMap.get(r.productId) ?? null : null;
    return {
      productId: r.productId,
      productName: r.productId ? productNameMap.get(r.productId) ?? null : null,
      productImage: rawImage ? getImageSrc(rawImage, "thumb") : null,
      pfsProductRef: r.pfsProductRef,
      quantitySold: r._sum.qtyValidated ?? 0,
      totalHT: decimalToNumber(r._sum.totalPriceHT),
      colors: colorsByRef.get(r.pfsProductRef) ?? [],
    };
  });

  const statusCounts = {
    NEW: 0,
    VALIDATED: 0,
    SENT: 0,
    CANCELLED: 0,
  } as Record<"NEW" | "VALIDATED" | "SENT" | "CANCELLED", number>;
  for (const s of statusRows) {
    statusCounts[s.status] = s._count._all;
  }

  return {
    period: input.period,
    kpis,
    topClients,
    topProducts,
    statusCounts,
  };
}

// ─────────────────────────────────────────────
// Détail d'une commande + articles enrichis
// ─────────────────────────────────────────────

export interface PfsOrderItemDetail {
  id: string;
  pfsItemId: string;
  pfsProductRef: string;
  productId: string | null;
  productName: string | null;
  colorLabelFr: string | null;
  colorCodePfs: string | null;
  sizeLabel: string | null;
  sizeDetails: string | null;
  itemType: string;
  qtyOrdered: number;
  qtyValidated: number;
  unitPriceHT: number;
  totalPriceHT: number;
}

export interface PfsOrderDetailFull {
  id: string;
  pfsOrderId: string;
  orderNumber: string;
  createdAtPfs: string;
  status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED";
  canceledAt: string | null;
  totalHT: number;
  totalTTC: number;
  vatAmount: number;
  vatRate: number;
  totalWeight: number | null;
  totalOrderedQty: number;
  totalValidatedQty: number;
  uniqueReferences: number;
  hasInvoice: boolean;
  hasCredit: boolean;
  carrier: string | null;
  paymentMethod: string | null;
  customerName: string;
  customerShop: string | null;
  customerCountry: string | null;
  adminClientCardId: string | null;
  statusTimeline: Array<{ status: string; timestamp: string; paymentMethod?: string }>;
  deliveryAddress: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  billingAddress: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
  } | null;
  siret: string | null;
  vatNumber: string | null;
  phone: string | null;
  items: PfsOrderItemDetail[];
}

export async function getPfsOrderDetail(orderId: string): Promise<PfsOrderDetailFull | null> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const row = await prisma.pfsOrder.findFirst({
    where: { tenantId: tenant.id, id: orderId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;

  const raw = row.rawDetailJson as {
    customer?: {
      identification_numbers?: { siret?: string | null; vat?: string | null };
      phone?: string | null;
      delivery_address?: { street?: string | null; postal_code?: string | null; city?: string | null; country?: string | null } | null;
      billing_address?: { street?: string | null; postal_code?: string | null; city?: string | null; country?: string | null } | null;
    };
  } | null;

  const cust = raw?.customer ?? undefined;
  const delivery = cust?.delivery_address
    ? {
        street: cust.delivery_address.street ?? null,
        postalCode: cust.delivery_address.postal_code ?? null,
        city: cust.delivery_address.city ?? null,
        country: cust.delivery_address.country ?? null,
      }
    : null;
  const billing = cust?.billing_address
    ? {
        street: cust.billing_address.street ?? null,
        postalCode: cust.billing_address.postal_code ?? null,
        city: cust.billing_address.city ?? null,
        country: cust.billing_address.country ?? null,
      }
    : null;

  const timeline = Array.isArray(row.statusTimelineJson)
    ? (row.statusTimelineJson as Array<{ status: string; timestamp: string; payment_method?: string }>).map((t) => ({
        status: t.status,
        timestamp: t.timestamp,
        paymentMethod: t.payment_method,
      }))
    : [];

  return {
    id: row.id,
    pfsOrderId: row.pfsOrderId,
    orderNumber: row.orderNumber,
    createdAtPfs: row.createdAtPfs.toISOString(),
    status: row.status,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    totalHT: decimalToNumber(row.totalHT),
    totalTTC: decimalToNumber(row.totalTTC),
    vatAmount: decimalToNumber(row.vatAmount),
    vatRate: decimalToNumber(row.vatRate),
    totalWeight: row.totalWeight != null ? decimalToNumber(row.totalWeight) : null,
    totalOrderedQty: row.totalOrderedQty,
    totalValidatedQty: row.totalValidatedQty,
    uniqueReferences: row.uniqueReferences,
    hasInvoice: row.hasInvoice,
    hasCredit: row.hasCredit,
    carrier: row.carrier,
    paymentMethod: row.paymentMethod,
    customerName: row.customerName,
    customerShop: row.customerShop,
    customerCountry: row.customerCountry,
    adminClientCardId: row.adminClientCardId,
    statusTimeline: timeline,
    deliveryAddress: delivery,
    billingAddress: billing,
    siret: cust?.identification_numbers?.siret ?? null,
    vatNumber: cust?.identification_numbers?.vat ?? null,
    phone: cust?.phone ?? null,
    items: row.items.map((it) => ({
      id: it.id,
      pfsItemId: it.pfsItemId,
      pfsProductRef: it.pfsProductRef,
      productId: it.productId,
      productName: it.product?.name ?? it.productSnapshotName ?? null,
      colorLabelFr: it.colorLabelFr,
      colorCodePfs: it.colorCodePfs,
      sizeLabel: it.sizeLabel,
      sizeDetails: it.sizeDetails,
      itemType: it.itemType,
      qtyOrdered: it.qtyOrdered,
      qtyValidated: it.qtyValidated,
      unitPriceHT: decimalToNumber(it.unitPriceHT),
      totalPriceHT: decimalToNumber(it.totalPriceHT),
    })),
  };
}

// ─────────────────────────────────────────────
// Sync manuelle + import historique
// ─────────────────────────────────────────────

export async function syncPfsOrdersNow(): Promise<
  | { success: true; created: number; updated: number; scanned: number }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const res = await syncRecentPfsOrders(tenant.id);
    revalidatePath("/admin/commandes");
    return { success: true, ...res };
  } catch (err) {
    logger.error("[PFS Orders] syncPfsOrdersNow échec", { error: err as Error });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

export async function resyncPfsOrderById(
  orderId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const row = await prisma.pfsOrder.findFirst({
      where: { tenantId: tenant.id, id: orderId },
      select: { pfsOrderId: true },
    });
    if (!row) return { success: false, error: "Commande introuvable." };
    await syncSinglePfsOrder(tenant.id, row.pfsOrderId);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function startPfsHistoricalImport(): Promise<PfsImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return startPfsHistoricalImportInBackground(tenant.id);
}

export async function stopPfsHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await requestStopPfsHistoricalImport(tenant.id);
  return { success: true };
}

export async function acknowledgePfsHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await resetPfsImportState(tenant.id);
  return { success: true };
}

export async function getPfsImportStateAction(): Promise<PfsImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return getPfsImportState(tenant.id);
}

export async function getPfsSyncMeta(): Promise<{
  lastSyncedAt: string | null;
  totalOrdersInDb: number;
  hasCredentials: boolean;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const [lastSyncRow, credsRows, totalOrdersInDb] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "pfs_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findMany({
      where: { tenantId: tenant.id, key: { in: ["pfs_email", "pfs_password"] } },
      select: { key: true, value: true },
    }),
    prisma.pfsOrder.count({ where: { tenantId: tenant.id } }),
  ]);

  const credsMap = new Map(credsRows.map((r) => [r.key, r.value]));
  const hasCredentials =
    (credsMap.get("pfs_email") || "").trim().length > 0 &&
    (credsMap.get("pfs_password") || "").trim().length > 0;

  const lastSyncedAt = lastSyncRow?.value
    ? new Date(parseInt(lastSyncRow.value, 10)).toISOString()
    : null;

  return { lastSyncedAt, totalOrdersInDb, hasCredentials };
}

/** Liste les commandes PFS d'un client donné (pour AdminCardDrawer). */
export async function listPfsOrdersForClientCard(adminClientCardId: string): Promise<PfsOrderListItem[]> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const rows = await prisma.pfsOrder.findMany({
    where: { tenantId: tenant.id, adminClientCardId },
    orderBy: { createdAtPfs: "desc" },
    select: {
      id: true,
      pfsOrderId: true,
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
      hasCredit: true,
    },
  });
  const stockDeductionByOrder = await computeStockDeductionMap(
    tenant.id,
    rows.map((r) => ({ id: r.id, status: r.status })),
  );

  return rows.map((r) => {
    const stock = stockDeductionByOrder.get(r.id)!;
    return {
      id: r.id,
      pfsOrderId: r.pfsOrderId,
      orderNumber: r.orderNumber,
      createdAtPfs: r.createdAtPfs.toISOString(),
      status: r.status,
      customerName: r.customerName,
      customerShop: r.customerShop,
      customerCountry: r.customerCountry,
      carrier: r.carrier,
      totalTTC: decimalToNumber(r.totalTTC),
      totalHT: decimalToNumber(r.totalHT),
      hasInvoice: r.hasInvoice,
      hasCredit: r.hasCredit,
      stockDeductionState: stock.state,
      ...(stock.reason ? { stockDeductionReason: stock.reason } : {}),
    };
  });
}

/**
 * Calcule pour chaque commande PFS son état de déduction de stock.
 *
 * Règle métier : le bouton « Déduire stock PFS » est **irréversible et non rejouable**
 * pour une commande donnée. Une commande passe donc par :
 *  - NOT_APPLICABLE si status NEW ou CANCELLED,
 *  - DONE dès qu'au moins un article a été décrémenté (aucun retour arrière possible),
 *  - NOTHING_TO_DEDUCT s'il n'existe aucun article rattaché à la boutique,
 *  - PENDING sinon (au moins un article rattaché, clic « Déduire » pas encore effectué).
 *
 * Pour les commandes NOTHING_TO_DEDUCT, joint un échantillon des articles non rattachés
 * afin d'expliquer visuellement pourquoi rien ne peut être déduit.
 */
async function computeStockDeductionMap(
  tenantId: string,
  rows: Array<{ id: string; status: "NEW" | "VALIDATED" | "SENT" | "CANCELLED" }>,
): Promise<
  Map<
    string,
    {
      state: PfsStockDeductionState;
      reason?: PfsNothingToDeductReason;
    }
  >
> {
  const orderIds = rows.map((r) => r.id);
  const result = new Map<
    string,
    {
      state: PfsStockDeductionState;
      reason?: PfsNothingToDeductReason;
    }
  >();
  if (!orderIds.length) return result;

  const [eligibleGroups, deductedGroups] = await Promise.all([
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
      where: {
        tenantId,
        pfsOrderId: { in: orderIds },
        stockDeductedAt: { not: null },
      },
      _count: { id: true },
    }),
  ]);
  const eligibleByOrder = new Map(eligibleGroups.map((g) => [g.pfsOrderId, g._count.id]));
  const deductedByOrder = new Map(deductedGroups.map((g) => [g.pfsOrderId, g._count.id]));

  const nothingToDeductIds: string[] = [];
  for (const r of rows) {
    const eligible = eligibleByOrder.get(r.id) ?? 0;
    const done = deductedByOrder.get(r.id) ?? 0;
    let state: PfsStockDeductionState;
    if (r.status === "NEW" || r.status === "CANCELLED") {
      state = "NOT_APPLICABLE";
    } else if (done > 0) {
      // Irréversible : dès qu'une ligne est marquée déduite, la commande est verrouillée.
      state = "DONE";
    } else if (eligible === 0) {
      state = "NOTHING_TO_DEDUCT";
      nothingToDeductIds.push(r.id);
    } else {
      state = "PENDING";
    }
    result.set(r.id, { state });
  }

  if (nothingToDeductIds.length > 0) {
    // 1 seule requête : on récupère tous les items non rattachés des commandes concernées.
    // Ordonnancement par commande + pfsProductRef pour un rendu stable.
    const unlinkedRows = await prisma.pfsOrderItem.findMany({
      where: {
        tenantId,
        pfsOrderId: { in: nothingToDeductIds },
        OR: [{ productId: null }, { productColorId: null }],
      },
      orderBy: [{ pfsOrderId: "asc" }, { pfsProductRef: "asc" }],
      select: {
        pfsOrderId: true,
        pfsProductRef: true,
        productSnapshotName: true,
        colorLabelFr: true,
        sizeLabel: true,
      },
    });

    const byOrder = new Map<string, PfsUnlinkedItem[]>();
    const totalByOrder = new Map<string, number>();
    for (const it of unlinkedRows) {
      const total = (totalByOrder.get(it.pfsOrderId) ?? 0) + 1;
      totalByOrder.set(it.pfsOrderId, total);
      const arr = byOrder.get(it.pfsOrderId) ?? [];
      if (arr.length < 5) {
        arr.push({
          pfsProductRef: it.pfsProductRef,
          productName: it.productSnapshotName,
          colorLabel: it.colorLabelFr,
          sizeLabel: it.sizeLabel,
        });
      }
      byOrder.set(it.pfsOrderId, arr);
    }

    for (const orderId of nothingToDeductIds) {
      const entry = result.get(orderId)!;
      const sample = byOrder.get(orderId) ?? [];
      const total = totalByOrder.get(orderId) ?? 0;
      entry.reason = {
        hasNoItems: total === 0,
        totalUnlinkedCount: total,
        sampleUnlinkedItems: sample,
      };
    }
  }

  return result;
}

/**
 * Traduit le filtre stock UI en clause `where` Prisma sur PfsOrder.
 * Reflète les états métier :
 *   - pending : commande validée/envoyée + au moins un article rattaché + aucun article encore déduit
 *   - done    : commande validée/envoyée + au moins un article déjà déduit (irréversible)
 *   - nothing : commande validée/envoyée + aucun article rattaché à la boutique
 */
function buildStockFilterWhere(filter: PfsStockFilter): Record<string, unknown> {
  if (filter === "all") return {};
  const activeStatuses = { in: ["VALIDATED", "SENT"] as const };
  if (filter === "done") {
    return {
      status: activeStatuses,
      items: { some: { stockDeductedAt: { not: null } } },
    };
  }
  if (filter === "pending") {
    return {
      status: activeStatuses,
      items: {
        some: { productId: { not: null }, productColorId: { not: null } },
        none: { stockDeductedAt: { not: null } },
      },
    };
  }
  // nothing : aucun item n'est rattaché à la boutique
  return {
    status: activeStatuses,
    NOT: {
      items: {
        some: { productId: { not: null }, productColorId: { not: null } },
      },
    },
  };
}

// ─────────────────────────────────────────────
// Déduction manuelle d'une seule commande PFS
// ─────────────────────────────────────────────

export interface PfsSingleOrderDeductionPreview {
  orderId: string;
  orderNumber: string;
  lines: Array<{
    pfsOrderItemId: string;
    pfsProductRef: string;
    productName: string | null;
    colorLabel: string | null;
    sizeLabel: string | null;
    qtyValidated: number;
    saleType: "UNIT" | "PACK";
    variantChanges: Array<{
      productColorId: string;
      colorLabel: string;
      sizeLabel: string;
      unitsRemoved: number;
      currentStock: number;
      nextStock: number;
    }>;
    skipReason?: string;
  }>;
  totalUnitsRemoved: number;
}

export async function previewPfsOrderStockDeduction(
  orderId: string,
): Promise<
  | { success: true; preview: PfsSingleOrderDeductionPreview }
  | { success: false; error: string }
> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const { simulatePfsStockDeductionForOrder } = await import("@/lib/pfs-stock-deduction");
    const preview = await simulatePfsStockDeductionForOrder(tenant.id, orderId);
    if (!preview) return { success: false, error: "Commande introuvable." };
    return { success: true, preview };
  } catch (err) {
    logger.error("[PFS Stock] Preview échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function runPfsOrderStockDeductionOne(
  orderId: string,
): Promise<
  | {
      success: true;
      processedCount: number;
      skippedCount: number;
      touchedProductIds: string[];
    }
  | { success: false; error: string }
> {
  const session = await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const { deductStockFromPfsOrders } = await import("@/lib/pfs-stock-deduction");
    const result = await deductStockFromPfsOrders(tenant.id, session.user.id ?? null, { pfsOrderIds: [orderId] });
    if (result.touchedProductIds.length > 0) {
      revalidateTag("products", "default");
      revalidateTag("dashboard-stats", "default");
      revalidatePath("/admin/produits");
    }
    revalidatePath("/admin/commandes");
    return {
      success: true,
      processedCount: result.processedCount,
      skippedCount: result.skipped.length,
      touchedProductIds: result.touchedProductIds,
    };
  } catch (err) {
    logger.error("[PFS Stock] Déduction commande unique échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

/** Force la revalidation du cache commandes (invalidateur pour l'UI). */
export async function invalidatePfsOrdersCache(): Promise<void> {
  await requireAdmin();
  revalidatePath("/admin/commandes");
  revalidatePath("/admin/utilisateurs");
  revalidateTag("pfs-orders", "default");
}
