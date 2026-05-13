/**
 * Ankorstore API Client (write operations) — MODE CALLBACK-ONLY
 *
 * Wraps the catalog-integration write workflow. Every async operation kicks off
 * the work on Ankorstore and returns the operationId — the result is delivered
 * later via a webhook callback to `/api/webhooks/ankorstore`.
 *
 * No polling, no waiting for terminal status here. Finalization (looking up
 * `ankorstoreProductId`, mapping variants, saving snapshot) happens in
 * `lib/ankorstore-finalize.ts` driven by the webhook handler.
 *
 * The only synchronous calls left are the direct variant patches
 * (`/product-variants/{id}/stock` and `/prices`), which are not catalog
 * operations — their HTTP response IS the result.
 *
 * Validated against the real API on 2026-05-11. See docs/ankorstore-api.md.
 */

import {
  getAnkorstoreHeaders,
  invalidateAnkorstoreToken,
  ANKORSTORE_BASE_URL,
} from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Callback URL builder
// ─────────────────────────────────────────────

/**
 * Build the public webhook URL we send to Ankorstore as `callbackUrl`.
 *
 * The secret query parameter is the only auth Ankorstore has when calling us
 * back — without it, anyone could POST fake operation results to our webhook.
 *
 * In dev (localhost), Ankorstore can't reach this URL, so callbacks never fire.
 * All Ankorstore testing must happen against the production host.
 */
export function buildAnkorstoreCallbackUrl(): string {
  const base = (process.env.NEXTAUTH_URL ?? "https://beliandjolie.com").replace(/\/$/, "");
  const secret = process.env.ANKORSTORE_WEBHOOK_SECRET ?? "";
  return `${base}/api/webhooks/ankorstore?secret=${encodeURIComponent(secret)}`;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AnkorstoreCatalogProductInput {
  externalId: string;
  name: string;
  description: string;
  mainImage?: string;
  images?: { order: number; url: string }[];
  currency: "EUR";
  vatRate: number;
  unitMultiplier: number;
  wholesalePrice: number; // EUR (not cents)
  retailPrice: number;    // EUR
  countryCode: string;    // ISO
  tags?: string[];
  variants: {
    sku: string;
    ian?: string | null;
    stockQuantity: number;
    isAlwaysInStock: boolean;
    wholesalePrice: number;          // EUR — required per variant
    retailPrice: number;             // EUR — required per variant
    originalWholesalePrice: number;  // EUR — required per variant (not documented in spec)
    options: { name: "color" | "size" | "material" | "style"; value: string }[];
    images?: { order: number; url: string }[];
  }[];
  shapeProperties?: {
    /**
     * Poids du produit. `unit_code` n'est PAS envoyé : Ankorstore applique
     * "kg" par défaut côté plateforme, et le préciser produit un affichage
     * dupliqué de l'unité dans leur backoffice.
     */
    weight?: { amount: number };
    /**
     * Dimensions du produit. `unit_code: "cm"` reste explicite (la valeur
     * par défaut côté Ankorstore n'est pas documentée).
     */
    dimensions?: {
      unitCode: "cm";
      width?: number;
      height?: number;
      length?: number;
    };
  };
}

// ─────────────────────────────────────────────
// Internal fetch helper
// ─────────────────────────────────────────────

/** Non-retryable error (4xx except 429) */
class AnkorstoreNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkorstoreNonRetryableError";
  }
}

