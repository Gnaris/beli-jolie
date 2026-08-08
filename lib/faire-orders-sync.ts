/**
 * Faire Orders Sync — synchronisation lecture seule des commandes Faire.
 *
 * Deux modes (calqués sur `lib/pfs-orders-sync.ts` et `lib/ankorstore-orders-sync.ts`) :
 *  - `syncRecentFaireOrders(tenantId)`  : lit la 1ère page, upsert les
 *    commandes nouvelles ou dont `updated_at` a évolué. Ne parcourt qu'une page.
 *  - `importAllFaireOrdersFor(tenantId, onProgress)` : rattrapage historique
 *    complet, boucle sur les pages jusqu'à réponse vide.
 *
 * Contrairement à Ankorstore (JSON:API includes) ou PFS (2 appels list + detail),
 * Faire renvoie l'objet commande complet directement dans la réponse `/orders`
 * (items + shipments + address inclus). Pas d'appel détail nécessaire pendant
 * la synchro incrémentale — plus rapide et moins de rate-limit.
 *
 * Matching produit :
 *   1. ProductColor.faireVariantId == item.product_option_id (le plus fiable)
 *   2. Product.faireProductId     == item.product_id
 *   3. Fallback : Product.reference == referenceBase extraite du SKU
 *
 * Upsert fiche client (AdminClientCard) :
 *   1. tenantId + faireRetailerId (lookup direct)
 *   2. Fallback company_name normalisé (Faire n'expose pas de SIRET dans /orders)
 *   3. Création `importedFromMarketplace = "FAIRE"`, `hasFaire = true`
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveCountryCode } from "@/lib/countries";
import {
  computeFaireOrderTotalCents,
  extractFaireTrackingInfo,
  extractReferenceFromFaireSku,
  faireCentsToEuros,
  faireListOrders,
  faireMoneyToCents,
  getFaireItemUnitPriceCents,
  normalizeFaireStatus,
  type FaireOrderAddress,
  type FaireOrderItemResource,
  type FaireOrderResource,
} from "@/lib/faire-orders-api";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Client card upsert
// ─────────────────────────────────────────────

function normalizeCompanyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

function pickCustomerNameParts(address: FaireOrderAddress | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const contact = (address?.name ?? "").trim();
  if (contact) {
    // Faire ne sépare pas firstName/lastName — on garde le tout en lastName
    return { firstName: "", lastName: contact };
  }
  const shop = (address?.company_name ?? "").trim();
  return { firstName: "", lastName: shop || "(client Faire)" };
}

function maxDate(a: Date | null, b: Date): Date {
  if (!a) return b;
  return a.getTime() >= b.getTime() ? a : b;
}

interface OptionalCardFields {
  company?: string;
  phone?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
}

function buildOptionalCardFieldsFromAddress(
  address: FaireOrderAddress | null | undefined,
): OptionalCardFields {
  const data: OptionalCardFields = {};
  if (!address) return data;
  const company = (address.company_name ?? "").trim();
  if (company) data.company = company;
  const phone = (address.phone_number ?? "").trim();
  if (phone) data.phone = phone;
  const street = [address.address1, address.address2].filter(Boolean).join(", ").trim();
  if (street) data.addressLine = street;
  if (address.postal_code) data.postalCode = address.postal_code;
  if (address.city) data.city = address.city;
  const country = address.country_code
    ? String(address.country_code).toUpperCase()
    : resolveCountryCode(address.country ?? "");
  if (country) data.countryCode = country;
  return data;
}

/**
 * Rattache/crée la fiche client correspondante au retailer Faire.
 * Retourne l'id AdminClientCard (ou null si le retailerId manque).
 */
