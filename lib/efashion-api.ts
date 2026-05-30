/**
 * eFashion Paris — Lectures (queries GraphQL).
 *
 * Toutes les fonctions garantissent une session active via
 * `ensureEfashionSession()` avant d'envoyer la requête.
 *
 * Documentation API : docs/efashion-api.md
 */

import { ensureEfashionSession, type EfashionVendorUser } from "@/lib/efashion-auth";
import { efashionGraphql } from "@/lib/efashion-client";

export interface EfashionMeResult {
  id_vendeur: number;
  email: string;
  prenomContact: string;
  nomContact: string;
  nomSociete: string;
  nomBoutique: string;
  siret: string;
  tva: string;
  commandeMini: number;
}

/**
 * Récupère les infos du vendeur connecté.
 */
export async function efashionGetMe(): Promise<EfashionMeResult> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ me: EfashionMeResult }>(
    `query GetMe {
      me {
        id_vendeur email prenomContact nomContact
        nomSociete nomBoutique siret tva commandeMini
      }
    }`,
  );
  if (!data.me) throw new Error("eFashion: query me a renvoyé un résultat vide");
  return data.me;
}

/**
 * Compte total des produits-couleurs du vendeur (tous statuts confondus).
 * ⚠️ Chez eFashion, 1 couleur = 1 ligne produit, donc ce nombre est
 * en pratique nbProduitsBJ × nbCouleurMoyen.
 */
export async function efashionGetTotalProducts(idVendeur: number): Promise<number> {
  await ensureEfashionSession();
  const data = await efashionGraphql<{ totalProduitsVendeur: number }>(
    `query ($id_vendeur: Int!) {
      totalProduitsVendeur(id_vendeur: $id_vendeur)
    }`,
    { id_vendeur: idVendeur },
  );
  return data.totalProduitsVendeur ?? 0;
}

export interface EfashionProductListItem {
  id_produit: number;
  id_vendeur: number;
  reference: string;
  reference_base: string;
  marque: string;
  id_vendeur_marque: number;
  collection: string;
  id_collection: number;
  categorie: string;
  id_categorie: number;
  prix: number;
  prixReduit: number | null;
  poids: number;
  visible: boolean;
  supprimer: boolean;
  id_couleur: number;
  couleur: string;
  stock_value: number | null;
  stock_renseigne: boolean;
  vendu_par: "couleurs" | "tailles";
  id_pack: number | null;
  id_declinaison: number | null;
  id_provenance: number | null;
  provenance: string | null;
  nb_photos: number;
  id_shooting: number | null;
  main: boolean;
}

export type EfashionPremelFilter =
  | "en_ligne"
  | "brouillon"
  | "supprime"
  | "tous";

/**
 * Liste paginée des produits du vendeur. Filtres + tri équivalents à ceux
 * de leur interface web `/catalog/productlist`.
 */
export async function efashionListProducts(opts: {
  idVendeur: number;
  take?: number;
  skip?: number;
  reference?: string;
  premelFilter?: EfashionPremelFilter;
  orderBy?: "dateCreation" | "reference" | "prix";
  orderDir?: "ASC" | "DESC";
}): Promise<{ items: EfashionProductListItem[]; total: number }> {
  await ensureEfashionSession();
  const filter: Record<string, unknown> = {
    id_vendeur: opts.idVendeur,
    take: opts.take ?? 25,
    skip: opts.skip ?? 0,
    orderBy: opts.orderBy ?? "dateCreation",
    orderDir: opts.orderDir ?? "DESC",
    includePremel: true,
    premelFilter: opts.premelFilter ?? "en_ligne",
  };
  if (opts.reference) filter.reference = opts.reference;

  const data = await efashionGraphql<{
    productsPage: { items: EfashionProductListItem[]; total: number };
  }>(
    `query GetProductsPage($filter: FilterProduitInput!) {
      productsPage(filter: $filter) {
        items {
          id_produit id_vendeur reference reference_base
          marque id_vendeur_marque
          collection id_collection
          categorie id_categorie
          prix prixReduit poids
          visible supprimer
          id_couleur couleur
          stock_value stock_renseigne
          vendu_par id_pack id_declinaison
          id_provenance provenance
          nb_photos id_shooting main
        }
        total
      }
    }`,
    { filter },
  );
  return data.productsPage;
}

