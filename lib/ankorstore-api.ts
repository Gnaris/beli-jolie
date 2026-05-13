/**
 * Ankorstore API Client (read-only)
 *
 * Wraps the JSON:API endpoints:
 *   - /products          — list, search, get single product
 *   - /product-variants  — get variants for a product, find by SKU
 *
 * Includes retry with exponential backoff and 401/429 handling.
 */

import {
  getAnkorstoreHeaders,
  invalidateAnkorstoreToken,
  ANKORSTORE_BASE_URL,
} from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";
import { sortAnkorstoreSearchResults } from "@/lib/ankorstore-search-rank";

// ─────────────────────────────────────────────
// Types — Ankorstore API responses (JSON:API)
// ─────────────────────────────────────────────

export interface AnkorstoreVariant {
  id: string;
  sku: string | null;
  ian: string | null;
  name: string;
  retailPrice: number;
  wholesalePrice: number;
  availableQuantity: number | null;
  stockQuantity: number | null;
  isAlwaysInStock: boolean;
  options?: { name: "color" | "size" | "material" | "style"; value: string }[];
  images?: { order: number; url: string }[];
}

export interface AnkorstoreProduct {
  id: string;
  externalId: string | null;
  name: string;
  description: string;
  retailPrice: number;
  wholesalePrice: number;
  vatRate: number;
  active: boolean;
  archived: boolean;
  images: { order: number; url: string }[];
  variants: AnkorstoreVariant[]; // hydraté via include=productVariant(s)
}

// ─────────────────────────────────────────────
// Internal fetch helper with retry
// ─────────────────────────────────────────────

/** Erreur non-retryable (4xx autre que 429) */
class AnkorstoreNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkorstoreNonRetryableError";
  }
}

async function ankorstoreFetch<T>(
  path: string,
  init?: RequestInit,
  retryCount = 0
): Promise<T> {
  const headers = await getAnkorstoreHeaders();
  const url = `${ANKORSTORE_BASE_URL}${path}`;

  const makeRequest = async (attempt: number): Promise<T> => {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });

    // 401 — token expired, invalidate and retry once
    if (res.status === 401 && attempt === 0) {
      invalidateAnkorstoreToken();
      const freshHeaders = await getAnkorstoreHeaders();
      logger.warn("[Ankorstore] Retry", { status: 401, attempt: 1, path });
      const retryRes = await fetch(url, {
        ...init,
        headers: { ...freshHeaders, ...(init?.headers as Record<string, string> | undefined) },
      });
      if (!retryRes.ok) {
        const text = await retryRes.text().catch(() => "");
        throw new AnkorstoreNonRetryableError(
          `Ankorstore API ${retryRes.status}: ${text.slice(0, 200)}`
        );
      }
      return retryRes.json() as Promise<T>;
    }

    if (res.ok) {
      return res.json() as Promise<T>;
    }

    // 429 — rate limited: respect Retry-After header (max 3 attempts)
    if (res.status === 429) {
      const maxRetries = 3;
      if (attempt >= maxRetries) {
        throw new AnkorstoreNonRetryableError(`Ankorstore API 429: rate limit exceeded after ${maxRetries} attempts`);
      }
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? "5");
      const delayMs = (isNaN(retryAfterSec) ? 5 : retryAfterSec) * 1000;
      logger.warn("[Ankorstore] Retry", { status: 429, attempt: attempt + 1, path });
      await new Promise((r) => setTimeout(r, delayMs));
      return makeRequest(attempt + 1);
    }

    // 5xx — exponential backoff: 1s, 4s, 16s (max 3 retries)
    if (res.status >= 500) {
      const maxRetries = 3;
      if (attempt >= maxRetries) {
        const text = await res.text().catch(() => "");
        throw new Error(`Ankorstore API ${res.status} after ${maxRetries} retries: ${text.slice(0, 200)}`);
      }
      const delayMs = Math.pow(4, attempt) * 1000; // 1s, 4s, 16s
      logger.warn("[Ankorstore] Retry", { status: res.status, attempt: attempt + 1, path });
      await new Promise((r) => setTimeout(r, delayMs));
      return makeRequest(attempt + 1);
    }

    // Other 4xx — never retry
    const text = await res.text().catch(() => "");
    throw new AnkorstoreNonRetryableError(
      `Ankorstore API ${res.status}: ${text.slice(0, 200)}`
    );
  };

  return makeRequest(retryCount);
}

// ─────────────────────────────────────────────
// JSON:API helpers
// ─────────────────────────────────────────────

