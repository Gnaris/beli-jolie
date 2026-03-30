/**
 * PFS (Paris Fashion Shop) API Client
 *
 * Wraps the 3 tested endpoints:
 *   1. listProducts   — paginated product list with inline variants (buggy weight/pieces)
 *   2. checkReference — product details (composition, description, collection)
 *   3. variants       — correct weight, packQuantity, total price per variant
 *
 * Includes retry with exponential backoff for API instability.
 */

import { getPfsHeaders, invalidatePfsToken, PFS_BASE_URL } from "@/lib/pfs-auth";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types — PFS API responses
// ─────────────────────────────────────────────

export interface PfsColorInfo {
  id: number;
  reference: string;
  value: string; // hex e.g. "#C4A647"
  image: string | null;
  labels: Record<string, string>; // fr, en, de, es, it
}

export interface PfsVariantItem {
  id: string;
  sku_suffix: string | null;
  type: "ITEM" | "PACK";
  custom_suffix: string;
  pieces: number;
  price_sale: {
    unit: { value: number; currency: string };
    total: { value: number; currency: string };
  };
  price_before_discount: {
    unit: { value: number; currency: string };
    total: { value: number; currency: string };
  };
  discount: {
    type: string;
    value: number;
  } | null;
  // ITEM type
  item?: {
    color: PfsColorInfo;
    size: string;
  };
  // PACK type
  packs?: {
    color: PfsColorInfo;
    sizes: { id: string; size: string; qty: number }[];
  }[];
  is_active: boolean;
  is_star: boolean | null;
  in_stock: boolean;
  stock_qty: number;
  weight: number;
  creation_date: string | null;
  images?: Record<string, string | string[]>;
}

export interface PfsProduct {
  id: string;
  reference: string;
  brand: { id: string; name: string };
  gender: string;
  family: string;
  category: {
    id: string;
    labels: Record<string, string>;
  };
  labels: Record<string, string>;
  colors: string; // "GOLDEN;SILVER"
  sizes: string;
  size_details_tu: string;
  unit_price: number;
  creation_date: string;
  status: string;
  is_star: number;
  count_variants: number;
  images: Record<string, string | string[]>;
  flash_sales_discount: unknown | null;
  variants: PfsVariantItem[];
}

export interface PfsListProductsResponse {
  data: PfsProduct[];
  state?: {
    total: number;
    active: number;
    draft: number;
    for_sale: number;
    out_of_stock: number;
    archived: number;
    deleted: number;
    star: number;
  };
  meta?: {
    current_page: number;
    last_page: number;
    from: number;
    per_page: number;
    total: number;
  };
}

export interface PfsCheckReferenceResponse {
  exists: boolean;
  product?: {
    id: string;
    brand: { id: string; name: string };
    gender: { reference: string };
    family: { id: string; reference: string };
    category: { id: string; reference: string };
    reference: string;
    label: Record<string, string>;
    collection?: {
      id: string;
      reference: string;
      labels: Record<string, string>;
    };
    material_composition: {
      id: string;
      reference: string;
      percentage: number;
      labels: Record<string, string>;
    }[];
    lining_composition: unknown[];
    country_of_manufacture: string;
    description: Record<string, string>;
    status: string;
    default_color: string;
    images: Record<string, string | string[]>;
    flash_sales_discount: unknown | null;
  };
}

export interface PfsVariantDetail extends PfsVariantItem {
  product_id: string;
  reference: string;
  size_details_tu: string;
  colors: PfsColorInfo[];
}

export interface PfsVariantsResponse {
  data: PfsVariantDetail[];
}

// ─────────────────────────────────────────────
// Retry logic
// ─────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      // 401 = token expired, invalidate and retry once
      if (res.status === 401 && attempt === 0) {
        invalidatePfsToken();
        const newHeaders = await getPfsHeaders();
        options.headers = newHeaders;
        continue;
      }

      if (res.ok) return res;

      // 404 = resource not found — don't retry, clean error message
      if (res.status === 404) {
        throw new Error(`PFS API 404: ressource introuvable`);
      }

      // Rate limited or server error — retry with backoff
      if (res.status === 429 || res.status >= 500) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 60000);
        logger.warn("[PFS] HTTP error, retrying", { status: res.status, attempt: attempt + 1, maxRetries, delayMs: delay });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Other errors — don't retry
      const text = await res.text().catch(() => "");
      throw new Error(`PFS API ${res.status}: ${text.slice(0, 200)}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 60000);
        logger.warn("[PFS] Request failed, retrying", { error: lastError.message, attempt: attempt + 1, maxRetries, delayMs: delay });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error("PFS API: max retries exceeded");
}

// ─────────────────────────────────────────────
// API methods
// ─────────────────────────────────────────────

/**
 * List products (paginated). Returns one page at a time.
 */
export async function pfsListProducts(
  page: number,
  perPage = 100,
): Promise<PfsListProductsResponse> {
  const headers = await getPfsHeaders();
  const url = `${PFS_BASE_URL}/catalog/listProducts?page=${page}&per_page=${perPage}&status=ACTIVE`;

  const res = await fetchWithRetry(url, { method: "GET", headers });
  return res.json();
}

/**
 * Check if a product reference exists and get detailed info.
 * Returns composition, description, collection, country of manufacture.
 */
export async function pfsCheckReference(
  reference: string,
): Promise<PfsCheckReferenceResponse> {
  const headers = await getPfsHeaders();
  const url = `${PFS_BASE_URL}/catalog/products/checkReference/${encodeURIComponent(reference)}`;

  const res = await fetchWithRetry(url, { method: "GET", headers });
  return res.json();
}

/**
 * Get correct variant details for a product.
 * Fixes buggy weight/pieces/total from listProducts.
 */
export async function pfsGetVariants(
  productId: string,
): Promise<PfsVariantsResponse> {
  const headers = await getPfsHeaders();
  const url = `${PFS_BASE_URL}/catalog/products/${encodeURIComponent(productId)}/variants`;

  const res = await fetchWithRetry(url, { method: "GET", headers });
  return res.json();
}

/**
 * Count total active products (from first page state).
 */
export async function pfsTotalProducts(): Promise<number> {
  const response = await pfsListProducts(1, 100);
  return response.meta?.total ?? response.state?.active ?? 0;
}

