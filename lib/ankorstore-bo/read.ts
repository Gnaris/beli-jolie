/**
 * Lecture produit(s) via le back-office Ankorstore.
 *
 * Endpoint principal : GET /api/me/brand/products?filters[id]=X&fields=…
 * (le back-office n'a pas d'endpoint /products/{id} isolé — la liste filtrée fait tout).
 *
 * Sert au bouton "Rafraîchir" côté BJ et au flow de liaison (recherche par référence).
 */

import { boGet } from "./client";
import type { BoProductSummary } from "./types";

/**
 * Sélecteur de champs par défaut — couvre tout ce qui sert au Rafraîchir BJ :
 * ID, prix, images, tags, catégories, options, variants (avec stock).
 */
const DEFAULT_FIELDS = [
  "id",
  "uuid",
  "name",
  "link",
  "active",
  "retail_price",
  "wholesale_price",
  "original_wholesale_price",
  "hs_code",
  "made_in",
  "categories",
  "tags",
  "images",
  "requires_category_update",
  "errors_count",
  "validation_errors",
  "has_pending_draft",
  "is_new",
  "vat_rate",
  "options",
  "variants{id,uuid,sku,ian,images,name,options,price,stock}",
].join(",");

interface PaginatedResponse<T> {
  data: T[];
  meta?: { total?: number; current_page?: number; last_page?: number };
}

/**
 * Lit un produit Ankorstore par son ID interne.
 * Retourne null si absent (archivé côté Ankor, ou ID invalide).
 */
export async function readProductById(
  productId: number,
  opts: { fields?: string } = {}
): Promise<BoProductSummary | null> {
  const fields = opts.fields ?? DEFAULT_FIELDS;
  const qs = new URLSearchParams({
    fields,
    page: "1",
    per_page: "1",
    "filters[id]": String(productId),
    "filters[requireupdate]": "0",
    "filters[with_options]": "1",
  });
  const res = await boGet<PaginatedResponse<BoProductSummary>>(
    `/api/me/brand/products?${qs.toString()}`
  );
  return res.data?.[0] ?? null;
}

/**
 * Recherche par texte libre (référence, nom).
 * Utilisé par le flow de liaison — l'admin tape la référence BJ, on cherche un match.
 */
export async function searchProducts(
  query: string,
  opts: { limit?: number; fields?: string } = {}
): Promise<BoProductSummary[]> {
  const fields = opts.fields ?? DEFAULT_FIELDS;
  const qs = new URLSearchParams({
    fields,
    page: "1",
    per_page: String(opts.limit ?? 20),
    query,
    "filters[requireupdate]": "0",
    "filters[with_options]": "1",
  });
  const res = await boGet<PaginatedResponse<BoProductSummary>>(
    `/api/me/brand/products?${qs.toString()}`
  );
  return res.data ?? [];
}

/**
 * Rafraîchit un produit après un PUT ou un mass-action.
 * L'index Elasticsearch d'Ankor est à la traîne (~1-3 s). Retry avec délai
 * pour éviter les fenêtres où filters[id] renvoie [].
 */
export async function readProductByIdWithRetry(
  productId: number,
  opts: { attempts?: number; delayMs?: number } = {}
): Promise<BoProductSummary | null> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 1500;
  for (let i = 0; i < attempts; i++) {
    const found = await readProductById(productId);
    if (found) return found;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
