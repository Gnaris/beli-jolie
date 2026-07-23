/**
 * eFashion Orders Sync — Synchronisation lecture seule des commandes eFashion Paris.
 *
 * Calqué sur `lib/pfs-orders-sync.ts`. Deux modes :
 *  - `syncRecentEfashionOrders(tenantId)`  : polling incrémental (page 1),
 *    s'arrête dès que les commandes ont déjà été vues avec le même statut.
 *  - `importAllEfashionOrdersFor(tenantId, onProgress)` : rattrapage historique
 *    complet, boucle pages 1 → N avec appel `onProgress` après chaque commande.
 *
 * Matching des lignes :
 *   1. `ProductColor.efashionProductId === ligne.id_produit` (1-1 fiable),
 *   2. sinon fallback par `Product.reference === ligne.reference_base`,
 *   3. si aucun match, la ligne est stockée avec `productId = null`.
 *
 * Fiche client (AdminClientCard) :
 *   1. lookup par `efashionCustomerId` (ajout dédié au modèle si absent, sinon
 *      par email en fallback),
 *   2. fallback par email si connu,
 *   3. sinon création `hasEfashion=true`, `importedFromMarketplace="EFASHION"`.
 */

import { Prisma, EfashionOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  efashionListOrders,
  efashionGetOrderDetail,
  efashionGetOrderEtiquettes,
  normalizeEfashionStatus,
  sumLineQuantities,
  type EfashionListOrderRow,
  type EfashionOrderDetail,
} from "@/lib/efashion-orders-api";

const D = Prisma.Decimal;

// ─────────────────────────────────────────────
// Client card upsert
// ─────────────────────────────────────────────

/**
 * Rattache/crée la fiche client correspondante au client eFashion.
 * Priorité : efashionCustomerId → email → création.
 */
export async function upsertClientCardFromEfashionCustomer(
  tenantId: string,
  customer: NonNullable<EfashionOrderDetail["acheteur"]>,
  address: EfashionOrderDetail["adresseLivraison"],
  orderDate?: Date,
): Promise<string | null> {
  const efashionCustomerId = customer.id_acheteur;
  if (!efashionCustomerId) return null;

  const effectiveOrderDate = orderDate ?? new Date();

  // Étape 1 : lookup par efashionCustomerId
  const existingByEfashionId = await prisma.adminClientCard.findFirst({
    where: { tenantId, efashionCustomerId },
    select: { id: true, lastOrderAt: true },
  });
  if (existingByEfashionId) {
    const nextLastOrderAt = maxDate(existingByEfashionId.lastOrderAt, effectiveOrderDate);
    await prisma.adminClientCard.update({
      where: { id: existingByEfashionId.id },
      data: {
        hasEfashion: true,
        lastOrderAt: nextLastOrderAt,
        ...buildOptionalCardFieldsFromCustomer(customer, address),
      },
    });
    return existingByEfashionId.id;
  }

  // Étape 2 : fallback par email
  const email = normalizeEmail(customer.email);
  if (email) {
    const existingByEmail = await prisma.adminClientCard.findFirst({
      where: { tenantId, email },
      select: { id: true, lastOrderAt: true },
    });
    if (existingByEmail) {
      const nextLastOrderAt = maxDate(existingByEmail.lastOrderAt, effectiveOrderDate);
      await prisma.adminClientCard.update({
        where: { id: existingByEmail.id },
        data: {
          efashionCustomerId,
          hasEfashion: true,
          lastOrderAt: nextLastOrderAt,
          ...buildOptionalCardFieldsFromCustomer(customer, address),
        },
      });
      return existingByEmail.id;
    }
  }

  // Étape 3 : création
  const firstName = customer.prenomContact?.trim() || "";
  const lastName =
    customer.nomContact?.trim() || customer.nomSociete?.trim() || "(client eFashion)";
  const created = await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      hasEfashion: true,
      efashionCustomerId,
      importedFromMarketplace: "EFASHION",
      lastOrderAt: effectiveOrderDate,
      ...buildOptionalCardFieldsFromCustomer(customer, address),
    },
    select: { id: true },
  });
  return created.id;
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

