/**
 * Ankorstore API Write Client
 *
 * Handles mutations (PATCH, POST) on the Ankorstore API.
 * - Stock updates (single variant)
 * - Catalog push (bulk product import/update via operations API)
 */

import { ankorstoreFetch } from "@/lib/ankorstore-api";
import { getAnkorstoreHeaders, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Adaptive polling delays
// 5 fast polls at 3s, then increasing: 5s, 8s, 12s, 18s, 25s, 35s, 45s...
// ─────────────────────────────────────────────
function getPollingDelay(attempt: number): number {
  if (attempt < 5) return 3_000;
  const extra = attempt - 5;
  return Math.min(5_000 * Math.pow(1.5, extra), 45_000);
}

// ─────────────────────────────────────────────
// Variant stock update
// ─────────────────────────────────────────────

/**
 * Update the stock quantity of an Ankorstore product variant.
 * PATCH /product-variants/{id}/stock
 */
export async function ankorstoreUpdateVariantStock(
  variantId: string,
  quantity: number
): Promise<{ success: boolean; error?: string }> {
  const url = `${ANKORSTORE_BASE_URL}/product-variants/${encodeURIComponent(variantId)}/stock`;

  const body = JSON.stringify({
    data: {
      type: "productVariants",
      id: variantId,
      attributes: { stockQuantity: quantity },
    },
  });

  try {
    logger.info("[Ankorstore] Updating variant stock", { variantId, quantity });
    await ankorstoreFetch(url, { method: "PATCH", body });
    logger.info("[Ankorstore] Variant stock updated", { variantId, quantity });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Stock update failed", { variantId, quantity, error: message });
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// Variant price update
// ─────────────────────────────────────────────

/**
 * Update the prices of an Ankorstore product variant.
 * PATCH /product-variants/{id}/prices
 * Both wholesalePrice and retailPrice are required (in cents).
 */
export async function ankorstoreUpdateVariantPrices(
  variantId: string,
  wholesalePrice: number,
  retailPrice: number
): Promise<{ success: boolean; error?: string }> {
  const url = `${ANKORSTORE_BASE_URL}/product-variants/${encodeURIComponent(variantId)}/prices`;

  const body = JSON.stringify({
    data: {
      type: "product-variants",
      id: variantId,
      attributes: { wholesalePrice, retailPrice },
    },
  });

  try {
    logger.info("[Ankorstore] Updating variant prices", { variantId, wholesalePrice, retailPrice });
    await ankorstoreFetch(url, { method: "PATCH", body });
    logger.info("[Ankorstore] Variant prices updated", { variantId, wholesalePrice, retailPrice });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Price update failed", { variantId, wholesalePrice, retailPrice, error: message });
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// Catalog push (bulk import/update)
// ─────────────────────────────────────────────

export interface AnkorstorePushVariant {
  sku: string;
  external_id: string;
  stock_quantity: number;
  wholesalePrice: number;
  retailPrice: number;
  originalWholesalePrice: number;
  unit_multiplier?: number; // 1 for single units, N for packs of N
  options: { name: "color" | "size" | "material" | "style"; value: string }[];
  images?: { order: number; url: string }[];
}

export interface AnkorstorePushProduct {
  external_id: string;
  name: string;
  description: string;
  wholesale_price: number;
  retail_price: number;
  vat_rate: number;
  unit_multiplier?: number; // Units per lot (default 1, e.g. 12 for packs)
  main_image?: string;
  images?: { order: number; url: string }[];
  made_in_country?: string; // ISO Alpha-2 (e.g. "CN", "FR")
  // Dimensions in mm, weight in grams
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
  variants: AnkorstorePushVariant[];
}

export interface AnkorstorePushResult {
  externalProductId: string;
  status: "success" | "failure";
  failureReason?: string;
  issues?: { field: string; reason: string; message: string }[];
}

/**
 * Delete product(s) from Ankorstore via catalog operations.
 * 3 steps: create delete operation → add products → start.
 *
 * @param externalId The product reference (external_id on Ankorstore)
 * @param variantSkus SKUs of variants to delete
 */
export async function ankorstoreDeleteProduct(
  externalId: string,
  variantSkus: string[]
): Promise<{ success: boolean; error?: string }> {
  const headers = await getAnkorstoreHeaders();
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  try {
    logger.info("[Ankorstore] Deleting product", { externalId, variantSkus });

    // Step 1: Create delete operation
    const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          attributes: {
            source: "other",
            operationType: "delete",
            callbackUrl: "https://example.com/ankorstore-callback",
          },
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Create delete operation failed (${createRes.status}): ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id;
    if (!opId) throw new Error("No operation ID returned");

    // Step 2: Add product to delete
    const addRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        products: [{
          id: externalId,
          type: "catalog-integration-product",
          attributes: {
            external_id: externalId,
            ...(variantSkus.length > 0
              ? { variants: variantSkus.map((sku) => ({ sku })) }
              : {}),
          },
        }],
      }),
    });

    if (!addRes.ok) {
      const err = await addRes.text();
      logger.error("[Ankorstore] Add product to delete operation failed", {
        opId, externalId, status: addRes.status, response: err.slice(0, 500),
      });
      throw new Error(`Add product to delete failed (${addRes.status}): ${err.slice(0, 300)}`);
    }

    // Step 3: Start processing
    const startRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } },
      }),
    });

    if (!startRes.ok) {
      const err = await startRes.text();
      throw new Error(`Start delete operation failed (${startRes.status}): ${err.slice(0, 300)}`);
    }

    logger.info("[Ankorstore] Delete operation started, polling for result...", { opId, externalId });

    // Step 4: Poll for completion (adaptive: 5×3s then increasing, max 12 polls)
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, getPollingDelay(i)));

      const checkRes = await fetch(
        `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`,
        { headers }
      );
      const checkData = await checkRes.json();
      const status = checkData.data?.attributes?.status;

      logger.info("[Ankorstore] Delete poll", { opId, poll: i, status });

      if (["succeeded", "completed"].includes(status)) {
        logger.info("[Ankorstore] Delete succeeded", { opId, externalId });
        return { success: true };
      }

      if (["failed", "partially_failed"].includes(status)) {
        // Fetch results for details
        const resultsRes = await fetch(
          `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`,
          { headers }
        );
        const resultsData = await resultsRes.json();
        const failures = (resultsData.data ?? [])
          .filter((r: { attributes?: { status?: string } }) => r.attributes?.status === "failure")
          .map((r: { attributes?: { failureReason?: string; issues?: { field: string; message: string }[] } }) => {
            const issues = r.attributes?.issues?.map((i) => `${i.field}: ${i.message}`).join("; ");
            return issues || r.attributes?.failureReason || "Unknown";
          });

        const errorMsg = failures.length > 0 ? failures.join(" | ") : `Operation ${status}`;
        logger.error("[Ankorstore] Delete failed", { opId, externalId, status, failures });
        return { success: false, error: errorMsg };
      }

      if (status === "skipped") {
        logger.warn("[Ankorstore] Delete operation skipped", { opId });
        return { success: false, error: "Delete operation was skipped by Ankorstore" };
      }
    }

    logger.warn("[Ankorstore] Delete timed out after polling", { opId, externalId });
    return { success: false, error: "Timeout waiting for delete to complete" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Delete failed", { externalId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Push products to Ankorstore via the Catalog Integrations operations API.
 * Creates an operation, adds products, starts processing, and polls for results.
 *
 * @param products Products to push (with variants)
 * @param operationType "import" for new products, "update" for existing
 * @param onProgress Optional progress callback
 * @returns Results per product
 */
export async function ankorstorePushProducts(
  products: AnkorstorePushProduct[],
  operationType: "import" | "update" = "update",
  onProgress?: (status: string, processed: number, total: number) => void
): Promise<{ success: boolean; results: AnkorstorePushResult[]; error?: string }> {
  const headers = await getAnkorstoreHeaders();
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  try {
    // Step 1: Create operation
    logger.info("[Ankorstore] Creating catalog operation", { operationType, productCount: products.length });
    const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          attributes: {
            source: "other",
            operationType,
            callbackUrl: "https://example.com/ankorstore-callback",
          },
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create operation: ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id;
    if (!opId) throw new Error("No operation ID returned");
    logger.info("[Ankorstore] Operation created", { opId });

    // Step 2: Add products in batches of 50
    const batchSize = 50;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const payload = {
        products: batch.map((p) => ({
          id: p.external_id,
          type: "catalog-integration-product",
          attributes: {
            external_id: p.external_id,
            name: p.name,
            description: p.description,
            currency: "EUR",
            vat_rate: p.vat_rate,
            wholesale_price: p.wholesale_price,
            retail_price: p.retail_price,
            unit_multiplier: p.unit_multiplier ?? 1,
            discount_rate: 0,
            ...(p.main_image ? { main_image: p.main_image } : {}),
            ...(p.made_in_country ? { made_in_country: p.made_in_country } : {}),
            ...(p.weight ? { weight: p.weight } : {}),
            ...(p.height ? { height: p.height } : {}),
            ...(p.width ? { width: p.width } : {}),
            ...(p.length ? { length: p.length } : {}),
            ...(p.images?.length ? { images: p.images } : {}),
            variants: p.variants.map((v) => ({
              sku: v.sku,
              external_id: v.external_id,
              stock_quantity: v.stock_quantity,
              is_always_in_stock: false,
              wholesale_price: v.wholesalePrice,
              retail_price: v.retailPrice,
              wholesalePrice: v.wholesalePrice,
              retailPrice: v.retailPrice,
              originalWholesalePrice: v.originalWholesalePrice,
              unit_multiplier: v.unit_multiplier ?? 1,
              discount_rate: 0,
              options: v.options,
              ...(v.images?.length ? { images: v.images } : {}),
            })),
          },
        })),
      };

      const addRes = await fetch(
        `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`,
        { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) }
      );

      if (!addRes.ok) {
        const err = await addRes.text();
        logger.error("[Ankorstore] Add products failed", {
          opId,
          status: addRes.status,
          response: err.slice(0, 500),
          payloadSample: JSON.stringify(payload).slice(0, 500),
        });
        throw new Error(`Failed to add products batch ${i} (HTTP ${addRes.status}): ${err.slice(0, 300)}`);
      }

      const addData = await addRes.json();
      logger.info("[Ankorstore] Products added", {
        batch: `${i + 1}-${i + batch.length}`,
        total: addData.meta?.totalProductsCount,
      });
    }

    // Step 3: Start processing
    const startRes = await fetch(
      `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`,
      {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({
          data: {
            type: "catalog-integration-operation",
            id: opId,
            attributes: { status: "started" },
          },
        }),
      }
    );

    if (!startRes.ok) {
      const err = await startRes.text();
      throw new Error(`Failed to start operation: ${err.slice(0, 300)}`);
    }

    logger.info("[Ankorstore] Operation started", { opId });
    onProgress?.("started", 0, products.length);

    // Step 4: Poll for completion (adaptive: 5×3s then increasing, max 12 polls)
    const maxPolls = 12;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, getPollingDelay(i)));

      const checkRes = await fetch(
        `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`,
        { headers }
      );
      const checkData = await checkRes.json();
      const attrs = checkData.data?.attributes;
      const status = attrs?.status;
      const processed = attrs?.processedProductsCount ?? 0;
      const total = attrs?.totalProductsCount ?? products.length;

      if (i % 3 === 0) {
        logger.info("[Ankorstore] Polling", { opId, poll: i, status, processed, total });
      }

      onProgress?.(status, processed, total);

      if (["succeeded", "completed", "failed", "partially_failed"].includes(status)) {
        // Get results
        const resultsRes = await fetch(
          `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`,
          { headers }
        );
        const resultsData = await resultsRes.json();
        const results: AnkorstorePushResult[] = (resultsData.data ?? []).map(
          (r: { attributes: AnkorstorePushResult }) => r.attributes
        );

        const succeeded = results.filter((r) => r.status === "success").length;
        const failed = results.filter((r) => r.status === "failure").length;

        logger.info("[Ankorstore] Operation completed", { opId, status, succeeded, failed });

        // Log detailed failure info
        for (const r of results) {
          if (r.status === "failure") {
            logger.warn("[Ankorstore] Product failed", {
              opId,
              externalProductId: r.externalProductId,
              failureReason: r.failureReason,
              issues: r.issues,
            });
          }
        }

        return {
          success: status === "succeeded" || status === "completed",
          results,
        };
      }

      if (status === "skipped") {
        logger.warn("[Ankorstore] Operation skipped", { opId });
        return { success: false, results: [], error: "Operation was skipped by Ankorstore" };
      }
    }

    return { success: false, results: [], error: "Timeout waiting for operation to complete" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Push failed", { error: message });
    return { success: false, results: [], error: message };
  }
}
