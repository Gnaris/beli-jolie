/**
 * Ankorstore API Client (write operations)
 *
 * Covers:
 *   - Catalog Integration operations (create, add products, start, poll)
 *   - Variant stock/price patches (single + batch atomic)
 *   - Product delete with retry on "Could not archive SKUs"
 */

import {
  getAnkorstoreHeaders,
  invalidateAnkorstoreToken,
  ANKORSTORE_BASE_URL,
} from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

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
    options: { name: "color" | "size" | "material" | "style"; value: string }[];
  }[];
  shapeProperties?: { weight: { unitCode: "GRM"; amount: number } };
}

export interface AnkorstoreOperationResult {
  externalProductId: string;
  ankorstoreProductId: string | null;
  status: "success" | "failure";
  failureReason: string | null;
  issues: unknown[];
}

export interface AnkorstoreOperationPollResult {
  status: "succeeded" | "partially_failed" | "failed";
  results: AnkorstoreOperationResult[];
}

// ─────────────────────────────────────────────
// Internal fetch helper (mirrors ankorstore-api.ts)
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
      // Some write endpoints return empty body (204)
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
// Catalog Integration operations
// ─────────────────────────────────────────────

/** Create a catalog integration operation (import / update / delete). */
export async function ankorstoreCreateCatalogOperation(
  type: "import" | "update" | "delete"
): Promise<{ operationId: string }> {
  const resp = await ankorstoreFetchJson<{ data: { id: string } }>(
    `/catalog/integrations/operations`,
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          attributes: { type, source: "other" },
        },
      }),
    }
  );
  return { operationId: resp.data.id };
}

/** Add products to an existing catalog integration operation. */
export async function ankorstoreAddProductsToOperation(
  operationId: string,
  products: AnkorstoreCatalogProductInput[]
): Promise<void> {
  const data = products.map((p) => ({
    id: p.externalId,
    type: "catalog-integration-product",
    attributes: {
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
              weight: {
                unit_code: p.shapeProperties.weight.unitCode,
                amount: p.shapeProperties.weight.amount,
              },
            },
          }
        : {}),
      variants: p.variants.map((v) => ({
        sku: v.sku,
        ...(v.ian != null ? { ian: v.ian } : {}),
        stock_quantity: v.stockQuantity,
        is_always_in_stock: v.isAlwaysInStock,
        options: v.options,
      })),
    },
  }));

  await ankorstoreFetchJson<unknown>(
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}/products`,
    {
      method: "POST",
      body: JSON.stringify({ data }),
    }
  );
}

/** Start (trigger) a catalog integration operation. */
export async function ankorstoreStartOperation(operationId: string): Promise<void> {
  await ankorstoreFetchJson<unknown>(
    `/catalog/integrations/operations/${encodeURIComponent(operationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          id: operationId,
        },
      }),
    }
  );
}

/** Poll an operation until it completes (succeeded / partially_failed / failed). */
export async function ankorstorePollOperation(
  operationId: string,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<AnkorstoreOperationPollResult> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const resp = await ankorstoreFetchJson<{
      data: {
        attributes: {
          status: string;
          externalProductId?: string;
          ankorstoreProductId?: string | null;
          failureReason?: string | null;
          issues?: unknown[];
        };
      }[];
    }>(
      `/catalog/integrations/operations/${encodeURIComponent(operationId)}/results`
    );

    // Infer overall status from individual results
    const items = resp.data ?? [];
    const statuses = items.map((i) => i.attributes.status);

    const terminalStatuses = ["succeeded", "partially_failed", "failed"];
    const overallStatus = statuses.find((s) => terminalStatuses.includes(s));

    if (overallStatus && terminalStatuses.includes(overallStatus)) {
      const results: AnkorstoreOperationResult[] = items.map((i) => ({
        externalProductId: i.attributes.externalProductId ?? "",
        ankorstoreProductId: i.attributes.ankorstoreProductId ?? null,
        status: i.attributes.status === "success" ? "success" : "failure",
        failureReason: i.attributes.failureReason ?? null,
        issues: i.attributes.issues ?? [],
      }));
      return {
        status: overallStatus as AnkorstoreOperationPollResult["status"],
        results,
      };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `[Ankorstore] Operation ${operationId} did not complete within ${timeoutMs}ms`
  );
}

// ─────────────────────────────────────────────
// Variant patches (single)
// ─────────────────────────────────────────────

/** Patch stock of a single variant. */
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

/** Batch update variant attributes via JSON:API atomic operations. Splits into chunks of 50 automatically. */
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

// ─────────────────────────────────────────────
// Delete product with retry
// ─────────────────────────────────────────────

/**
 * Delete a product on Ankorstore via a catalog integration delete operation.
 * Retries up to 4 times (0s / 1s / 4s / 16s backoff) when the failure reason
 * contains "Could not archive SKUs" — a transient Ankorstore issue.
 */
export async function ankorstoreDeleteProduct(
  ankorsProductIdOrExternalId: string
): Promise<void> {
  const delays = [0, 1000, 4000, 16000];
  let lastErr: unknown = null;

  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }

    try {
      const { operationId } = await ankorstoreCreateCatalogOperation("delete");
      await ankorstoreAddProductsToOperation(operationId, [
        {
          externalId: ankorsProductIdOrExternalId,
          name: "",
          description: "",
          currency: "EUR",
          vatRate: 0,
          unitMultiplier: 1,
          wholesalePrice: 0,
          retailPrice: 0,
          countryCode: "FR",
          variants: [],
        } as AnkorstoreCatalogProductInput,
      ]);
      await ankorstoreStartOperation(operationId);
      const result = await ankorstorePollOperation(operationId);

      if (result.status === "succeeded") return;

      if (result.status === "partially_failed") {
        const archiveSkuFail = result.results.find((r) =>
          r.failureReason?.includes("Could not archive SKUs")
        );
        if (archiveSkuFail) {
          lastErr = new Error(
            `[Ankorstore Delete] Could not archive SKUs: ${JSON.stringify(archiveSkuFail.issues)}`
          );
          logger.warn("[Ankorstore] Delete attempt failed (archive SKUs), retrying", {
            attempt: i + 1,
            productId: ankorsProductIdOrExternalId,
          });
          continue;
        }
      }

      throw new Error(
        `[Ankorstore Delete] Operation finished with status ${result.status}`
      );
    } catch (err) {
      // Only continue on the retriable archive-SKU case (already handled above via continue)
      // For any other error, capture and propagate after last attempt
      lastErr = err;
      if (i < delays.length - 1) continue;
    }
  }

  logger.error("[Ankorstore] Delete failed after retries", {
    productId: ankorsProductIdOrExternalId,
    error: lastErr,
  });

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