type JsonApiProductAttributes = Omit<AnkorstoreProduct, "id" | "variants" | "externalId"> & {
  externalId?: string | null;
  external_id?: string | null;
};

type JsonApiProductItem = {
  id: string;
  attributes: JsonApiProductAttributes;
  relationships?: {
    // The API uses singular `productVariant` on /products (list) and plural
    // `productVariants` on /products/{id}. Accept either to be resilient.
    productVariant?: { data: { id: string }[] };
    productVariants?: { data: { id: string }[] };
  };
};

type JsonApiVariantItem = {
  id: string;
  attributes: Omit<AnkorstoreVariant, "id">;
};

function parseProductList(
  data: JsonApiProductItem[],
  included?: JsonApiVariantItem[]
): AnkorstoreProduct[] {
  const variantsById = new Map(
    (included ?? []).map((v) => [v.id, { ...v.attributes, id: v.id }])
  );

  return data.map((item) => {
    const variantIds =
      item.relationships?.productVariants?.data?.map((v) => v.id) ??
      item.relationships?.productVariant?.data?.map((v) => v.id) ??
      [];
    const externalId =
      item.attributes.externalId ?? item.attributes.external_id ?? null;
    return {
      ...item.attributes,
      externalId,
      id: item.id,
      variants: variantIds
        .map((id) => variantsById.get(id))
        .filter(Boolean) as AnkorstoreVariant[],
    };
  });
}

// ─────────────────────────────────────────────
// API methods
// ─────────────────────────────────────────────

/**
 * Search products by name or SKU on Ankorstore.
 *
 * Performance: un seul appel API au lieu de N+1.
 *
 * Le filtre `skuOrName` sur `/product-variants` matche les SKU partiels
 * (ex: "A382" trouve A382_Violet, A382_Blanc...) — contrairement au filtre
 * équivalent sur `/products` qui ne regarde que le nom du produit.
 *
 * Avec `include=product` Ankorstore renvoie aussi les produits parents dans
 * `included[]` (nom, images, externalId) → on n'a pas besoin de faire un
 * second appel par produit pour les afficher dans la modale de liaison.
 *
 * `variantCount` = nombre de variantes MATCHÉES par la recherche (peut être
 * inférieur au total si l'utilisateur tape un nom). Acceptable pour la modale.
 *
 * Fallback : si la recherche variantes ne ramène rien (utilisateur tape un nom
 * de produit qui ne correspond à aucun SKU), on retombe sur `/products?filter[skuOrName]=...`.
 */
