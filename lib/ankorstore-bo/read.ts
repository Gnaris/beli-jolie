/**
 * Lecture produit(s) via le back-office Ankorstore.
 *
 * Endpoint principal : GET /api/me/brand/products?filters[id]=X&fields=…
 * (le back-office n'a pas d'endpoint /products/{id} isolé — la liste filtrée fait tout).
 *
 * Sert au bouton "Rafraîchir" côté BJ et au flow de liaison (recherche par référence).
 */

import { boGet } from "./client";
import { logger } from "@/lib/logger";
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
 *
 * Garde-fou critique : l'endpoint `filters[id]=X` d'Ankor a été observé (2026-08-15)
 * en train de renvoyer un AUTRE produit que celui demandé quand le produit ciblé
 * n'est pas dans le cache ES d'Ankor. Sans check, la donnée renvoyée est injectée
 * dans le plan de sync images côté publishProductToAnkorstoreBo → l'URL d'image
 * d'un autre produit est "keep" et réinjectée dans le PUT → BJ Product A se
 * retrouve avec l'image de BJ Product B chez Ankor. On vérifie donc que l'ID
 * renvoyé correspond, sinon on traite comme "not found" (le sync fera un
 * upload complet + variant re-création, plus lent mais correct).
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
  const found = res.data?.[0] ?? null;
  if (found && found.id !== productId) {
    logger.warn(
      "[ankorstore-bo] filters[id] a renvoyé un produit différent - traité comme not found",
      { requested: productId, returned: found.id }
    );
    return null;
  }
  return found;
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
 * Lit un produit par ID, avec fallback SKU si l'endpoint filters[id] renvoie
 * un autre produit (bug Ankor observé). Le SKU exact matche via `query=`, ce
 * qui a été vérifié fiable même quand filters[id] est cassé.
 *
 * Passe UN SKU par variante — on stoppe dès qu'un match sur `productId` est
 * trouvé. Aucun appel superflu si le premier SKU trouve le bon produit.
 */
export async function readProductByIdWithSkuFallback(
  productId: number,
  skuHints: readonly string[],
  opts: { fields?: string } = {}
): Promise<BoProductSummary | null> {
  const direct = await readProductById(productId, opts);
  if (direct) return direct;
  for (const sku of skuHints) {
    const trimmed = sku?.trim();
    if (!trimmed) continue;
    try {
      const results = await searchProducts(trimmed, { limit: 5, fields: opts.fields });
      const match = results.find((p) => p.id === productId);
      if (match) {
        logger.info(
          "[ankorstore-bo] fallback SKU a résolu le produit après échec filters[id]",
          { productId, sku: trimmed },
        );
        return match;
      }
    } catch (err) {
      logger.warn("[ankorstore-bo] fallback SKU search a échoué", {
        productId,
        sku: trimmed,
        error: (err as Error).message,
      });
    }
  }
  return null;
}

/**
 * Rafraîchit un produit après un PUT ou un mass-action.
 * L'index Elasticsearch d'Ankor est à la traîne (~1-3 s). Retry avec délai
 * pour éviter les fenêtres où filters[id] renvoie [].
 *
 * Accepte des SKU hints — si l'endpoint filters[id] renvoie un mauvais produit
 * (bug Ankor 2026-08-15), on fait un fallback recherche par SKU. Passer les
 * ankorsSku qu'on vient d'envoyer dans le PUT / POST.
 */
export async function readProductByIdWithRetry(
  productId: number,
  opts: { attempts?: number; delayMs?: number; skuHints?: readonly string[] } = {}
): Promise<BoProductSummary | null> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 1500;
  const skuHints = opts.skuHints ?? [];
  for (let i = 0; i < attempts; i++) {
    const found =
      skuHints.length > 0
        ? await readProductByIdWithSkuFallback(productId, skuHints)
        : await readProductById(productId);
    if (found) return found;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