async function ankorstoreFetchJson<T>(
  path: string,
  init?: RequestInit,
  attempt = 0
): Promise<T> {
  const headers = await getAnkorstoreHeaders();
  const url = `${ANKORSTORE_BASE_URL}${path}`;

  const makeRequest = async (currentAttempt: number): Promise<T> => {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    // 401 — token expired, invalidate and retry once
    if (res.status === 401 && currentAttempt === 0) {
      invalidateAnkorstoreToken();
      const freshHeaders = await getAnkorstoreHeaders();
      logger.warn("[Ankorstore] Retry", { status: 401, attempt: 1, path });
      const retryRes = await fetch(url, {
        ...init,
        headers: {
          ...(init?.body !== undefined ? { "Content-Type": "application/vnd.api+json" } : {}),
          ...freshHeaders,
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
      if (!retryRes.ok) {
        const text = await retryRes.text().catch(() => "");
        throw new AnkorstoreNonRetryableError(
          `Ankorstore API ${retryRes.status}: ${text.slice(0, 200)}`
        );
      }
      if (retryRes.status === 204) return undefined as unknown as T;
      return retryRes.json() as Promise<T>;
    }

    if (res.ok) {
      if (res.status === 204) return undefined as unknown as T;
      const text = await res.text();
      if (!text) return undefined as unknown as T;
      return JSON.parse(text) as T;
    }

    // 429 — rate limited
    if (res.status === 429) {
      const maxRetries = 3;
      if (currentAttempt >= maxRetries) {
        throw new AnkorstoreNonRetryableError(
          `Ankorstore API 429: rate limit exceeded after ${maxRetries} attempts`
        );
      }
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? "5");
      const delayMs = (isNaN(retryAfterSec) ? 5 : retryAfterSec) * 1000;
      logger.warn("[Ankorstore] Retry", { status: 429, attempt: currentAttempt + 1, path });
      await new Promise((r) => setTimeout(r, delayMs));
      return makeRequest(currentAttempt + 1);
    }

    // 5xx — exponential backoff: 1s, 4s, 16s
    if (res.status >= 500) {
      const maxRetries = 3;
      if (currentAttempt >= maxRetries) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Ankorstore API ${res.status} after ${maxRetries} retries: ${text.slice(0, 200)}`
        );
      }
      const delayMs = Math.pow(4, currentAttempt) * 1000;
      logger.warn("[Ankorstore] Retry", { status: res.status, attempt: currentAttempt + 1, path });
      await new Promise((r) => setTimeout(r, delayMs));
      return makeRequest(currentAttempt + 1);
    }

    // Other 4xx — never retry
    const text = await res.text().catch(() => "");
    throw new AnkorstoreNonRetryableError(
      `Ankorstore API ${res.status}: ${text.slice(0, 200)}`
    );
  };

  return makeRequest(attempt);
}

// ─────────────────────────────────────────────
// Payload builders (snake_case for the products array)
// ─────────────────────────────────────────────

function buildProductPayloadAttributes(p: AnkorstoreCatalogProductInput): Record<string, unknown> {
  return {
    external_id: p.externalId,
    name: p.name,
    description: p.description,
    ...(p.mainImage ? { main_image: p.mainImage } : {}),
    ...(p.images ? { images: p.images } : {}),
    currency: p.currency,
    vat_rate: p.vatRate,
    unit_multiplier: p.unitMultiplier,
    wholesale_price: p.wholesalePrice,
    retail_price: p.retailPrice,
    made_in_country: p.countryCode,
    ...(p.tags ? { tags: p.tags } : {}),
    ...(p.shapeProperties
      ? {
          shape_properties: {
            ...(p.shapeProperties.weight
              ? { weight: { amount: p.shapeProperties.weight.amount } }
              : {}),
            ...(p.shapeProperties.dimensions
              ? {
                  dimensions: {
                    unit_code: p.shapeProperties.dimensions.unitCode,
                    ...(p.shapeProperties.dimensions.width != null
                      ? { width: p.shapeProperties.dimensions.width }
                      : {}),
                    ...(p.shapeProperties.dimensions.height != null
                      ? { height: p.shapeProperties.dimensions.height }
                      : {}),
                    ...(p.shapeProperties.dimensions.length != null
                      ? { length: p.shapeProperties.dimensions.length }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    variants: p.variants.map((v) => ({
      sku: v.sku,
      ...(v.ian != null ? { ian: v.ian } : {}),
      stock_quantity: v.stockQuantity,
      is_always_in_stock: v.isAlwaysInStock,
      wholesale_price: v.wholesalePrice,
      retail_price: v.retailPrice,
      original_wholesale_price: v.originalWholesalePrice,
      options: v.options,
      ...(v.images ? { images: v.images } : {}),
    })),
  };
}

// ─────────────────────────────────────────────
// Catalog Integration kickoff — create / import / update
// ─────────────────────────────────────────────

/**
 * Create a catalog-integration operation (`import` or `update`).
 *
 * The created operation is in status `created` — it must be moved to `started`
 * via {@link ankorstoreStartOperation} after products are added.
 *
 * `delete` uses a different endpoint — see {@link ankorstoreKickoffDelete}.
 */
export async function ankorstoreCreateCatalogOperation(
  type: "import" | "update"
): Promise<{ operationId: string }> {
  const resp = await ankorstoreFetchJson<{ data: { id: string } }>(
    `/catalog/integrations/operations`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          attributes: {
            operationType: type,
            source: "other",
            callbackUrl: buildAnkorstoreCallbackUrl(),
          },
        },
      }),
    }
  );
  return { operationId: resp.data.id };
}

/**
 * Add products to a catalog-integration operation.
 *
 * Wrapper is `{ products: [...] }` (NOT `{ data: [...] }` — silently ignored).
 * Attributes inside the products array are snake_case.
 */
export async function ankorstoreAddProductsToOperation(
  operationId: string,
  products: AnkorstoreCatalogProductInput[]
): Promise<{ totalProductsCount: number }> {
  const payloadProducts = products.map((p) => ({
    id: p.externalId,
    type: "catalog-integration-product",
    attributes: buildProductPayloadAttributes(p),
  }));

  const resp = await ankorstoreFetchJson<{ meta?: { totalProductsCount?: number } }>(
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}/products`,
    {
      method: "POST",
      body: JSON.stringify({ products: payloadProducts }),
    }
  );

  const totalProductsCount = resp?.meta?.totalProductsCount ?? 0;
  if (totalProductsCount !== products.length) {
    logger.warn("[Ankorstore] addProducts mismatch", {
      operationId,
      sent: products.length,
      acknowledged: totalProductsCount,
    });
  }
  return { totalProductsCount };
}

/**
 * Start (trigger) a catalog-integration operation. Required after adding
 * products to a `created` operation.
 */
export async function ankorstoreStartOperation(operationId: string): Promise<void> {
  await ankorstoreFetchJson<unknown>(
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          id: operationId,
          attributes: { status: "started" },
        },
      }),
    }
  );
}

