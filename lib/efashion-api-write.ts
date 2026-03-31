/**
 * eFashion Paris Write API Client
 *
 * Provides typed wrappers for write operations (mutations + REST uploads).
 * All functions handle auth automatically via ensureEfashionAuth / reauthenticateEfashion.
 */

import {
  ensureEfashionAuth,
  reauthenticateEfashion,
  getEfashionVendorId,
} from "@/lib/efashion-auth";
import { efashionGraphQL, efashionREST } from "@/lib/efashion-graphql";
import { logger } from "@/lib/logger";

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

/**
 * Create a new product on eFashion.
 * Returns the created product's id_produit.
 */
export async function createEfashionProduct(data: {
  id_categorie: number;
  id_declinaison?: number;
  id_pack?: number;
  id_collection?: number;
  id_provenance?: number;
  reference: string;
  vendu_par: string; // "couleurs" | "assortiment"
  prix: number;
  prixReduit?: number;
  poids?: number;
  visible?: boolean;
  qteMini?: number;
  dimension?: string;
}): Promise<{ id_produit: number }> {
  return withRetry(async () => {
    const vendorId = getEfashionVendorId();
    if (!vendorId) {
      throw new Error("eFashion vendorId not available — ensure auth first");
    }

    const result = await efashionGraphQL<{
      createProduit: { id_produit: number; reference: string };
    }>(
      `mutation CreateProduit($input: CreateProduitInput!) {
        createProduit(input: $input) {
          id_produit
          reference
        }
      }`,
      { input: { id_vendeur: vendorId, ...data } }
    );

    logger.info("[eFashion] Product created", {
      id_produit: result.createProduit.id_produit,
      reference: result.createProduit.reference,
    });

    return { id_produit: result.createProduit.id_produit };
  }, `createEfashionProduct(${data.reference})`);
}

/**
 * Update an existing product on eFashion.
 * Returns the updated product's id_produit.
 */
