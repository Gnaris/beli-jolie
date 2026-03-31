/**
 * eFashion Paris Read-Only API Client
 *
 * Provides typed wrappers around the eFashion GraphQL and REST APIs.
 * All functions handle auth automatically via ensureEfashionAuth / reauthenticateEfashion.
 */

import {
  ensureEfashionAuth,
  reauthenticateEfashion,
  getEfashionVendorId,
} from "@/lib/efashion-auth";
import { efashionGraphQL, efashionREST, EFASHION_BASE_URL } from "@/lib/efashion-graphql";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EfashionProductListItem {
  id_produit: number;
  id_vendeur: number;
  date_produit: string | null;
  reference: string;
  reference_base: string | null;
  marque: string | null;
  collection: string | null;
  categorie: string | null;
  id_categorie: number | null;
  prix: number;
  promotion: number | null;
  poids: number | null;
  visible: boolean;
  supprimer: boolean;
  id_couleur: number | null;
  couleur: string | null;
  stock_value: number | null;
  stock_renseigne: boolean | null;
  liaison: number | null;
  vendu_par: string;
  id_pack: number | null;
  id_declinaison: number | null;
  id_collection: number | null;
  id_vendeur_marque: number | null;
  id_provenance: number | null;
  provenance: string | null;
  prixReduit: number | null;
  premel: string | null;
  nb_photos: number;
}

export interface EfashionProduct {
  id_produit: string;
  reference: string;
  reference_base: string | null;
  id_categorie: number;
  id_vendeur: number;
  id_declinaison: number | null;
  id_pack: number | null;
  id_collection: number | null;
  id_provenance: number | null;
  vendu_par: string;
  prix: string;
  prixReduit: number | null;
  poids: number;
  visible: boolean;
  supprimer: boolean;
  nb_photos: number;
  qteMini: number | null;
  dimension: string | null;
  dateCreation: string;
  dateModification: string;
  premel: string;
}

export interface EfashionCouleurProduit {
  id_couleur_produit: string;
  id_couleur: number;
  id_produit: number;
  description_paquet: string | null;
  reception: boolean;
  photo: boolean;
  couleur: {
    id_couleur: string;
    couleur_FR: string;
    couleur_EN: string;
    defaut: number;
  };
}

export interface EfashionDescription {
  id_produit: number;
  texte_fr: string | null;
  texte_uk: string | null;
  instructions: string | null;
  commentaires: string | null;
}

export interface EfashionStock {
  id_produit_stock: string;
  id_produit: number;
  id_couleur: number;
  value: number;
  taille: string | null;
}

export interface EfashionComposition {
  id_composition: number;
  id_composition_localisation: number;
  value: number | null;
  famille: string;
  libelle: string;
}

export interface EfashionCategoryNode {
  id_categorie: number;
  label: string;
  id_parent_categorie: number | null;
  id_top_categorie: number | null;
  children: EfashionCategoryNode[];
}

export interface EfashionPack {
  id_pack: string;
  id_vendeur: number;
  titre: string;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
  p6: number;
  p7: number;
  p8: number;
  p9: number;
  p10: number;
  p11: number;
  p12: number;
}

export interface EfashionDeclinaison {
  id_declinaison: string;
  d1_FR: string | null;
  d2_FR: string | null;
  d3_FR: string | null;
  d4_FR: string | null;
  d5_FR: string | null;
  d6_FR: string | null;
  d7_FR: string | null;
  d8_FR: string | null;
  d9_FR: string | null;
  d10_FR: string | null;
  d11_FR: string | null;
  d12_FR: string | null;
}

export interface EfashionDefaultColor {
  id_couleur: string;
  couleur_FR: string;
  couleur_EN: string;
  defaut: number;
}

export type EfashionStatut = "TOUS" | "EN_VENTE" | "HORS_LIGNE" | "RUPTURE";

export interface EfashionProductDetails {
  product: EfashionProduct;
  colors: EfashionCouleurProduit[];
  description: EfashionDescription | null;
  stocks: EfashionStock[];
  compositions: EfashionComposition[];
  photos: string[];
}

// ---------------------------------------------------------------------------
// Retry wrapper
// ---------------------------------------------------------------------------

const RETRY_DELAYS = [2000, 5000, 15000];

