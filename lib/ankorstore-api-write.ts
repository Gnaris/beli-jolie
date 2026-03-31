import { akFetch } from "@/lib/ankorstore-auth";
import { logger } from "@/lib/logger";
import type { AkVariant } from "@/lib/ankorstore-api";

/**
 * Update variant stock on Ankorstore.
 * Note: Cannot set stockQuantity when isAlwaysInStock=true.
 */
export async function akUpdateStock(
  variantId: string,
  opts: { isAlwaysInStock?: boolean; stockQuantity?: number },
): Promise<AkVariant> {
  const attributes: Record<string, unknown> = {};
  if (opts.isAlwaysInStock !== undefined) attributes.isAlwaysInStock = opts.isAlwaysInStock;
  if (opts.stockQuantity !== undefined) attributes.stockQuantity = opts.stockQuantity;

  const res = await akFetch(`/product-variants/${variantId}/stock`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "product-variant-stock",
        attributes,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Ankorstore] Stock update failed", { variantId, status: res.status, body: text });
    throw new Error(`akUpdateStock failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const attrs = json.data.attributes;
  return {
    id: json.data.id,
    name: attrs.name,
    sku: attrs.sku,
    wholesalePrice: attrs.wholesalePrice,
    retailPrice: attrs.retailPrice,
    isAlwaysInStock: attrs.isAlwaysInStock,
    stockQuantity: attrs.stockQuantity,
    availableQuantity: attrs.availableQuantity,
    images: attrs.images || [],
    createdAt: attrs.createdAt,
    updatedAt: attrs.updatedAt,
  };
}

/**
 * Update variant wholesale & retail prices on Ankorstore.
 * Prices in centimes.
 */
export async function akUpdatePrices(
  variantId: string,
  opts: { wholesalePrice: number; retailPrice: number },
): Promise<AkVariant> {
  const res = await akFetch(`/product-variants/${variantId}/prices`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "product-variant-price",
        attributes: {
          wholesalePrice: opts.wholesalePrice,
          retailPrice: opts.retailPrice,
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("[Ankorstore] Price update failed", { variantId, status: res.status, body: text });
    throw new Error(`akUpdatePrices failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  const attrs = json.data.attributes;
  return {
    id: json.data.id,
    name: attrs.name,
    sku: attrs.sku,
    wholesalePrice: attrs.wholesalePrice,
    retailPrice: attrs.retailPrice,
    isAlwaysInStock: attrs.isAlwaysInStock,
    stockQuantity: attrs.stockQuantity,
    availableQuantity: attrs.availableQuantity,
    images: attrs.images || [],
    createdAt: attrs.createdAt,
    updatedAt: attrs.updatedAt,
  };
}
