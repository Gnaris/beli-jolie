"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireCurrentTenant } from "@/lib/tenant";
import { logger } from "@/lib/logger";
import {
  getEfashionImportState,
  startEfashionHistoricalImportInBackground,
  requestStopEfashionHistoricalImport,
  resetEfashionImportState,
} from "@/lib/efashion-orders-import-state";
export type {
  EfashionImportState,
  EfashionImportRecentEvent,
  EfashionImportCurrentOrder,
} from "@/lib/efashion-orders-import-state";
import type { EfashionImportState } from "@/lib/efashion-orders-import-state";
import {
  syncRecentEfashionOrders,
  syncSingleEfashionOrder,
} from "@/lib/efashion-orders-sync";
import { getImageSrc } from "@/lib/image-utils";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

function decimalToNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  const asString = (v as { toString: () => string }).toString();
  return Number(asString);
}

// ─────────────────────────────────────────────
// Sync manuelle + import historique
// ─────────────────────────────────────────────

export async function syncEfashionOrdersNow(): Promise<
  | { success: true; created: number; updated: number; scanned: number }
  | { success: false; error: string }
> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const res = await syncRecentEfashionOrders(tenant.id);
    revalidatePath("/admin/commandes");
    return { success: true, ...res };
  } catch (err) {
    logger.error("[eFashion Orders] syncEfashionOrdersNow échec", { error: err as Error });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur inconnue",
    };
  }
}

export async function resyncEfashionOrderById(
  orderId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
    const tenant = await requireCurrentTenant();
    const row = await prisma.efashionOrder.findFirst({
      where: { tenantId: tenant.id, id: orderId },
      select: { efashionOrderId: true },
    });
    if (!row) return { success: false, error: "Commande introuvable." };
    await syncSingleEfashionOrder(tenant.id, row.efashionOrderId);
    revalidatePath("/admin/commandes");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function startEfashionHistoricalImport(): Promise<EfashionImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return startEfashionHistoricalImportInBackground(tenant.id);
}

export async function stopEfashionHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await requestStopEfashionHistoricalImport(tenant.id);
  return { success: true };
}

export async function acknowledgeEfashionHistoricalImport(): Promise<{ success: true }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  await resetEfashionImportState(tenant.id);
  return { success: true };
}

export async function getEfashionImportStateAction(): Promise<EfashionImportState> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  return getEfashionImportState(tenant.id);
}

export async function getEfashionSyncMeta(): Promise<{
  lastSyncedAt: string | null;
  totalOrdersInDb: number;
  hasCredentials: boolean;
}> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const [lastSyncRow, credsRows, totalOrdersInDb] = await Promise.all([
    prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: "efashion_orders_last_synced_at" },
      select: { value: true },
    }),
    prisma.siteConfig.findMany({
      where: { tenantId: tenant.id, key: { in: ["efashion_email", "efashion_password"] } },
      select: { key: true, value: true },
    }),
    prisma.efashionOrder.count({ where: { tenantId: tenant.id } }),
  ]);

  const credsMap = new Map(credsRows.map((r) => [r.key, r.value]));
  const hasCredentials =
    (credsMap.get("efashion_email") || "").trim().length > 0 &&
    (credsMap.get("efashion_password") || "").trim().length > 0;

  const lastSyncedAt = lastSyncRow?.value
    ? new Date(parseInt(lastSyncRow.value, 10)).toISOString()
    : null;

  return { lastSyncedAt, totalOrdersInDb, hasCredentials };
}

// ─────────────────────────────────────────────
// Détail d'une commande + articles enrichis
// ─────────────────────────────────────────────

export interface EfashionOrderItemDetail {
  id: string;
  referenceFull: string;
  referenceBase: string;
  productId: string | null;
  productColorId: string | null;
  productName: string | null;
  productImage: string | null;
  colorLabelFr: string | null;
  qtyTotal: number;
  qtyPackUnit: number;
  // Répartition par taille : q1..q12 croisé avec d1_FR..d12_FR
  sizes: Array<{ sizeLabelFr: string | null; quantity: number }>;
  unitPriceHT: number;
  totalLineHT: number;
  provenanceCode: string | null;
  category: string | null;
}

