/**
 * PFS (Paris Fashion Shop) Write API Client
 *
 * Provides functions to push data from Beli Jolie → PFS:
 *   - Create/update products
 *   - Create/update/delete variants
 *   - Upload images (WebP → JPEG conversion)
 *   - Update product status
 *
 * All functions use retry with exponential backoff via fetchWithRetry pattern.
 */

import { getPfsHeaders, PFS_BASE_URL, invalidatePfsToken } from "@/lib/pfs-auth";

const PFS_BRAND_ID = "a01AZ00000314QgYAI";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PfsProductCreateData {
  reference: string;
  reference_code: string;
  gender: string;
  gender_label: string;
  brand_name: string;
  family: string;
  category: string;
  season_name: string;
  label: Record<string, string>;
  description: Record<string, string>;
  material_composition: string; // String for POST (array crashes)
  country_of_manufacture: string;
}

export interface PfsProductUpdateData {
  label?: Record<string, string>;
  description?: Record<string, string>;
  category?: string;
  country_of_manufacture?: string;
  season_name?: string;
  material_composition?: { id: string; value: number }[] | string;
  lining_composition?: { id: string; value: number }[];
  default_color?: string;
  brand_name?: string;
  gender_label?: string;
  family?: string;
  reference_code?: string;
}

export interface PfsVariantCreateData {
  type: "ITEM" | "PACK";
  color: string;
  size: string;
  price_eur_ex_vat: number;
  weight: number;
  stock_qty: number;
  is_active?: boolean;
  custom_suffix?: string;
  // PACK specific
  packs?: { color: string; size: string; qty: number }[];
}

export interface PfsVariantUpdateData {
  variant_id: string;
  price_eur_ex_vat?: number;
  stock_qty?: number;
  weight?: number;
  custom_suffix?: string;
  star?: boolean;
  is_active?: boolean;
  discount_type?: "PERCENT" | "AMOUNT" | null;
  discount_value?: number | null;
}

export type PfsStatus = "READY_FOR_SALE" | "DRAFT" | "NEW" | "ARCHIVED" | "DELETED";

// ─────────────────────────────────────────────
// Retry logic (shared with pfs-api.ts pattern)
// ─────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 401 && attempt === 0) {
        invalidatePfsToken();
        const newHeaders = await getPfsHeaders();
        if (options.headers && typeof options.headers === "object") {
          options.headers = { ...options.headers, ...newHeaders } as Record<string, string>;
        }
        continue;
      }

      if (res.ok) return res;

      if (res.status === 404) {
        throw new Error(`PFS API 404: ressource introuvable — ${url}`);
      }

      if (res.status === 429 || res.status >= 500) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Return non-retryable errors as-is (400, 422, etc.)
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error("PFS API: max retries exceeded");
}

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