export async function upsertClientCardFromFaireRetailer(
  tenantId: string,
  retailerId: string,
  address: FaireOrderAddress | null | undefined,
  orderDate?: Date,
): Promise<string | null> {
  if (!retailerId) return null;
  const effectiveOrderDate = orderDate ?? new Date();

  // Étape 1 : lookup direct par faireRetailerId
  const existingByFaireId = await prisma.adminClientCard.findFirst({
    where: { tenantId, faireRetailerId: retailerId },
    select: { id: true, lastOrderAt: true },
  });
  if (existingByFaireId) {
    await prisma.adminClientCard.update({
      where: { id: existingByFaireId.id },
      data: {
        hasFaire: true,
        lastOrderAt: maxDate(existingByFaireId.lastOrderAt, effectiveOrderDate),
        ...buildOptionalCardFieldsFromAddress(address),
      },
    });
    return existingByFaireId.id;
  }

  // Étape 2 : fallback company_name normalisé (Faire n'expose pas de SIRET)
  const companyKey = normalizeCompanyKey(address?.company_name);
  if (companyKey) {
    const existingByCompany = await prisma.adminClientCard.findFirst({
      where: {
        tenantId,
        // Recherche insensible à la casse via lowercase + comparaison "starts with"
        // souple — company est un champ libre pouvant contenir des variantes.
        company: { contains: companyKey.split(" ")[0] },
      },
      select: { id: true, lastOrderAt: true, company: true },
    });
    if (existingByCompany && normalizeCompanyKey(existingByCompany.company) === companyKey) {
      await prisma.adminClientCard.update({
        where: { id: existingByCompany.id },
        data: {
          faireRetailerId: retailerId,
          hasFaire: true,
          lastOrderAt: maxDate(existingByCompany.lastOrderAt, effectiveOrderDate),
          ...buildOptionalCardFieldsFromAddress(address),
        },
      });
      return existingByCompany.id;
    }
  }

  // Étape 3 : création d'une nouvelle fiche
  const { firstName, lastName } = pickCustomerNameParts(address);
  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      hasFaire: true,
      faireRetailerId: retailerId,
      importedFromMarketplace: "FAIRE",
      lastOrderAt: effectiveOrderDate,
      ...buildOptionalCardFieldsFromAddress(address),
    },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────────────────────────────────
// Upsert commande depuis la ressource Faire
// ─────────────────────────────────────────────

export interface FaireOrderUpsertResult {
  orderId: string;
  created: boolean;
}