export interface EfashionOrderDetailFull {
  id: string;
  efashionOrderId: string;
  orderNumber: string; // id_commande_name
  orderGroupe: string | null;
  createdAt: string; // ISO
  shippedAt: string | null;
  status: "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";
  statusIdRaw: number;
  statusLabelFr: string;
  totalHT: number;
  totalAfterDiscount: number;
  ca: number;
  ruptureHT: number;
  shippingCost: number | null;
  totalWeight: number | null;
  parcelCount: number;
  isFirstOrder: boolean;
  carrier: string | null;
  paymentMethod: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;

  customerName: string;
  customerContact: string | null;
  customerEmail: string | null;
  customerVatIntra: string | null;
  customerEori: string | null;
  customerCountry: string | null;

  adminClientCardId: string | null;

  deliveryAddress: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    contact: string | null;
    phone: string | null;
  } | null;
  billingAddress: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    contact: string | null;
    phone: string | null;
  } | null;

  items: EfashionOrderItemDetail[];
}

function expandItemSizes(
  quantitiesJson: unknown,
  declinaisonsJson: unknown,
): Array<{ sizeLabelFr: string | null; quantity: number }> {
  const qs = (quantitiesJson ?? {}) as Record<string, unknown>;
  const ds = (declinaisonsJson ?? {}) as Record<string, unknown>;
  const out: Array<{ sizeLabelFr: string | null; quantity: number }> = [];
  for (let i = 1; i <= 12; i++) {
    const rawQty = qs[`q${i}`];
    const q = typeof rawQty === "number" ? rawQty : Number(rawQty ?? 0);
    if (!Number.isFinite(q) || q <= 0) continue;
    const rawLabel = ds[`d${i}_FR`];
    const sizeLabelFr = typeof rawLabel === "string" ? rawLabel : null;
    out.push({ sizeLabelFr, quantity: q });
  }
  return out;
}