async function pfsPost(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function pfsPatch(path: string, body: unknown): Promise<{ status: number; data: unknown }> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}${path}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function pfsDelete(path: string): Promise<{ status: number; data: unknown }> {
  const res = await fetchWithRetry(`${PFS_BASE_URL}${path}`, {
    method: "DELETE",
    headers: await getPfsHeaders(),
  });
  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// ─────────────────────────────────────────────
// 1. Create product
// ─────────────────────────────────────────────

export async function pfsCreateProduct(
  product: PfsProductCreateData,
): Promise<{ pfsProductId: string }> {
  const { status, data } = await pfsPost("/catalog/products", {
    data: [product],
  });

  const resp = data as { resume?: { products: number; errors: number }; data?: { id?: string; errors?: Record<string, string[]> }[] };

  if (status !== 200 || !resp.resume || resp.resume.errors > 0) {
    const errorDetail = resp.data?.[0]?.errors
      ? Object.entries(resp.data[0].errors).map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`).join("; ")
      : JSON.stringify(data).slice(0, 300);
    throw new Error(`PFS create product failed: ${errorDetail}`);
  }

  const pfsId = resp.data?.[0]?.id;
  if (!pfsId) throw new Error("PFS create product: no ID returned");

  return { pfsProductId: pfsId };
}

// ─────────────────────────────────────────────
// 2. Update product
// ─────────────────────────────────────────────

export async function pfsUpdateProduct(
  pfsProductId: string,
  updates: PfsProductUpdateData,
): Promise<void> {
  const { status, data } = await pfsPatch(`/catalog/products/${pfsProductId}`, {
    data: updates,
  });

  if (status === 422) {
    const resp = data as { errors?: { message: string; columns: string[] }[] };
    const detail = resp.errors?.map((e) => `${e.columns.join(",")}: ${e.message}`).join("; ") ?? JSON.stringify(data).slice(0, 300);
    throw new Error(`PFS update product validation error: ${detail}`);
  }

  if (status !== 200) {
    throw new Error(`PFS update product failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
}

// ─────────────────────────────────────────────
// 3. Create variants
// ─────────────────────────────────────────────

export async function pfsCreateVariants(
  pfsProductId: string,
  variants: PfsVariantCreateData[],
): Promise<{ variantIds: string[] }> {
  const { status, data } = await pfsPost(
    `/catalog/products/${pfsProductId}/variants`,
    { data: variants },
  );

  const resp = data as { data?: { id: string }[]; resume?: unknown };
  if (status !== 200) {
    throw new Error(`PFS create variants failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const ids = resp.data?.map((v) => v.id).filter(Boolean) ?? [];
  return { variantIds: ids };
}

// ─────────────────────────────────────────────
// 4. Update variants (batch)
// ─────────────────────────────────────────────

export async function pfsPatchVariants(
  updates: PfsVariantUpdateData[],
): Promise<{ updated: number }> {
  const { status, data } = await pfsPatch("/catalog/products/variants", {
    data: updates,
  });

  if (status !== 200) {
    throw new Error(`PFS patch variants failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const resp = data as { data?: { resume?: { product_items?: { updated: number } } } };
  return { updated: resp.data?.resume?.product_items?.updated ?? 0 };
}

// ─────────────────────────────────────────────
// 5. Delete variant
// ─────────────────────────────────────────────

export async function pfsDeleteVariant(pfsVariantId: string): Promise<void> {
  const { status, data } = await pfsDelete(`/catalog/products/variants/${pfsVariantId}`);

  if (status !== 200) {
    throw new Error(`PFS delete variant failed (${status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
}

// ─────────────────────────────────────────────
// 6. Upload image (multipart/form-data)
// ─────────────────────────────────────────────

export async function pfsUploadImage(
  pfsProductId: string,
  imageBuffer: Buffer,
  slot: number,
  colorRef: string,
  filename = "image.jpg",
): Promise<{ imagePath: string }> {
  const headers = await getPfsHeaders();

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" });
  formData.append("image", blob, filename);
  formData.append("slot", String(slot));
  formData.append("color", colorRef);

  // Don't set Content-Type — let fetch set multipart boundary
  const res = await fetchWithRetry(`${PFS_BASE_URL}/catalog/products/${pfsProductId}/image`, {
    method: "POST",
    headers: {
      Authorization: headers.Authorization,
      Accept: headers.Accept,
      "User-Agent": headers["User-Agent"],
    },
    body: formData,
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`PFS upload image failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const resp = data as { image_path?: string; success?: boolean };
  return { imagePath: resp.image_path ?? "" };
}

// ─────────────────────────────────────────────
// 7. Update product status (batch)
// ─────────────────────────────────────────────

export async function pfsUpdateStatus(
  products: { id: string; status: PfsStatus }[],
): Promise<void> {
  const { status, data } = await pfsPatch("/catalog/products/batch/updateStatus", {
    data: products,
  });

  if (status !== 200) {
    const resp = data as { errors?: { id: string; message: string; issues?: Record<string, string> }[] };
    const detail = resp.errors?.map((e) => `${e.id}: ${e.message}`).join("; ") ?? JSON.stringify(data).slice(0, 300);
    throw new Error(`PFS update status failed: ${detail}`);
  }
}

// ─────────────────────────────────────────────
// 8. Fetch attribute lists (for mapping UI)
// ─────────────────────────────────────────────

export interface PfsAttributeColor {
  reference: string;
  value: string; // hex
  image: string | null;
  labels: Record<string, string>;
}

export interface PfsAttributeCategory {
  id: string;
  family: { id: string };
  labels: Record<string, string>;
  gender: string;
}

export interface PfsAttributeComposition {
  id: string;
  reference: string;
  labels: Record<string, string>;
}

export interface PfsAttributeCountry {
  reference: string; // ISO code (FR, CN, TR...)
  labels: Record<string, string>;
  preview: string | null; // flag SVG URL
}

export interface PfsAttributeCollection {
  id: string;
  reference: string; // PE2026, AH2025...
  labels: Record<string, string>;
}

export async function pfsGetColors(): Promise<PfsAttributeColor[]> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}/catalog/attributes/colors`, {
    method: "GET",
    headers,
  });
  const data = (await res.json()) as { data: PfsAttributeColor[] };
  return data.data ?? [];
}

export async function pfsGetCategories(): Promise<PfsAttributeCategory[]> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}/catalog/attributes/categories`, {
    method: "GET",
    headers,
  });
  const data = (await res.json()) as { data: PfsAttributeCategory[] };
  return data.data ?? [];
}

export async function pfsGetCompositions(): Promise<PfsAttributeComposition[]> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}/catalog/attributes/compositions`, {
    method: "GET",
    headers,
  });
  const data = (await res.json()) as { data: PfsAttributeComposition[] };
  return data.data ?? [];
}

export async function pfsGetCountries(): Promise<PfsAttributeCountry[]> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}/catalog/attributes/countries`, {
    method: "GET",
    headers,
  });
  const data = (await res.json()) as { data: PfsAttributeCountry[] };
  return data.data ?? [];
}

export async function pfsGetCollections(): Promise<PfsAttributeCollection[]> {
  const headers = await getPfsHeaders();
  const res = await fetchWithRetry(`${PFS_BASE_URL}/catalog/attributes/collections`, {
    method: "GET",
    headers,
  });
  const data = (await res.json()) as { data: PfsAttributeCollection[] };
  return data.data ?? [];
}

// ─────────────────────────────────────────────
// AI Translations
// ─────────────────────────────────────────────

/**
 * Call PFS AI translation endpoint.
 * Returns translated labels for productName and productDescription
 * in fr, en, de, es, it.
 */
export async function pfsTranslate(
  productName: string,
  productDescription: string,
  sourceLanguage = "fr",
): Promise<{
  productName: Record<string, string>;
  productDescription: Record<string, string>;
}> {
  const { status, data } = await pfsPost("/ai/translations", {
    phrases: { productName, productDescription },
    productName,
    productDescription,
    source_language: sourceLanguage,
  });

  if (status !== 200) {
    console.warn(`[PFS] Translation API returned ${status}:`, data);
    // Fallback: return FR only
    return {
      productName: { fr: productName },
      productDescription: { fr: productDescription },
    };
  }

  return data as {
    productName: Record<string, string>;
    productDescription: Record<string, string>;
  };
}

export { PFS_BRAND_ID };
