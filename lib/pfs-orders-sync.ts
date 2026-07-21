/**
 * PFS Orders Sync — Synchronisation lecture seule des commandes Paris Fashion Shop.
 *
 * Deux modes :
 *  - `syncRecentPfsOrders(tenantId)`  : polling incrémental (page 1),
 *    s'arrête dès que les commandes ont déjà été vues avec le même statut.
 *  - `importAllPfsOrdersFor(tenantId, onProgress)` : rattrapage historique complet,
 *    boucle pages 1 → N avec appel `onProgress` après chaque commande importée.
 *
 * Le matching des lignes à notre catalogue produit se fait par référence
 * (Product.reference) au niveau du tenant courant. Si la référence est inconnue,
 * la ligne est stockée avec `productId = null` et affichée « Produit non
 * présent sur notre site » dans l'UI.
 *
 * Les fiches clients (AdminClientCard) sont créées/rattachées automatiquement :
 *   1. lookup par `pfsCustomerId` (rapide, direct)
 *   2. fallback SIRET si `siret` connu
 *   3. sinon création d'une fiche `hasPfs=true`, `importedFromMarketplace="PFS"`.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveCountryCode } from "@/lib/countries";
import {
  pfsListOrders,
  pfsGetOrderDetail,
  normalizePfsStatus,
  type PfsListOrderSummary,
  type PfsOrderDetail,
  type PfsOrderDetailItem,
  type PfsOrderDetailProduct,
} from "@/lib/pfs-orders-api";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Client card upsert
// ─────────────────────────────────────────────

/**
 * Rattache/crée la fiche client correspondante au client PFS.
 * Retourne l'id AdminClientCard (ou null si le tenantId manque — sécurité).
 */
export async function upsertClientCardFromPfsCustomer(
  tenantId: string,
  customer: PfsOrderDetail["customer"],
  orderDate?: Date,
): Promise<string | null> {
  const pfsCustomerId = customer.id;
  if (!pfsCustomerId) return null;

  // `lastOrderAt` doit refléter la date de la commande PFS (`created_at`), pas
  // l'instant où l'import a tourné — sinon toutes les fiches se retrouvent
  // datées d'aujourd'hui après un rattrapage. Si l'appelant ne fournit pas
  // de date on retombe sur `now`, mais tous les flux PFS passent la vraie.
  const effectiveOrderDate = orderDate ?? new Date();

  // Étape 1 : lookup direct par pfsCustomerId (le plus rapide et fiable)
  const existingByPfsId = await prisma.adminClientCard.findFirst({
    where: { tenantId, pfsCustomerId },
    select: { id: true, lastOrderAt: true },
  });
  if (existingByPfsId) {
    const nextLastOrderAt = maxDate(existingByPfsId.lastOrderAt, effectiveOrderDate);
    await prisma.adminClientCard.update({
      where: { id: existingByPfsId.id },
      data: {
        hasPfs: true,
        lastOrderAt: nextLastOrderAt,
        ...buildOptionalCardFieldsFromCustomer(customer),
      },
    });
    return existingByPfsId.id;
  }

  // Étape 2 : fallback par SIRET (fiche existante saisie manuellement)
  const siret = normalizeIdentifier(customer.identification_numbers?.siret);
  if (siret) {
    const existingBySiret = await prisma.adminClientCard.findFirst({
      where: { tenantId, siret },
      select: { id: true, lastOrderAt: true },
    });
    if (existingBySiret) {
      const nextLastOrderAt = maxDate(existingBySiret.lastOrderAt, effectiveOrderDate);
      await prisma.adminClientCard.update({
        where: { id: existingBySiret.id },
        data: {
          pfsCustomerId,
          hasPfs: true,
          lastOrderAt: nextLastOrderAt,
          ...buildOptionalCardFieldsFromCustomer(customer),
        },
      });
      return existingBySiret.id;
    }
  }

  // Étape 3 : création d'une nouvelle fiche
  // firstName/lastName sont requis en base — PFS ne fournit qu'un nom
  // global. On met le nom entier en `lastName` et on laisse `firstName` vide
  // (la cliente pourra ajuster à la main dans le drawer).
  const { firstName, lastName } = splitCustomerName(customer.name);
  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      hasPfs: true,
      pfsCustomerId,
      importedFromMarketplace: "PFS",
      lastOrderAt: effectiveOrderDate,
      ...buildOptionalCardFieldsFromCustomer(customer),
    },
    select: { id: true },
  });
  return created.id;
}

