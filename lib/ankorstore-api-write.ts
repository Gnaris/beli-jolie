/**
 * Ankorstore API Write Client — push (fire-and-forget) + delete.
 *
 * Push and delete operations go through the Catalog Integrations API
 * (create operation → add products → start). We do NOT wait for the callback
 * webhook: start the operation, return the opId, and the admin verifies the
 * result on the Ankorstore dashboard.
 *
 * Reason for fire-and-forget: rebuilding the full callback/webhook machinery
 * would require a publicly-reachable callback URL plus in-memory operation
 * tracking (see commit 14a0ac8 for the removed version). For the refresh flow,
 * kicking off the operation is enough — the admin manually checks Ankorstore.
 */

import { getAnkorstoreHeaders, invalidateAnkorstoreToken, ANKORSTORE_BASE_URL } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";

/**
 * Build a callbackUrl for Ankorstore catalog operations (required field).
 * Uses NEXTAUTH_URL which must be a public HTTPS address in production.
 */
function buildCallbackUrl(): string {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/ankorstore/callback/${crypto.randomUUID()}`;
}

// ─────────────────────────────────────────────
// Push types
// ─────────────────────────────────────────────

export interface AnkorstorePushVariant {
  sku: string;
  external_id: string;
  stock_quantity: number;
  wholesalePrice: number;
  retailPrice: number;
  originalWholesalePrice: number;
  unit_multiplier?: number;
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
  unit_multiplier?: number;
  discount_rate?: number;
  main_image?: string;
  images?: { order: number; url: string }[];
  made_in_country?: string;
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
  variants: AnkorstorePushVariant[];
}

// ─────────────────────────────────────────────
// Delete (existing)
// ─────────────────────────────────────────────

export async function ankorstoreDeleteProduct(
  externalId: string,
  variantSkus: string[],
): Promise<{ success: boolean; opId?: string; error?: string }> {
  const headers = await getAnkorstoreHeaders();
  let jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  try {
    logger.info("[Ankorstore] Deleting product", { externalId, variantSkus });

    const deleteBody = JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: {
          source: "other",
          operationType: "delete",
          callbackUrl: buildCallbackUrl(),
        },
      },
    });

    let createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
      method: "POST",
      headers: jsonHeaders,
      body: deleteBody,
    });

    // 401/403 HTML → token may be stale, retry once
    if ((createRes.status === 401 || createRes.status === 403) && !createRes.headers.get("content-type")?.includes("json")) {
      logger.warn("[Ankorstore] Got " + createRes.status + " on delete operation — refreshing token");
      invalidateAnkorstoreToken();
      const freshHeaders = await getAnkorstoreHeaders();
      jsonHeaders = { ...freshHeaders, "Content-Type": "application/vnd.api+json" };
      createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
        method: "POST",
        headers: jsonHeaders,
        body: deleteBody,
      });
    }

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Create delete operation failed (${createRes.status}): ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id as string;
    if (!opId) throw new Error("No operation ID returned");

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
      throw new Error(`Add product to delete failed (${addRes.status}): ${err.slice(0, 300)}`);
    }

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

    logger.info("[Ankorstore] Delete operation started", { opId, externalId });
    return { success: true, opId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Delete failed", { externalId, error: message });
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// Push (fire-and-forget)
// ─────────────────────────────────────────────

/**
 * Push products to Ankorstore via the Catalog Integrations operations API.
 * 3 steps: create operation → add products → start → return immediately.
 *
 * Fire-and-forget: we do NOT wait for Ankorstore's callback. The admin must
 * verify the result on the Ankorstore dashboard.
 *
 * @param products Products to push (with variants)
 * @param operationType "import" for new products, "update" for existing (upsert by external_id)
 */
export async function ankorstorePushProducts(
  products: AnkorstorePushProduct[],
  operationType: "import" | "update" = "update",
): Promise<{ success: boolean; opId?: string; error?: string }> {
  if (products.length === 0) {
    return { success: false, error: "No products to push" };
  }

  async function buildJsonHeaders(): Promise<Record<string, string>> {
    const h = await getAnkorstoreHeaders();
    return { ...h, "Content-Type": "application/vnd.api+json", "User-Agent": "BeliJolie/1.0" };
  }

  let jsonHeaders = await buildJsonHeaders();

  try {
    const callbackUrl = buildCallbackUrl();
    logger.info("[Ankorstore] Creating catalog operation", {
      operationType,
      productCount: products.length,
      hasCallbackUrl: !!callbackUrl,
      baseUrl: ANKORSTORE_BASE_URL,
    });

    const createBody = JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: {
          source: "other",
          operationType,
          callbackUrl,
        },
      },
    });

    let createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
      method: "POST",
      headers: jsonHeaders,
      body: createBody,
    });

    // 401/403 → invalidate token and retry once
    if ((createRes.status === 401 || createRes.status === 403) && !createRes.headers.get("content-type")?.includes("json")) {
      logger.warn("[Ankorstore] Got " + createRes.status + " on create operation — refreshing token and retrying");
      invalidateAnkorstoreToken();
      jsonHeaders = await buildJsonHeaders();
      createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
        method: "POST",
        headers: jsonHeaders,
        body: createBody,
      });
    }

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create operation (${createRes.status}): ${err.slice(0, 300)}`);
    }

    const opId = (await createRes.json()).data?.id as string;
    if (!opId) throw new Error("No operation ID returned");

    // Add products in batches of 50
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
        { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) },
      );

      if (!addRes.ok) {
        const err = await addRes.text();
        throw new Error(`Failed to add products batch ${i / batchSize + 1} (${addRes.status}): ${err.slice(0, 300)}`);
      }
    }

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
      },
    );

    if (!startRes.ok) {
      const err = await startRes.text();
      throw new Error(`Failed to start operation (${startRes.status}): ${err.slice(0, 300)}`);
    }

    logger.info("[Ankorstore] Push operation started", { opId, operationType, productCount: products.length });
    return { success: true, opId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] Push failed", { error: message });
    return { success: false, error: message };
  }
}
