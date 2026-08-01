/**
 * Microstore Customers Sync — import de la liste complète des clients.
 *
 * Contrairement aux 4 autres marketplaces (PFS, eFashion, Ankor, Faire) qui
 * ne renvoient les infos client qu'à travers leurs commandes, Microstore
 * expose un endpoint dédié `/customer/get_by_order` qui liste TOUS les
 * clients — même ceux qui n'ont jamais commandé.
 *
 * On upsert chaque client dans `AdminClientCard` avec `microstoreClientId`
 * comme clé stable. Le nom est splitté sur le 1er espace pour extraire
 * un firstName / lastName (heuristique simple : les vrais noms Microstore
 * sont libres, souvent juste le nom de famille).
 *
 * Clients ignorés :
 *  - `id` numérique ≤ 0 → clients système type "Client tmp" (id=-11)
 *  - `disable === "1"` → déjà filtré par l'API via `client_status`, mais
 *    on double-check par sécurité
 *
 * Enrichissement :
 *  - Les infos email, VAT, country ne sont PAS présentes dans la liste
 *    basique. Elles seront ajoutées automatiquement quand une commande de
 *    ce client sera importée (le detail commande contient `client_info`
 *    complet qui vient enrichir la fiche existante).
 */
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  microstoreListCustomers,
  type MicrostoreCustomerListItem,
} from "@/lib/microstore-client";

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // sécurité : 20 000 clients max
const PARALLEL_PAGES = 10; // 10 pages fetchées en parallèle (~10× plus rapide)

export interface MicrostoreCustomersProgress {
  page: number;
  processed: number;
  total: number;
}

export interface MicrostoreCustomersResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ microstoreClientId: string; error: string }>;
}

export interface SyncMicrostoreCustomersOptions {
  tenantId: string;
  /** Signal d'annulation coopératif — vérifié entre chaque page. */
  shouldStop?: () => Promise<boolean>;
  /** Callback appelé après chaque page. */
  onProgress?: (info: MicrostoreCustomersProgress) => Promise<void> | void;
  /** Callback appelé après chaque client upserté. */
  onCustomer?: (
    item: MicrostoreCustomerListItem,
    action: "created" | "updated" | "skipped",
  ) => Promise<void> | void;
  /** Limite le nombre de pages (utile pour la synchro auto qui ne veut que la 1ère). */
  maxPages?: number;
}

/**
 * Split "Prénom Nom" → { firstName, lastName }.
 * Un seul mot → firstName vide, lastName = mot.
 * Vide → firstName vide, lastName = "(sans nom)".
 */
function splitName(raw: string | undefined): {
  firstName: string;
  lastName: string;
} {
  const cleaned = (raw ?? "").trim();
  if (!cleaned) return { firstName: "", lastName: "(sans nom)" };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function toDateFromSec(sec: string | undefined): Date | null {
  if (!sec) return null;
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000);
}

/**
 * `true` si l'entrée est un client système Microstore (non-humain) à ignorer.
 * Ex : id="-11" (Client tmp, panier de vente comptant).
 */
function isSystemCustomer(item: MicrostoreCustomerListItem): boolean {
  const idNum = Number(item.id);
  if (!Number.isFinite(idNum)) return true;
  if (idNum <= 0) return true;
  if (item.disable === "1") return true;
  return false;
}

/**
 * Upsert d'un client Microstore dans AdminClientCard.
 * Clé de dédup : `microstoreClientId` (stable, jamais vide, unique par tenant).
 */
async function upsertOneCustomer(
  tenantId: string,
  item: MicrostoreCustomerListItem,
): Promise<"created" | "updated"> {
  const microstoreClientId = item.id.trim();
  const { firstName, lastName } = splitName(item.name);
  const phone = (item.phone ?? "").trim() || null;
  const address = (item.address ?? "").trim() || null;
  const createdAtMc = toDateFromSec(item.ctime);

  const existing = await prisma.adminClientCard.findFirst({
    where: { tenantId, microstoreClientId },
    select: { id: true, phone: true, addressLine: true, firstName: true, lastName: true },
  });

  if (existing) {
    // Mise à jour NON destructive : on ne remplace un champ existant en base
    // que si l'API renvoie une valeur non vide. Évite d'écraser des infos
    // enrichies par l'orders-sync (email, VAT…) avec des vides.
    await prisma.adminClientCard.update({
      where: { id: existing.id },
      data: {
        hasMicrostore: true,
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        phone: phone ?? existing.phone,
        addressLine: address ?? existing.addressLine,
      },
    });
    return "updated";
  }

  await prisma.adminClientCard.create({
    data: {
      tenantId,
      firstName,
      lastName,
      phone,
      addressLine: address,
      microstoreClientId,
      hasMicrostore: true,
      importedFromMarketplace: "MICROSTORE",
      lastOrderAt: createdAtMc, // date de création client — sera écrasée par la 1ère commande
    },
  });
  return "created";
}

