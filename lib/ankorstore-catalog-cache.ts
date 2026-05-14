/**
 * Ankorstore Catalog Cache
 *
 * Garde en mémoire serveur la liste **complète** des produits Ankorstore
 * (allégée : id, nom, référence extraite, externalId, 1ʳᵉ image, nb variantes)
 * pour éviter de dépendre du moteur de recherche `filter[skuOrName]` qui
 * tokenise et passe à côté de certaines références (cf. cas A405 collé
 * à un tiret dans le nom).
 *
 * TTL : 6 heures. Reset manuel via `invalidateCatalogCache()` (bouton ↻
 * côté UI) remet le minuteur à zéro après un rechargement complet.
 *
 * Préchargement au boot pm2 : `instrumentation-node.ts` appelle
 * `preloadCatalog()` en arrière-plan pour que la 1ʳᵉ ouverture de modale
 * soit instantanée si Ankorstore est activé. Puis `startCatalogAutoReload()`
 * planifie un rechargement complet automatique toutes les 6 heures pour que
 * les nouveautés Ankorstore apparaissent sans intervention manuelle.
 *
 * Parallélisation : impossible. L'API Ankorstore `/products` utilise une
 * pagination par curseur (`page[after]=<dernierIdDeLaPagePrécédente>`),
 * donc chaque page nécessite l'ID de la précédente — pas de fetch parallèle
 * possible sans changer de stratégie d'indexation côté Ankorstore.
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
// État partagé via globalThis
// ─────────────────────────────────────────────
//
// Next.js compile `instrumentation.ts` et les routes API dans des bundles
// Webpack séparés. Conséquence : si on déclare l'état avec de simples
// `let cachedEntries = []`, chaque bundle se retrouve avec sa propre copie
// du module → la préchauffe au boot remplit la mémoire d'un bundle, mais
// la route `/api/admin/ankorstore-catalog` lit une autre mémoire (vide)
// et redéclenche un téléchargement complet. On contourne en stockant
// l'état sur `globalThis` (partagé par tous les bundles d'un même process).

const TTL_MS = 6 * 60 * 60 * 1000; // 6 heures
const AUTO_RELOAD_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures

interface CatalogState {
  cachedEntries: CatalogEntry[];
  loadedAt: Date | null;
  activeLoad: Promise<CatalogEntry[]> | null;
  autoReloadHandle: NodeJS.Timeout | null;
  /** Dernière progression du chargement en cours (pour les nouveaux abonnés). */
  currentProgress: CatalogProgress | null;
  /** Callbacks de progression abonnés au chargement en cours. */
  progressListeners: Set<(p: CatalogProgress) => void>;
}

const STATE_KEY = Symbol.for("beliandjolie.ankorstoreCatalogCache");
const g = globalThis as Record<symbol, CatalogState | undefined>;

function getState(): CatalogState {
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      cachedEntries: [],
      loadedAt: null,
      activeLoad: null,
      autoReloadHandle: null,
      currentProgress: null,
      progressListeners: new Set(),
    };
  }
  return g[STATE_KEY] as CatalogState;
}

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
 * Renvoie le cache s'il est encore frais (< 6h), `null` sinon.
 * Ne déclenche PAS de chargement.
 */
export function getCachedCatalog(): CatalogEntry[] | null {
  const state = getState();
  if (!state.loadedAt) return null;
  const age = Date.now() - state.loadedAt.getTime();
  if (age >= TTL_MS) return null;
  return state.cachedEntries;
}

/**
 * Statut du cache (pour l'API debug ou l'UI).
 */
export function getCatalogStatus(): CatalogStatus {
  const state = getState();
  const age = state.loadedAt ? Date.now() - state.loadedAt.getTime() : null;
  return {
    fresh: state.loadedAt !== null && age !== null && age < TTL_MS,
    ageMs: age,
    entries: state.cachedEntries.length,
    loadedAt: state.loadedAt?.toISOString() ?? null,
    loading: state.activeLoad !== null,
  };
}

