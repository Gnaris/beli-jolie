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