/**
 * Boucle paginée : lit toutes les pages de `/customer/get_by_order` et
 * upserte chaque client. Le total (`list_num`) est connu dès la 1ère page,
 * ce qui permet d'afficher une progress bar précise dans le widget.
 *
 * Stratégie **parallèle** (2026-08-01) :
 *   1. On fetch la **page 1** en solo pour connaître `list_num` et `is_last`.
 *   2. On calcule le nombre total de pages nécessaires : `ceil(list_num / PAGE_SIZE)`.
 *   3. On fetch les pages restantes par **vagues de PARALLEL_PAGES** (10 par 10).
 *      Chaque vague lance N appels API en parallèle via `Promise.all`.
 *   4. Les upserts BDD au sein d'une même page restent séquentiels (léger, pas
 *      de bottleneck), mais on lance ensuite l'upsert d'une page pendant qu'on
 *      fetch la vague suivante.
 *
 * La liste API renvoie `pageNum + 1` items (1 de plus pour signaler "next page
 * dispo") — on tronque à `pageNum` pour éviter le double-comptage.
 */
export async function syncMicrostoreCustomers(
  opts: SyncMicrostoreCustomersOptions,
): Promise<MicrostoreCustomersResult> {
  const result: MicrostoreCustomersResult = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const maxPages = opts.maxPages ?? MAX_PAGES;
  let processed = 0;

  // Traite une page : upsert chaque client + comptage. Ne throw pas — les
  // erreurs individuelles sont collectées dans `result.errors`.
  const processPage = async (page: number, items: MicrostoreCustomerListItem[]) => {
    const truncated = items.slice(0, PAGE_SIZE);
    for (const item of truncated) {
      if (isSystemCustomer(item)) {
        result.skipped += 1;
        if (opts.onCustomer) await opts.onCustomer(item, "skipped");
        processed += 1;
        continue;
      }
      try {
        const action = await upsertOneCustomer(opts.tenantId, item);
        if (action === "created") result.created += 1;
        else result.updated += 1;
        if (opts.onCustomer) await opts.onCustomer(item, action);
      } catch (err) {
        result.errors.push({
          microstoreClientId: item.id,
          error: err instanceof Error ? err.message : String(err),
        });
        logger.warn("[Microstore Customers] Upsert failed", {
          tenantId: opts.tenantId,
          microstoreClientId: item.id,
          error: err,
        });
      }
      processed += 1;
    }
    if (opts.onProgress) {
      await opts.onProgress({ page, processed, total: result.total });
    }
  };

  // ── Étape 1 : page 1 en solo (donne list_num) ────────────
  if (opts.shouldStop && (await opts.shouldStop())) return result;

  let firstResp: Awaited<ReturnType<typeof microstoreListCustomers>>;
  try {
    firstResp = await microstoreListCustomers({ page: 1, pageNum: PAGE_SIZE });
  } catch (err) {
    logger.error("[Microstore Customers] Erreur page 1", {
      tenantId: opts.tenantId,
      error: err as Error,
    });
    throw err;
  }
  result.total = firstResp.list_num ?? 0;

  await processPage(1, firstResp.list ?? []);

  // Si maxPages=1 (worker auto) ou déjà à la dernière page → stop
  if (maxPages <= 1 || firstResp.is_last === 1) return result;

  // ── Étape 2 : pages 2..N en vagues parallèles ──────────
  const totalPagesEstimate = Math.min(
    maxPages,
    Math.max(1, Math.ceil((result.total || 0) / PAGE_SIZE)),
  );

  let nextPage = 2;
  while (nextPage <= totalPagesEstimate) {
    if (opts.shouldStop && (await opts.shouldStop())) break;

    const wavePages: number[] = [];
    for (let i = 0; i < PARALLEL_PAGES && nextPage <= totalPagesEstimate; i++) {
      wavePages.push(nextPage++);
    }

    // Fetch la vague en parallèle
    const responses = await Promise.all(
      wavePages.map(async (page) => {
        try {
          const resp = await microstoreListCustomers({ page, pageNum: PAGE_SIZE });
          return { page, resp, error: null as Error | null };
        } catch (err) {
          logger.warn("[Microstore Customers] Erreur page (batch)", {
            tenantId: opts.tenantId,
            page,
            error: err,
          });
          return { page, resp: null, error: err as Error };
        }
      }),
    );

    // Upserts BDD séquentiellement dans l'ordre des pages (pour un onProgress cohérent)
    let sawLastPage = false;
    for (const { page, resp } of responses) {
      if (!resp) continue;
      // list_num peut évoluer légèrement pendant l'import (nouveaux clients)
      result.total = Math.max(result.total, resp.list_num ?? 0);
      await processPage(page, resp.list ?? []);
      if (resp.is_last === 1) sawLastPage = true;
    }
    if (sawLastPage) break;
  }

  return result;
}
