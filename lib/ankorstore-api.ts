/**
 * Ankorstore API Client (read-only)
 *
 * JSON:API client for fetching products and variants from Ankorstore.
 * Includes retry logic with token refresh, rate-limit handling, and exponential backoff.
 */

import {
  getAnkorstoreHeaders,
  invalidateAnkorstoreToken,
  ANKORSTORE_BASE_URL,
} from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types — Ankorstore API entities
// ─────────────────────────────────────────────

export interface AnkorstoreVariant {
  id: string;
  sku: string | null;
  name: string;
  ian: string | null; // EAN / barcode
  retailPrice: number | null;
  wholesalePrice: number | null;
  availableQuantity: number | null;
  images: string[];
}

export interface AnkorstoreProduct {
  id: string;
  name: string;
  description: string;
  images: string[];
  active: boolean;
  archived: boolean;
  variants: AnkorstoreVariant[];
}

// ─────────────────────────────────────────────
// JSON:API parsing helpers
// ─────────────────────────────────────────────

interface JsonApiResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<
    string,
    { data: { id: string; type: string } | { id: string; type: string }[] | null }
  >;
}

interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
  links?: Record<string, string | null>;
  meta?: Record<string, unknown>;
}

function parseVariant(resource: JsonApiResource): AnkorstoreVariant {
  const attrs = resource.attributes;
  return {
    id: resource.id,
    sku: (attrs.sku as string) ?? null,
    name: (attrs.name as string) ?? "",
    ian: (attrs.ian as string) ?? null,
    retailPrice: (attrs.retail_price as number) ?? (attrs.retailPrice as number) ?? null,
    wholesalePrice:
      (attrs.wholesale_price as number) ?? (attrs.wholesalePrice as number) ?? null,
    availableQuantity:
      (attrs.available_quantity as number) ??
      (attrs.availableQuantity as number) ??
      null,
    images: Array.isArray(attrs.images)
      ? (attrs.images as string[])
      : typeof attrs.image_url === "string"
        ? [attrs.image_url as string]
        : [],
  };
}

function parseProduct(
  resource: JsonApiResource,
  includedMap: Map<string, JsonApiResource>
): AnkorstoreProduct {
  const attrs = resource.attributes;

  // Resolve variant relationships
  const variants: AnkorstoreVariant[] = [];
  const variantRel = resource.relationships?.productVariant ?? resource.relationships?.["product-variant"];
  if (variantRel?.data) {
    const relData = Array.isArray(variantRel.data) ? variantRel.data : [variantRel.data];
    for (const ref of relData) {
      const included = includedMap.get(`${ref.type}:${ref.id}`);
      if (included) {
        variants.push(parseVariant(included));
      }
    }
  }

  return {
    id: resource.id,
    name: (attrs.name as string) ?? "",
    description: (attrs.description as string) ?? "",
    images: Array.isArray(attrs.images)
      ? (attrs.images as string[])
      : typeof attrs.image_url === "string"
        ? [attrs.image_url as string]
        : [],
    active: (attrs.active as boolean) ?? (attrs.is_active as boolean) ?? true,
    archived: (attrs.archived as boolean) ?? (attrs.is_archived as boolean) ?? false,
    variants,
  };
}

function buildIncludedMap(
  included?: JsonApiResource[]
): Map<string, JsonApiResource> {
  const map = new Map<string, JsonApiResource>();
  if (included) {
    for (const res of included) {
      map.set(`${res.type}:${res.id}`, res);
    }
  }
  return map;
}

// ─────────────────────────────────────────────
// Retry logic
// ─────────────────────────────────────────────