function maxDate(a: Date | null, b: Date): Date {
  if (!a) return b;
  return a.getTime() >= b.getTime() ? a : b;
}

function normalizeIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\s+/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function splitCustomerName(raw: string): { firstName: string; lastName: string } {
  const cleaned = String(raw ?? "").trim();
  if (!cleaned) return { firstName: "", lastName: "(client PFS)" };
  return { firstName: "", lastName: cleaned };
}

interface OptionalCardFields {
  company?: string;
  siret?: string;
  vatNumber?: string;
  phone?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
}

function buildOptionalCardFieldsFromCustomer(
  customer: PfsOrderDetail["customer"],
): OptionalCardFields {
  const siret = normalizeIdentifier(customer.identification_numbers?.siret);
  const vat = normalizeIdentifier(customer.identification_numbers?.vat);
  const phone = customer.phone?.trim() || null;
  const addr = customer.delivery_address || customer.billing_address;
  const data: OptionalCardFields = {};
  const company = customer.shop?.trim() || customer.name?.trim() || null;
  if (company) data.company = company;
  if (siret) data.siret = siret;
  if (vat) data.vatNumber = vat;
  if (phone) data.phone = phone;
  if (addr) {
    if (addr.street) data.addressLine = addr.street;
    if (addr.postal_code) data.postalCode = addr.postal_code;
    if (addr.city) data.city = addr.city;
    if (addr.country) {
      // PFS remonte le nom du pays en clair (ex "Portugal"). On le convertit en
      // code ISO alpha-2 pour que les drapeaux et libellés côté fiche fonctionnent.
      const iso = resolveCountryCode(addr.country);
      if (iso) data.countryCode = iso;
    }
  }
  return data;
}

// ─────────────────────────────────────────────
// Order upsert (from PFS detail)
// ─────────────────────────────────────────────

interface PfsOrderUpsertResult {
  orderId: string; // id BDD
  created: boolean; // true si insert, false si update
}