/**
 * Vide le cache. Le prochain `loadFullCatalog()` retéléchargera tout.
 * N'interrompt PAS un chargement déjà en cours.
 */
export function invalidateCatalogCache(): void {
  const state = getState();
  state.cachedEntries = [];
  state.loadedAt = null;
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
  const state = getState();

  // Branche le callback de progression du nouveau caller sur le chargement
  // en cours (s'il y en a un) ET sur les pages futures. On le replay aussi
  // avec la dernière progression connue pour que la modale ne reste pas figée
  // à 0 produit alors qu'un préchargement est déjà à mi-parcours.
  if (onProgress) {
    state.progressListeners.add(onProgress);
    if (state.currentProgress) {
      try {
        onProgress(state.currentProgress);
      } catch {
        // ignore les erreurs côté listener
      }
    }
  }

  if (state.activeLoad) {
    try {
      return await state.activeLoad;
    } finally {
      if (onProgress) state.progressListeners.delete(onProgress);
    }
  }

  state.activeLoad = (async () => {
    const start = Date.now();
    state.currentProgress = null;
    logger.info("[Ankorstore Catalog] Chargement complet démarré");
    try {
      const products = await ankorstoreListAllProducts({
        pageSize: 50,
        onPage: (_page, pageIndex, totalSoFar) => {
          const progress: CatalogProgress = { loaded: totalSoFar, pageIndex };
          state.currentProgress = progress;
          // Notifie tous les abonnés (modale ouverte + arrivants tardifs).
          for (const listener of state.progressListeners) {
            try {
              listener(progress);
            } catch {
              // ignore les erreurs côté listener
            }
          }
        },
      });
      const entries = products.map(toCatalogEntry);
      state.cachedEntries = entries;
      state.loadedAt = new Date();
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
      state.activeLoad = null;
      state.currentProgress = null;
    }
  })();

  try {
    return await state.activeLoad;
  } finally {
    if (onProgress) state.progressListeners.delete(onProgress);
  }
}

/**
 * Variante non-bloquante : déclenche un chargement en arrière-plan si pas
 * déjà en cours. Utilisée par l'instrumentation au boot.
 */
export function preloadCatalogInBackground(): void {
  const state = getState();
  if (state.activeLoad) return;
  if (getCachedCatalog()) return; // déjà frais
  void loadFullCatalog().catch(() => {
    // Les erreurs sont déjà loggées par loadFullCatalog.
  });
}

/**
 * Démarre un rechargement automatique toutes les 6 heures.
 * Idempotent : un seul intervalle actif à la fois par process Node.
 *
 * Lancé une fois au boot par `instrumentation-node.ts`. Le tick force
 * l'invalidation puis relance le chargement même si le cache est encore
 * "frais", pour garantir que les nouveautés Ankorstore apparaissent au plus
 * tard 6h après leur création.
 */
export function startCatalogAutoReload(): void {
  const state = getState();
  if (state.autoReloadHandle) return;
  state.autoReloadHandle = setInterval(() => {
    void (async () => {
      try {
        logger.info("[Ankorstore Catalog] Rechargement automatique déclenché (cycle 6h)");
        invalidateCatalogCache();
        await loadFullCatalog();
      } catch {
        // Les erreurs sont déjà loggées par loadFullCatalog.
      }
    })();
  }, AUTO_RELOAD_INTERVAL_MS);
  // Ne bloque pas la sortie du process si on est en cours d'arrêt.
  state.autoReloadHandle.unref?.();
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
  const state = getState();
  state.cachedEntries = [];
  state.loadedAt = null;
  state.activeLoad = null;
  state.currentProgress = null;
  state.progressListeners.clear();
  if (state.autoReloadHandle) {
    clearInterval(state.autoReloadHandle);
    state.autoReloadHandle = null;
  }
}
