/**
 * Publication d'un produit Beli & Jolie sur Ankorstore.
 *
 * Reversé depuis POST /api/me/brand/products. La création est ATOMIQUE :
 * un seul appel HTTP crée le produit + ses N variantes + attache les images
 * déjà uploadées via /api/files.
 *
 * Pas d'endpoint de "publication" séparé — le produit est `active: true` dès
 * la 201. Une catégorie manquante déclenche `requires_category_update: true`
 * mais Ankor auto-classifie ~30 s plus tard via nom + description.
 */

import { boPostJson } from "./client";
import type { BoProductPayload, BoProductSummary } from "./types";

interface CreateProductResponse {
  data: BoProductSummary;
}

/**
 * POST /api/me/brand/products avec un payload déjà assemblé.
 *
 * Le payload doit avoir été construit via `buildProductPayload` (builder.ts)
 * qui gère la conversion BJ → Ankor (prix centimes, SKU préfixés, couleurs,
 * pays, tags Bestseller, etc.).
 */
export async function createProduct(payload: BoProductPayload): Promise<BoProductSummary> {
  const res = await boPostJson<CreateProductResponse>("/api/me/brand/products", payload);
  if (!res.data?.id) {
    throw new Error("Ankorstore : réponse création produit sans data.id");
  }
  return res.data;
}

/**
 * Extrait une map lisible { sku → variantId Ankor } depuis la réponse de création.
 * Utile pour peupler `ProductColor.ankorsVariantId` côté BJ.
 */
export function extractVariantIdBySku(created: BoProductSummary): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of created.variants ?? []) {
    if (v.sku) out.set(v.sku, v.id);
  }
  return out;
}