export async function ankorstoreSearchProducts(
  query: string,
  limit = 20
): Promise<AnkorstoreProduct[]> {
  // On élargit volontairement la fenêtre (jusqu'à 100 candidats) parce que
  // `filter[skuOrName]` renvoie les résultats dans un ordre opaque côté
  // Ankorstore : une référence courte comme "A405" peut se retrouver
  // perdue derrière 50 produits non pertinents si on coupe trop tôt.
  // On trie ensuite par pertinence côté code (sortAnkorstoreSearchResults)
  // avant de tronquer à `limit`.
  const FETCH_LIMIT = 100;
  const variantUrl =
    `/product-variants?filter[skuOrName]=${encodeURIComponent(query)}` +
    `&include=product&page[limit]=${FETCH_LIMIT}`;
  const variantResp = await ankorstoreFetch<{
    data: {
      id: string;
      attributes: Omit<AnkorstoreVariant, "id">;
      relationships?: { product?: { data?: { id: string } } };
    }[];
    included?: {
      id: string;
      type: string;
      attributes: JsonApiProductAttributes;
    }[];
  }>(variantUrl);

  // Index produits depuis `included[]` (parsed même struct que parseProductList).
  const productById = new Map<string, AnkorstoreProduct>();
  for (const inc of variantResp.included ?? []) {
    if (inc.type !== "product") continue;
    const attrs = inc.attributes ?? ({} as JsonApiProductAttributes);
    const externalId = attrs.externalId ?? attrs.external_id ?? null;
    productById.set(inc.id, {
      ...(attrs as unknown as Omit<AnkorstoreProduct, "id" | "variants" | "externalId">),
      externalId,
      id: inc.id,
      variants: [],
    });
  }

  // Attache à chaque produit les variantes matchées (ordre du tableau data).
  const orderedProductIds: string[] = [];
  const seenProductIds = new Set<string>();
  for (const v of variantResp.data ?? []) {
    const pid = v.relationships?.product?.data?.id;
    if (!pid) continue;
    const p = productById.get(pid);
    if (!p) continue;
    p.variants.push({ ...v.attributes, id: v.id });
    if (!seenProductIds.has(pid)) {
      seenProductIds.add(pid);
      orderedProductIds.push(pid);
    }
  }

  const candidates: AnkorstoreProduct[] = [];
  for (const id of orderedProductIds) {
    const p = productById.get(id);
    if (p) candidates.push(p);
  }

  // Fallback : aucune correspondance via les SKU → recherche legacy par nom de produit.
  if (candidates.length === 0) {
    try {
      const url =
        `/products?filter[skuOrName]=${encodeURIComponent(query)}` +
        `&include=productVariant&page[limit]=${FETCH_LIMIT}`;
      const resp = await ankorstoreFetch<{
        data: JsonApiProductItem[];
        included?: JsonApiVariantItem[];
      }>(url);
      for (const p of parseProductList(resp.data ?? [], resp.included)) {
        candidates.push(p);
      }
    } catch (err) {
      logger.warn("[Ankorstore] Legacy product-name search failed", {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Tri par pertinence (SKU exact → préfixe "{query}_" → nom commence par → …)
  // PUIS troncature, sinon une référence très pertinente peut être coupée.
  const ranked = sortAnkorstoreSearchResults(candidates, query);
  return ranked.slice(0, limit);
}

/**
 * Get a single product by its Ankorstore ID.
 * Returns null if the product is not found (404).
 */
export async function ankorstoreGetProduct(
  productId: string
): Promise<AnkorstoreProduct | null> {
  try {
    // /products/{id} requires the PLURAL include name `productVariants` —
    // /products (list) uses the singular `productVariant`. Asymmetric, but
    // that's how the API responds (400 "Include path productVariant is not
    // allowed" on /products/{id} with singular).
    const url = `/products/${encodeURIComponent(productId)}?include=productVariants`;
    const resp = await ankorstoreFetch<{
      data: JsonApiProductItem;
      included?: JsonApiVariantItem[];
    }>(url);
    const [product] = parseProductList([resp.data], resp.included);
    return product ?? null;
  } catch (err) {
    if (err instanceof AnkorstoreNonRetryableError && err.message.includes("404")) {
      return null;
    }
    throw err;
  }
}

/**
 * Get all variants for a product by its Ankorstore ID.
 */
export async function ankorstoreGetVariants(
  productId: string
): Promise<AnkorstoreVariant[]> {
  const url = `/product-variants?filter[productId][]=${encodeURIComponent(productId)}&page[limit]=100`;
  const resp = await ankorstoreFetch<{ data: JsonApiVariantItem[] }>(url);
  return (resp.data ?? []).map((v) => ({ ...v.attributes, id: v.id }));
}

/**
 * Find a single variant by its SKU.
 * Returns null if no match.
 */
export async function ankorstoreFindVariantBySku(
  sku: string
): Promise<AnkorstoreVariant | null> {
  const url = `/product-variants?filter[sku]=${encodeURIComponent(sku)}&page[limit]=1`;
  const resp = await ankorstoreFetch<{ data: JsonApiVariantItem[] }>(url);
  if (!resp.data?.length) return null;
  return { ...resp.data[0].attributes, id: resp.data[0].id };
}

/**
 * List all products from Ankorstore using cursor-based pagination.
 * Fetches up to 200 pages (safety cap).
 */
export async function ankorstoreListAllProducts(opts?: {
  pageSize?: number;
}): Promise<AnkorstoreProduct[]> {
  // Ankorstore API caps page.limit at 50 — enforce here to prevent 400 errors.
  const pageSize = Math.min(opts?.pageSize ?? 50, 50);
  const all: AnkorstoreProduct[] = [];
  let after: string | null = null;

  for (let i = 0; i < 200; i++) {
    const cursorParam: string = after ? `&page[after]=${encodeURIComponent(after)}` : "";
    const pageUrl: string = `/products?include=productVariant&page[limit]=${pageSize}${cursorParam}`;
    const resp: {
      data: JsonApiProductItem[];
      included?: JsonApiVariantItem[];
      meta?: { page?: { hasMore?: boolean } };
      links?: { next?: string };
    } = await ankorstoreFetch<{
      data: JsonApiProductItem[];
      included?: JsonApiVariantItem[];
      meta?: { page?: { hasMore?: boolean } };
      links?: { next?: string };
    }>(pageUrl);

    const page = parseProductList(resp.data ?? [], resp.included);
    all.push(...page);

    if (!resp.meta?.page?.hasMore || resp.data.length < pageSize) break;
    after = resp.data[resp.data.length - 1].id;
  }

  return all;
}
