/**
 * Ankorstore Orders Sync — synchronisation lecture seule des commandes Ankorstore.
 *
 * Deux modes (calqués sur `lib/pfs-orders-sync.ts` et `lib/efashion-orders-sync.ts`) :
 *  - `syncRecentAnkorstoreOrders(tenantId)`  : lit la 1ère page, upsert les
 *    commandes nouvelles ou dont `updatedAt` a évolué. Ne parcourt qu'une page.
 *  - `importAllAnkorstoreOrdersFor(tenantId, onProgress)` : rattrapage historique
 *    complet via curseur JSON:API (`page[after]`), boucle jusqu'à `hasMore=false`.
 *
 * Contrairement à PFS et eFashion, l'API Ankorstore inclut retailer / order-items /
 * variants / products dans la même réponse (JSON:API includes) — pas besoin d'un
 * appel détail par commande. Ça rend la sync très rapide.
 *
 * Matching produit :
 *   1. Product.ankorsProductId == variant.product.id (le plus fiable)
 *   2. ProductColor.ankorsVariantId == variant.id
 *   3. Fallback : Product.reference == referenceBase extraite du SKU
 *
 * Upsert fiche client (AdminClientCard) :
 *   1. tenantId + ankorstoreRetailerId (lookup direct)
 *   2. SIRET (businessIdentifier ou taxNumber, normalisé)
 *   3. Création `importedFromMarketplace = "ANKORSTORE"`, `hasAnkorstore = true`
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { findClientCardByEmailForDedup } from "@/lib/marketplace-client-dedup";
import {
  ankorstoreCentsToEuros,
  ankorstoreListOrders,
  extractReferenceFromSku,
  extractTrackingInfo,
  normalizeAnkorstoreStatus,
  type AnkorstoreBillingItemResource,
  type AnkorstoreIncludedResource,
  type AnkorstoreOrderItemResource,
  type AnkorstoreOrderResource,
  type AnkorstoreProductVariantResource,
  type AnkorstoreRetailerAttributes,
  type AnkorstoreRetailerResource,
} from "@/lib/ankorstore-orders-api";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Client card upsert
// ─────────────────────────────────────────────

function normalizeIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\s+/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function pickCustomerNameParts(r: AnkorstoreRetailerAttributes): {
  firstName: string;
  lastName: string;
} {
  const first = (r.firstName ?? "").trim();
  const last = (r.lastName ?? "").trim();
  if (first || last) return { firstName: first, lastName: last || "(client Ankorstore)" };
  // Aucun nom : on retombe sur le storeName ou companyName
  const shop = (r.storeName ?? r.companyName ?? "").trim();
  return { firstName: "", lastName: shop || "(client Ankorstore)" };
}

function maxDate(a: Date | null, b: Date): Date {
  if (!a) return b;
  return a.getTime() >= b.getTime() ? a : b;
}

interface OptionalCardFields {
  company?: string;
  siret?: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
}

function buildOptionalCardFields(r: AnkorstoreRetailerAttributes): OptionalCardFields {
  const data: OptionalCardFields = {};
  const company = (r.storeName ?? r.companyName ?? "").trim();
  if (company) data.company = company;
  const siret = normalizeIdentifier(r.businessIdentifier ?? r.taxNumber);
  if (siret) data.siret = siret;
  const vat = normalizeIdentifier(r.vatNumber);
  if (vat) data.vatNumber = vat;
  const phone = (r.phoneNumberE164 ?? "").trim();
  if (phone) data.phone = phone;
  const email = (r.email ?? "").trim();
  if (email) data.email = email;
  return data;
}

/**
 * Rattache/crée la fiche client correspondante au retailer Ankorstore.
 * Retourne l'id AdminClientCard (ou null si le retailerId manque).
 */