export async function upsertFaireOrderFromResource(
  tenantId: string,
  order: FaireOrderResource,
): Promise<FaireOrderUpsertResult> {
  const status = normalizeFaireStatus(order.state);
  const createdAtFaire = new Date(order.created_at);
  const updatedAtFaire = order.updated_at ? new Date(order.updated_at) : null;
  const shipAfter = order.ship_after ? new Date(order.ship_after) : null;
  const canceledAt = order.canceled_at ? new Date(order.canceled_at) : null;

  const address = order.address ?? null;
  const items = order.items ?? [];
  const shipments = order.shipments ?? [];

  const totalCents = computeFaireOrderTotalCents(items);
  // Faire renvoie 0 dans les champs *_cents historiques. On lit `commission`
  // et `payout_fee` (objets FaireMoney) en priorité.
  const commissionCents = faireMoneyToCents(
    order.payout_costs?.commission,
    order.payout_costs?.commission_cents,
  );
  const payoutFeeCents = faireMoneyToCents(
    order.payout_costs?.payout_fee,
    order.payout_costs?.payout_fee_cents,
  );
  const netCents = Math.max(0, totalCents - commissionCents - payoutFeeCents);

  const totalHT = new D(faireCentsToEuros(totalCents));
  const commissionAmount = new D(faireCentsToEuros(commissionCents));
  const payoutFeeAmount = new D(faireCentsToEuros(payoutFeeCents));
  const netAmount = new D(faireCentsToEuros(netCents));

  const tracking = extractFaireTrackingInfo(shipments);
  const shippedAt = tracking.shippedAt ? new Date(tracking.shippedAt) : null;

  const contactName = (address?.name ?? "").trim();
  const shopName = (address?.company_name ?? "").trim();
  const customerName = contactName || shopName || "(inconnu)";

  const shippingCountryCode = address?.country_code
    ? String(address.country_code).toUpperCase()
    : null;
  const customerCountry = shippingCountryCode ?? resolveCountryCode(address?.country ?? "");

  const retailerId = order.retailer_id ?? "";
  const adminClientCardId = retailerId
    ? await upsertClientCardFromFaireRetailer(
        tenantId,
        retailerId,
        address,
        createdAtFaire,
      )
    : null;

  const baseData: Prisma.FaireOrderUncheckedCreateInput = {
    tenantId,
    faireOrderId: order.id,
    displayId: order.display_id ?? null,
    status,
    statusRaw: order.state,
    faireSource: order.source ?? null,
    currency: order.currency ?? "EUR",
    createdAtFaire,
    updatedAtFaire,
    shipAfter,
    shippedAt,
    canceledAt,
    totalHT,
    commissionAmount,
    payoutFeeAmount,
    netAmount,
    shippingName: address?.name ?? null,
    shippingCompany: address?.company_name ?? null,
    shippingStreet: address?.address1 ?? null,
    shippingStreet2: address?.address2 ?? null,
    shippingCity: address?.city ?? null,
    shippingStateCode: address?.state_code ?? null,
    shippingPostalCode: address?.postal_code ?? null,
    shippingCountryCode,
    shippingPhone: address?.phone_number ?? null,
    faireRetailerId: retailerId || "unknown",
    customerName,
    customerShop: shopName || null,
    customerEmail: null, // Faire n'expose pas l'email retailer dans /orders
    customerPhone: address?.phone_number ?? null,
    customerCountry,
    adminClientCardId,
    carrier: tracking.carrier,
    trackingCode: tracking.trackingCode,
    trackingUrl: tracking.trackingUrl,
    rawDetailJson: order as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  };

  const existing = await prisma.faireOrder.findFirst({
    where: { tenantId, faireOrderId: order.id },
    select: { id: true },
  });

  let orderRowId: string;
  let created = false;
  if (existing) {
    await prisma.faireOrder.update({ where: { id: existing.id }, data: baseData });
    orderRowId = existing.id;
  } else {
    const row = await prisma.faireOrder.create({
      data: baseData,
      select: { id: true },
    });
    orderRowId = row.id;
    created = true;
  }

  // Snapshot stockDeductedAt existants pour survivre au re-sync
  const previouslyDeducted = new Map<string, Date>();
  const existingItems = await prisma.faireOrderItem.findMany({
    where: { faireOrderId: orderRowId, stockDeductedAt: { not: null } },
    select: { faireItemId: true, stockDeductedAt: true },
  });
  for (const ex of existingItems) {
    if (ex.stockDeductedAt) previouslyDeducted.set(ex.faireItemId, ex.stockDeductedAt);
  }

  // Rebuild items (idempotent : delete + reinsert)
  await prisma.faireOrderItem.deleteMany({
    where: { faireOrderId: orderRowId },
  });

  if (items.length > 0) {
    // Résolution catalogue en un seul aller-retour BDD
    const productIdsFaire = new Set<string>();
    const variantIdsFaire = new Set<string>();
    const refBases = new Set<string>();

    interface PerItem {
      item: FaireOrderItemResource;
      productIdFaire: string | null;
      variantIdFaire: string | null;
      refBase: string | null;
    }
    const perItem: PerItem[] = items.map((it) => {
      const productIdFaire = it.product_id ?? null;
      const variantIdFaire = it.product_option_id ?? null;
      const refBase = extractReferenceFromFaireSku(it.sku);
      if (productIdFaire) productIdsFaire.add(productIdFaire);
      if (variantIdFaire) variantIdsFaire.add(variantIdFaire);
      if (refBase) refBases.add(refBase);
      return { item: it, productIdFaire, variantIdFaire, refBase };
    });

    const orClauses: Prisma.ProductWhereInput[] = [];
    if (productIdsFaire.size > 0)
      orClauses.push({ faireProductId: { in: Array.from(productIdsFaire) } });
    if (refBases.size > 0) orClauses.push({ reference: { in: Array.from(refBases) } });
    // Retrouver aussi les produits via la variante (join sur colors)
    if (variantIdsFaire.size > 0)
      orClauses.push({ colors: { some: { faireVariantId: { in: Array.from(variantIdsFaire) } } } });

    const bjProducts = orClauses.length
      ? await prisma.product.findMany({
          where: { tenantId, OR: orClauses },
          select: {
            id: true,
            reference: true,
            name: true,
            faireProductId: true,
            colors: { select: { id: true, faireVariantId: true } },
          },
        })
      : [];
    const productByFaireId = new Map(
      bjProducts.filter((p) => p.faireProductId).map((p) => [p.faireProductId!, p]),
    );
    // Voir pfs-orders-sync.ts : MySQL case-insensitive vs Map.get case-sensitive.
    const productByRef = new Map(bjProducts.map((p) => [p.reference.toLowerCase(), p]));
    const productByVariantId = new Map<string, (typeof bjProducts)[number]>();
    for (const p of bjProducts) {
      for (const c of p.colors) {
        if (c.faireVariantId) productByVariantId.set(c.faireVariantId, p);
      }
    }

    const itemRows: Prisma.FaireOrderItemUncheckedCreateInput[] = perItem.map((row) => {
      const productMatch =
        (row.variantIdFaire && productByVariantId.get(row.variantIdFaire)) ||
        (row.productIdFaire && productByFaireId.get(row.productIdFaire)) ||
        (row.refBase && productByRef.get(row.refBase.toLowerCase())) ||
        null;
      const productColorMatch =
        productMatch && row.variantIdFaire
          ? productMatch.colors.find((c) => c.faireVariantId === row.variantIdFaire) ?? null
          : null;

      const unitPriceCents = getFaireItemUnitPriceCents(row.item);
      const quantity = row.item.quantity ?? 0;
      const unitPriceHT = new D(faireCentsToEuros(unitPriceCents));
      const totalPriceHT = new D(faireCentsToEuros(unitPriceCents * quantity));

      return {
        tenantId,
        faireOrderId: orderRowId,
        faireItemId: row.item.id,
        faireProductId: row.productIdFaire,
        faireVariantId: row.variantIdFaire,
        sku: row.item.sku ?? null,
        referenceBase: row.refBase,
        productId: productMatch?.id ?? null,
        productColorId: productColorMatch?.id ?? null,
        productSnapshotName: row.item.product_name ?? productMatch?.name ?? null,
        variantOptionLabel: row.item.product_option_name ?? null,
        quantity,
        unitPriceHT,
        totalPriceHT,
        includesTester: row.item.includes_tester ?? false,
        stockDeductedAt: previouslyDeducted.get(row.item.id) ?? null,
      };
    });

    await prisma.faireOrderItem.createMany({ data: itemRows });
  }

  return { orderId: orderRowId, created };
}

