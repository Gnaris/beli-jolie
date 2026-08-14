/**
 * Ankorstore Orders Sync — Synchronisation lecture seule des commandes
 * Ankorstore via le back-office reverse-engineered (`lib/ankorstore-bo/orders.ts`).
 *
 * Calqué sur `lib/efashion-orders-sync.ts` / `lib/faire-orders-sync.ts`.
 * Deux modes :
 *  - `syncRecentAnkorstoreOrders(tenantId)` : polling incrémental (page 1),
 *    ne re-fetch le détail que pour les commandes nouvelles ou dont le statut
 *    a changé.
 *  - `importAllAnkorstoreOrdersFor(tenantId, onProgress)` : rattrapage
 *    historique complet, page 1 → N avec appel `onProgress` par commande.
 *
 * Matching des lignes (par ordre de priorité) :
 *   1. `ProductColor.ankorsSku === item.sku`          (SKU exact, 1-1 fiable)
 *   2. `Product.ankorsProductId === item.product.uuid` (produit-père Ankor)
 *      → si résolu, on tente de piocher la ProductColor par nom de couleur.
 *   3. `Product.reference === referenceBase(sku)`     (fallback texte)
 *
 * Fiche client (AdminClientCard) :
 *   1. lookup par `ankorstoreRetailerId` (retailer.uuid),
 *   2. fallback par email si connu,
 *   3. sinon création `hasAnkorstore=true`, `importedFromMarketplace="ANKORSTORE"`.
 */

import { AnkorstoreOrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  listOrders,
  getOrderDetail,
  getOrderItems,
  getOrderTracking,
  type BoOrderDetail,
  type BoOrderItem,
  type BoOrderSummary,
  type BoRetailer,
  type BoAddress,
} from "@/lib/ankorstore-bo";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Status normalisation
// ─────────────────────────────────────────────

const STATUS_RAW_TO_ENUM: Record<string, AnkorstoreOrderStatus> = {
  pending: AnkorstoreOrderStatus.NEW,
  submitted: AnkorstoreOrderStatus.NEW,
  needs_review: AnkorstoreOrderStatus.NEW,
  retailer_paid: AnkorstoreOrderStatus.NEW,
  ankor_confirmed: AnkorstoreOrderStatus.VALIDATED,
  brand_confirmed: AnkorstoreOrderStatus.VALIDATED,
  shipped: AnkorstoreOrderStatus.SHIPPED,
  delivered: AnkorstoreOrderStatus.SHIPPED,
  brand_paid: AnkorstoreOrderStatus.SHIPPED,
  invoiced: AnkorstoreOrderStatus.SHIPPED,
  refunded: AnkorstoreOrderStatus.SHIPPED,
  cancelled: AnkorstoreOrderStatus.CANCELLED,
  canceled: AnkorstoreOrderStatus.CANCELLED,
  rejected: AnkorstoreOrderStatus.CANCELLED,
  brand_rejected: AnkorstoreOrderStatus.CANCELLED,
  retailer_rejected: AnkorstoreOrderStatus.CANCELLED,
};

export function normalizeAnkorstoreStatus(raw: string): AnkorstoreOrderStatus {
  const key = (raw ?? "").toLowerCase().trim();
  return STATUS_RAW_TO_ENUM[key] ?? AnkorstoreOrderStatus.NEW;
}

// ─────────────────────────────────────────────
// Helpers date / string
// ─────────────────────────────────────────────

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function maxDate(a: Date | null, b: Date): Date {
  if (!a) return b;
  return a.getTime() >= b.getTime() ? a : b;
}

function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 && trimmed.includes("@") ? trimmed : null;
}

/** Convertit un montant en centimes (BoMoney.amount) vers un Decimal Prisma. */
function centsToDecimal(cents: number | undefined | null): Prisma.Decimal {
  const value = typeof cents === "number" ? cents : 0;
  return new D((value / 100).toFixed(2));
}

