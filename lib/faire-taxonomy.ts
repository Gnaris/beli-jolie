/**
 * Faire Taxonomy — cache 24h des `taxonomy_types`.
 *
 * Endpoint validé en réel : `GET /products/types` renvoie ~2 967 entrées de
 * forme `tt_xxxxxxxxxx` + nom + breadcrumb catégorie. C'est la seule source
 * de vérité côté brand pour les IDs de taxonomie à envoyer dans `POST /products`.
 *
 * Pourquoi le cache : la liste est très stable (Faire la révise rarement),
 * 24h évite de spammer leur API à chaque ouverture d'une page admin.
 *
 * Pas de hardcode : le mapping `Category.faireTaxonomyId` côté BDD est saisi
 * par l'admin (copier-coller du `tt_xxx`), mais l'UI peut aussi proposer une
 * recherche live qui tape dans ce cache.
 */

import { unstable_cache } from "next/cache";
import { faireFetch } from "@/lib/faire-api";
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

async function loadFreshTaxonomy(): Promise<FaireTaxonomyType[]> {
  try {
    const res = await faireFetch(`/products/types`);
    if (!res.ok) {
      logger.error("[Faire Taxonomy] GET /products/types failed", {
        status: res.status,
      });
      return [];
    }
    const data = (await res.json()) as FaireTaxonomyTypesResponse;
    const rows = data.taxonomy_types ?? data.types ?? [];
    return rows
      .map(normalize)
      .filter((t): t is FaireTaxonomyType => t !== null);
  } catch (err) {
    logger.warn("[Faire Taxonomy] load failed", { error: String(err) });
    return [];
  }
}

const cachedTaxonomy = unstable_cache(
  loadFreshTaxonomy,
  ["faire-taxonomy-types-v1"],
  { revalidate: 86400, tags: ["faire-taxonomy"] },
);

/**
 * Liste complète des taxonomy_types Faire (cache 24h, tag `faire-taxonomy`).
 * Si le fetch initial échoue, retourne []. L'appelant doit gérer le cas vide.
 */
export async function getFaireTaxonomy(): Promise<FaireTaxonomyType[]> {
  return cachedTaxonomy();
}

/** Idem mais sans cache (utile pour les tests / scripts CLI). */
export async function getFaireTaxonomyFresh(): Promise<FaireTaxonomyType[]> {
  return loadFreshTaxonomy();
}
