/**
 * Ankorstore Refresh — push a product back to Ankorstore (fire-and-forget).
 *
 * Flow:
 * 1. Load product from DB (shared loader with Excel export)
 * 2. Check product exists on Ankorstore via reference search
 * 3. If not found → return { reason: "not_found" }
 * 4. Build push payload (same markups as Excel export)
 * 5. Fire ankorstorePushProducts with operationType "update" (upsert by external_id)
 * 6. Return success immediately — the admin verifies the result on the Ankorstore
 *    dashboard (IMPORTANT: Ankorstore does NOT call back — we don't know if it
 *    succeeded server-side).
 */

import { ankorstoreSearchProductsByRef } from "@/lib/ankorstore-api";
import {
  ankorstorePushProducts,
  type AnkorstorePushProduct,
  type AnkorstorePushVariant,
} from "@/lib/ankorstore-api-write";
import { loadExportContext, loadExportProducts } from "@/lib/marketplace-excel/load-products";
import { applyMarketplaceMarkup } from "@/lib/marketplace-pricing";
import type { ExportContext, ExportProduct, ExportVariant } from "@/lib/marketplace-excel/types";
import { logger } from "@/lib/logger";

export type AnkorstoreRefreshResult =
  | { success: true; opId?: string; warning: string }
  | { success: false; reason: "not_found"; error: string }
  | { success: false; reason: "error"; error: string };

const VERIFY_WARNING =
  "Opération envoyée à Ankorstore. Vérifiez toujours le résultat sur le tableau de bord Ankorstore — nous ne recevons pas de confirmation.";

function wholesaleHT(v: ExportVariant, ctx: ExportContext): number {
  let base = v.unitPrice;
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    base = v.unitPrice / v.packQuantity;
  }
  return applyMarketplaceMarkup(base, ctx.markups.ankorstoreWholesale);
}

function retailTTC(v: ExportVariant, ctx: ExportContext): number {
  const whHT = wholesaleHT(v, ctx);
  const retailHT = applyMarketplaceMarkup(whHT, ctx.markups.ankorstoreRetail);
  const ttc = retailHT * (1 + ctx.ankorstoreVatRate / 100);
  return Math.round(ttc * 100) / 100;
}

function variantColorLabel(v: ExportVariant): string {
  return [...v.colorNames, ...v.subColorNames].join(" / ");
}

function variantSizeLabel(v: ExportVariant): string {
  if (v.sizes.length === 0) return "";
  return v.sizes.map((s) => (s.quantity > 1 ? `${s.quantity}*${s.name}` : s.name)).join(", ");
}

function variantImageUrls(v: ExportVariant, ctx: ExportContext): string[] {
  const base = ctx.publicBaseUrl;
  return v.imagePaths.map((p) => {
    const clean = p.startsWith("/") ? p.slice(1) : p;
    return base ? `${base}/${clean}` : `/${clean}`;
  });
}

function variantSku(p: ExportProduct, v: ExportVariant, idx: number): string {
  if (v.sku) return v.sku;
  const color = variantColorLabel(v).replace(/\s+/g, "_") || "NA";
  return `${p.reference}_${color}_${v.saleType}_${idx + 1}`;
}

function buildPushProduct(p: ExportProduct, ctx: ExportContext): AnkorstorePushProduct | null {
  if (p.variants.length === 0) return null;

  const productGallery: { order: number; url: string }[] = [];
  const seen = new Set<string>();
  for (const v of p.variants) {
    for (const url of variantImageUrls(v, ctx)) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      productGallery.push({ order: productGallery.length, url });
      if (productGallery.length === 10) break;
    }
    if (productGallery.length === 10) break;
  }

  const firstVariant = p.variants[0];
  const productWholesale = wholesaleHT(firstVariant, ctx);
  const productRetail = retailTTC(firstVariant, ctx);

  const pushVariants: AnkorstorePushVariant[] = p.variants.map((v, idx) => {
    const options: AnkorstorePushVariant["options"] = [];
    const colorLabel = variantColorLabel(v);
    if (colorLabel) options.push({ name: "color", value: colorLabel });
    const sizeLabel = variantSizeLabel(v);
    if (sizeLabel) options.push({ name: "size", value: sizeLabel });

    const wh = wholesaleHT(v, ctx);
    const rt = retailTTC(v, ctx);
    const variantImages = variantImageUrls(v, ctx)
      .slice(0, 1)
      .map((url, i) => ({ order: i, url }));

    return {
      sku: variantSku(p, v, idx),
      external_id: variantSku(p, v, idx),
      stock_quantity: v.stock,
      wholesalePrice: Number(wh.toFixed(2)),
      retailPrice: Number(rt.toFixed(2)),
      originalWholesalePrice: Number(wh.toFixed(2)),
      unit_multiplier: v.saleType === "PACK" && v.packQuantity ? v.packQuantity : 1,
      options,
      ...(variantImages.length > 0 ? { images: variantImages } : {}),
    };
  });

  return {
    external_id: p.reference,
    name: p.name || p.reference,
    description: p.description,
    wholesale_price: Number(productWholesale.toFixed(2)),
    retail_price: Number(productRetail.toFixed(2)),
    vat_rate: ctx.ankorstoreVatRate,
    unit_multiplier: 1,
    discount_rate: 0,
    ...(productGallery[0] ? { main_image: productGallery[0].url } : {}),
    ...(productGallery.length > 0 ? { images: productGallery } : {}),
    ...(p.manufacturingCountryIso ? { made_in_country: p.manufacturingCountryIso } : {}),
    variants: pushVariants,
  };
}

export async function ankorstoreRefreshProduct(productId: string): Promise<AnkorstoreRefreshResult> {
  const [products, ctx] = await Promise.all([
    loadExportProducts([productId]),
    loadExportContext(),
  ]);

  const product = products[0];
  if (!product) {
    return { success: false, reason: "error", error: "Produit introuvable en base" };
  }

  // Step 1: Check product exists on Ankorstore
  let existing: Awaited<ReturnType<typeof ankorstoreSearchProductsByRef>> = [];
  try {
    existing = await ankorstoreSearchProductsByRef(product.reference);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[Ankorstore Refresh] Search failed", { reference: product.reference, error: message });
    return { success: false, reason: "error", error: `Impossible de contacter Ankorstore : ${message}` };
  }

  if (existing.length === 0) {
    return {
      success: false,
      reason: "not_found",
      error: "Produit inexistant sur Ankorstore",
    };
  }

  // Step 2: Build and push
  const pushProduct = buildPushProduct(product, ctx);
  if (!pushProduct) {
    return { success: false, reason: "error", error: "Produit sans variantes — rien à pousser" };
  }

  const pushResult = await ankorstorePushProducts([pushProduct], "update");
  if (!pushResult.success) {
    return {
      success: false,
      reason: "error",
      error: pushResult.error ?? "Échec du push Ankorstore",
    };
  }

  logger.info("[Ankorstore Refresh] Push started", {
    reference: product.reference,
    opId: pushResult.opId,
  });

  return {
    success: true,
    opId: pushResult.opId,
    warning: VERIFY_WARNING,
  };
}