/**
 * Liste **toutes les lignes eFashion dont `reference_base` correspond
 * exactement** à celle demandée, en paginant l'API jusqu'à ce qu'on ait
 * tout ramassé.
 *
 * Pourquoi cette fonction et pas `efashionListProducts` direct :
 *  1. Le filtre `reference` côté eFashion est PARTIEL ("contient") : une
 *     requête avec `reference: "A11"` ramène aussi A1100, A1101…A1199, A11A,
 *     A1134, etc. Sur certains comptes, ça fait plusieurs centaines de
 *     lignes, et les fiches historiques (comme A11) atterrissent loin dans
 *     la pagination.
 *  2. L'API trie par `dateCreation DESC` — donc les vieilles fiches sortent
 *     en dernier. Un simple `take: 100` les rate systématiquement.
 *  3. ⚠️ Comportement non standard : `skip` est interprété comme un curseur
 *     par **chunk** (de taille `take`), pas comme un offset par item. L'API
 *     renvoie souvent plus d'items que le `take` demandé (sans duplication
 *     entre chunks). Conséquence : on doit incrémenter `skip` strictement
 *     de `PAGE_SIZE`, pas de `items.length`, sinon on saute par-dessus les
 *     chunks suivants.
 *
 * Garanties :
 *  - Retourne uniquement les items dont `reference_base.toLowerCase().trim()`
 *    correspond exactement à celui demandé (filtre strict).
 *  - Boucle bornée à `MAX_PAGES` pour empêcher tout enchaînement infini en
 *    cas d'API qui ne se vide jamais.
 *  - S'arrête tôt si on a déjà au moins un match exact et que la page
 *    courante n'en apporte aucun nouveau (court-circuit pour les références
 *    très partagées).
 *
 * Pas d'I/O en dehors de `efashionListProducts` → testable en injectant un
 * `listFn` mocké.
 */
export async function efashionListByReferenceBaseExact(opts: {
  idVendeur: number;
  referenceBase: string;
  premelFilter?: EfashionPremelFilter;
  pageSize?: number;
  maxPages?: number;
  /** Hook test-only : remplace l'appel API par une fonction mock. */
  listFn?: typeof efashionListProducts;
}): Promise<EfashionProductListItem[]> {
  const PAGE_SIZE = opts.pageSize ?? 50;
  const MAX_PAGES = opts.maxPages ?? 30;
  const needle = opts.referenceBase.toLowerCase().trim();
  const premelFilter = opts.premelFilter ?? "tous";
  const listFn = opts.listFn ?? efashionListProducts;

  const collected: EfashionProductListItem[] = [];
  let exactMatchesSoFar = 0;
  let skip = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listFn({
      idVendeur: opts.idVendeur,
      take: PAGE_SIZE,
      skip,
      reference: opts.referenceBase,
      premelFilter,
    });
    if (res.items.length === 0) break;
    collected.push(...res.items);
    const newExact = res.items.filter(
      (it) => (it.reference_base ?? "").toLowerCase().trim() === needle,
    ).length;
    const totalExact = exactMatchesSoFar + newExact;
    skip += PAGE_SIZE;
    if (totalExact > 0 && newExact === 0) break;
    exactMatchesSoFar = totalExact;
  }

  return collected.filter(
    (it) => (it.reference_base ?? "").toLowerCase().trim() === needle,
  );
}

/**
 * Récupère { user, total } en une seule passe — utile pour l'écran
 * « Tester la connexion » pour afficher le statut complet.
 */
export async function efashionGetConnectionStatus(): Promise<{
  user: EfashionMeResult;
  totalProducts: number;
  onlineProducts: number;
}> {
  const user = await efashionGetMe();
  const [total, listing] = await Promise.all([
    efashionGetTotalProducts(user.id_vendeur),
    efashionListProducts({ idVendeur: user.id_vendeur, take: 1, premelFilter: "en_ligne" }),
  ]);
  return { user, totalProducts: total, onlineProducts: listing.total };
}

/**
 * Re-export pour signaler quelles infos vendeur sont garanties par `ensureEfashionSession`.
 */
export type { EfashionVendorUser };