export async function upsertPfsOrderFromDetail(
  tenantId: string,
  detail: PfsOrderDetail,
): Promise<PfsOrderUpsertResult> {
  const status = normalizePfsStatus(detail.status);
  const createdAtPfs = new Date(detail.created_at);
  const adminClientCardId = await upsertClientCardFromPfsCustomer(
    tenantId,
    detail.customer,
    createdAtPfs,
  );
  const canceledAt = detail.canceled_at ? new Date(detail.canceled_at) : null;

  const summary = detail.summary;
  const totalHT = new D(summary.subtotal_excl_tax ?? 0);
  const totalTTC = new D(summary.total_incl_tax ?? detail.validated_vat ?? detail.order_vat ?? 0);
  const vatAmount = new D(summary.vat?.amount ?? 0);
  const vatRate = new D(summary.vat?.rate ?? 0);

  const carrier = detail.customer.carrier?.value ?? null;
  const paymentMethod = detail.customer.payment_method ?? null;

  const customerName = detail.customer.name ?? "(inconnu)";
  const customerShop = detail.customer.shop ?? null;
  const deliveryCountry = detail.customer.delivery_address?.country ?? null;
  const billingCountry = detail.customer.billing_address?.country ?? null;
  const customerCountry = (deliveryCountry || billingCountry) ?? null;

  // Upsert principal : le couple (tenantId, pfsOrderId) est unique.
  const existing = await prisma.pfsOrder.findFirst({
    where: { tenantId, pfsOrderId: detail.id },
    select: { id: true },
  });

  const baseData = {
    tenantId,
    pfsOrderId: detail.id,
    orderNumber: detail.order_no,
    status,
    createdAtPfs,
    canceledAt,
    totalHT,
    totalTTC,
    vatAmount,
    vatRate,
    totalWeight: detail.total_weight != null ? new D(detail.total_weight) : null,
    totalOrderedQty: detail.total_ordered_qty ?? 0,
    totalValidatedQty: detail.total_validated_qty ?? 0,
    uniqueReferences: detail.unique_references ?? 0,
    hasInvoice: detail.has_invoice === 1,
    hasCredit: detail.has_credit === 1,
    carrier,
    paymentMethod,
    pfsCustomerId: detail.customer.id,
    customerName,
    customerShop,
    customerCountry: customerCountry ? String(customerCountry).toUpperCase() : null,
    adminClientCardId,
    statusTimelineJson: detail.status_timeline as unknown as Prisma.InputJsonValue,
    rawDetailJson: detail as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  } satisfies Prisma.PfsOrderUncheckedCreateInput;

  let orderId: string;
  let created = false;
  if (existing) {
    await prisma.pfsOrder.update({ where: { id: existing.id }, data: baseData });
    orderId = existing.id;
  } else {
    const row = await prisma.pfsOrder.create({ data: baseData, select: { id: true } });
    orderId = row.id;
    created = true;
  }

  // Rebuild items (idempotent : on efface + reinsert, simplifie la logique)
  await prisma.pfsOrderItem.deleteMany({ where: { pfsOrderId: orderId } });

  const flatItems = flattenDetailItems(detail);
  if (flatItems.length > 0) {
    const productRefs = Array.from(new Set(flatItems.map((it) => it.reference).filter(Boolean)));
    const products = productRefs.length
      ? await prisma.product.findMany({
          where: { tenantId, reference: { in: productRefs } },
          select: {
            id: true,
            reference: true,
            name: true,
            colors: { select: { id: true, pfsVariantId: true } },
          },
        })
      : [];
    const productByRef = new Map(products.map((p) => [p.reference, p]));

    const itemRows: Prisma.PfsOrderItemUncheckedCreateInput[] = flatItems.map((it) => {
      const productMatch = productByRef.get(it.reference);
      const productColorMatch = productMatch?.colors.find((c) =>
        c.pfsVariantId && it.raw.variant_id && c.pfsVariantId === it.raw.variant_id,
      );

      const unitPriceHT = new D(it.raw.price_sale?.unit?.value ?? 0);
      const totalPriceHT =
        it.raw.price_sale?.total_with_qty?.value != null
          ? new D(it.raw.price_sale.total_with_qty.value)
          : new D(it.raw.price_sale?.total?.value ?? 0).mul(it.raw.qty_ordered ?? 1);

      const colorLabelFr =
        it.raw.color?.labels?.fr ?? it.raw.color?.reference ?? null;

      return {
        tenantId,
        pfsOrderId: orderId,
        pfsItemId: it.raw.id,
        pfsProductRef: it.reference,
        pfsProductInternalId: it.pfsProductInternalId,
        pfsSku: it.raw.sku,
        productId: productMatch?.id ?? null,
        productColorId: productColorMatch?.id ?? null,
        productSnapshotName: productMatch?.name ?? null,
        colorLabelFr,
        colorCodePfs: it.raw.color?.reference ?? null,
        sizeLabel: it.raw.item?.size ?? null,
        sizeDetails: it.raw.size_details_tu ?? null,
        itemType: it.raw.type ?? "ITEM",
        qtyOrdered: it.raw.qty_ordered ?? 0,
        qtyValidated: it.raw.qty_validated ?? 0,
        unitPriceHT,
        totalPriceHT,
        weight: it.raw.weight != null ? new D(it.raw.weight) : null,
      };
    });

    await prisma.pfsOrderItem.createMany({ data: itemRows });
  }

  return { orderId, created };
}

interface FlatItem {
  reference: string;
  pfsProductInternalId: string | null;
  raw: PfsOrderDetailItem;
}