/**
 * Kick off a deletion operation via the dedicated endpoint. Returns the
 * operationId — the result arrives via webhook.
 *
 * The variant SKU list is REQUIRED (empty list = silent no-op).
 */
export async function ankorstoreKickoffDelete(
  externalId: string,
  variantSkus: string[]
): Promise<{ operationId: string }> {
  if (!externalId) {
    throw new Error("[Ankorstore Delete] externalId is required");
  }
  if (!variantSkus || variantSkus.length === 0) {
    throw new Error(
      "[Ankorstore Delete] At least one SKU is required — empty variant list is a silent no-op"
    );
  }

  const resp = await ankorstoreFetchJson<{ data: { id: string } }>(
    `/catalog/integrations/operations/delete`,
    {
      method: "POST",
      body: JSON.stringify({
        source: "other",
        callbackUrl: buildAnkorstoreCallbackUrl(),
        products: [
          {
            type: "catalog-integration-product",
            attributes: {
              external_id: externalId,
              variants: variantSkus.map((sku) => ({ sku })),
            },
          },
        ],
      }),
    }
  );

  return { operationId: resp.data.id };
}

// ─────────────────────────────────────────────
// Webhook-side helpers (called from /api/webhooks/ankorstore)
// ─────────────────────────────────────────────

/**
 * Resolve the `ankorstoreProductId` of a freshly created product by querying
 * a known SKU. The catalog-integration callback does NOT carry it, and
 * indexing can lag a few seconds → retry with backoff.
 */
