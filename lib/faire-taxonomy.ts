/**
 * Faire Taxonomy — cache 24h des `taxonomy_types`, scopé par tenant.
 *
 * Endpoint validé en réel : `GET /products/types` renvoie ~2 967 entrées de
 * forme `tt_xxxxxxxxxx` + nom + breadcrumb catégorie. C'est la seule source
 * de vérité côté brand pour les IDs de taxonomie à envoyer dans `POST /products`.
 *
 * Pourquoi le cache : la liste est très stable (Faire la révise rarement),
 * 24h évite de spammer leur API à chaque ouverture d'une page admin.
 *
 * Pourquoi scopé par tenant : chaque tenant a sa propre clé API Faire. Un
 * cache global partageait le résultat entre boutiques et — en cas d'échec —
 * empoisonnait le cache d'un tableau vide pendant 24h côté tous les tenants
 * (incident 2026-07-18 : Issyma sans clé Faire cachait `[]`, BJ héritait du
 * même `[]` et affichait « Taxonomie Faire indisponible »).
 *
 * Pas de hardcode : le mapping `Category.faireTaxonomyId` côté BDD est saisi
 * par l'admin (copier-coller du `tt_xxx`), mais l'UI peut aussi proposer une
 * recherche live qui tape dans ce cache.
 */

import { faireFetch } from "@/lib/faire-api";
import { getCachedHasFaireConfig, tenantScopedCacheWithTid } from "@/lib/cached-data";
import { logger } from "@/lib/logger";
import type {
  FaireTaxonomyType,
  FaireTargetCustomer,
} from "@/lib/faire-taxonomy-types";

export {
  searchFaireTaxonomy,
  findFaireTaxonomyById,
} from "@/lib/faire-taxonomy-types";
export type { FaireTaxonomyType, FaireTargetCustomer };

interface FaireTaxonomyTypesResponse {
  taxonomy_types?: FaireTaxonomyTypeRaw[];
  types?: FaireTaxonomyTypeRaw[];
}

interface FaireTaxonomyTypeRaw {
  id?: string;
  token?: string;
  name?: string;
  clean_name?: string;
  category_breadcrumbs?: { categories?: string[] }[];
  target_customer?: string;
}

function normalize(raw: FaireTaxonomyTypeRaw): FaireTaxonomyType | null {
  const id = raw.id ?? raw.token;
  const name = raw.name ?? raw.clean_name;
  if (!id || !name) return null;
  const breadcrumb = raw.category_breadcrumbs?.[0]?.categories ?? undefined;
  return {
    id,
    name,
    cleanName: raw.clean_name,
    categoryBreadcrumb: breadcrumb,
    targetCustomer: raw.target_customer,
  };
}

// Throw plutôt que retourner [] : `unstable_cache` ne mémorise pas les
// exceptions, donc un échec transient ne verrouille pas 24h de cache vide.
export async function loadFreshTaxonomy(): Promise<FaireTaxonomyType[]> {
  const hasConfig = await getCachedHasFaireConfig();
  if (!hasConfig) {
    throw new Error("[Faire Taxonomy] no API key configured for this tenant");
  }
  const res = await faireFetch(`/products/types`);
  if (!res.ok) {
    throw new Error(`[Faire Taxonomy] GET /products/types HTTP ${res.status}`);
  }
  const data = (await res.json()) as FaireTaxonomyTypesResponse;
  const rows = data.taxonomy_types ?? data.types ?? [];
  const normalized = rows
    .map(normalize)
    .filter((t): t is FaireTaxonomyType => t !== null);
  if (normalized.length === 0) {
    throw new Error("[Faire Taxonomy] empty response");
  }
  return normalized;
}

const cachedTaxonomy = tenantScopedCacheWithTid<[], FaireTaxonomyType[]>(
  "faire-taxonomy",
  async () => loadFreshTaxonomy(),
  ["faire-taxonomy-v2"],
  { revalidate: 86400, tags: ["faire-taxonomy"] },
);

/**
 * Liste complète des taxonomy_types Faire (cache 24h par tenant, tag
 * `faire-taxonomy`). Retourne `[]` en cas d'échec, sans polluer le cache.
 */
export async function getFaireTaxonomy(): Promise<FaireTaxonomyType[]> {
  try {
    return await cachedTaxonomy();
  } catch (err) {
    logger.warn("[Faire Taxonomy] load failed", { error: String(err) });
    return [];
  }
}

/** Idem mais sans cache (utile pour les tests / scripts CLI). */
export async function getFaireTaxonomyFresh(): Promise<FaireTaxonomyType[]> {
  try {
    return await loadFreshTaxonomy();
  } catch (err) {
    logger.warn("[Faire Taxonomy] fresh load failed", { error: String(err) });
    return [];
  }
}