/** Extrait le premier segment du SKU Ankorstore (`A1720_VERT_DEAU` → `A1720`). */
function sliceReferenceBase(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const first = sku.split("_")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// ─────────────────────────────────────────────
// AdminClientCard upsert
// ─────────────────────────────────────────────

interface OptionalCardFields {
  company?: string;
  email?: string;
  vatNumber?: string;
  phone?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  siret?: string;
}

function buildCardFieldsFromRetailer(
  retailer: BoRetailer,
  shipping: BoAddress | null,
): OptionalCardFields {
  const data: OptionalCardFields = {};
  const shop = retailer.name?.trim() || null;
  const email = normalizeEmail(retailer.email);
  const vat = retailer.business?.vat_number?.replace(/\s+/g, "").trim() || null;
  const siret = retailer.business?.tax_number?.replace(/\s+/g, "").trim() || null;
  const phone = retailer.phone_number?.trim() || shipping?.contactPerson?.phoneNumber?.trim() || null;

  if (shop) data.company = shop;
  if (email) data.email = email;
  if (vat) data.vatNumber = vat;
  if (siret) data.siret = siret;
  if (phone) data.phone = phone;

  if (shipping?.address) {
    const addr = shipping.address;
    if (addr.addressLine) data.addressLine = addr.addressLine;
    if (addr.postalCode) data.postalCode = addr.postalCode;
    if (addr.city) data.city = addr.city;
    if (addr.countryCode) data.countryCode = addr.countryCode.toUpperCase();
  } else if (retailer.city) {
    data.city = retailer.city;
  }

  const businessCountry = retailer.business?.country?.iso_code?.toUpperCase();
  if (!data.countryCode && businessCountry) data.countryCode = businessCountry;

  return data;
}

/**
 * Rattache/crée la fiche client correspondante au retailer Ankorstore.
 * Priorité : ankorstoreRetailerId → email → création.
 */
export async function upsertClientCardFromAnkorstoreRetailer(
  tenantId: string,
  retailer: BoRetailer,
  shipping: BoAddress | null,
  orderDate?: Date,
): Promise<string | null> {
  const retailerUuid = retailer?.uuid;
  if (!retailerUuid) return null;

  const effectiveOrderDate = orderDate ?? new Date();
  const fields = buildCardFieldsFromRetailer(retailer, shipping);

  // Étape 1 : lookup par ankorstoreRetailerId
  const existingByUuid = await prisma.adminClientCard.findFirst({
    where: { tenantId, ankorstoreRetailerId: retailerUuid },
    select: { id: true, lastOrderAt: true },
  });
  if (existingByUuid) {
    await prisma.adminClientCard.update({
      where: { id: existingByUuid.id },
      data: {
        hasAnkorstore: true,
        lastOrderAt: maxDate(existingByUuid.lastOrderAt, effectiveOrderDate),
        ...fields,
      },
    });
    return existingByUuid.id;
  }

  // Étape 2 : fallback email
  const email = fields.email ?? normalizeEmail(retailer.email);
  if (email) {
    const existingByEmail = await prisma.adminClientCard.findFirst({
      where: { tenantId, email },
      select: { id: true, lastOrderAt: true },
    });
    if (existingByEmail) {
      await prisma.adminClientCard.update({
        where: { id: existingByEmail.id },
        data: {
          ankorstoreRetailerId: retailerUuid,
          hasAnkorstore: true,
          lastOrderAt: maxDate(existingByEmail.lastOrderAt, effectiveOrderDate),
          ...fields,
        },
      });
      return existingByEmail.id;
    }
  }

  // Étape 3 : création
  const firstName = retailer.business?.user_first_name?.trim() || "";
  const lastName =
    retailer.business?.user_last_name?.trim() ||
    retailer.name?.trim() ||
    "(client Ankorstore)";
  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      hasAnkorstore: true,
      ankorstoreRetailerId: retailerUuid,
      importedFromMarketplace: "ANKORSTORE",
      lastOrderAt: effectiveOrderDate,
      ...fields,
    },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────────────────────────────────
// Item matching (BJ Product / ProductColor)
// ─────────────────────────────────────────────

interface ResolvedItemMatch {
  productId: string | null;
  productColorId: string | null;
  productSnapshotName: string | null;
}

async function resolveItemMatches(
  tenantId: string,
  items: BoOrderItem[],
): Promise<Map<string, ResolvedItemMatch>> {
  const result = new Map<string, ResolvedItemMatch>();
  if (items.length === 0) return result;

  const skus = Array.from(new Set(items.map((i) => i.product.sku).filter(Boolean)));
  const ankorProductUuids = Array.from(
    new Set(items.map((i) => i.product.uuid).filter(Boolean)),
  );
  const referenceBases = Array.from(
    new Set(items.map((i) => sliceReferenceBase(i.product.sku)).filter((v): v is string => Boolean(v))),
  );

  const [byExactSku, byProductUuid, byReference] = await Promise.all([
    skus.length > 0
      ? prisma.productColor.findMany({
          where: { tenantId, ankorsSku: { in: skus } },
          select: {
            id: true,
            ankorsSku: true,
            productId: true,
            product: { select: { id: true, name: true, reference: true } },
          },
        })
      : Promise.resolve([]),
    ankorProductUuids.length > 0
      ? prisma.product.findMany({
          where: { tenantId, ankorsProductId: { in: ankorProductUuids } },
          select: { id: true, name: true, reference: true, ankorsProductId: true },
        })
      : Promise.resolve([]),
    referenceBases.length > 0
      ? prisma.product.findMany({
          where: { tenantId, reference: { in: referenceBases } },
          select: { id: true, name: true, reference: true },
        })
      : Promise.resolve([]),
  ]);

  const colorBySku = new Map(byExactSku.map((c) => [c.ankorsSku ?? "", c]));
  const productByAnkorUuid = new Map(
    byProductUuid.map((p) => [p.ankorsProductId ?? "", p]),
  );
  // MySQL est case-insensitive sur la comparaison IN, mais Map.get l'est ; on
  // normalise en minuscule dans les deux sens.
  const productByRef = new Map(byReference.map((p) => [p.reference.toLowerCase(), p]));

  for (const item of items) {
    // 1) SKU exact → variant
    const colorMatch = item.product.sku ? colorBySku.get(item.product.sku) : undefined;
    if (colorMatch) {
      result.set(item.uuid, {
        productId: colorMatch.productId,
        productColorId: colorMatch.id,
        productSnapshotName: colorMatch.product?.name ?? null,
      });
      continue;
    }

    // 2) Produit-père Ankor → product uniquement (pas de variant fiable ici)
    const productByUuid = item.product.uuid ? productByAnkorUuid.get(item.product.uuid) : undefined;
    if (productByUuid) {
      result.set(item.uuid, {
        productId: productByUuid.id,
        productColorId: null,
        productSnapshotName: productByUuid.name,
      });
      continue;
    }

    // 3) Reference base → product
    const refBase = sliceReferenceBase(item.product.sku);
    const productByRefMatch = refBase ? productByRef.get(refBase.toLowerCase()) : undefined;
    if (productByRefMatch) {
      result.set(item.uuid, {
        productId: productByRefMatch.id,
        productColorId: null,
        productSnapshotName: productByRefMatch.name,
      });
      continue;
    }

    // 4) Aucun match — stocké quand même avec snapshot brut
    result.set(item.uuid, {
      productId: null,
      productColorId: null,
      productSnapshotName: item.product.name ?? null,
    });
  }

  return result;
}

// ─────────────────────────────────────────────
// Détail addresses helpers
// ─────────────────────────────────────────────

function extractShippingAddress(detail: BoOrderDetail): BoAddress | null {
  return detail.shipping?.shippingAddress ?? null;
}

interface FlatAddress {
  name: string | null;
  organisationName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
}

function flattenAddress(addr: BoAddress | null): FlatAddress {
  if (!addr) {
    return { name: null, organisationName: null, street: null, postalCode: null, city: null, countryCode: null };
  }
  const contact = addr.contactPerson?.fullName?.trim()
    || [addr.contactPerson?.firstName, addr.contactPerson?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim()
    || null;
  return {
    name: contact,
    organisationName: addr.company?.trim() || null,
    street: addr.address?.addressLine || null,
    postalCode: addr.address?.postalCode || null,
    city: addr.address?.city || null,
    countryCode: addr.address?.countryCode?.toUpperCase() || null,
  };
}

// ─────────────────────────────────────────────
// Upsert commande depuis détail + items
// ─────────────────────────────────────────────

export interface AnkorstoreOrderUpsertResult {
  orderId: string;
  created: boolean;
}

export async function upsertAnkorstoreOrderFromDetail(
  tenantId: string,
  detail: BoOrderDetail,
  items: BoOrderItem[],
): Promise<AnkorstoreOrderUpsertResult> {
  const statusRaw = detail.status?.name ?? "pending";
  const status = normalizeAnkorstoreStatus(statusRaw);

  const createdAtAnkor = parseDate(detail.createdAt) ?? new Date();
  const shippedAt = parseDate(detail.shipping?.shipment?.shippedAt);

  // Ces dates n'ont pas d'attribut top-level sur le JSON:API — on tente de les
  // dériver des events (chaque event a un type + createdAt). Si absents, on
  // laisse null.
  const eventDate = (type: string): Date | null => {
    const ev = (detail.events ?? []).find((e) => e.type === type);
    return ev ? parseDate(ev.createdAt) : null;
  };
  const submittedAt = eventDate("submitted") ?? eventDate("order_submitted");
  const brandPaidAt = eventDate("brand_paid") ?? eventDate("brand_payment_received");
  const canceledAt = status === AnkorstoreOrderStatus.CANCELLED
    ? (eventDate("cancelled") ?? eventDate("canceled") ?? eventDate("rejected"))
    : null;

  const shipping = extractShippingAddress(detail);
  const shippingFlat = flattenAddress(shipping);
  const billingFlat = shippingFlat; // Le BO ne renvoie pas d'adresse de billing séparée.

  const retailer = detail.retailer;
  const adminClientCardId = retailer
    ? await upsertClientCardFromAnkorstoreRetailer(
        tenantId,
        retailer,
        shipping,
        createdAtAnkor,
      )
    : null;

  const customerName = [retailer?.business?.user_first_name, retailer?.business?.user_last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || retailer?.name?.trim() || "(inconnu)";
  const customerShop = retailer?.name?.trim() || null;
  const customerCountry =
    shippingFlat.countryCode ??
    retailer?.business?.country?.iso_code?.toUpperCase() ??
    null;

  // Tracking best-effort : ne casse pas la sync si l'appel échoue.
  let trackingNumber: string | null = detail.tracking?.trackingNumber ?? null;
  let trackingLink: string | null = detail.tracking?.trackingLink ?? null;
  let trackingStatus: string | null = detail.tracking?.status ?? null;
  const trackingStatusDetails: string | null = null;
  const trackingUpdatedAt: Date | null = null;
  let carrier: string | null = detail.shipping?.shippingProvider ?? null;
  try {
    const tracking = await getOrderTracking(detail.uuid);
    if (tracking) {
      trackingNumber = tracking.trackingNumber ?? trackingNumber;
      trackingLink = tracking.trackingLink ?? trackingLink;
      trackingStatus = tracking.status ?? trackingStatus;
      carrier = tracking.carrier ?? carrier;
    }
  } catch (err) {
    logger.warn("[Ankorstore Orders Sync] échec récup tracking", {
      ankorstoreOrderId: detail.uuid,
      error: err,
    });
  }

  const rejectReason = (() => {
    const anyDetail = detail as unknown as Record<string, unknown>;
    const reject = anyDetail.rejection as { reason?: string; brandReason?: string } | undefined;
    return reject?.brandReason ?? reject?.reason ?? null;
  })();

  const existing = await prisma.ankorstoreOrder.findFirst({
    where: { tenantId, ankorstoreOrderId: detail.uuid },
    select: { id: true },
  });

  const baseData = {
    tenantId,
    ankorstoreOrderId: detail.uuid,
    ankorstoreMasterOrderId: null, // à remplir quand on aura reversé la relation masterOrder
    reference: detail.reference ?? String(detail.internalId),

    status,
    statusRaw,
    currency: detail.totals?.totalAmount?.currency ?? "EUR",
    createdAtAnkor,
    submittedAt,
    shippedAt,
    brandPaidAt,
    canceledAt,

    brandNetAmount: centsToDecimal(detail.totals?.netAmount?.amount),
    brandTotalAmount: centsToDecimal(detail.totals?.totalAmount?.amount),
    brandTotalAmountVat: centsToDecimal(detail.totals?.totalVatAmount?.amount),
    brandTotalAmountWithVat: centsToDecimal(detail.totals?.totalAmountWithVat?.amount),

    brandRejectReason: rejectReason,
    retailerRejectReason: null,
    retailerCancellationRequestReason: null,

    billingName: billingFlat.name,
    billingOrganisationName: billingFlat.organisationName,
    billingStreet: billingFlat.street,
    billingPostalCode: billingFlat.postalCode,
    billingCity: billingFlat.city,
    billingCountryCode: billingFlat.countryCode,

    shippingName: shippingFlat.name,
    shippingOrganisationName: shippingFlat.organisationName,
    shippingStreet: shippingFlat.street,
    shippingPostalCode: shippingFlat.postalCode,
    shippingCity: shippingFlat.city,
    shippingCountryCode: shippingFlat.countryCode,

    shippingMethod: detail.shipping?.shippingMethod ?? null,
    carrier,
    trackingNumber,
    trackingLink,
    trackingStatus,
    trackingStatusDetails,
    trackingUpdatedAt,

    ankorstoreRetailerId: retailer?.uuid ?? "",
    customerName,
    customerShop,
    customerEmail: normalizeEmail(retailer?.email),
    customerPhone: retailer?.phone_number ?? null,
    customerVatNumber: retailer?.business?.vat_number ?? null,
    customerSiret: retailer?.business?.tax_number ?? null,
    customerCountry,

    adminClientCardId,

    billingItemsJson: (detail.billing?.billingItems ?? []) as unknown as Prisma.InputJsonValue,
    shippingOverviewJson: (detail.shipping ?? {}) as unknown as Prisma.InputJsonValue,
    rawDetailJson: detail as unknown as Prisma.InputJsonValue,

    lastSyncedAt: new Date(),
  } satisfies Prisma.AnkorstoreOrderUncheckedCreateInput;

  let orderId: string;
  let created = false;
  if (existing) {
    await prisma.ankorstoreOrder.update({ where: { id: existing.id }, data: baseData });
    orderId = existing.id;
  } else {
    const row = await prisma.ankorstoreOrder.create({ data: baseData, select: { id: true } });
    orderId = row.id;
    created = true;
  }

  // Préserver stockDeductedAt à travers le rebuild d'items.
  const previouslyDeducted = new Map<string, Date>();
  const existingItems = await prisma.ankorstoreOrderItem.findMany({
    where: { ankorstoreOrderId: orderId, stockDeductedAt: { not: null } },
    select: { ankorstoreItemId: true, stockDeductedAt: true },
  });
  for (const ex of existingItems) {
    if (ex.stockDeductedAt) previouslyDeducted.set(ex.ankorstoreItemId, ex.stockDeductedAt);
  }

  await prisma.ankorstoreOrderItem.deleteMany({ where: { ankorstoreOrderId: orderId } });

  if (items.length > 0) {
    const matches = await resolveItemMatches(tenantId, items);

    // VAT rate proratisé au niveau commande (le BO n'expose pas le VAT par item).
    const totalHT = detail.totals?.totalAmount?.amount ?? 0;
    const totalVat = detail.totals?.totalVatAmount?.amount ?? 0;
    const vatRate = totalHT > 0 ? new D((totalVat / totalHT).toFixed(4)) : new D(0);
    const vatRatePct = vatRate.mul(100); // stocké en pourcentage (schéma Decimal(5,2))

    const itemRows: Prisma.AnkorstoreOrderItemUncheckedCreateInput[] = items.map((it) => {
      const match = matches.get(it.uuid) ?? {
        productId: null,
        productColorId: null,
        productSnapshotName: it.product.name ?? null,
      };
      const unitPrice = centsToDecimal(it.unitPrice?.amount);
      const totalPrice = centsToDecimal(it.totalPrice?.amount);
      const vatAmount = new D(totalPrice.mul(vatRate).toFixed(2));
      const totalWithVat = new D(totalPrice.add(vatAmount).toFixed(2));
      const variantOptionLabel = (it.product.options ?? [])
        .map((o) => o.value)
        .filter(Boolean)
        .join(" · ") || null;

      return {
        tenantId,
        ankorstoreOrderId: orderId,
        ankorstoreItemId: it.uuid,
        ankorstoreVariantId: null, // pas dans le payload actuel — à remplir quand reversé
        ankorstoreProductId: it.product.uuid || null,
        sku: it.product.sku || "",
        referenceBase: sliceReferenceBase(it.product.sku),

        productId: match.productId,
        productColorId: match.productColorId,
        productSnapshotName: match.productSnapshotName,
        variantOptionLabel,

        quantity: it.unitQuantity,
        multipliedQuantity: it.batchQuantity * it.unitQuantity,
        unitPriceHT: unitPrice,
        totalPriceHT: totalPrice,
        vatAmount,
        totalWithVat,
        vatRate: new D(vatRatePct.toFixed(2)),

        stockDeductedAt: previouslyDeducted.get(it.uuid) ?? null,
      };
    });

    await prisma.ankorstoreOrderItem.createMany({ data: itemRows });
  }

  return { orderId, created };
}

// ─────────────────────────────────────────────
// Sync unitaire (par UUID)
// ─────────────────────────────────────────────

export async function syncSingleAnkorstoreOrder(
  tenantId: string,
  uuid: string,
): Promise<AnkorstoreOrderUpsertResult | null> {
  const detail = await getOrderDetail(uuid);
  if (!detail) return null;
  const items = await getOrderItems(uuid);
  return upsertAnkorstoreOrderFromDetail(tenantId, detail, items);
}

// ─────────────────────────────────────────────
// Polling incrémental
// ─────────────────────────────────────────────

const RECENT_PAGE_LIMIT = 50;

/**
 * Lit la 1re page côté Ankorstore et re-fetch le détail uniquement pour les
 * commandes nouvelles ou dont le statut a changé.
 */
export async function syncRecentAnkorstoreOrders(tenantId: string): Promise<{
  created: number;
  updated: number;
  scanned: number;
}> {
  const first = await listOrders({ offset: 0, limit: RECENT_PAGE_LIMIT });
  const summaries = first.orders;
  if (summaries.length === 0) return { created: 0, updated: 0, scanned: 0 };

  const uuids = summaries.map((s) => s.uuid);
  const existingRows = await prisma.ankorstoreOrder.findMany({
    where: { tenantId, ankorstoreOrderId: { in: uuids } },
    select: { ankorstoreOrderId: true, status: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.ankorstoreOrderId, r.status]));

  let created = 0;
  let updated = 0;
  for (const summary of summaries) {
    const existingStatus = existingMap.get(summary.uuid);
    const nextStatus = normalizeAnkorstoreStatus(summary.status?.name ?? "pending");
    if (existingStatus && existingStatus === nextStatus) continue;

    try {
      const res = await syncSingleAnkorstoreOrder(tenantId, summary.uuid);
      if (!res) continue;
      if (res.created) created++;
      else updated++;
    } catch (err) {
      logger.warn("[Ankorstore Orders Sync] Échec import commande", {
        tenantId,
        uuid: summary.uuid,
        error: err,
      });
    }
  }

  return { created, updated, scanned: summaries.length };
}

// ─────────────────────────────────────────────
// Import historique
// ─────────────────────────────────────────────

export interface AnkorstoreImportCurrentOrder {
  uuid: string;
  reference: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface AnkorstoreImportProgress {
  totalOrders: number;
  processedOrders: number;
  currentPage: number;
  totalPages: number;
  currentOrders: AnkorstoreImportCurrentOrder[];
}

export interface AnkorstoreImportEvent {
  reference: string;
  customerName: string;
  result: "imported" | "unchanged" | "error";
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

const PAGE_LIMIT = 50;
const PAGE_CHUNK_SIZE = 5; // fetch 5 pages en parallèle
const DETAIL_CONCURRENCY = 3; // détail + items + tracking = 3 calls / commande

function summaryToCurrent(summary: BoOrderSummary): AnkorstoreImportCurrentOrder {
  return {
    uuid: summary.uuid,
    reference: summary.reference ?? String(summary.internalId),
    customerName: summary.retailer?.name ?? "(inconnu)",
    totalHT: summary.totals?.totalAmount?.amount != null
      ? summary.totals.totalAmount.amount / 100
      : null,
    country: summary.retailer?.business?.country?.iso_code?.toUpperCase() ?? null,
  };
}

export async function importAllAnkorstoreOrdersFor(
  tenantId: string,
  onProgress?: (p: AnkorstoreImportProgress) => void | Promise<void>,
  opts?: {
    stopSignal?: () => boolean | Promise<boolean>;
    onEvent?: (e: AnkorstoreImportEvent) => void | Promise<void>;
  },
): Promise<{ imported: number; skipped: number; unchanged: number; total: number }> {
  const first = await listOrders({ offset: 0, limit: PAGE_LIMIT });
  const totalOrders = first.meta.page.total ?? first.orders.length;
  const perPage = first.meta.page.perPage || PAGE_LIMIT;
  const totalPages = Math.max(1, Math.ceil(totalOrders / perPage));

  const state = { processed: 0, imported: 0, skipped: 0, unchanged: 0 };
  const currentOrdersMap = new Map<string, AnkorstoreImportCurrentOrder>();

  const emitProgress = async (currentPage: number) => {
    if (!onProgress) return;
    await onProgress({
      totalOrders,
      processedOrders: state.processed,
      currentPage,
      totalPages,
      currentOrders: Array.from(currentOrdersMap.values()),
    });
  };
  const emitEvent = async (e: AnkorstoreImportEvent) => {
    if (opts?.onEvent) await opts.onEvent(e);
  };

  const processChunk = async (
    chunk: Array<{ page: number; summaries: BoOrderSummary[] }>,
  ): Promise<boolean> => {
    const allItems: Array<{ page: number; summary: BoOrderSummary }> = [];
    for (const c of chunk) for (const s of c.summaries) allItems.push({ page: c.page, summary: s });
    if (allItems.length === 0) return false;

    const uuids = allItems.map((it) => it.summary.uuid);
    const existingRows = await prisma.ankorstoreOrder.findMany({
      where: { tenantId, ankorstoreOrderId: { in: uuids } },
      select: { ankorstoreOrderId: true, status: true },
    });
    const existingStatusMap = new Map(existingRows.map((r) => [r.ankorstoreOrderId, r.status]));

    const needsSync: typeof allItems = [];
    const lastPage = chunk[chunk.length - 1]?.page ?? 0;
    for (const it of allItems) {
      const existingStatus = existingStatusMap.get(it.summary.uuid);
      const nextStatus = normalizeAnkorstoreStatus(it.summary.status?.name ?? "pending");
      if (existingStatus && existingStatus === nextStatus) {
        state.unchanged++;
        state.processed++;
        const cur = summaryToCurrent(it.summary);
        await emitEvent({
          reference: cur.reference,
          customerName: cur.customerName,
          result: "unchanged",
          totalHT: cur.totalHT,
          at: Date.now(),
        });
      } else {
        needsSync.push(it);
      }
    }
    if (state.processed > 0) await emitProgress(lastPage);

    const queue = [...needsSync];
    let stopped = false;
    const workerCount = Math.min(DETAIL_CONCURRENCY, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0 && !stopped) {
        if (opts?.stopSignal && (await opts.stopSignal())) {
          stopped = true;
          break;
        }
        const item = queue.shift();
        if (!item) break;
        const cur = summaryToCurrent(item.summary);
        currentOrdersMap.set(item.summary.uuid, cur);
        await emitProgress(item.page);
        try {
          await syncSingleAnkorstoreOrder(tenantId, item.summary.uuid);
          state.imported++;
          await emitEvent({
            reference: cur.reference,
            customerName: cur.customerName,
            result: "imported",
            totalHT: cur.totalHT,
            at: Date.now(),
          });
        } catch (err) {
          state.skipped++;
          logger.warn("[Ankorstore Orders Import] Échec commande", {
            tenantId,
            uuid: item.summary.uuid,
            error: err,
          });
          await emitEvent({
            reference: cur.reference,
            customerName: cur.customerName,
            result: "error",
            totalHT: cur.totalHT,
            errorMessage: err instanceof Error ? err.message : String(err),
            at: Date.now(),
          });
        }
        state.processed++;
        currentOrdersMap.delete(item.summary.uuid);
        await emitProgress(item.page);
      }
    });
    await Promise.all(workers);
    return stopped;
  };

  const stoppedOnFirst = await processChunk([{ page: 1, summaries: first.orders }]);
  if (stoppedOnFirst) return { ...state, total: totalOrders };

  for (let startPage = 2; startPage <= totalPages; startPage += PAGE_CHUNK_SIZE) {
    const pageNumbers: number[] = [];
    for (let p = startPage; p < startPage + PAGE_CHUNK_SIZE && p <= totalPages; p++) {
      pageNumbers.push(p);
    }
    const listResults = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        try {
          const offset = (pageNum - 1) * PAGE_LIMIT;
          const resp = await listOrders({ offset, limit: PAGE_LIMIT });
          return { page: pageNum, summaries: resp.orders };
        } catch (err) {
          logger.error("[Ankorstore Orders Import] Échec chargement page", {
            tenantId,
            page: pageNum,
            error: err,
          });
          return { page: pageNum, summaries: [] as BoOrderSummary[] };
        }
      }),
    );
    const stopped = await processChunk(listResults);
    if (stopped) break;
  }

  return { ...state, total: totalOrders };
}