export async function upsertClientCardFromAnkorstoreRetailer(
  tenantId: string,
  retailerId: string,
  retailer: AnkorstoreRetailerAttributes,
  orderDate?: Date,
): Promise<string | null> {
  if (!retailerId) return null;
  const effectiveOrderDate = orderDate ?? new Date();

  // Étape 1 : lookup direct par ankorstoreRetailerId
  const existingByAnkorId = await prisma.adminClientCard.findFirst({
    where: { tenantId, ankorstoreRetailerId: retailerId },
    select: { id: true, lastOrderAt: true },
  });
  if (existingByAnkorId) {
    await prisma.adminClientCard.update({
      where: { id: existingByAnkorId.id },
      data: {
        hasAnkorstore: true,
        lastOrderAt: maxDate(existingByAnkorId.lastOrderAt, effectiveOrderDate),
        ...buildOptionalCardFields(retailer),
      },
    });
    return existingByAnkorId.id;
  }

  // Étape 2 : fallback SIRET
  const siret = normalizeIdentifier(retailer.businessIdentifier ?? retailer.taxNumber);
  if (siret) {
    const existingBySiret = await prisma.adminClientCard.findFirst({
      where: { tenantId, siret },
      select: { id: true, lastOrderAt: true },
    });
    if (existingBySiret) {
      await prisma.adminClientCard.update({
        where: { id: existingBySiret.id },
        data: {
          ankorstoreRetailerId: retailerId,
          hasAnkorstore: true,
          lastOrderAt: maxDate(existingBySiret.lastOrderAt, effectiveOrderDate),
          ...buildOptionalCardFields(retailer),
        },
      });
      return existingBySiret.id;
    }
  }

  // Étape 2 bis : fallback email cross-marketplace (rejette les emails
  // synthétiques `orders+xxx@ankorstore.com` qui sont uniques par commande).
  const existingByEmail = await findClientCardByEmailForDedup(tenantId, retailer.email);
  if (existingByEmail) {
    await prisma.adminClientCard.update({
      where: { id: existingByEmail.id },
      data: {
        ankorstoreRetailerId: retailerId,
        hasAnkorstore: true,
        lastOrderAt: maxDate(existingByEmail.lastOrderAt, effectiveOrderDate),
        ...buildOptionalCardFields(retailer),
      },
    });
    return existingByEmail.id;
  }

  // Étape 3 : création d'une nouvelle fiche
  const { firstName, lastName } = pickCustomerNameParts(retailer);
  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      hasAnkorstore: true,
      ankorstoreRetailerId: retailerId,
      importedFromMarketplace: "ANKORSTORE",
      lastOrderAt: effectiveOrderDate,
      ...buildOptionalCardFields(retailer),
    },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────────────────────────────────
// Index des `included` par (type, id)
// ─────────────────────────────────────────────

class IncludedIndex {
  private map = new Map<string, AnkorstoreIncludedResource>();

  constructor(included: AnkorstoreIncludedResource[] | undefined) {
    if (!included) return;
    for (const r of included) {
      if (r?.type && r?.id) this.map.set(`${r.type}::${r.id}`, r);
    }
  }

  get(type: string, id: string | undefined | null): AnkorstoreIncludedResource | undefined {
    if (!id) return undefined;
    return this.map.get(`${type}::${id}`);
  }

  retailer(id: string | undefined | null): AnkorstoreRetailerResource | undefined {
    return this.get("retailers", id) as AnkorstoreRetailerResource | undefined;
  }
  orderItem(id: string): AnkorstoreOrderItemResource | undefined {
    return this.get("order-items", id) as AnkorstoreOrderItemResource | undefined;
  }
  variant(id: string | undefined | null): AnkorstoreProductVariantResource | undefined {
    return this.get("productVariants", id) as AnkorstoreProductVariantResource | undefined;
  }
  billingItem(id: string): AnkorstoreBillingItemResource | undefined {
    return this.get("billing-items", id) as AnkorstoreBillingItemResource | undefined;
  }
}

// ─────────────────────────────────────────────
// Upsert commande depuis la ressource JSON:API
// ─────────────────────────────────────────────