export async function getEfashionOrderDetail(
  orderId: string,
): Promise<EfashionOrderDetailFull | null> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  const row = await prisma.efashionOrder.findFirst({
    where: { tenantId: tenant.id, id: orderId },
    include: {
      items: {
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;

  // Adresses depuis le rawDetailJson
  const raw = row.rawDetailJson as {
    adresseLivraison?: {
      adresse?: string | null;
      codePostal?: string | null;
      ville?: string | null;
      NomContact?: string | null;
      telephone?: string | null;
      mobile?: string | null;
      pays?: { code?: string | null; texte_fr?: string | null } | null;
    } | null;
    adresseFacturation?: {
      adresse?: string | null;
      codePostal?: string | null;
      ville?: string | null;
      NomContact?: string | null;
      telephone?: string | null;
      mobile?: string | null;
      pays?: { code?: string | null; texte_fr?: string | null } | null;
    } | null;
  } | null;

  const buildAddr = (a: NonNullable<typeof raw>["adresseLivraison"]) =>
    a
      ? {
          street: a.adresse ?? null,
          postalCode: a.codePostal ?? null,
          city: a.ville ?? null,
          country: a.pays?.texte_fr ?? a.pays?.code ?? null,
          contact: a.NomContact ?? null,
          phone: a.telephone ?? a.mobile ?? null,
        }
      : null;

  // Récupère une image thumbnail par produit
  const productIds = Array.from(
    new Set(row.items.map((it) => it.productId).filter((x): x is string => Boolean(x))),
  );
  const imageRows = productIds.length
    ? await prisma.productColorImage.findMany({
        where: { tenantId: tenant.id, productId: { in: productIds }, order: 0 },
        select: {
          productId: true,
          path: true,
          productColor: { select: { isPrimary: true } },
        },
      })
    : [];
  const imageByProduct = new Map<string, string>();
  for (const r of imageRows) {
    const existing = imageByProduct.get(r.productId);
    const primary = r.productColor?.isPrimary ?? false;
    if (!existing || primary) imageByProduct.set(r.productId, r.path);
  }

  return {
    id: row.id,
    efashionOrderId: row.efashionOrderId,
    orderNumber: row.efashionOrderName,
    orderGroupe: row.efashionOrderGroupe,
    createdAt: row.createdAtEfashion.toISOString(),
    shippedAt: row.shippedAt?.toISOString() ?? null,
    status: row.status,
    statusIdRaw: row.statusIdRaw,
    statusLabelFr: row.statusLabelFr,
    totalHT: decimalToNumber(row.totalHT),
    totalAfterDiscount: decimalToNumber(row.totalAfterDiscount),
    ca: decimalToNumber(row.ca),
    ruptureHT: decimalToNumber(row.ruptureHT),
    shippingCost: row.shippingCost != null ? decimalToNumber(row.shippingCost) : null,
    totalWeight: row.totalWeight != null ? decimalToNumber(row.totalWeight) : null,
    parcelCount: row.parcelCount,
    isFirstOrder: row.isFirstOrder,
    carrier: row.carrier,
    paymentMethod: row.paymentMethod,
    trackingNumber: row.trackingNumber,
    labelUrl: row.labelUrl,
    customerName: row.customerName,
    customerContact: row.customerContact,
    customerEmail: row.customerEmail,
    customerVatIntra: row.customerVatIntra,
    customerEori: row.customerEori,
    customerCountry: row.customerCountry,
    adminClientCardId: row.adminClientCardId,
    deliveryAddress: buildAddr(raw?.adresseLivraison ?? null),
    billingAddress: buildAddr(raw?.adresseFacturation ?? null),
    items: row.items.map((it) => {
      const rawPath = it.productId ? imageByProduct.get(it.productId) ?? null : null;
      return {
        id: it.id,
        referenceFull: it.referenceFull,
        referenceBase: it.referenceBase,
        productId: it.productId,
        productColorId: it.productColorId,
        productName: it.product?.name ?? it.productSnapshotName ?? null,
        productImage: rawPath ? getImageSrc(rawPath, "thumb") : null,
        colorLabelFr: it.colorLabelFr,
        qtyTotal: it.qtyTotal,
        qtyPackUnit: it.qtyPackUnit,
        sizes: expandItemSizes(it.quantitiesJson, it.declinaisonsJson),
        unitPriceHT: decimalToNumber(it.unitPriceHT),
        totalLineHT: decimalToNumber(it.totalLineHT),
        provenanceCode: it.provenanceCode,
        category: it.categorySnapshot,
      };
    }),
  };
}

// ─────────────────────────────────────────────
// Déduction manuelle d'une seule commande eFashion
// ─────────────────────────────────────────────

export interface EfashionSingleOrderDeductionPreview {
  orderId: string;
  orderNumber: string;
  lines: Array<{
    efashionOrderItemId: string;
    reference: string;
    productName: string | null;
    colorLabel: string | null;
    qtyTotal: number;
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

export async function previewEfashionOrderStockDeduction(
  orderId: string,
): Promise<
  | { success: true; preview: EfashionSingleOrderDeductionPreview }
  | { success: false; error: string }
> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  try {
    const { simulateEfashionStockDeductionForOrder } = await import(
      "@/lib/efashion-stock-deduction"
    );
    const preview = await simulateEfashionStockDeductionForOrder(tenant.id, orderId);
    if (!preview) return { success: false, error: "Commande introuvable." };
    return { success: true, preview };
  } catch (err) {
    logger.error("[eFashion Stock] Preview échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}

export async function runEfashionOrderStockDeductionOne(
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
    const { deductStockFromEfashionOrders } = await import("@/lib/efashion-stock-deduction");
    const result = await deductStockFromEfashionOrders(tenant.id, session.user.id ?? null, [
      orderId,
    ]);
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
    logger.error("[eFashion Stock] Déduction commande unique échouée", { error: err });
    return { success: false, error: err instanceof Error ? err.message : "Erreur inconnue" };
  }
}