async function ankorstoreFetch(
  url: string,
  maxRetries = 3
): Promise<JsonApiResponse> {
  let headers = await getAnkorstoreHeaders();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      // 401 → invalidate token and retry once
      if (res.status === 401 && attempt === 0) {
        logger.warn("[Ankorstore] 401 — refreshing token");
        invalidateAnkorstoreToken();
        headers = await getAnkorstoreHeaders();
        continue;
      }

      // 429 → respect Retry-After header
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
        const delay = Math.min(retryAfter * 1000, 60000);
        logger.warn("[Ankorstore] Rate limited, waiting", {
          retryAfter,
          attempt: attempt + 1,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // 5xx → exponential backoff
      if (res.status >= 500) {
        const jitter = Math.random() * 1000;
        const delay = Math.min(2000 * Math.pow(2, attempt) + jitter, 30000);
        logger.warn("[Ankorstore] Server error, retrying", {
          status: res.status,
          attempt: attempt + 1,
          delayMs: Math.round(delay),
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Ankorstore API ${res.status}: ${text.slice(0, 200)}`
        );
      }

      return (await res.json()) as JsonApiResponse;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (
        lastError.name === "AbortError" ||
        lastError.message.includes("Ankorstore API")
      ) {
        // Don't retry client-side aborts or non-retryable errors
        if (!lastError.name.includes("Abort") || attempt >= maxRetries) {
          throw lastError;
        }
      }
      if (attempt < maxRetries) {
        const jitter = Math.random() * 1000;
        const delay = Math.min(2000 * Math.pow(2, attempt) + jitter, 30000);
        logger.warn("[Ankorstore] Request failed, retrying", {
          error: lastError.message,
          attempt: attempt + 1,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error("Ankorstore API: max retries exceeded");
}

// ─────────────────────────────────────────────
// Public API methods
// ─────────────────────────────────────────────

/**
 * Fetch all products from Ankorstore using cursor-based pagination.
 * Includes product variants via JSON:API include.
 *
 * @param onProgress Optional callback reporting (fetchedSoFar, total?)
 */
export async function ankorstoreFetchAllProducts(
  onProgress?: (fetched: number, total?: number) => void
): Promise<AnkorstoreProduct[]> {
  const allProducts: AnkorstoreProduct[] = [];
  let cursor: string | null = null;
  const limit = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let url = `${ANKORSTORE_BASE_URL}/products?page[limit]=${limit}&include=productVariant`;
    if (cursor) {
      url += `&page[after]=${encodeURIComponent(cursor)}`;
    }

    const json = await ankorstoreFetch(url);
    const includedMap = buildIncludedMap(json.included);

    const dataArr = Array.isArray(json.data) ? json.data : [json.data];
    for (const resource of dataArr) {
      allProducts.push(parseProduct(resource, includedMap));
    }

    const total =
      json.meta?.total != null ? Number(json.meta.total) : undefined;
    onProgress?.(allProducts.length, total);

    // Check for next page cursor
    const nextLink = json.links?.next;
    if (!nextLink || dataArr.length < limit) {
      break;
    }

    // Extract cursor from next link or use last item ID
    const nextUrl = new URL(nextLink, ANKORSTORE_BASE_URL);
    cursor =
      nextUrl.searchParams.get("page[after]") ??
      dataArr[dataArr.length - 1].id;
  }

  logger.info("[Ankorstore] Fetched all products", {
    count: allProducts.length,
  });
  return allProducts;
}

/**
 * Fetch a single product by ID with its variants.
 */
export async function ankorstoreFetchProduct(
  id: string
): Promise<AnkorstoreProduct> {
  const url = `${ANKORSTORE_BASE_URL}/products/${encodeURIComponent(id)}?include=productVariant`;
  const json = await ankorstoreFetch(url);
  const includedMap = buildIncludedMap(json.included);

  const resource = Array.isArray(json.data) ? json.data[0] : json.data;
  if (!resource) {
    throw new Error(`Ankorstore product ${id} not found`);
  }

  return parseProduct(resource, includedMap);
}

/**
 * Search product variants by SKU or name.
 */
export async function ankorstoreSearchVariants(filter: {
  sku?: string;
  skuOrName?: string;
}): Promise<AnkorstoreVariant[]> {
  const params = new URLSearchParams();
  if (filter.sku) {
    params.set("filter[sku]", filter.sku);
  }
  if (filter.skuOrName) {
    params.set("filter[search]", filter.skuOrName);
  }

  const url = `${ANKORSTORE_BASE_URL}/product-variants?${params.toString()}`;
  const json = await ankorstoreFetch(url);

  const dataArr = Array.isArray(json.data) ? json.data : [json.data];
  return dataArr.map(parseVariant);
}