function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("non authentifié") ||
    msg.includes("cookie manquant") ||
    msg.includes("unauthenticated") ||
    msg.includes("unauthorized")
  );
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      await ensureEfashionAuth();
      return await fn();
    } catch (err) {
      lastError = err;

      if (isAuthError(err)) {
        logger.warn(`[eFashion] Auth error on ${label}, re-authenticating...`, {
          attempt,
          error: err instanceof Error ? err.message : String(err),
        });
        try {
          await reauthenticateEfashion();
        } catch (reAuthErr) {
          logger.error(`[eFashion] Re-auth failed on ${label}`, {
            error: reAuthErr instanceof Error ? reAuthErr.message : String(reAuthErr),
          });
        }
      } else {
        logger.warn(`[eFashion] ${label} failed (attempt ${attempt + 1})`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (attempt < RETRY_DELAYS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
      }
    }
  }

  logger.error(`[eFashion] ${label} failed after all retries`, {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  throw lastError;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCT_LIST_FIELDS = `
  id_produit
  id_vendeur
  date_produit
  reference
  reference_base
  marque
  collection
  categorie
  id_categorie
  prix
  promotion
  poids
  visible
  supprimer
  id_couleur
  couleur
  stock_value
  stock_renseigne
  liaison
  vendu_par
  id_pack
  id_declinaison
  id_collection
  id_vendeur_marque
  id_provenance
  provenance
  prixReduit
  premel
  nb_photos
`;

/**
 * List products with pagination.
 * statut defaults to TOUS (all products).
 */
export async function efashionListProducts(
  skip = 0,
  take = 50,
  statut: EfashionStatut = "TOUS"
): Promise<{ items: EfashionProductListItem[]; total: number }> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      productsPage: { items: EfashionProductListItem[]; total: number };
    }>(
      `query ListProducts($skip: Int!, $take: Int!, $filter: ProductFilter) {
        productsPage(skip: $skip, take: $take, filter: $filter) {
          total
          items {
            ${PRODUCT_LIST_FIELDS}
          }
        }
      }`,
      { skip, take, filter: { statut } }
    );

    return data.productsPage;
  }, `efashionListProducts(skip=${skip},take=${take},statut=${statut})`);
}

/**
 * Fetch a single product by ID.
 */
export async function efashionGetProduct(id: number): Promise<EfashionProduct> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{ produit: EfashionProduct }>(
      `query GetProduct($id: Int!) {
        produit(id: $id) {
          id_produit
          reference
          reference_base
          id_categorie
          id_vendeur
          id_declinaison
          id_pack
          id_collection
          id_provenance
          vendu_par
          prix
          prixReduit
          poids
          visible
          supprimer
          nb_photos
          qteMini
          dimension
          dateCreation
          dateModification
          premel
        }
      }`,
      { id }
    );

    return data.produit;
  }, `efashionGetProduct(${id})`);
}

/**
 * Fetch all color variants for a product.
 */
export async function efashionGetProductColors(
  id: number
): Promise<EfashionCouleurProduit[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      couleursProduitByProduitId: EfashionCouleurProduit[];
    }>(
      `query GetProductColors($id: Int!) {
        couleursProduitByProduitId(id_produit: $id) {
          id_couleur_produit
          id_couleur
          id_produit
          description_paquet
          reception
          photo
          couleur {
            id_couleur
            couleur_FR
            couleur_EN
            defaut
          }
        }
      }`,
      { id }
    );

    return data.couleursProduitByProduitId;
  }, `efashionGetProductColors(${id})`);
}

/**
 * Fetch the description (FR/UK/instructions/commentaires) for a product.
 */
export async function efashionGetProductDescription(
  id: number
): Promise<EfashionDescription | null> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      produitDescription: EfashionDescription | null;
    }>(
      `query GetProductDescription($id: Int!) {
        produitDescription(id_produit: $id) {
          id_produit
          texte_fr
          texte_uk
          instructions
          commentaires
        }
      }`,
      { id }
    );

    return data.produitDescription ?? null;
  }, `efashionGetProductDescription(${id})`);
}

/**
 * Fetch all stock entries (by color and size) for a product.
 */
export async function efashionGetProductStocks(id: number): Promise<EfashionStock[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{ produitStocks: EfashionStock[] }>(
      `query GetProductStocks($id: Int!) {
        produitStocks(id_produit: $id) {
          id_produit_stock
          id_produit
          id_couleur
          value
          taille
        }
      }`,
      { id }
    );

    return data.produitStocks;
  }, `efashionGetProductStocks(${id})`);
}

/**
 * Fetch material composition for a product (in French).
 */
export async function efashionGetProductCompositions(
  id: number
): Promise<EfashionComposition[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      produitCompositions: EfashionComposition[];
    }>(
      `query GetProductCompositions($id: Int!, $lang: String!) {
        produitCompositions(id_produit: $id, lang: $lang) {
          id_composition
          id_composition_localisation
          value
          famille
          libelle
        }
      }`,
      { id, lang: "fr" }
    );

    return data.produitCompositions;
  }, `efashionGetProductCompositions(${id})`);
}

/**
 * Fetch photo paths for a product via REST.
 * Returns an array of relative paths (use efashionImageUrl to build full URLs).
 */
