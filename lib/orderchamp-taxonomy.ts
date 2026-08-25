/**
 * Orderchamp Taxonomy — server-only : récupère la liste des feuilles de
 * catégorie standard (`ProductCategoryPath` GraphQL enum) via introspection,
 * avec cache in-memory 24 h, enrichie de leur traduction FR (via API PFS).
 *
 * Séquence au 1ᵉʳ chargement :
 *   1. Fetch introspection GraphQL Orderchamp → ~1400 feuilles anglaises
 *   2. Lecture des traductions FR déjà stockées en BDD
 *      (`OrderchampCategoryTranslation`) — jointes au retour synchrone
 *   3. Fire-and-forget : traduire en fond via `translatePhrases` (PFS) les
 *      feuilles pas encore traduites, upsert en BDD, invalider le cache
 *      in-memory pour que le prochain appel remonte les nouvelles FR
 *
 * Les helpers purs (build tree, search, label) et les types sont dans
 * `lib/orderchamp-taxonomy-shared.ts` — safe à importer depuis un Client
 * Component.
 */

import { orderchampGraphQL, OrderchampGraphQLError } from "@/lib/orderchamp-client";
import { getOrderchampApiKey } from "@/lib/orderchamp-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { translatePhrases } from "@/lib/pfs-translate";
import type { OrderchampCategoryLeaf } from "@/lib/orderchamp-taxonomy-shared";

// Re-exports pour compatibilité — permet d'importer depuis `orderchamp-taxonomy`
// côté serveur sans devoir jongler entre 2 fichiers. Les Client Components,
// eux, doivent importer directement depuis `orderchamp-taxonomy-shared`.
export type {
  OrderchampCategoryLeaf,
  OrderchampCategoryTreeNode,
} from "@/lib/orderchamp-taxonomy-shared";
export {
  buildOrderchampCategoryTree,
  searchOrderchampCategoryLeaves,
  getOrderchampCategoryLabel,
  localizedOrderchampDisplayPath,
} from "@/lib/orderchamp-taxonomy-shared";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const INTROSPECT_QUERY = /* GraphQL */ `
  query IntrospectProductCategoryPath {
    __type(name: "ProductCategoryPath") {
      enumValues {
        name
        description
      }
    }
  }
`;

