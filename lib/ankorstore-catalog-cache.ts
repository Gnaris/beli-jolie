/**
 * Ankorstore Catalog Cache
 *
 * Garde en mémoire serveur la liste **complète** des produits Ankorstore
 * (allégée : id, nom, référence extraite, externalId, 1ʳᵉ image, nb variantes)
 * pour éviter de dépendre du moteur de recherche `filter[skuOrName]` qui
 * tokenise et passe à côté de certaines références (cf. cas A405 collé
 * à un tiret dans le nom).
 *
 * TTL : 3 heures. Reset manuel via `invalidateCatalogCache()` (bouton ↻
 * côté UI) remet le minuteur à zéro après un rechargement complet.
 *
 * Préchargement au boot pm2 : `instrumentation-node.ts` appelle
 * `preloadCatalog()` en arrière-plan pour que la 1ʳᵉ ouverture de modale
 * soit instantanée si Ankorstore est activé.
 *
 * Mémoire : 9 000 entrées × ~250 octets ≈ 2 Mo. Largement OK côté Node.
 */

import { ankorstoreListAllProducts } from "@/lib/ankorstore-api";
import type { AnkorstoreProduct } from "@/lib/ankorstore-api";
import { extractReference } from "@/lib/ankorstore-match";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface CatalogEntry {
  /** Identifiant Ankorstore du produit. */
  id: string;
  /** Nom complet tel qu'affiché côté Ankorstore. */
  name: string;
  /** Référence extraite (1er segment du SKU, fin du nom après " - ", ou regex Description). */
  ref: string | null;
  /** externalId si fourni par Ankorstore (= référence côté notre site quand publié depuis chez nous). */
  externalId: string | null;
  /** URL de la 1ʳᵉ image (ou null). */
  firstImageUrl: string | null;
  /** Nombre de variantes du produit. */
  variantCount: number;
}

export interface CatalogProgress {
  /** Nombre d'entrées récupérées jusqu'ici. */
  loaded: number;
  /** Index de la dernière page chargée (0-based). */
  pageIndex: number;
}

export interface CatalogStatus {
  /** `true` si un cache existe et n'a pas expiré. */
  fresh: boolean;
  /** Âge du cache en ms, ou `null` si pas de cache. */
  ageMs: number | null;
  /** Nombre d'entrées en cache (peut être >0 même si `fresh=false` si on a un cache expiré non encore purgé). */
  entries: number;
  /** Date du dernier chargement complet (ISO) ou null. */
  loadedAt: string | null;
  /** `true` si un chargement est en cours. */
  loading: boolean;
}

// ─────────────────────────────────────────────
// État module-level
// ─────────────────────────────────────────────

const TTL_MS = 3 * 60 * 60 * 1000; // 3 heures

let cachedEntries: CatalogEntry[] = [];
let loadedAt: Date | null = null;
let activeLoad: Promise<CatalogEntry[]> | null = null;

// ─────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────

function toCatalogEntry(p: AnkorstoreProduct): CatalogEntry {
  return {
    id: p.id,
    name: p.name,
    ref: extractReference(p),
    externalId: p.externalId,
    firstImageUrl: p.images?.[0]?.url ?? null,
    variantCount: p.variants?.length ?? 0,
  };
}

// ─────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────

/**
 * Renvoie le cache s'il est encore frais (< 3h), `null` sinon.
 * Ne déclenche PAS de chargement.
 */
export function getCachedCatalog(): CatalogEntry[] | null {
  if (!loadedAt) return null;
  const age = Date.now() - loadedAt.getTime();
  if (age >= TTL_MS) return null;
  return cachedEntries;
}

/**
 * Statut du cache (pour l'API debug ou l'UI).
 */
export function getCatalogStatus(): CatalogStatus {
  const age = loadedAt ? Date.now() - loadedAt.getTime() : null;
  return {
    fresh: loadedAt !== null && age !== null && age < TTL_MS,
    ageMs: age,
    entries: cachedEntries.length,
    loadedAt: loadedAt?.toISOString() ?? null,
    loading: activeLoad !== null,
  };
}

/**
 * Vide le cache. Le prochain `loadFullCatalog()` retéléchargera tout.
 * N'interrompt PAS un chargement déjà en cours.
 */
export function invalidateCatalogCache(): void {
  cachedEntries = [];
  loadedAt = null;
  logger.info("[Ankorstore Catalog] Cache invalidé");
}

/**
 * Charge la liste complète depuis Ankorstore et l'écrit dans le cache.
 * Si un chargement est déjà en cours, on partage la même promesse — pas
 * de doublons d'appels API.
 *
 * @param onProgress  Appelé à chaque page chargée pour suivre l'avancement.
 */
export async function loadFullCatalog(
  onProgress?: (p: CatalogProgress) => void,
): Promise<CatalogEntry[]> {
  if (activeLoad) {
    return activeLoad;
  }

  activeLoad = (async () => {
    const start = Date.now();
    logger.info("[Ankorstore Catalog] Chargement complet démarré");
    try {
      const products = await ankorstoreListAllProducts({
        pageSize: 50,
        onPage: (_page, pageIndex, totalSoFar) => {
          onProgress?.({ loaded: totalSoFar, pageIndex });
        },
      });
      const entries = products.map(toCatalogEntry);
      cachedEntries = entries;
      loadedAt = new Date();
      logger.info("[Ankorstore Catalog] Chargement complet terminé", {
        entries: entries.length,
        durationMs: Date.now() - start,
      });
      return entries;
    } catch (err) {
      logger.error("[Ankorstore Catalog] Chargement complet en échec", {
        error: err as Error,
      });
      throw err;
    } finally {
      activeLoad = null;
    }
  })();

  return activeLoad;
}

/**
 * Variante non-bloquante : déclenche un chargement en arrière-plan si pas
 * déjà en cours. Utilisée par l'instrumentation au boot.
 */
export function preloadCatalogInBackground(): void {
  if (activeLoad) return;
  if (getCachedCatalog()) return; // déjà frais
  void loadFullCatalog().catch(() => {
    // Les erreurs sont déjà loggées par loadFullCatalog.
  });
}

/**
 * Filtre une liste d'entrées par requête (insensible casse + accents).
 *
 * Match sur :
 * - référence extraite (égal ou contient)
 * - externalId (égal)
 * - nom (contient)
 *
 * Retourne les résultats triés par pertinence : ref exacte > externalId
 * exact > ref contient > nom contient.
 */
export function filterCatalogEntries(
  entries: CatalogEntry[],
  query: string,
): CatalogEntry[] {
  const q = normalize(query);
  if (q.length === 0) return entries;

  const scored: { entry: CatalogEntry; score: number }[] = [];
  for (const entry of entries) {
    const ref = normalize(entry.ref ?? "");
    const ext = normalize(entry.externalId ?? "");
    const name = normalize(entry.name);

    let score = 0;
    if (ref === q) score = 100;
    else if (ext === q) score = 90;
    else if (ref.startsWith(q)) score = 70;
    else if (ref.includes(q)) score = 60;
    else if (name.startsWith(q)) score = 50;
    else if (name.includes(q)) score = 30;

    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// ─────────────────────────────────────────────
// Test helpers (NE PAS appeler en prod)
// ─────────────────────────────────────────────

/** @internal — utilisé uniquement par les tests pour réinitialiser l'état module. */
export function __resetCatalogCacheForTests(): void {
  cachedEntries = [];
  loadedAt = null;
  activeLoad = null;
}