function flattenDetailItems(detail: PfsOrderDetail): FlatItem[] {
  const out: FlatItem[] = [];
  for (const brand of detail.items_by_brand ?? []) {
    for (const product of brand.products ?? []) {
      const reference = product.reference ?? "";
      const pfsProductInternalId = product.id ?? null;
      for (const it of product.items ?? []) {
        out.push({ reference, pfsProductInternalId, raw: it });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// Sync helpers
// ─────────────────────────────────────────────

export async function syncSinglePfsOrder(
  tenantId: string,
  pfsOrderId: string,
): Promise<PfsOrderUpsertResult> {
  const detail = await pfsGetOrderDetail(pfsOrderId);
  return upsertPfsOrderFromDetail(tenantId, detail);
}

/**
 * Polling incrémental : lit page 1 (les 50 plus récentes) et importe/rafraîchit
 * les commandes non encore vues ou dont le statut a changé. S'arrête dès qu'on
 * tombe sur un lot où toutes les commandes sont déjà synchronisées à l'identique.
 *
 * Retourne le nombre de commandes créées + mises à jour.
 */
export async function syncRecentPfsOrders(tenantId: string): Promise<{
  created: number;
  updated: number;
  scanned: number;
}> {
  const first = await pfsListOrders({ page: 1, perPage: 50 });
  const summaries = first.data ?? [];
  if (summaries.length === 0) {
    return { created: 0, updated: 0, scanned: 0 };
  }

  // Chercher lesquelles existent déjà + leur statut BDD
  const pfsIds = summaries.map((s) => s.id);
  const existingRows = await prisma.pfsOrder.findMany({
    where: { tenantId, pfsOrderId: { in: pfsIds } },
    select: { pfsOrderId: true, status: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.pfsOrderId, r.status]));

  const toSync: PfsListOrderSummary[] = [];
  for (const summary of summaries) {
    const existingStatus = existingMap.get(summary.id);
    const nextStatus = normalizePfsStatus(summary.status);
    if (!existingStatus) {
      toSync.push(summary);
      continue;
    }
    if (existingStatus !== nextStatus) {
      toSync.push(summary);
    }
  }

  let created = 0;
  let updated = 0;
  for (const summary of toSync) {
    try {
      const res = await syncSinglePfsOrder(tenantId, summary.id);
      if (res.created) created++;
      else updated++;
    } catch (err) {
      logger.warn("[PFS Orders Sync] Échec import commande", {
        tenantId,
        pfsOrderId: summary.id,
        error: err,
      });
    }
  }

  return { created, updated, scanned: summaries.length };
}

// ─────────────────────────────────────────────
// Import historique (bulk)
// ─────────────────────────────────────────────

export interface PfsImportCurrentOrder {
  pfsOrderId: string;
  orderNumber: string;
  customerName: string;
  totalTTC: number | null;
  country: string | null;
}

export interface PfsImportProgress {
  totalOrders: number;
  processedOrders: number;
  currentPage: number;
  totalPages: number;
  /** Commandes actuellement traitées par les 5 workers en parallèle. */
  currentOrders: PfsImportCurrentOrder[];
}

export interface PfsImportEvent {
  orderNumber: string;
  customerName: string;
  result: "imported" | "unchanged" | "error";
  totalTTC: number | null;
  errorMessage?: string;
  at: number;
}

/** Nombre de pages de listing PFS qu'on fetch en parallèle (léger, sans risque). */
const PAGE_CHUNK_SIZE = 10;
/** Nombre d'appels détail PFS en parallèle (borné pour éviter le rate-limit). */
const DETAIL_CONCURRENCY = 5;

/**
 * Rattrapage historique : traite les pages par tranches de 10. Pour chaque
 * tranche : (1) fetch les 10 listings en parallèle, (2) une seule requête BDD
 * bulk qui filtre les commandes déjà à jour, (3) fetch les détails restants
 * avec 5 workers concurrents. Un re-import complet devient quasi instantané.
 */
export async function importAllPfsOrdersFor(
  tenantId: string,
  onProgress?: (p: PfsImportProgress) => void | Promise<void>,
  opts?: {
    stopSignal?: () => boolean | Promise<boolean>;
    onEvent?: (e: PfsImportEvent) => void | Promise<void>;
  },
): Promise<{ imported: number; skipped: number; unchanged: number; total: number }> {
  const first = await pfsListOrders({ page: 1, perPage: 50 });
  const totalPages = first.meta.last_page ?? 1;
  const totalOrders = first.meta.total ?? first.data.length;

  const state = { processed: 0, imported: 0, skipped: 0, unchanged: 0 };
  // Map<pfsOrderId, currentOrder> — chaque worker set son entrée avant le fetch
  // détail, delete à la fin. Snapshot en tableau à chaque emitProgress.
  const currentOrdersMap = new Map<string, PfsImportCurrentOrder>();

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

  const emitEvent = async (e: PfsImportEvent) => {
    if (opts?.onEvent) await opts.onEvent(e);
  };

  const processChunk = async (
    chunk: Array<{ page: number; summaries: PfsListOrderSummary[] }>,
  ): Promise<boolean> => {
    const allItems: Array<{ page: number; summary: PfsListOrderSummary }> = [];
    for (const c of chunk) {
      for (const s of c.summaries) allItems.push({ page: c.page, summary: s });
    }
    if (allItems.length === 0) return false;

    const pfsIds = allItems.map((it) => it.summary.id);
    const existingRows = await prisma.pfsOrder.findMany({
      where: { tenantId, pfsOrderId: { in: pfsIds } },
      select: { pfsOrderId: true, status: true },
    });
    const existingStatusMap = new Map(existingRows.map((r) => [r.pfsOrderId, r.status]));

    const needsSync: typeof allItems = [];
    const lastPage = chunk[chunk.length - 1]?.page ?? 0;
    for (const it of allItems) {
      const existingStatus = existingStatusMap.get(it.summary.id);
      const nextStatus = normalizePfsStatus(it.summary.status);
      if (!existingStatus || existingStatus !== nextStatus) {
        needsSync.push(it);
      } else {
        state.unchanged++;
        state.processed++;
        await emitEvent({
          orderNumber: it.summary.order_no,
          customerName: it.summary.customer ?? "(inconnu)",
          result: "unchanged",
          totalTTC: it.summary.validated_vat ?? it.summary.order_vat ?? null,
          at: Date.now(),
        });
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
        // Publie « commande en cours » AVANT l'appel détail (long ~1-2s).
        currentOrdersMap.set(item.summary.id, {
          pfsOrderId: item.summary.id,
          orderNumber: item.summary.order_no,
          customerName: item.summary.customer ?? "(inconnu)",
          totalTTC: item.summary.validated_vat ?? item.summary.order_vat ?? null,
          country: item.summary.country ?? null,
        });
        await emitProgress(item.page);
        try {
          await syncSinglePfsOrder(tenantId, item.summary.id);
          state.imported++;
          await emitEvent({
            orderNumber: item.summary.order_no,
            customerName: item.summary.customer ?? "(inconnu)",
            result: "imported",
            totalTTC: item.summary.validated_vat ?? item.summary.order_vat ?? null,
            at: Date.now(),
          });
        } catch (err) {
          state.skipped++;
          logger.warn("[PFS Orders Import] Échec commande", {
            tenantId,
            pfsOrderId: item.summary.id,
            error: err,
          });
          await emitEvent({
            orderNumber: item.summary.order_no,
            customerName: item.summary.customer ?? "(inconnu)",
            result: "error",
            totalTTC: item.summary.validated_vat ?? item.summary.order_vat ?? null,
            errorMessage: err instanceof Error ? err.message : String(err),
            at: Date.now(),
          });
        }
        state.processed++;
        currentOrdersMap.delete(item.summary.id);
        await emitProgress(item.page);
      }
    });
    await Promise.all(workers);
    return stopped;
  };

  // Page 1 déjà fetchée en amont pour connaître totalPages.
  const stoppedOnFirst = await processChunk([{ page: 1, summaries: first.data ?? [] }]);
  if (stoppedOnFirst) return { ...state, total: totalOrders };

  for (let start = 2; start <= totalPages; start += PAGE_CHUNK_SIZE) {
    const pageNumbers: number[] = [];
    for (let p = start; p < start + PAGE_CHUNK_SIZE && p <= totalPages; p++) {
      pageNumbers.push(p);
    }

    const listResults = await Promise.all(
      pageNumbers.map(async (pageNum) => {
        try {
          const resp = await pfsListOrders({ page: pageNum, perPage: 50 });
          return { page: pageNum, summaries: resp.data ?? [] };
        } catch (err) {
          logger.error("[PFS Orders Import] Échec chargement page", {
            tenantId,
            page: pageNum,
            error: err,
          });
          return { page: pageNum, summaries: [] };
        }
      }),
    );

    const stopped = await processChunk(listResults);
    if (stopped) break;
  }

  return { ...state, total: totalOrders };
}