// ─────────────────────────────────────────────
// Sync helpers
// ─────────────────────────────────────────────

/**
 * Polling incrémental Faire.
 *
 * Faire trie `/orders` par `updated_at` **ascendant** (contrairement à PFS/Ankor
 * qui trient descendant). Si on lit la page 1 sans filtre, on récupère les 50
 * plus anciennes commandes toujours actives ; les nouvelles se retrouvent noyées
 * loin dans la pagination. Sur Issyma (495 commandes) le worker ratait ~38
 * commandes en 10 jours (incident diagnostiqué 2026-08-08).
 *
 * Fix : on passe `updated_at_min = lastSyncedAt - 15 min` (buffer de sécurité
 * pour couvrir race entre 2 ticks), et on pagine tant que la page est pleine.
 * La doc Faire (docs/faire-api.md §13.1) prescrit exactement ce pattern.
 *
 * Fallback : si `faire_orders_last_synced_at` absent (première fois), on
 * remonte 24 h en arrière — suffisant pour le régime nominal (tick 5 min).
 * Le rattrapage historique complet reste `importAllFaireOrdersFor()`.
 */
const SYNC_BUFFER_MS = 15 * 60_000;
const SYNC_FALLBACK_MS = 24 * 60 * 60_000;
const SYNC_MAX_PAGES = 20; // 20 × 50 = 1000 commandes/tick max (rare mais safe)