export async function ankorstoreLookupProductIdBySku(
  sku: string,
  opts?: { maxAttempts?: number; initialDelayMs?: number; pollDelayMs?: number }
): Promise<string | null> {
  const maxAttempts = opts?.maxAttempts ?? 6;
  const initialDelayMs = opts?.initialDelayMs ?? 3_000;
  const pollDelayMs = opts?.pollDelayMs ?? 5_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? initialDelayMs : pollDelayMs));

    const resp = await ankorstoreFetchJson<{
      data: {
        id: string;
        relationships?: { product?: { data?: { id?: string } } };
      }[];
    }>(`/product-variants?filter[sku]=${encodeURIComponent(sku)}&include=product&page[limit]=1`);

    const productId = resp.data?.[0]?.relationships?.product?.data?.id;
    if (productId) return productId;
  }

  return null;
}

/**
 * Read the per-product results of a completed operation. Used by the webhook
 * handler when the callback's `data.attributes.status` is terminal but we
 * need the issues / failureReason details for each product.
 */
export async function ankorstoreFetchOperationResults(operationId: string): Promise<
  {
    externalProductId: string;
    status: "success" | "failure";
    failureReason: string | null;
    issues: unknown[];
  }[]
> {
  const resp = await ankorstoreFetchJson<{
    data: {
      attributes: {
        externalProductId?: string;
        status: string;
        failureReason?: string | null;
        issues?: unknown[];
      };
    }[];
  }>(`/catalog/integrations/operations/${encodeURIComponent(operationId)}/results`);

  return (resp.data ?? []).map((i) => ({
    externalProductId: i.attributes.externalProductId ?? "",
    status: i.attributes.status === "success" ? "success" : "failure",
    failureReason: i.attributes.failureReason ?? null,
    issues: i.attributes.issues ?? [],
  }));
}

// ─────────────────────────────────────────────
// Variant patches (single — direct, no operation)
// ─────────────────────────────────────────────

/** Patch stock of a single variant. Synchronous: HTTP response is the result. */
export async function ankorstorePatchVariantStock(
  variantId: string,
  body: { stockQuantity?: number; isAlwaysInStock?: boolean }
): Promise<void> {
  await ankorstoreFetchJson<unknown>(
    `/product-variants/${encodeURIComponent(variantId)}/stock`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "product-variants",
          id: variantId,
          attributes: body,
        },
      }),
    }
  );
}

/** Patch wholesale + retail prices of a single variant (both required, in cents). */
export async function ankorstorePatchVariantPrices(
  variantId: string,
  body: { wholesalePriceCents: number; retailPriceCents: number }
): Promise<void> {
  await ankorstoreFetchJson<unknown>(
    `/product-variants/${encodeURIComponent(variantId)}/prices`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "product-variants",
          id: variantId,
          attributes: {
            wholesalePrice: body.wholesalePriceCents,
            retailPrice: body.retailPriceCents,
          },
        },
      }),
    }
  );
}

// ─────────────────────────────────────────────
// Batch variant update (atomic operations, max 50)
// ─────────────────────────────────────────────

const BATCH_SIZE = 50;

/** Batch update variant attributes via JSON:API atomic operations. */
export async function ankorstoreBatchUpdateVariants(
  updates: { variantId: string; attributes: Record<string, unknown> }[]
): Promise<void> {
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const atomicOps = chunk.map(({ variantId, attributes }) => ({
      op: "update",
      data: {
        type: "product-variants",
        id: variantId,
        attributes,
      },
    }));

    await ankorstoreFetchJson<unknown>(`/operations`, {
      method: "POST",
      body: JSON.stringify({ "atomic:operations": atomicOps }),
    });
  }
}