/** "BANGLE_BRACELETS" → "Bangle Bracelets" */
function prettifySegment(segment: string): string {
  const lower = segment.toLowerCase().replace(/_/g, " ");
  return lower.replace(/(^|\s)([a-z])/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
}

function toDisplayPath(rawName: string, description: string | null): string[] {
  if (description) {
    const parts = description
      .split(/[›>»]|\s\/\s|\s>\s/g)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts;
  }
  return rawName.split("_").map(prettifySegment);
}

interface RawLeaf {
  path: string;
  displayPath: string[];
  description: string | null;
}

async function fetchOrderchampTaxonomyRaw(): Promise<RawLeaf[]> {
  // Court-circuit propre : les tenants sans intégration Orderchamp n'ont pas
  // de clé — on retourne un tableau vide sans faire de requête réseau ni
  // logger d'erreur (le page produit affiche « catégories OC non chargées »).
  const apiKey = await getOrderchampApiKey().catch(() => null);
  if (!apiKey) return [];

  try {
    const data = await orderchampGraphQL<{
      __type: { enumValues: Array<{ name: string; description: string | null }> } | null;
    }>(INTROSPECT_QUERY, {}, "introspectProductCategoryPath");

    const values = data.__type?.enumValues ?? [];
    return values
      .map<RawLeaf>((v) => ({
        path: v.name,
        displayPath: toDisplayPath(v.name, v.description),
        description: v.description,
      }))
      .sort((a, b) =>
        a.displayPath.join(" ").localeCompare(b.displayPath.join(" "), "en"),
      );
  } catch (err) {
    if (err instanceof OrderchampGraphQLError) {
      logger.error("[Orderchamp Taxonomy] introspection GraphQL a échoué", {
        errors: err.errors,
      });
    } else {
      logger.error("[Orderchamp Taxonomy] fetch a échoué", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return [];
  }
}

/** Lit toutes les traductions FR déjà stockées en BDD.  */
async function loadStoredTranslations(): Promise<Map<string, string[]>> {
  const rows = await prisma.orderchampCategoryTranslation.findMany({
    select: { path: true, labelFr: true },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    map.set(r.path, r.labelFr.split(" › ").map((s) => s.trim()).filter(Boolean));
  }
  return map;
}

/** Lit les paths OC déjà mappés par la cliente (Category + SubCategory, tous
 *  tenants). Ces paths passent en tête de la file de traduction pour que la
 *  cliente voie immédiatement en FR les catégories qu'elle utilise. */
async function loadUsedOrderchampPaths(): Promise<Set<string>> {
  const [cats, subs] = await Promise.all([
    prisma.category.findMany({
      where: { orderchampCategoryPath: { not: null } },
      select: { orderchampCategoryPath: true },
    }),
    prisma.subCategory.findMany({
      where: { orderchampCategoryPath: { not: null } },
      select: { orderchampCategoryPath: true },
    }),
  ]);
  const set = new Set<string>();
  for (const c of cats) if (c.orderchampCategoryPath) set.add(c.orderchampCategoryPath);
  for (const s of subs) if (s.orderchampCategoryPath) set.add(s.orderchampCategoryPath);
  return set;
}

const TRANSLATION_BATCH_SIZE = 30;

/** Fire-and-forget : traduit en fond les feuilles pas encore traduites, upsert
 *  en BDD, invalide le cache in-memory **à chaque batch** pour que la cliente
 *  voie les catégories basculer en FR au fur et à mesure (au lieu d'attendre
 *  la fin complète du job, ~1400 termes = plusieurs heures via l'API PFS). */
async function translateMissingInBackground(
  leaves: readonly RawLeaf[],
  alreadyTranslated: ReadonlySet<string>,
): Promise<void> {
  const missing = leaves.filter((l) => !alreadyTranslated.has(l.path));
  if (missing.length === 0) return;

  // Priorise les catégories déjà mappées par la cliente — elle voit tout de
  // suite en FR ce qu'elle utilise, au lieu d'attendre la fin du job
  // (~30-60 min pour 1400 termes via l'API PFS, ordre alphabétique sinon).
  // Charger les paths mappés est best-effort — un échec ne bloque pas la
  // traduction, on retombe simplement sur l'ordre alphabétique par défaut.
  try {
    const usedPaths = await loadUsedOrderchampPaths();
    if (usedPaths.size > 0) {
      missing.sort((a, b) => {
        const ua = usedPaths.has(a.path) ? 0 : 1;
        const ub = usedPaths.has(b.path) ? 0 : 1;
        return ua - ub;
      });
    }
  } catch { /* pas grave, ordre alpha */ }

  logger.info("[Orderchamp Taxonomy] traduction FR en fond", {
    total: missing.length,
    batchSize: TRANSLATION_BATCH_SIZE,
  });

  let translated = 0;
  for (let i = 0; i < missing.length; i += TRANSLATION_BATCH_SIZE) {
    const batch = missing.slice(i, i + TRANSLATION_BATCH_SIZE);
    const phrases: Record<string, string> = {};
    for (const l of batch) {
      phrases[l.path] = l.displayPath.join(" › ");
    }
    try {
      const res = await translatePhrases(phrases, { sourceLanguage: "en" });
      if (!res) continue;
      const upserts: Promise<unknown>[] = [];
      for (const l of batch) {
        const fr = res[l.path]?.fr;
        if (!fr || !fr.trim()) continue;
        upserts.push(
          prisma.orderchampCategoryTranslation.upsert({
            where: { path: l.path },
            update: { labelFr: fr },
            create: { path: l.path, labelFr: fr },
          }),
        );
      }
      await Promise.all(upserts);
      translated += upserts.length;
      // Invalider le cache après chaque batch — le prochain rendu de la page
      // remontera les nouvelles FR (au lieu de servir le cache figé au
      // début de la session).
      cache = null;
      if (translated % 300 === 0) {
        logger.info("[Orderchamp Taxonomy] avancement FR", {
          translated,
          total: missing.length,
        });
      }
    } catch (err) {
      logger.warn("[Orderchamp Taxonomy] batch FR a échoué", {
        offset: i,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("[Orderchamp Taxonomy] traduction FR terminée", {
    translated,
    total: missing.length,
  });
  cache = null;
}

// Cache in-memory global (process-level). Reset au restart PM2 ou après
// traduction en fond réussie.
let cache: { data: OrderchampCategoryLeaf[]; expiresAt: number } | null = null;
let inflight: Promise<OrderchampCategoryLeaf[]> | null = null;
let backgroundTranslationInFlight = false;

/** Vide le cache. Utile après (re)configuration d'un token OC pour forcer
 *  un fetch propre sans devoir attendre 24 h ou redémarrer PM2. */
export function clearOrderchampTaxonomyCache(): void {
  cache = null;
  inflight = null;
}

/** Renvoie la liste des feuilles OC (EN + FR quand disponible en BDD). Cache
 *  in-memory 24 h. Un résultat vide n'est PAS caché — le prochain appel
 *  refera la requête. Traduit en fond les feuilles pas encore traduites. */
export async function getCachedOrderchampTaxonomy(): Promise<OrderchampCategoryLeaf[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now && cache.data.length > 0) {
    return cache.data;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [raw, stored] = await Promise.all([
        fetchOrderchampTaxonomyRaw(),
        loadStoredTranslations().catch(() => new Map<string, string[]>()),
      ]);
      const leaves: OrderchampCategoryLeaf[] = raw.map((r) => ({
        path: r.path,
        displayPath: r.displayPath,
        displayPathFr: stored.get(r.path) ?? null,
        description: r.description,
      }));
      if (leaves.length > 0) {
        cache = { data: leaves, expiresAt: Date.now() + ONE_DAY_MS };
      } else {
        cache = null;
      }
      // Lance la traduction des manquantes en fond (pas d'await : le prochain
      // affichage remontera les FR, sans bloquer le chargement actuel).
      if (leaves.length > 0 && !backgroundTranslationInFlight) {
        backgroundTranslationInFlight = true;
        void translateMissingInBackground(raw, new Set(stored.keys())).finally(() => {
          backgroundTranslationInFlight = false;
        });
      }
      return leaves;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
