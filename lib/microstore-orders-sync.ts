/**
 * Microstore Orders Sync — import lecture seule des commandes Microstore.
 *
 * L'API Microstore renvoie la liste sans les lignes → 1 appel `list` + 1 appel
 * `detail` par commande. On upsert dans MicrostoreOrder + MicrostoreOrderItem.
 *
 * Matching produit (par ligne) :
 *   1. ProductColor via EAN (goods_sn / receipt_goods_sn) sur ProductColor.sku
 *      → nos SKU internes contiennent souvent l'EAN, à défaut c'est un fallback
 *      symbolique et on retombe sur (2).
 *   2. Product.reference == item_ref → puis on cherche la variante par nom de couleur
 *
 * Rattachement User :
 *   Si `client_info.email` correspond à un User déjà inscrit sur le site → on
 *   rattache pour que la commande apparaisse dans son espace client. Sinon
 *   `userId` reste `null` — les clients Microstore ne sont **jamais** créés
 *   comme utilisateurs inscrits (ils vivent uniquement dans les fiches
 *   clients admin, comme pour Ankor / PFS / eFashion / Faire).
 *
 * Paiement : toujours "paid" (choix cliente : Microstore = déjà encaissé).
 */

import { Prisma, type MicrostoreOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { findClientCardByEmailForDedup } from "@/lib/marketplace-client-dedup";
import {
  microstoreGetOrderDetail,
  microstoreListAllOrders,
  microstoreMapStatus,
  microstoreCountryToIso,
  type MicrostoreOrderDetail,
  type MicrostoreOrderDetailItem,
} from "@/lib/microstore-client";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function toDateFromSec(secStr: string | undefined | null): Date {
  if (!secStr) return new Date();
  const n = Number(secStr);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  return new Date(n * 1000);
}

function toDecimal(v: string | number | undefined | null): Prisma.Decimal {
  if (v === null || v === undefined || v === "") return new D(0);
  const n = typeof v === "string" ? Number(v) : v;
  return new D(Number.isFinite(n) ? n : 0);
}

function normalizeEmail(raw: string | undefined | null): string | null {
  const cleaned = (raw ?? "").trim().toLowerCase();
  return cleaned && cleaned.includes("@") ? cleaned : null;
}

function firstNonEmpty(...vals: (string | undefined | null)[]): string {
  for (const v of vals) {
    const trimmed = (v ?? "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

// ─────────────────────────────────────────────
// Rattachement User existant (lookup only, jamais de création)
// ─────────────────────────────────────────────

/**
 * Rattache la commande à un User déjà inscrit sur le site s'il partage l'email.
 * Ne crée jamais de User — les clients Microstore vivent dans les fiches
 * clients admin uniquement (comme les autres marketplaces).
 */
async function resolveUserForMicrostoreClient(
  tenantId: string,
  detail: MicrostoreOrderDetail,
): Promise<string | null> {
  const email = normalizeEmail(detail.client_info?.email);
  if (!email) return null;
  const found = await prisma.user.findFirst({
    where: { tenantId, email },
    select: { id: true },
  });
  return found?.id ?? null;
}

// ─────────────────────────────────────────────
// AdminClientCard — rattachement/creation
// ─────────────────────────────────────────────

async function upsertClientCardFromMicrostoreDetail(
  tenantId: string,
  detail: MicrostoreOrderDetail,
  orderDate: Date,
): Promise<string | null> {
  const clientMcId = detail.client_info?.client_id?.trim() || null;
  if (!clientMcId) return null;

  // Étape 1 : lookup direct
  const existing = await prisma.adminClientCard.findFirst({
    where: { tenantId, microstoreClientId: clientMcId },
    select: { id: true, lastOrderAt: true },
  });
  const commonFields = {
    hasMicrostore: true,
    lastOrderAt: existing?.lastOrderAt && existing.lastOrderAt.getTime() > orderDate.getTime()
      ? existing.lastOrderAt
      : orderDate,
    phone: firstNonEmpty(
      detail.client_info?.address_phone,
      detail.client_info?.phone,
    ) || undefined,
    email: normalizeEmail(detail.client_info?.email) || undefined,
    addressLine: firstNonEmpty(detail.client_info?.address) || undefined,
    postalCode: firstNonEmpty(detail.client_info?.zip) || undefined,
    city: firstNonEmpty(detail.client_info?.city) || undefined,
    countryCode:
      microstoreCountryToIso(detail.client_info?.country) ||
      microstoreCountryToIso(detail.invoice_address?.country_ISO) ||
      undefined,
  };

  if (existing) {
    await prisma.adminClientCard.update({
      where: { id: existing.id },
      data: commonFields,
    });
    return existing.id;
  }

  // Étape 1 bis : fallback email cross-marketplace — un même humain peut
  // avoir commandé sur eFashion ou Ankor avec le même email. On rattache et
  // on ajoute hasMicrostore=true au lieu de dupliquer la fiche.
  const existingByEmail = await findClientCardByEmailForDedup(
    tenantId,
    detail.client_info?.email,
  );
  if (existingByEmail) {
    await prisma.adminClientCard.update({
      where: { id: existingByEmail.id },
      data: { ...commonFields, microstoreClientId: clientMcId },
    });
    return existingByEmail.id;
  }

  // Étape 2 : création
  const firstName = firstNonEmpty(detail.client_info?.first_name);
  const lastName = firstNonEmpty(
    detail.client_info?.last_name,
    detail.client_info?.company_name,
    detail.client_info?.address_name,
    "(client Microstore)",
  );
  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      company: firstNonEmpty(
        detail.client_info?.company_name,
        detail.client_info?.invoice_title,
      ) || null,
      microstoreClientId: clientMcId,
      importedFromMarketplace: "MICROSTORE",
      ...commonFields,
    },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────────────────────────────────
// Matching produit (par ligne)
// ─────────────────────────────────────────────

interface ItemMatch {
  productId: string | null;
  productColorId: string | null;
}

/**
 * Résout produit + variante pour une liste de lignes Microstore en un
 * seul aller-retour BDD. Priorité EAN (goods_sn) puis (item_ref + color).
 */
async function resolveMatchesForItems(
  tenantId: string,
  items: MicrostoreOrderDetailItem[],
): Promise<Map<string, ItemMatch>> {
  const result = new Map<string, ItemMatch>();
  const eans = new Set<string>();
  const refs = new Set<string>();
  for (const it of items) {
    const ean = it.goods_sn || it.receipt_goods_sn;
    if (ean) eans.add(ean.trim());
    if (it.item_ref) refs.add(it.item_ref.trim());
  }

  // 1) Match par SKU (souvent contient l'EAN)
  const eansArr = Array.from(eans);
  const skuMatches =
    eansArr.length > 0
      ? await prisma.productColor.findMany({
          where: { tenantId, sku: { in: eansArr } },
          select: { id: true, sku: true, productId: true },
        })
      : [];
  const productColorByEan = new Map(skuMatches.map((c) => [c.sku ?? "", c]));

  // 2) Fallback : Product par reference (+ variante par color name)
  const refsArr = Array.from(refs);
  const products =
    refsArr.length > 0
      ? await prisma.product.findMany({
          where: { tenantId, reference: { in: refsArr } },
          select: {
            id: true,
            reference: true,
            colors: {
              select: {
                id: true,
                sku: true,
                color: { select: { name: true } },
              },
            },
          },
        })
      : [];
  const productByRef = new Map(products.map((p) => [p.reference, p]));

  for (const it of items) {
    const ean = (it.goods_sn || it.receipt_goods_sn || "").trim();
    // Priorité EAN
    if (ean && productColorByEan.has(ean)) {
      const c = productColorByEan.get(ean)!;
      result.set(it.id, { productId: c.productId, productColorId: c.id });
      continue;
    }
    // Fallback ref + couleur
    const ref = (it.item_ref || "").trim();
    const p = ref ? productByRef.get(ref) : null;
    if (p) {
      const colorName = (it.color_name || "").trim().toLowerCase();
      const variant = colorName
        ? p.colors.find((c) => (c.color?.name ?? "").trim().toLowerCase() === colorName)
        : null;
      result.set(it.id, {
        productId: p.id,
        productColorId: variant?.id ?? null,
      });
      continue;
    }
    result.set(it.id, { productId: null, productColorId: null });
  }

  return result;
}

// ─────────────────────────────────────────────
// Upsert commande complète (list item + détail)
// ─────────────────────────────────────────────

export interface MicrostoreOrderUpsertResult {
  orderInternalId: string;
  created: boolean;
  matchedItems: number;
  unmatchedItems: number;
}

export async function upsertMicrostoreOrderFromDetail(
  tenantId: string,
  detail: MicrostoreOrderDetail,
): Promise<MicrostoreOrderUpsertResult> {
  const createdAt = toDateFromSec(detail.ctime);
  const updatedAt = detail.utime ? toDateFromSec(detail.utime) : null;
  const status = microstoreMapStatus({
    shippingStatus: detail.shipping_status,
    goodsStatus: 1,
  });
  const statusRaw = `pay=${detail.pay_status ?? "0"};ship=${detail.shipping_status ?? "0"}`;
  const totalHT = toDecimal(detail.total_price);
  const paidPrice = toDecimal(detail.paid_price);
  const shippingPrice = toDecimal(detail.shipping_price);

  // Client card + User
  const adminClientCardId = await upsertClientCardFromMicrostoreDetail(
    tenantId,
    detail,
    createdAt,
  );
  const userId = await resolveUserForMicrostoreClient(tenantId, detail);

  const email = normalizeEmail(detail.client_info?.email);
  const phoneCode = firstNonEmpty(detail.client_info?.phone_code);
  const rawPhone = firstNonEmpty(
    detail.client_info?.address_phone,
    detail.client_info?.phone,
  );
  const shippingPhone = phoneCode && rawPhone && !rawPhone.startsWith("+")
    ? `${phoneCode} ${rawPhone}`
    : rawPhone;
  const shippingCountryCode = microstoreCountryToIso(detail.client_info?.country);
  const customerCountry = shippingCountryCode ?? null;
  const customerName = firstNonEmpty(
    detail.client_info?.address_name,
    `${detail.client_info?.first_name ?? ""} ${detail.client_info?.last_name ?? ""}`.trim(),
    detail.client_info?.company_name,
    "(inconnu)",
  );

  const shippedAt = status === "SHIPPED" ? updatedAt ?? new Date() : null;

  const baseData: Prisma.MicrostoreOrderUncheckedCreateInput = {
    tenantId,
    microstoreOrderId: detail.id,
    posNum: null, // pas dans le détail (seulement dans la liste)
    status: status as MicrostoreOrderStatus,
    statusRaw,
    currency: "EUR",
    createdAtMicrostore: createdAt,
    updatedAtMicrostore: updatedAt,
    shippedAt,
    canceledAt: null,
    totalHT,
    paidPrice,
    shippingPrice,
    shippingLabel: firstNonEmpty(detail.shipping_name) || null,
    remark: firstNonEmpty(detail.remark) || null,
    invoiceTitle: firstNonEmpty(detail.client_info?.invoice_title) || null,
    shippingName: firstNonEmpty(detail.client_info?.address_name) || null,
    shippingCompany: firstNonEmpty(detail.client_info?.company_name) || null,
    shippingStreet: firstNonEmpty(detail.client_info?.address) || null,
    shippingCity: firstNonEmpty(detail.client_info?.city) || null,
    shippingPostalCode: firstNonEmpty(detail.client_info?.zip) || null,
    shippingCountryCode,
    shippingPhone: shippingPhone || null,
    microstoreClientId: firstNonEmpty(detail.client_info?.client_id) || null,
    customerName,
    customerCompany: firstNonEmpty(detail.client_info?.company_name) || null,
    customerEmail: email,
    customerPhone: rawPhone || null,
    customerCountry,
    customerVatNumber: firstNonEmpty(detail.client_info?.vat_num) || null,
    adminClientCardId,
    userId,
    rawDetailJson: detail as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };

  // Idempotence : findFirst puis update/create
  const existing = await prisma.microstoreOrder.findFirst({
    where: { tenantId, microstoreOrderId: detail.id },
    select: { id: true },
  });

  let orderRowId: string;
  let created = false;
  if (existing) {
    await prisma.microstoreOrder.update({ where: { id: existing.id }, data: baseData });
    orderRowId = existing.id;
  } else {
    const row = await prisma.microstoreOrder.create({
      data: baseData,
      select: { id: true },
    });
    orderRowId = row.id;
    created = true;
  }

  // Items : snapshot stockDeductedAt + delete/reinsert
  const previouslyDeducted = new Map<string, Date>();
  const existingItems = await prisma.microstoreOrderItem.findMany({
    where: { microstoreOrderInternalId: orderRowId, stockDeductedAt: { not: null } },
    select: { microstoreItemId: true, stockDeductedAt: true },
  });
  for (const ex of existingItems) {
    if (ex.stockDeductedAt) previouslyDeducted.set(ex.microstoreItemId, ex.stockDeductedAt);
  }

  await prisma.microstoreOrderItem.deleteMany({
    where: { microstoreOrderInternalId: orderRowId },
  });

  const items = detail.goods_info ?? [];
  let matchedItems = 0;
  let unmatchedItems = 0;
  if (items.length > 0) {
    const matches = await resolveMatchesForItems(tenantId, items);
    const rows: Prisma.MicrostoreOrderItemUncheckedCreateInput[] = items.map((it) => {
      const m = matches.get(it.id) ?? { productId: null, productColorId: null };
      if (m.productId) matchedItems++;
      else unmatchedItems++;
      const quantity = Math.max(0, Math.floor(Number(it.quantity) || 0));
      const unitPriceHT = toDecimal(it.price);
      const totalPriceHT = toDecimal(it.sale_sub_price || (Number(it.price) * quantity).toString());
      return {
        tenantId,
        microstoreOrderInternalId: orderRowId,
        microstoreItemId: it.id,
        microstoreGoodsId: it.goods_id || null,
        microstoreSkuId: it.sku_id || null,
        itemRef: it.item_ref || "",
        goodsSn: it.goods_sn || it.receipt_goods_sn || null,
        microstoreColorId: it.color_id || null,
        colorNameSnapshot: it.color_name || null,
        sizeNameSnapshot: it.size_name || null,
        productSnapshotName: it.name || null,
        productId: m.productId,
        productColorId: m.productColorId,
        quantity,
        unitPriceHT,
        totalPriceHT,
        imageUrl: it.img || null,
        stockDeductedAt: previouslyDeducted.get(it.id) ?? null,
      };
    });
    await prisma.microstoreOrderItem.createMany({ data: rows });
  }

  return {
    orderInternalId: orderRowId,
    created,
    matchedItems,
    unmatchedItems,
  };
}

// ─────────────────────────────────────────────
// Sync incrémental (dates configurables)
// ─────────────────────────────────────────────

export interface MicrostoreSyncResult {
  scanned: number;
  created: number;
  updated: number;
  errors: Array<{ microstoreOrderId: string; error: string }>;
}

/**
 * Récupère la liste Microstore sur une plage puis appelle le détail pour
 * chaque nouvelle commande ou commande modifiée. Idempotent : sûr à relancer.
 */
export async function syncMicrostoreOrders(opts: {
  tenantId: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  onProgress?: (info: {
    scanned: number;
    total: number;
    lastOrderNumber: string;
  }) => void;
}): Promise<MicrostoreSyncResult> {
  const listItems = await microstoreListAllOrders({
    fromDate: opts.fromDate,
    toDate: opts.toDate,
  });
  const result: MicrostoreSyncResult = {
    scanned: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  // Snapshot des ctime existants pour n'appeler le détail que si updated
  const existingIds = new Set(listItems.map((o) => o.id));
  const existing =
    existingIds.size > 0
      ? await prisma.microstoreOrder.findMany({
          where: {
            tenantId: opts.tenantId,
            microstoreOrderId: { in: Array.from(existingIds) },
          },
          select: {
            microstoreOrderId: true,
            updatedAtMicrostore: true,
            status: true,
          },
        })
      : [];
  const existingMap = new Map(existing.map((r) => [r.microstoreOrderId, r]));

  for (const listItem of listItems) {
    result.scanned++;
    opts.onProgress?.({
      scanned: result.scanned,
      total: listItems.length,
      lastOrderNumber: listItem.number,
    });

    const prev = existingMap.get(listItem.id);
    const listCtime = Number(listItem.ctime) * 1000;
    // Skip si déjà importée et shipping_status inchangé — Microstore ne
    // fournit pas d'utime dans la liste, on utilise le statut comme trigger.
    if (prev) {
      const currentStatus = microstoreMapStatus({
        shippingStatus: listItem.shipping_status,
        goodsStatus: listItem.goods_status,
      });
      if (currentStatus === prev.status && prev.updatedAtMicrostore) {
        // Aucun changement de statut → skip refresh du détail
        continue;
      }
    }
    if (prev && !Number.isFinite(listCtime)) {
      continue; // ctime invalide et déjà en base → skip
    }

    try {
      const detail = await microstoreGetOrderDetail(listItem.id);
      const upsert = await upsertMicrostoreOrderFromDetail(opts.tenantId, detail);
      if (upsert.created) result.created++;
      else result.updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ microstoreOrderId: listItem.id, error: msg });
      logger.warn("[Microstore Sync] import failed", {
        tenantId: opts.tenantId,
        microstoreOrderId: listItem.id,
        error: err,
      });
    }
  }

  return result;
}