export interface AnkorstoreOrderUpsertResult {
  orderId: string;
  created: boolean;
}

export async function upsertAnkorstoreOrderFromResource(
  tenantId: string,
  order: AnkorstoreOrderResource,
  included: AnkorstoreIncludedResource[] | undefined,
): Promise<AnkorstoreOrderUpsertResult> {
  const idx = new IncludedIndex(included);
  const attrs = order.attributes;

  const retailerRef = order.relationships?.retailer?.data as
    | { type: string; id: string }
    | null
    | undefined;
  const retailerId = retailerRef?.id ?? "";
  const retailerResource = idx.retailer(retailerId);
  const retailerAttrs: AnkorstoreRetailerAttributes = retailerResource?.attributes ?? {};

  const createdAtAnkor = new Date(attrs.createdAt);
  const submittedAt = attrs.submittedAt ? new Date(attrs.submittedAt) : null;
  const shippedAt = attrs.shippedAt ? new Date(attrs.shippedAt) : null;
  const brandPaidAt = attrs.brandPaidAt ? new Date(attrs.brandPaidAt) : null;
  const canceledAt = attrs.cancelledAt ? new Date(attrs.cancelledAt) : null;

  const status = normalizeAnkorstoreStatus(attrs.status);
  const trackingInfo = extractTrackingInfo(attrs.shippingOverview);
  const shipTo = attrs.shippingOverview?.shipToAddress ?? null;

  const customerName =
    [retailerAttrs.firstName, retailerAttrs.lastName].filter(Boolean).join(" ").trim() ||
    (retailerAttrs.storeName ?? retailerAttrs.companyName ?? "(inconnu)");

  const adminClientCardId = retailerId
    ? await upsertClientCardFromAnkorstoreRetailer(
        tenantId,
        retailerId,
        retailerAttrs,
        submittedAt ?? createdAtAnkor,
      )
    : null;

  // billing-items included (frais, shipping)
  const billingItemRefs =
    (order.relationships?.billingItems?.data as { type: string; id: string }[] | undefined) ?? [];
  const billingItems = billingItemRefs
    .map((r) => idx.billingItem(r.id))
    .filter((x): x is AnkorstoreBillingItemResource => !!x)
    .map((x) => ({ id: x.id, attributes: x.attributes }));

  const baseData: Prisma.AnkorstoreOrderUncheckedCreateInput = {
    tenantId,
    ankorstoreOrderId: order.id,
    ankorstoreMasterOrderId: attrs.masterOrderId ?? null,
    // Ankor renvoie parfois `reference` en int, parfois en string — on force
    // string pour la BDD (numéro purement affichage, pas d'arithmétique).
    reference: String(attrs.reference),
    status,
    statusRaw: attrs.status,
    currency: attrs.brandCurrency ?? "EUR",
    createdAtAnkor,
    submittedAt,
    shippedAt,
    brandPaidAt,
    canceledAt,
    brandNetAmount: new D(ankorstoreCentsToEuros(attrs.brandNetAmount)),
    brandTotalAmount: new D(ankorstoreCentsToEuros(attrs.brandTotalAmount)),
    brandTotalAmountVat: new D(ankorstoreCentsToEuros(attrs.brandTotalAmountVat)),
    brandTotalAmountWithVat: new D(ankorstoreCentsToEuros(attrs.brandTotalAmountWithVat)),
    brandRejectReason: attrs.brandRejectReason ?? null,
    retailerRejectReason: attrs.retailerRejectReason ?? null,
    retailerCancellationRequestReason: attrs.retailerCancellationRequestReason ?? null,
    billingName: attrs.billingName ?? null,
    billingOrganisationName: attrs.billingOrganisationName ?? null,
    billingStreet: attrs.billingStreet ?? null,
    billingPostalCode: attrs.billingPostalCode ?? null,
    billingCity: attrs.billingCity ?? null,
    billingCountryCode: attrs.billingCountryCode ? attrs.billingCountryCode.toUpperCase() : null,
    shippingName: shipTo?.name ?? null,
    shippingOrganisationName: shipTo?.organisationName ?? null,
    shippingStreet: shipTo?.street ?? null,
    shippingPostalCode: shipTo?.postalCode ?? null,
    shippingCity: shipTo?.city ?? null,
    shippingCountryCode: shipTo?.countryCode ? shipTo.countryCode.toUpperCase() : null,
    shippingMethod: attrs.shippingMethod ?? null,
    carrier: attrs.shippingOverview?.provider ?? null,
    trackingNumber: trackingInfo.trackingNumber,
    trackingLink: trackingInfo.trackingLink,
    trackingStatus: trackingInfo.status,
    trackingStatusDetails: trackingInfo.statusDetails,
    trackingUpdatedAt: trackingInfo.updatedAt,
    ankorstoreRetailerId: retailerId || "unknown",
    customerName,
    customerShop: retailerAttrs.storeName ?? retailerAttrs.companyName ?? null,
    customerEmail: retailerAttrs.email ?? null,
    customerPhone: retailerAttrs.phoneNumberE164 ?? null,
    customerVatNumber: retailerAttrs.vatNumber ?? null,
    customerSiret: normalizeIdentifier(retailerAttrs.businessIdentifier ?? retailerAttrs.taxNumber),
    customerCountry: shipTo?.countryCode
      ? shipTo.countryCode.toUpperCase()
      : attrs.billingCountryCode
        ? attrs.billingCountryCode.toUpperCase()
        : null,
    adminClientCardId,
    billingItemsJson: billingItems as unknown as Prisma.InputJsonValue,
    shippingOverviewJson: (attrs.shippingOverview ?? null) as unknown as Prisma.InputJsonValue,
    // On ne stocke que la ressource `order` (pas les `included` partagés entre
    // toutes les commandes de la page — sinon on multiplie 20× le même payload
    // et MySQL ferme la connexion (P1017 max_allowed_packet). Les infos
    // d'items sont déjà normalisées dans AnkorstoreOrderItem.
    rawDetailJson: order as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };

  const existing = await prisma.ankorstoreOrder.findFirst({
    where: { tenantId, ankorstoreOrderId: order.id },
    select: { id: true },
  });

  let orderRowId: string;
  let created = false;
  if (existing) {
    await prisma.ankorstoreOrder.update({ where: { id: existing.id }, data: baseData });
    orderRowId = existing.id;
  } else {
    const row = await prisma.ankorstoreOrder.create({
      data: baseData,
      select: { id: true },
    });
    orderRowId = row.id;
    created = true;
  }

  // Snapshot stockDeductedAt existants pour survivre au re-sync
  const previouslyDeducted = new Map<string, Date>();
  const existingItems = await prisma.ankorstoreOrderItem.findMany({
    where: { ankorstoreOrderId: orderRowId, stockDeductedAt: { not: null } },
    select: { ankorstoreItemId: true, stockDeductedAt: true },
  });
  for (const ex of existingItems) {
    if (ex.stockDeductedAt) previouslyDeducted.set(ex.ankorstoreItemId, ex.stockDeductedAt);
  }

  // Rebuild items
  await prisma.ankorstoreOrderItem.deleteMany({
    where: { ankorstoreOrderId: orderRowId },
  });

  const itemRefs =
    (order.relationships?.orderItems?.data as { type: string; id: string }[] | undefined) ?? [];
  const items = itemRefs
    .map((r) => idx.orderItem(r.id))
    .filter((x): x is AnkorstoreOrderItemResource => !!x);

  if (items.length > 0) {
    // Résoudre les variants + produits BJ en un shot
    const variantIds = new Set<string>();
    const skus = new Set<string>();
    const productIdsAnkor = new Set<string>();
    const refBases = new Set<string>();

    const perItem: Array<{
      item: AnkorstoreOrderItemResource;
      variantId: string | null;
      sku: string | null;
      productIdAnkor: string | null;
      refBase: string | null;
      productSnapshotName: string | null;
      variantOptionLabel: string | null;
    }> = [];

    for (const it of items) {
      const variantRef = it.relationships?.productVariant?.data as
        | { type: string; id: string }
        | null
        | undefined;
      const variantId = variantRef?.id ?? null;
      const variant = idx.variant(variantId);
      const sku = variant?.attributes?.sku ?? null;
      const productRef = variant?.relationships?.product?.data as
        | { type: string; id: string }
        | null
        | undefined;
      const productIdAnkor = productRef?.id ?? null;
      const refBase = extractReferenceFromSku(sku);
      const productSnapshotName = variant?.attributes?.name ?? null;
      const variantOptionLabel = variant?.attributes?.optionLabel ?? null;

      if (variantId) variantIds.add(variantId);
      if (sku) skus.add(sku);
      if (productIdAnkor) productIdsAnkor.add(productIdAnkor);
      if (refBase) refBases.add(refBase);

      perItem.push({
        item: it,
        variantId,
        sku,
        productIdAnkor,
        refBase,
        productSnapshotName,
        variantOptionLabel,
      });
    }

    // Résoudre les Products BJ par 3 clés
    const bjProducts = await prisma.product.findMany({
      where: {
        tenantId,
        OR: [
          productIdsAnkor.size > 0 ? { ankorsProductId: { in: Array.from(productIdsAnkor) } } : {},
          refBases.size > 0 ? { reference: { in: Array.from(refBases) } } : {},
        ].filter((c) => Object.keys(c).length > 0),
      },
      select: {
        id: true,
        reference: true,
        name: true,
        ankorsProductId: true,
        colors: { select: { id: true, ankorsVariantId: true } },
      },
    });
    const productByAnkorId = new Map(
      bjProducts.filter((p) => p.ankorsProductId).map((p) => [p.ankorsProductId!, p]),
    );
    // Voir pfs-orders-sync.ts : MySQL case-insensitive vs Map.get case-sensitive.
    const productByRef = new Map(bjProducts.map((p) => [p.reference.toLowerCase(), p]));

    const itemRows: Prisma.AnkorstoreOrderItemUncheckedCreateInput[] = perItem.map((row) => {
      const productMatch =
        (row.productIdAnkor && productByAnkorId.get(row.productIdAnkor)) ||
        (row.refBase && productByRef.get(row.refBase.toLowerCase())) ||
        null;
      const productColorMatch =
        productMatch && row.variantId
          ? productMatch.colors.find((c) => c.ankorsVariantId === row.variantId) ?? null
          : null;

      const attrs = row.item.attributes;
      return {
        tenantId,
        ankorstoreOrderId: orderRowId,
        ankorstoreItemId: row.item.id,
        ankorstoreVariantId: row.variantId,
        ankorstoreProductId: row.productIdAnkor,
        sku: row.sku ?? "",
        referenceBase: row.refBase,
        productId: productMatch?.id ?? null,
        productColorId: productColorMatch?.id ?? null,
        productSnapshotName: row.productSnapshotName ?? productMatch?.name ?? null,
        variantOptionLabel: row.variantOptionLabel,
        quantity: attrs.quantity ?? 0,
        multipliedQuantity: attrs.multipliedQuantity ?? attrs.quantity ?? 0,
        unitPriceHT: new D(ankorstoreCentsToEuros(attrs.brandUnitPrice)),
        totalPriceHT: new D(ankorstoreCentsToEuros(attrs.brandAmount)),
        vatAmount: new D(ankorstoreCentsToEuros(attrs.brandAmountVat)),
        totalWithVat: new D(ankorstoreCentsToEuros(attrs.brandAmountWithVat)),
        vatRate: new D(attrs.vatRate ?? 0),
        stockDeductedAt: previouslyDeducted.get(row.item.id) ?? null,
      };
    });

    await prisma.ankorstoreOrderItem.createMany({ data: itemRows });
  }

  return { orderId: orderRowId, created };
}