export async function efashionGetProductPhotos(id: number): Promise<string[]> {
  return withRetry(async () => {
    const res = await efashionREST(`/api/product-photos/${id}`);

    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => "");
      throw new Error(`eFashion product photos (${res.status}): ${text}`);
    }

    const json = await res.json();
    // API may return { photos: [...] } or a direct array
    if (Array.isArray(json)) return json as string[];
    if (Array.isArray(json?.photos)) return json.photos as string[];
    return [];
  }, `efashionGetProductPhotos(${id})`);
}

/**
 * Fetch all details for a product in parallel.
 */
export async function efashionGetProductDetails(
  id: number
): Promise<EfashionProductDetails> {
  await ensureEfashionAuth();

  const [product, colors, description, stocks, compositions, photos] =
    await Promise.all([
      efashionGetProduct(id),
      efashionGetProductColors(id),
      efashionGetProductDescription(id),
      efashionGetProductStocks(id),
      efashionGetProductCompositions(id),
      efashionGetProductPhotos(id),
    ]);

  return { product, colors, description, stocks, compositions, photos };
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the full category tree (2 levels deep) in French.
 */
export async function efashionGetCategories(): Promise<EfashionCategoryNode[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{ categoriesTree: EfashionCategoryNode[] }>(
      `query GetCategories($lang: String!) {
        categoriesTree(lang: $lang) {
          id_categorie
          label
          id_parent_categorie
          id_top_categorie
          children {
            id_categorie
            label
            id_parent_categorie
            id_top_categorie
            children {
              id_categorie
              label
              id_parent_categorie
              id_top_categorie
            }
          }
        }
      }`,
      { lang: "fr" }
    );

    return data.categoriesTree;
  }, "efashionGetCategories");
}

/**
 * Fetch all default colors defined on the eFashion platform.
 */
export async function efashionGetDefaultColors(): Promise<EfashionDefaultColor[]> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{ allCouleursDefaut: EfashionDefaultColor[] }>(
      `query GetDefaultColors {
        allCouleursDefaut {
          id_couleur
          couleur_FR
          couleur_EN
          defaut
        }
      }`
    );

    return data.allCouleursDefaut;
  }, "efashionGetDefaultColors");
}

/**
 * Fetch all packs for the authenticated vendor.
 */
export async function efashionGetPacks(): Promise<EfashionPack[]> {
  return withRetry(async () => {
    const vendorId = getEfashionVendorId();
    if (!vendorId) {
      throw new Error("eFashion vendorId not available — ensure auth first");
    }

    const data = await efashionGraphQL<{ packsByVendeur: EfashionPack[] }>(
      `query GetPacks($id_vendeur: Int!) {
        packsByVendeur(id_vendeur: $id_vendeur) {
          id_pack
          id_vendeur
          titre
          p1 p2 p3 p4
          p5 p6 p7 p8
          p9 p10 p11 p12
        }
      }`,
      { id_vendeur: vendorId }
    );

    return data.packsByVendeur;
  }, "efashionGetPacks");
}

/**
 * Fetch all size-breakdown tables (declinaisons) for the authenticated vendor.
 */
export async function efashionGetDeclinaisons(): Promise<EfashionDeclinaison[]> {
  return withRetry(async () => {
    const vendorId = getEfashionVendorId();
    if (!vendorId) {
      throw new Error("eFashion vendorId not available — ensure auth first");
    }

    const data = await efashionGraphQL<{
      declinaisonsByVendeur: EfashionDeclinaison[];
    }>(
      `query GetDeclinaisons($idVendeur: Int!) {
        declinaisonsByVendeur(idVendeur: $idVendeur) {
          id_declinaison
          d1_FR d2_FR d3_FR d4_FR
          d5_FR d6_FR d7_FR d8_FR
          d9_FR d10_FR d11_FR d12_FR
        }
      }`,
      { idVendeur: vendorId }
    );

    return data.declinaisonsByVendeur;
  }, "efashionGetDeclinaisons");
}

/**
 * Quickly count products for a given statut without fetching data.
 */
export async function efashionTotalProducts(
  statut: EfashionStatut = "TOUS"
): Promise<number> {
  return withRetry(async () => {
    const data = await efashionGraphQL<{
      productsPage: { total: number };
    }>(
      `query TotalProducts($filter: ProductFilter) {
        productsPage(skip: 0, take: 1, filter: $filter) {
          total
        }
      }`,
      { filter: { statut } }
    );

    return data.productsPage.total;
  }, `efashionTotalProducts(statut=${statut})`);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Build a full URL for an eFashion image path.
 * If the path is already absolute, it is returned as-is.
 */
export function efashionImageUrl(relativePath: string): string {
  if (!relativePath) return "";
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  const base = EFASHION_BASE_URL.replace(/\/$/, "");
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${base}${path}`;
}