export async function updateEfashionProduct(data: {
  id_produit: number;
  id_categorie?: number;
  id_declinaison?: number;
  id_pack?: number;
  id_collection?: number;
  reference?: string;
  vendu_par?: string;
  prix?: number;
  prixReduit?: number;
  poids?: number;
  visible?: boolean;
  qteMini?: number;
  dimension?: string;
}): Promise<{ id_produit: number }> {
  return withRetry(async () => {
    const result = await efashionGraphQL<{
      updateProduit: { id_produit: number };
    }>(
      `mutation UpdateProduit($input: UpdateProduitInput!) {
        updateProduit(input: $input) {
          id_produit
        }
      }`,
      { input: data }
    );

    logger.info("[eFashion] Product updated", {
      id_produit: result.updateProduit.id_produit,
    });

    return { id_produit: result.updateProduit.id_produit };
  }, `updateEfashionProduct(${data.id_produit})`);
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

/**
 * Save the FR/UK descriptions for a product.
 * Maps texte_fr / texte_uk to the { lang, description } format the mutation expects.
 */
export async function saveEfashionDescription(data: {
  id_produit: number;
  texte_fr?: string;
  texte_uk?: string;
}): Promise<void> {
  return withRetry(async () => {
    const descriptions: Array<{ lang: string; titre: string; description: string }> = [];

    if (data.texte_fr !== undefined) {
      descriptions.push({ lang: "fr", titre: "", description: data.texte_fr });
    }
    if (data.texte_uk !== undefined) {
      descriptions.push({ lang: "en", titre: "", description: data.texte_uk });
    }

    await efashionGraphQL<{ saveProduitDescription: { success: boolean } }>(
      `mutation SaveProduitDescription($input: SaveProduitDescriptionInput!) {
        saveProduitDescription(input: $input) {
          success
        }
      }`,
      { input: { id_produit: data.id_produit, descriptions } }
    );

    logger.info("[eFashion] Description saved", { id_produit: data.id_produit });
  }, `saveEfashionDescription(${data.id_produit})`);
}

// ---------------------------------------------------------------------------
// Stocks
// ---------------------------------------------------------------------------

/**
 * Save (upsert) all stock entries for a product in one call.
 */
export async function saveEfashionStocks(data: {
  id_produit: number;
  stocks: Array<{ id_couleur: number; taille?: string; value: number }>;
}): Promise<void> {
  return withRetry(async () => {
    await efashionGraphQL<{ saveProduitStocks: { success: boolean } }>(
      `mutation SaveProduitStocks($input: SaveProduitStocksInput!) {
        saveProduitStocks(input: $input) {
          success
        }
      }`,
      { input: data }
    );

    logger.info("[eFashion] Stocks saved", {
      id_produit: data.id_produit,
      count: data.stocks.length,
    });
  }, `saveEfashionStocks(${data.id_produit})`);
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

/**
 * Replace the full color list associated with a product.
 */
export async function updateEfashionProductColors(data: {
  id_produit: number;
  couleurs: number[];
}): Promise<void> {
  return withRetry(async () => {
    await efashionGraphQL<{ updateProduitCouleursProduit: { success: boolean } }>(
      `mutation UpdateProduitCouleursProduit($input: UpdateProduitCouleursProduitInput!) {
        updateProduitCouleursProduit(input: $input) {
          success
        }
      }`,
      { input: data }
    );

    logger.info("[eFashion] Product colors updated", {
      id_produit: data.id_produit,
      couleurs: data.couleurs,
    });
  }, `updateEfashionProductColors(${data.id_produit})`);
}

// ---------------------------------------------------------------------------
// Visibility / Soft-delete (batch)
// ---------------------------------------------------------------------------

/**
 * Set the visibility (visible flag) for a batch of products.
 */
export async function setEfashionProductsVisible(
  ids: number[],
  visible: boolean
): Promise<void> {
  return withRetry(async () => {
    await efashionGraphQL<{ setProduitsVisible: { success: boolean } }>(
      `mutation SetProduitsVisible($ids: [Int!]!, $visible: Boolean!) {
        setProduitsVisible(ids: $ids, visible: $visible) {
          success
        }
      }`,
      { ids, visible }
    );

    logger.info("[eFashion] Product visibility updated", { ids, visible });
  }, `setEfashionProductsVisible(${ids.join(",")})`);
}

/**
 * Soft-delete a batch of products (sets supprimer = true).
 */
export async function softDeleteEfashionProducts(ids: number[]): Promise<void> {
  return withRetry(async () => {
    await efashionGraphQL<{ softDeleteProduits: { success: boolean } }>(
      `mutation SoftDeleteProduits($ids: [Int!]!) {
        softDeleteProduits(ids: $ids) {
          success
        }
      }`,
      { ids }
    );

    logger.info("[eFashion] Products soft-deleted", { ids });
  }, `softDeleteEfashionProducts(${ids.join(",")})`);
}

// ---------------------------------------------------------------------------
// Images (REST)
// ---------------------------------------------------------------------------

/**
 * Upload a product photo via the eFashion REST endpoint.
 * The API expects a multipart/form-data request with the image file.
 */
export async function uploadEfashionImage(
  imageBuffer: Buffer,
  filename: string,
  productId: number
): Promise<void> {
  return withRetry(async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([imageBuffer], { type: "image/jpeg" }),
      filename
    );
    formData.append("id_produit", String(productId));

    const res = await efashionREST("/api/upload-product-photo", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `eFashion upload-product-photo (${res.status}): ${text}`
      );
    }

    logger.info("[eFashion] Image uploaded", { productId, filename });
  }, `uploadEfashionImage(${productId}, ${filename})`);
}

/**
 * Delete a product photo via the eFashion REST endpoint.
 */
export async function deleteEfashionImage(
  productId: number,
  filename: string
): Promise<void> {
  return withRetry(async () => {
    const res = await efashionREST("/api/product-photo/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_produit: productId, filename }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `eFashion product-photo/delete (${res.status}): ${text}`
      );
    }

    logger.info("[eFashion] Image deleted", { productId, filename });
  }, `deleteEfashionImage(${productId}, ${filename})`);
}

// ---------------------------------------------------------------------------
// Compositions
// ---------------------------------------------------------------------------

/**
 * Save the material compositions for a product.
 */
export async function saveEfashionCompositions(data: {
  id_produit: number;
  compositions: Array<{
    id_composition: number;
    id_composition_localisation: number;
    value: number;
  }>;
}): Promise<void> {
  return withRetry(async () => {
    await efashionGraphQL<{ saveProduitCompositions: { success: boolean } }>(
      `mutation SaveProduitCompositions($input: SaveProduitCompositionsInput!) {
        saveProduitCompositions(input: $input) {
          success
        }
      }`,
      { input: data }
    );

    logger.info("[eFashion] Compositions saved", {
      id_produit: data.id_produit,
      count: data.compositions.length,
    });
  }, `saveEfashionCompositions(${data.id_produit})`);
}