// ─────────────────────────────────────────────
// Sync helpers
// ─────────────────────────────────────────────

/**
 * Polling incrémental : lit la 1ère page (20 commandes triées desc par
 * createdAt, includes complets) et upsert les commandes nouvelles ou dont
 * `updatedAt` a évolué.
 *
 * Attention : `limit` doit rester modéré (≤20). Ankor sert 504 upstream
 * timeout quand include=orderItems.productVariant.product est demandé sur
 * de gros lots (testé avec 50 → 504).
 */
export async function syncRecentAnkorstoreOrders(tenantId: string): Promise<{
  created: number;
  updated: number;
  scanned: number;
}> {
  const page1 = await ankorstoreListOrders({ limit: 20 });
  const orders = page1.data ?? [];
  if (orders.length === 0) return { created: 0, updated: 0, scanned: 0 };

  const ankorIds = orders.map((o) => o.id);
  const existingRows = await prisma.ankorstoreOrder.findMany({
    where: { tenantId, ankorstoreOrderId: { in: ankorIds } },
    select: { ankorstoreOrderId: true, updatedAt: true, statusRaw: true },
  });
  const existingMap = new Map(
    existingRows.map((r) => [r.ankorstoreOrderId, { updatedAt: r.updatedAt, statusRaw: r.statusRaw }]),
  );

  let created = 0;
  let updated = 0;
  for (const order of orders) {
    const existing = existingMap.get(order.id);
    const apiUpdated = order.attributes.updatedAt
      ? new Date(order.attributes.updatedAt).getTime()
      : 0;
    const bddUpdated = existing?.updatedAt.getTime() ?? 0;
    const statusChanged = existing && existing.statusRaw !== order.attributes.status;
    // Ré-import si nouveau, ou si l'API dit updatedAt plus récent, ou status a changé
    if (!existing || apiUpdated > bddUpdated || statusChanged) {
      try {
        const res = await upsertAnkorstoreOrderFromResource(tenantId, order, page1.included);
        if (res.created) created++;
        else updated++;
      } catch (err) {
        logger.warn("[Ankorstore Orders Sync] Échec import commande", {
          tenantId,
          ankorstoreOrderId: order.id,
          error: err,
        });
      }
    }
  }

  return { created, updated, scanned: orders.length };
}

