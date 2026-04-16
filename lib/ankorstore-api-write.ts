/**
 * Ankorstore API Write Client
 *
 * Handles mutations (PATCH, POST) on the Ankorstore API.
 * - Stock updates (single variant)
 * - Catalog push (bulk product import/update via operations API)
 * - Product delete via operations API
 *
 * Push and delete operations use a callback webhook instead of polling:
 * 1. Create operation with callbackUrl → add products → start
 * 2. Return immediately (no blocking)
 * 3. Ankorstore calls /api/ankorstore/callback when done
 */

import { ankorstoreFetch } from "@/lib/ankorstore-api";
import { getAnkorstoreHeaders, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";
import { registerOperation, buildCallbackUrl } from "@/lib/ankorstore-operations";

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
  discount_rate?: number; // Product-level discount (0 to 1, e.g. 0.15 = -15%)
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
 * 3 steps: create delete operation → add products → start → return immediately.
 * Result is processed asynchronously via callback webhook.
 *
 * @param externalId The product reference (external_id on Ankorstore)
 * @param variantSkus SKUs of variants to delete
 * @param productId Local product ID (for callback context)
 */
export async function ankorstoreDeleteProduct(
  externalId: string,
  variantSkus: string[],
  productId?: string,
): Promise<{ success: boolean; opId?: string; error?: string }> {
  const headers = await getAnkorstoreHeaders();
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  try {
    logger.info("[Ankorstore] Deleting product", { externalId, variantSkus });

    // Step 1: Create delete operation
    const tempOpId = crypto.randomUUID();
    const callbackUrl = buildCallbackUrl(tempOpId);

    const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          attributes: {
            source: "other",
            operationType: "delete",
            callbackUrl,
          },
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Create delete operation failed (${createRes.status}): ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id as string;
    if (!opId) throw new Error("No operation ID returned");

    // Register pending operation for callback processing
    registerOperation({
      opId,
      productId: productId || externalId,
      type: "delete",
      hadOptimisticLink: false,
      reference: externalId,
      createdAt: Date.now(),
    });

    // Also register with our temp ID in case Ankorstore uses our callbackUrl as-is
    registerOperation({
      opId: tempOpId,
      productId: productId || externalId,
      type: "delete",
      hadOptimisticLink: false,
      reference: externalId,
      createdAt: Date.now(),
    });

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

    // Return immediately — callback webhook will handle the result
    logger.info("[Ankorstore] Delete operation started, waiting for callback", { opId, externalId });
    return { success: true, opId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Delete failed", { externalId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Push products to Ankorstore via the Catalog Integrations operations API.
 * Creates an operation, adds products, starts processing → returns immediately.
 * Result is processed asynchronously via callback webhook.
 *
 * @param products Products to push (with variants)
 * @param operationType "import" for new products, "update" for existing
 * @param context Context for callback processing
 */
export async function ankorstorePushProducts(
  products: AnkorstorePushProduct[],
  operationType: "import" | "update" = "update",
  context?: { productId: string; hadOptimisticLink: boolean },
): Promise<{ success: boolean; opId?: string; error?: string }> {
  const headers = await getAnkorstoreHeaders();
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  try {
    // Step 1: Create operation
    const tempOpId = crypto.randomUUID();
    const callbackUrl = buildCallbackUrl(tempOpId);

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
            callbackUrl,
          },
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create operation: ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id as string;
    if (!opId) throw new Error("No operation ID returned");
    logger.info("[Ankorstore] Operation created", { opId });

    // Register pending operation for callback processing
    if (context) {
      const reference = products[0]?.external_id || "";
      registerOperation({
        opId,
        productId: context.productId,
        type: operationType,
        hadOptimisticLink: context.hadOptimisticLink,
        reference,
        createdAt: Date.now(),
      });
      registerOperation({
        opId: tempOpId,
        productId: context.productId,
        type: operationType,
        hadOptimisticLink: context.hadOptimisticLink,
        reference,
        createdAt: Date.now(),
      });
    }

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
            discount_rate: p.discount_rate ?? 0,
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

    // Return immediately — callback webhook will handle the result
    logger.info("[Ankorstore] Operation started, waiting for callback", { opId, operationType });
    return { success: true, opId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Push failed", { error: message });
    return { success: false, error: message };
  }
}