function normalizeIdentifier(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\s+/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

interface OptionalCardFields {
  company?: string;
  email?: string;
  vatNumber?: string;
  phone?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
}

function buildOptionalCardFieldsFromCustomer(
  customer: NonNullable<EfashionOrderDetail["acheteur"]>,
  address: EfashionOrderDetail["adresseLivraison"],
): OptionalCardFields {
  const data: OptionalCardFields = {};
  const company = customer.nomSociete?.trim() || null;
  const email = normalizeEmail(customer.email);
  const vat = normalizeIdentifier(customer.tva_intra);
  const phone = address?.telephone?.trim() || address?.mobile?.trim() || null;
  if (company) data.company = company;
  if (email) data.email = email;
  if (vat) data.vatNumber = vat;
  if (phone) data.phone = phone;
  if (address) {
    if (address.adresse) data.addressLine = address.adresse;
    if (address.codePostal) data.postalCode = address.codePostal;
    if (address.ville) data.city = address.ville;
    if (address.pays?.code) data.countryCode = address.pays.code.toUpperCase();
  }
  return data;
}

// ─────────────────────────────────────────────
// Order upsert (from eFashion detail)
// ─────────────────────────────────────────────

interface EfashionOrderUpsertResult {
  orderId: string;
  created: boolean;
}

export async function upsertEfashionOrderFromDetail(
  tenantId: string,
  detail: EfashionOrderDetail,
): Promise<EfashionOrderUpsertResult> {
  // Le détail ne renvoie pas commandeStatut.statut_fr → on retombe sur l'id
  // numérique + un libellé calculé. La sync via LIST (syncSingleEfashionOrder)
  // repasse le vrai libellé via `overrides.statusLabelFr` juste après.
  const status = normalizeEfashionStatus(detail.statut);
  const createdAt = new Date(detail.dateCreation ?? detail.dateCommande);
  const shippedAt = detail.dateExpedition ? new Date(detail.dateExpedition) : null;
  const canceledAt = status === EfashionOrderStatus.CANCELLED ? shippedAt : null;

  const adminClientCardId = detail.acheteur
    ? await upsertClientCardFromEfashionCustomer(
        tenantId,
        detail.acheteur,
        detail.adresseLivraison,
        createdAt,
      )
    : null;

  const shippingCost =
    detail.commandeGroupe?.frais_port != null ? new D(detail.commandeGroupe.frais_port) : null;
  const customerName = detail.acheteur?.nomSociete ?? "(inconnu)";
  const customerContact = buildContactName(detail.acheteur);
  const customerCountry =
    detail.adresseLivraison?.pays?.code?.toUpperCase() ??
    detail.adresseFacturation?.pays?.code?.toUpperCase() ??
    null;

  // Tracking (best effort — n'échoue pas la sync si l'appel plante)
  let trackingNumber: string | null = null;
  let labelUrl: string | null = null;
  try {
    const etiquettes = await efashionGetOrderEtiquettes(detail.id_commande);
    if (etiquettes.length > 0) {
      trackingNumber = etiquettes[0].tracking_number ?? null;
      labelUrl = etiquettes[0].etiquette ?? null;
    }
  } catch (err) {
    logger.warn("[eFashion Orders Sync] échec récup étiquettes", {
      efashionOrderId: detail.id_commande,
      error: err,
    });
  }

  const existing = await prisma.efashionOrder.findFirst({
    where: { tenantId, efashionOrderId: String(detail.id_commande) },
    select: { id: true },
  });

  const baseData = {
    tenantId,
    efashionOrderId: String(detail.id_commande),
    efashionOrderName: detail.id_commande_name,
    efashionOrderGroupe: detail.id_commande_groupe != null ? String(detail.id_commande_groupe) : null,
    status,
    statusIdRaw: detail.statut,
    statusLabelFr: buildStatusLabel(detail),
    createdAtEfashion: createdAt,
    shippedAt,
    canceledAt,
    totalHT: new D(detail.montantTotal ?? 0),
    totalAfterDiscount: new D(detail.montantApresRemise ?? 0),
    ruptureHT: new D(0), // pas dans le détail, se remplit depuis la summary si dispo
    ca: new D(detail.montantCA ?? 0),
    shippingCost,
    totalWeight: detail.poids != null ? new D(detail.poids) : null,
    parcelCount: detail.nb_colis ?? 1,
    isFirstOrder: false, // info dispo côté LIST seulement, propagée par le caller
    carrier: detail.livraison?.libelle ?? null,
    paymentMethod: detail.paiement?.texte_fr ?? null,
    efashionCustomerId: detail.acheteur?.id_acheteur ?? "",
    customerName,
    customerContact,
    customerEmail: detail.acheteur?.email ?? null,
    customerVatIntra: detail.acheteur?.tva_intra ?? null,
    customerEori: detail.acheteur?.eori ?? null,
    customerCountry,
    adminClientCardId,
    trackingNumber,
    labelUrl,
    rawDetailJson: detail as unknown as Prisma.InputJsonValue,
    lastSyncedAt: new Date(),
  } satisfies Prisma.EfashionOrderUncheckedCreateInput;

  let orderId: string;
  let created = false;
  if (existing) {
    await prisma.efashionOrder.update({ where: { id: existing.id }, data: baseData });
    orderId = existing.id;
  } else {
    const row = await prisma.efashionOrder.create({ data: baseData, select: { id: true } });
    orderId = row.id;
    created = true;
  }

  // Snapshot des stockDeductedAt existants par id_ligne pour survivre au re-sync
  const previouslyDeductedByLineId = new Map<string, Date>();
  const existingItems = await prisma.efashionOrderItem.findMany({
    where: { efashionOrderId: orderId, stockDeductedAt: { not: null } },
    select: { efashionLineId: true, stockDeductedAt: true },
  });
  for (const ex of existingItems) {
    if (ex.stockDeductedAt) {
      previouslyDeductedByLineId.set(String(ex.efashionLineId), ex.stockDeductedAt);
    }
  }

  // Rebuild items (delete + createMany idempotent)
  await prisma.efashionOrderItem.deleteMany({ where: { efashionOrderId: orderId } });

  const lines = detail.lignes ?? [];
  if (lines.length > 0) {
    // Résolution des ProductColor : d'abord par efashionProductId (1-1),
    // puis fallback par reference_base pour les lignes non liées.
    const efashionProductIds = Array.from(
      new Set(lines.map((l) => l.id_produit).filter((v): v is number => typeof v === "number")),
    );
    const referenceBases = Array.from(new Set(lines.map((l) => l.reference_base).filter(Boolean)));

    const [colorMatches, productMatches] = await Promise.all([
      efashionProductIds.length > 0
        ? prisma.productColor.findMany({
            where: { tenantId, efashionProductId: { in: efashionProductIds } },
            select: {
              id: true,
              efashionProductId: true,
              productId: true,
              product: { select: { id: true, name: true, reference: true } },
            },
          })
        : Promise.resolve([]),
      referenceBases.length > 0
        ? prisma.product.findMany({
            where: { tenantId, reference: { in: referenceBases } },
            select: { id: true, reference: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const colorByEfashionId = new Map(
      colorMatches
        .filter((c) => typeof c.efashionProductId === "number")
        .map((c) => [c.efashionProductId as number, c]),
    );
    const productByRef = new Map(productMatches.map((p) => [p.reference, p]));

    const itemRows: Prisma.EfashionOrderItemUncheckedCreateInput[] = lines.map((line) => {
      const colorMatch = colorByEfashionId.get(line.id_produit);
      const productMatch =
        colorMatch?.product ?? productByRef.get(line.reference_base) ?? null;

      const qtyTotal = line.quantite_total ?? sumLineQuantities(line.quantites);
      const unitPriceHT = new D(line.prix ?? 0);
      const totalLineHT = new D(line.prixLigne ?? unitPriceHT.mul(qtyTotal || 1));

      return {
        tenantId,
        efashionOrderId: orderId,
        efashionLineId: BigInt(line.id_ligne),
        efashionProductId: line.id_produit,
        efashionColorId: line.id_couleur ?? null,
        referenceFull: line.reference,
        referenceBase: line.reference_base,
        productId: productMatch?.id ?? null,
        productColorId: colorMatch?.id ?? null,
        productSnapshotName: productMatch?.name ?? null,
        colorLabelFr: line.couleur_FR ?? null,
        categorySnapshot: line.categorie ?? null,
        provenanceCode: line.provenance_code ?? null,
        qtyTotal,
        qtyPackUnit: line.quantite_pack ?? 1,
        quantitiesJson: (line.quantites ?? {}) as unknown as Prisma.InputJsonValue,
        declinaisonsJson: (line.declinaisons ?? {}) as unknown as Prisma.InputJsonValue,
        unitPriceHT,
        totalLineHT,
        weightUnit: line.poids_produit != null ? new D(line.poids_produit) : null,
        weightLine: line.poids != null ? new D(line.poids) : null,
        stockDeductedAt: previouslyDeductedByLineId.get(String(line.id_ligne)) ?? null,
      };
    });

    await prisma.efashionOrderItem.createMany({ data: itemRows });
  }

  return { orderId, created };
}

function buildContactName(
  customer: EfashionOrderDetail["acheteur"] | null | undefined,
): string | null {
  if (!customer) return null;
  const parts = [customer.prenomContact, customer.nomContact]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  return parts.length > 0 ? parts.join(" ") : null;
}

function buildStatusLabel(detail: EfashionOrderDetail): string {
  // Le détail ne renvoie pas commandeStatut, on retombe sur un libellé par défaut.
  // La sync liste, elle, dispose de commandeStatut.statut_fr — voir syncSingleEfashionOrder.
  return `Statut ${detail.statut}`;
}

// ─────────────────────────────────────────────
// Sync helpers
// ─────────────────────────────────────────────

export async function syncSingleEfashionOrder(
  tenantId: string,
  efashionOrderId: string | number,
  overrides?: {
    statusLabelFr?: string;
    isFirstOrder?: boolean;
    ruptureHT?: number;
  },
): Promise<EfashionOrderUpsertResult> {
  const detail = await efashionGetOrderDetail(efashionOrderId);
  const res = await upsertEfashionOrderFromDetail(tenantId, detail);
  if (overrides && (overrides.statusLabelFr || overrides.isFirstOrder || overrides.ruptureHT != null)) {
    // Recalcule le statut normalisé en tenant compte du libellé (« Confirmé »
    // → VALIDATED alors que l'id numérique seul aurait retombé sur NEW).
    const nextStatus = overrides.statusLabelFr
      ? normalizeEfashionStatus(detail.statut, overrides.statusLabelFr)
      : undefined;
    await prisma.efashionOrder.update({
      where: { id: res.orderId },
      data: {
        statusLabelFr: overrides.statusLabelFr ?? undefined,
        status: nextStatus,
        isFirstOrder: overrides.isFirstOrder ?? undefined,
        ruptureHT: overrides.ruptureHT != null ? new D(overrides.ruptureHT) : undefined,
      },
    });
  }
  return res;
}

/**
 * Polling incrémental : lit page 1 et importe/rafraîchit les commandes non
 * encore vues ou dont le statut a changé. Retourne le nombre créées + MAJ.
 */
export async function syncRecentEfashionOrders(tenantId: string): Promise<{
  created: number;
  updated: number;
  scanned: number;
}> {
  const first = await efashionListOrders({ page: 1, limit: 50 });
  const summaries = first.data ?? [];
  if (summaries.length === 0) {
    return { created: 0, updated: 0, scanned: 0 };
  }

  const orderIds = summaries.map((s) => s.id_commande);
  const existingRows = await prisma.efashionOrder.findMany({
    where: { tenantId, efashionOrderId: { in: orderIds } },
    select: { efashionOrderId: true, status: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.efashionOrderId, r.status]));

  const toSync: EfashionListOrderRow[] = [];
  for (const summary of summaries) {
    const existingStatus = existingMap.get(summary.id_commande);
    const nextStatus = normalizeEfashionStatus(
      summary.statut,
      summary.commandeStatut?.statut_fr,
    );
    if (!existingStatus || existingStatus !== nextStatus) {
      toSync.push(summary);
    }
  }

  let created = 0;
  let updated = 0;
  for (const summary of toSync) {
    try {
      const res = await syncSingleEfashionOrder(tenantId, summary.id_commande, {
        statusLabelFr: summary.commandeStatut?.statut_fr,
        isFirstOrder: summary.isPremiereCommande,
        ruptureHT: summary.montantRuptureHT,
      });
      if (res.created) created++;
      else updated++;
    } catch (err) {
      logger.warn("[eFashion Orders Sync] Échec import commande", {
        tenantId,
        efashionOrderId: summary.id_commande,
        error: err,
      });
    }
  }

  return { created, updated, scanned: summaries.length };
}

// ─────────────────────────────────────────────
// Import historique (bulk)
// ─────────────────────────────────────────────

export interface EfashionImportCurrentOrder {
  efashionOrderId: string;
  orderNumber: string;
  customerName: string;
  totalHT: number | null;
  country: string | null;
}

export interface EfashionImportProgress {
  totalOrders: number;
  processedOrders: number;
  currentPage: number;
  totalPages: number;
  currentOrders: EfashionImportCurrentOrder[];
}

export interface EfashionImportEvent {
  orderNumber: string;
  customerName: string;
  result: "imported" | "unchanged" | "error";
  totalHT: number | null;
  errorMessage?: string;
  at: number;
}

const PAGE_CHUNK_SIZE = 10;
const DETAIL_CONCURRENCY = 5;
const PAGE_LIMIT = 50;

export async function importAllEfashionOrdersFor(
  tenantId: string,
  onProgress?: (p: EfashionImportProgress) => void | Promise<void>,
  opts?: {
    stopSignal?: () => boolean | Promise<boolean>;
    onEvent?: (e: EfashionImportEvent) => void | Promise<void>;
  },
): Promise<{ imported: number; skipped: number; unchanged: number; total: number }> {
  const first = await efashionListOrders({ page: 1, limit: PAGE_LIMIT });
  const totalOrders = first.total ?? first.data.length;
  const totalPages = Math.max(1, Math.ceil(totalOrders / (first.limit || PAGE_LIMIT)));

  const state = { processed: 0, imported: 0, skipped: 0, unchanged: 0 };
  const currentOrdersMap = new Map<string, EfashionImportCurrentOrder>();

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
  const emitEvent = async (e: EfashionImportEvent) => {
    if (opts?.onEvent) await opts.onEvent(e);
  };

  const processChunk = async (
    chunk: Array<{ page: number; summaries: EfashionListOrderRow[] }>,
  ): Promise<boolean> => {
    const allItems: Array<{ page: number; summary: EfashionListOrderRow }> = [];
    for (const c of chunk) {
      for (const s of c.summaries) allItems.push({ page: c.page, summary: s });
    }
    if (allItems.length === 0) return false;

    const ids = allItems.map((it) => it.summary.id_commande);
    const existingRows = await prisma.efashionOrder.findMany({
      where: { tenantId, efashionOrderId: { in: ids } },
      select: { efashionOrderId: true, status: true },
    });
    const existingStatusMap = new Map(existingRows.map((r) => [r.efashionOrderId, r.status]));

    const needsSync: typeof allItems = [];
    const lastPage = chunk[chunk.length - 1]?.page ?? 0;
    for (const it of allItems) {
      const existingStatus = existingStatusMap.get(it.summary.id_commande);
      const nextStatus = normalizeEfashionStatus(
        it.summary.statut,
        it.summary.commandeStatut?.statut_fr,
      );
      if (!existingStatus || existingStatus !== nextStatus) {
        needsSync.push(it);
      } else {
        state.unchanged++;
        state.processed++;
        await emitEvent({
          orderNumber: it.summary.id_commande_name,
          customerName: it.summary.acheteur?.nomSociete ?? "(inconnu)",
          result: "unchanged",
          totalHT: it.summary.montantTotal ?? null,
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
        currentOrdersMap.set(item.summary.id_commande, {
          efashionOrderId: item.summary.id_commande,
          orderNumber: item.summary.id_commande_name,
          customerName: item.summary.acheteur?.nomSociete ?? "(inconnu)",
          totalHT: item.summary.montantTotal ?? null,
          country: null,
        });
        await emitProgress(item.page);
        try {
          await syncSingleEfashionOrder(tenantId, item.summary.id_commande, {
            statusLabelFr: item.summary.commandeStatut?.statut_fr,
            isFirstOrder: item.summary.isPremiereCommande,
            ruptureHT: item.summary.montantRuptureHT,
          });
          state.imported++;
          await emitEvent({
            orderNumber: item.summary.id_commande_name,
            customerName: item.summary.acheteur?.nomSociete ?? "(inconnu)",
            result: "imported",
            totalHT: item.summary.montantTotal ?? null,
            at: Date.now(),
          });
        } catch (err) {
          state.skipped++;
          logger.warn("[eFashion Orders Import] Échec commande", {
            tenantId,
            efashionOrderId: item.summary.id_commande,
            error: err,
          });
          await emitEvent({
            orderNumber: item.summary.id_commande_name,
            customerName: item.summary.acheteur?.nomSociete ?? "(inconnu)",
            result: "error",
            totalHT: item.summary.montantTotal ?? null,
            errorMessage: err instanceof Error ? err.message : String(err),
            at: Date.now(),
          });
        }
        state.processed++;
        currentOrdersMap.delete(item.summary.id_commande);
        await emitProgress(item.page);
      }
    });
    await Promise.all(workers);
    return stopped;
  };

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
          const resp = await efashionListOrders({ page: pageNum, limit: PAGE_LIMIT });
          return { page: pageNum, summaries: resp.data ?? [] };
        } catch (err) {
          logger.error("[eFashion Orders Import] Échec chargement page", {
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