// ─────────────────────────────────────────────
// Import historique (bulk)
// ─────────────────────────────────────────────

export interface AnkorstoreImportCurrentOrder {
  ankorstoreOrderId: string;
  reference: string;
  customerName: string;
  totalTTC: number | null;
  country: string | null;
}

export interface AnkorstoreImportProgress {
  totalOrders: number | null; // Ankor n'expose pas de total → null
  processedOrders: number;
  currentPage: number;
  currentOrders: AnkorstoreImportCurrentOrder[];
}

export interface AnkorstoreImportEvent {
  reference: string;
  customerName: string;
  result: "imported" | "unchanged" | "error";
  totalTTC: number | null;
  errorMessage?: string;
  at: number;
}

// Attention : Ankor sert 504 upstream timeout au-delà de ~25 items par page
// quand include=orderItems.productVariant.product est demandé. On reste sur 20
// pour rester dans une marge confortable.
const IMPORT_PAGE_SIZE = 20;

/**
 * Rattrapage historique : parcourt les pages via curseur (`page[after]`) et
 * upsert toutes les commandes non encore à jour. Publie la progression sur
 * chaque commande traitée.
 */
export async function importAllAnkorstoreOrdersFor(
  tenantId: string,
  onProgress?: (p: AnkorstoreImportProgress) => void | Promise<void>,
  opts?: {
    stopSignal?: () => boolean | Promise<boolean>;
    onEvent?: (e: AnkorstoreImportEvent) => void | Promise<void>;
  },
): Promise<{ imported: number; skipped: number; unchanged: number; total: number }> {
  const state = { processed: 0, imported: 0, skipped: 0, unchanged: 0 };
  let currentPage = 0;
  let after: string | null = null;
  const currentOrdersMap = new Map<string, AnkorstoreImportCurrentOrder>();

  const emitProgress = async () => {
    if (!onProgress) return;
    await onProgress({
      totalOrders: null,
      processedOrders: state.processed,
      currentPage,
      currentOrders: Array.from(currentOrdersMap.values()),
    });
  };

  while (true) {
    if (opts?.stopSignal && (await opts.stopSignal())) break;

    currentPage++;
    const resp = await ankorstoreListOrders({ limit: IMPORT_PAGE_SIZE, after: after ?? undefined });
    const orders = resp.data ?? [];
    if (orders.length === 0) break;

    // Comparaison bulk : quelles commandes ont vraiment besoin d'un upsert ?
    const ankorIds = orders.map((o) => o.id);
    const existingRows = await prisma.ankorstoreOrder.findMany({
      where: { tenantId, ankorstoreOrderId: { in: ankorIds } },
      select: { ankorstoreOrderId: true, updatedAt: true, statusRaw: true },
    });
    const existingMap = new Map(
      existingRows.map((r) => [r.ankorstoreOrderId, { updatedAt: r.updatedAt, statusRaw: r.statusRaw }]),
    );

    for (const order of orders) {
      if (opts?.stopSignal && (await opts.stopSignal())) break;

      const existing = existingMap.get(order.id);
      const apiUpdated = order.attributes.updatedAt
        ? new Date(order.attributes.updatedAt).getTime()
        : 0;
      const bddUpdated = existing?.updatedAt.getTime() ?? 0;
      const statusChanged = existing && existing.statusRaw !== order.attributes.status;
      const needsSync = !existing || apiUpdated > bddUpdated || statusChanged;

      const totalTTC = ankorstoreCentsToEuros(order.attributes.brandTotalAmountWithVat);
      const referenceStr = String(order.attributes.reference);
      const currentInfo: AnkorstoreImportCurrentOrder = {
        ankorstoreOrderId: order.id,
        reference: referenceStr,
        customerName: order.attributes.billingName ?? "(inconnu)",
        totalTTC: Number.isFinite(totalTTC) ? totalTTC : null,
        country: order.attributes.billingCountryCode ?? null,
      };

      if (!needsSync) {
        state.unchanged++;
        state.processed++;
        if (opts?.onEvent) {
          await opts.onEvent({
            reference: referenceStr,
            customerName: currentInfo.customerName,
            result: "unchanged",
            totalTTC: currentInfo.totalTTC,
            at: Date.now(),
          });
        }
        continue;
      }

      currentOrdersMap.set(order.id, currentInfo);
      await emitProgress();
      try {
        await upsertAnkorstoreOrderFromResource(tenantId, order, resp.included);
        state.imported++;
        if (opts?.onEvent) {
          await opts.onEvent({
            reference: referenceStr,
            customerName: currentInfo.customerName,
            result: "imported",
            totalTTC: currentInfo.totalTTC,
            at: Date.now(),
          });
        }
      } catch (err) {
        state.skipped++;
        logger.warn("[Ankorstore Orders Import] Échec commande", {
          tenantId,
          ankorstoreOrderId: order.id,
          error: err,
        });
        if (opts?.onEvent) {
          await opts.onEvent({
            reference: referenceStr,
            customerName: currentInfo.customerName,
            result: "error",
            totalTTC: currentInfo.totalTTC,
            errorMessage: err instanceof Error ? err.message : String(err),
            at: Date.now(),
          });
        }
      }
      state.processed++;
      currentOrdersMap.delete(order.id);
      await emitProgress();
    }

    // Curseur pour la prochaine page
    const hasMore = resp.meta?.page?.hasMore ?? false;
    const nextAfter = resp.meta?.page?.to ?? null;
    if (!hasMore || !nextAfter) break;
    after = nextAfter;
  }

  return { ...state, total: state.processed };
}