async function readLastSyncedAt(tenantId: string): Promise<number | null> {
  const row = await prisma.siteConfig.findFirst({
    where: { tenantId, key: "faire_orders_last_synced_at" },
    select: { value: true },
  });
  if (!row?.value) return null;
  const parsed = parseInt(row.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function syncRecentFaireOrders(tenantId: string): Promise<{
  created: number;
  updated: number;
  scanned: number;
}> {
  const lastSyncedAt = await readLastSyncedAt(tenantId);
  const cutoffMs = (lastSyncedAt ?? Date.now() - SYNC_FALLBACK_MS) - SYNC_BUFFER_MS;
  const updatedAtMin = new Date(cutoffMs).toISOString();

  let created = 0;
  let updated = 0;
  let scanned = 0;

  for (let page = 1; page <= SYNC_MAX_PAGES; page++) {
    const resp = await faireListOrders(page, 50, updatedAtMin);
    const orders = resp.orders ?? [];
    if (orders.length === 0) break;
    scanned += orders.length;

    const faireIds = orders.map((o) => o.id);
    const existingRows = await prisma.faireOrder.findMany({
      where: { tenantId, faireOrderId: { in: faireIds } },
      select: { faireOrderId: true, updatedAtFaire: true, statusRaw: true },
    });
    const existingMap = new Map(
      existingRows.map((r) => [
        r.faireOrderId,
        { updatedAtFaire: r.updatedAtFaire, statusRaw: r.statusRaw },
      ]),
    );

    for (const order of orders) {
      const existing = existingMap.get(order.id);
      const apiUpdated = order.updated_at ? new Date(order.updated_at).getTime() : 0;
      const bddUpdated = existing?.updatedAtFaire?.getTime() ?? 0;
      const statusChanged = existing && existing.statusRaw !== order.state;
      if (!existing || apiUpdated > bddUpdated || statusChanged) {
        try {
          const res = await upsertFaireOrderFromResource(tenantId, order);
          if (res.created) created++;
          else updated++;
        } catch (err) {
          logger.warn("[Faire Orders Sync] Échec import commande", {
            tenantId,
            faireOrderId: order.id,
            error: err,
          });
        }
      }
    }

    if (orders.length < 50) break;
  }

  return { created, updated, scanned };
}

// ─────────────────────────────────────────────
// Import historique (bulk)
// ─────────────────────────────────────────────

export interface FaireImportCurrentOrder {
  faireOrderId: string;
  displayId: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface FaireImportProgress {
  totalOrders: number | null; // Faire n'expose pas de total → null (pagination sans meta)
  processedOrders: number;
  currentPage: number;
  currentOrders: FaireImportCurrentOrder[];
}

export interface FaireImportEvent {
  orderNumber: string;
  customerName: string;
  result: "imported" | "unchanged" | "error";
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

const IMPORT_PAGE_SIZE = 50;

/**
 * Rattrapage historique : parcourt les pages 1..N jusqu'à réponse vide et
 * upsert toutes les commandes non encore à jour. Publie la progression sur
 * chaque commande traitée.
 */
export async function importAllFaireOrdersFor(
  tenantId: string,
  onProgress?: (p: FaireImportProgress) => void | Promise<void>,
  opts?: {
    stopSignal?: () => boolean | Promise<boolean>;
    onEvent?: (e: FaireImportEvent) => void | Promise<void>;
  },
): Promise<{ imported: number; skipped: number; unchanged: number; total: number }> {
  const state = { processed: 0, imported: 0, skipped: 0, unchanged: 0 };
  let currentPage = 0;
  const currentOrdersMap = new Map<string, FaireImportCurrentOrder>();

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
    const resp = await faireListOrders(currentPage, IMPORT_PAGE_SIZE);
    const orders = resp.orders ?? [];
    if (orders.length === 0) break;

    const faireIds = orders.map((o) => o.id);
    const existingRows = await prisma.faireOrder.findMany({
      where: { tenantId, faireOrderId: { in: faireIds } },
      select: { faireOrderId: true, updatedAtFaire: true, statusRaw: true },
    });
    const existingMap = new Map(
      existingRows.map((r) => [
        r.faireOrderId,
        { updatedAtFaire: r.updatedAtFaire, statusRaw: r.statusRaw },
      ]),
    );

    for (const order of orders) {
      if (opts?.stopSignal && (await opts.stopSignal())) break;

      const existing = existingMap.get(order.id);
      const apiUpdated = order.updated_at ? new Date(order.updated_at).getTime() : 0;
      const bddUpdated = existing?.updatedAtFaire?.getTime() ?? 0;
      const statusChanged = existing && existing.statusRaw !== order.state;
      const needsSync = !existing || apiUpdated > bddUpdated || statusChanged;

      const totalHT = faireCentsToEuros(computeFaireOrderTotalCents(order.items));
      const displayNumber = order.display_id ?? order.id;
      const currentInfo: FaireImportCurrentOrder = {
        faireOrderId: order.id,
        displayId: displayNumber,
        customerName:
          order.address?.name?.trim() ||
          order.address?.company_name?.trim() ||
          "(inconnu)",
        totalHT: Number.isFinite(totalHT) ? totalHT : null,
        country: order.address?.country_code
          ? String(order.address.country_code).toUpperCase()
          : null,
      };

      if (!needsSync) {
        state.unchanged++;
        state.processed++;
        if (opts?.onEvent) {
          await opts.onEvent({
            orderNumber: displayNumber,
            customerName: currentInfo.customerName,
            result: "unchanged",
            totalHT: currentInfo.totalHT,
            at: Date.now(),
          });
        }
        continue;
      }

      currentOrdersMap.set(order.id, currentInfo);
      await emitProgress();
      try {
        await upsertFaireOrderFromResource(tenantId, order);
        state.imported++;
        if (opts?.onEvent) {
          await opts.onEvent({
            orderNumber: displayNumber,
            customerName: currentInfo.customerName,
            result: "imported",
            totalHT: currentInfo.totalHT,
            at: Date.now(),
          });
        }
      } catch (err) {
        state.skipped++;
        logger.warn("[Faire Orders Import] Échec commande", {
          tenantId,
          faireOrderId: order.id,
          error: err,
        });
        if (opts?.onEvent) {
          await opts.onEvent({
            orderNumber: displayNumber,
            customerName: currentInfo.customerName,
            result: "error",
            totalHT: currentInfo.totalHT,
            errorMessage: err instanceof Error ? err.message : String(err),
            at: Date.now(),
          });
        }
      }
      state.processed++;
      currentOrdersMap.delete(order.id);
      await emitProgress();
    }

    // Si la page n'est pas pleine, on est à la fin
    if (orders.length < IMPORT_PAGE_SIZE) break;
  }

  return { ...state, total: state.processed };
}
