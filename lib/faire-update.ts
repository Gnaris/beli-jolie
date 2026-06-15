/**
 * Faire Update — PATCH incrémental d'un produit déjà publié.
 *
 * Stratégie identique à PFS / Ankorstore :
 *   1. Charger le produit + construire le payload "comme si on publiait".
 *   2. Comparer au snapshot stocké (`faireLastSyncSnapshot`) via faire-sync-diff.
 *   3. Court-circuiter si le diff est vide.
 *   4. Sinon, choisir le bon endpoint selon la nature du diff :
 *      - productChanged / variantsChanged / lifecycleChanged
 *           → PATCH /products/{id} (body partiel)
 *      - inventoryOnlyChanged
 *           → PATCH /product-inventory/by-skus (via faire-inventory)
 *      - pricesOnlyChanged
 *           → PATCH /product-prices/by-skus (via faire-prices). On NE PASSE
 *             PAS par PATCH variant individuel : Faire répond 200 mais ignore
 *             silencieusement les champs prix (« You cannot change the
 *             currencies or geographic regions for a single variant's
 *             prices… ») — même piège que l'ancien bug `current_quantity`.
 *      - variantsRemoved → DELETE /products/{id}/variants/{vid}
 *   5. Sauver le nouveau snapshot + reset `faireSyncRequired`.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { faireFetch } from "@/lib/faire-api";
import {
  diffSnapshots,
  diffIsEmpty,
  type FaireSyncSnapshot,
  type FaireSyncDiff,
} from "@/lib/faire-sync-diff";
import {
  buildPublishContext,
  buildFaireProductPayload,
  buildFaireSnapshot,
  loadFaireProductFull,
} from "@/lib/faire-publish";
import {
  faireUpdateInventory,
  type FaireInventoryUpdate,
} from "@/lib/faire-inventory";
import {
  faireUpdatePrices,
  type FairePriceUpdate,
} from "@/lib/faire-prices";
import { loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";

export type FaireUpdateResult =
  | { success: true; diff: FaireSyncDiff; noop: boolean }
  | { success: false; error: string };

interface ReloadedProduct {
  id: string;
  faireProductId: string | null;
  faireLastSyncSnapshot: Prisma.JsonValue;
}

async function loadFaireProductMeta(productId: string): Promise<ReloadedProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      faireProductId: true,
      faireLastSyncSnapshot: true,
    },
  });
}

/**
 * Construit le body PATCH partiel à envoyer à `/products/{id}` à partir du diff.
 * Seuls les champs marqués comme changés sont inclus.
 *
 * ⚠️ Important : on N'inclut JAMAIS dans `variants[]` des variantes déjà
 * existantes côté Faire (celles avec un `faireVariantId` mappé). Faire refuse
 * sinon avec HTTP 400 « Duplicate variants with same options » parce qu'il
 * voit le payload comme une tentative de créer 2 fois la même variante.
 * Pour les variantes déjà mappées, on fait un `PATCH /products/{id}/variants/{vid}`
 * séparé (cf. `patchExistingVariants` plus bas). Seules les VRAIMENT nouvelles
 * variantes (sans `faireVariantId`) restent dans `variants[]`.
 */
export function buildPatchBody(
  diff: FaireSyncDiff,
  fullBody: Record<string, unknown>,
  pricesOnly: boolean,
  newVariantsOnly?: unknown[],
): Record<string, unknown> {
  if (pricesOnly) {
    // Cas prix-only : on update via le batch /product-prices/by-skus à la fin
    // du flow — pas besoin de toucher au PATCH produit.
    return {};
  }

  const out: Record<string, unknown> = {};
  if (diff.productChanged) {
    for (const key of [
      "name",
      "description",
      "short_description",
      "taxonomy_type",
      "made_in_country",
      "minimum_order_quantity",
      "per_style_minimum_order_quantity",
      // Images au niveau produit racine (image principale Faire). PATCH avec
      // la liste complète remplace l'ancienne, conformément à la doc Faire §7.4.
      "images",
    ]) {
      if (key in fullBody) out[key] = fullBody[key];
    }
  }
  if (diff.lifecycleChanged) {
    out.lifecycle_state = fullBody.lifecycle_state;
  }
  // sale_state retiré : champ read-only côté Faire — géré automatiquement
  // selon le stock vs MOQ. Tenter de l'envoyer renvoie HTTP 400.
  // Variants : on N'envoie que les NOUVELLES (faireVariantId === null).
  // Les existantes sont updatées via PATCH /products/{id}/variants/{vid}.
  if (newVariantsOnly && newVariantsOnly.length > 0) {
    out.variants = newVariantsOnly;
    if (fullBody.variant_option_sets) out.variant_option_sets = fullBody.variant_option_sets;
  }
  return out;
}

export async function faireUpdateProduct(
  productId: string,
): Promise<FaireUpdateResult> {
  const meta = await loadFaireProductMeta(productId);
  if (!meta) return { success: false, error: "Produit introuvable." };
  if (!meta.faireProductId) {
    return { success: false, error: "Produit pas encore publié sur Faire." };
  }

  const product = await loadFaireProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable (loader)." };

  const ctxResult = buildPublishContext(product);
  if (!ctxResult.ok || !ctxResult.ctx) {
    return { success: false, error: ctxResult.reason ?? "Contexte Faire invalide." };
  }
  const ctx = ctxResult.ctx;

  const configs = await loadMarketplaceMarkupConfigs();
  const lifecycleState: "PUBLISHED" | "UNPUBLISHED" =
    product.status === "ARCHIVED" ? "UNPUBLISHED" : "PUBLISHED";

  // ⚠️ Salt STABLE pour un update : si on regénère un `idempotence_token`
  // différent à chaque PATCH, Faire ne reconnaît plus la variante existante
  // et tente d'en créer une nouvelle avec les mêmes options → HTTP 400
  // « Duplicate variants with same options ». Pour les publish (POST), au
  // contraire, le salt timestamp évite le cache d'erreurs sur des produits
  // DELETED.
  const { body, variants, productImageUrls } = buildFaireProductPayload(
    product,
    ctx,
    configs.faireWholesale,
    configs.faireRetail,
    lifecycleState === "UNPUBLISHED" ? "PUBLISHED" : lifecycleState,
    `update-${meta.faireProductId}`,
  );
  // Override le lifecycle dans le body (publish met DRAFT par défaut).
  body.lifecycle_state = lifecycleState;

  const nextSnapshot = buildFaireSnapshot(
    product,
    ctx,
    variants,
    lifecycleState,
    productImageUrls,
  );

  const prevSnapshot = (meta.faireLastSyncSnapshot ?? null) as FaireSyncSnapshot | null;
  const diff = diffSnapshots(prevSnapshot, nextSnapshot);

  if (diffIsEmpty(diff)) {
    // Reset le flag même quand rien n'a bougé (peut traîner depuis un build récent).
    if (meta.faireProductId) {
      await prisma.product.update({
        where: { id: productId },
        data: { faireSyncRequired: false },
      });
    }
    return { success: true, diff, noop: true };
  }

  // 1) Suppressions de variantes (avant les ajouts pour éviter conflit de SKU).
  for (const sku of diff.variantsRemoved) {
    const prevId = (prevSnapshot?.variants?.[sku] as { faireVariantId?: string } | undefined)
      ?.faireVariantId;
    if (!prevId) continue;
    try {
      const res = await faireFetch(
        `/products/${encodeURIComponent(meta.faireProductId)}/variants/${encodeURIComponent(prevId)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 404) {
        logger.warn("[Faire Update] DELETE variant failed", {
          productId,
          sku,
          status: res.status,
        });
      }
    } catch (err) {
      logger.warn("[Faire Update] DELETE variant threw", {
        productId,
        sku,
        error: String(err),
      });
    }
  }

  // 2) Détection du cas "inventory only" pour passer par bulk inventory.
  const inventoryOnlyMode =
    !diff.productChanged &&
    !diff.lifecycleChanged &&
    diff.variantsChanged.length === 0 &&
    diff.variantsAdded.length === 0 &&
    diff.variantsRemoved.length === 0 &&
    diff.inventoryOnlyChanged.length > 0;

  if (inventoryOnlyMode) {
    const updates: FaireInventoryUpdate[] = diff.inventoryOnlyChanged.map((sku) => ({
      sku,
      currentQuantity: nextSnapshot.variants[sku].availableQuantity,
    }));
    const inv = await faireUpdateInventory(updates);
    if (!inv.success) {
      return {
        success: false,
        error: `PATCH inventory échoué (${inv.failedCount}/${updates.length} SKU).`,
      };
    }
    await saveSnapshot(productId, nextSnapshot);
    return { success: true, diff, noop: false };
  }

  // 3) Cas "prices only" : court-circuit via batch /product-prices/by-skus.
  // Le PATCH variant individuel ne fonctionne PAS pour les prix (cf. en-tête
  // du fichier) — on saute directement à la phase d'envoi batch.
  const pricesOnlyMode =
    !diff.productChanged &&
    !diff.lifecycleChanged &&
    diff.variantsChanged.length === 0 &&
    diff.variantsAdded.length === 0 &&
    diff.variantsRemoved.length === 0 &&
    diff.pricesOnlyChanged.length > 0;

  // 3.bis) Sépare les variantes existantes (faireVariantId connu, à patcher
  // individuellement) des nouvelles (à insérer via variants[] du PATCH produit).
  // Carte SKU → faireVariantId pour les variantes existantes mappées.
  const faireVariantIdBySku = new Map<string, string>();
  for (const v of variants) {
    const bjVariant = product.colors.find((c) => c.id === v.bjVariantId);
    if (bjVariant?.faireVariantId) {
      faireVariantIdBySku.set(v.sku, bjVariant.faireVariantId);
    }
  }
  const newVariantsPayload = variants
    .filter((v) => !faireVariantIdBySku.has(v.sku))
    .map((v) => v.payload);

  // 4) PATCH /products/{id} — uniquement les champs produit + les nouvelles
  // variantes (pas les existantes). Les variantes existantes sont gérées
  // après via PATCH /products/{id}/variants/{vid} (champs non-prix uniquement).
  const patchBody = buildPatchBody(
    diff,
    body as Record<string, unknown>,
    pricesOnlyMode,
    newVariantsPayload,
  );

  // Si patchBody est vide ET qu'on n'a pas de variantes à update (cas
  // dégénéré : diff non vide mais que sur des champs qu'on délègue aux
  // PATCH variant individuels), on saute l'appel produit.
  const hasProductPatchPayload = Object.keys(patchBody).length > 0;

  if (hasProductPatchPayload) {
    try {
      const res = await faireFetch(`/products/${encodeURIComponent(meta.faireProductId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("[Faire Update] PATCH failed", {
          productId,
          status: res.status,
          body: text.slice(0, 400),
        });
        // Extrait le message Faire en clair pour qu'il remonte à l'UI.
        let humanMsg = "";
        try {
          const j = JSON.parse(text) as {
            localized_message?: string;
            message?: string;
            field?: string;
            error?: string;
          };
          humanMsg = j.localized_message || j.message || j.error || "";
          if (j.field) humanMsg = `${humanMsg} (champ : ${j.field})`;
        } catch {
          if (text) humanMsg = text.slice(0, 200);
        }
        return {
          success: false,
          error: humanMsg
            ? `Faire a refusé la mise à jour (HTTP ${res.status}) : ${humanMsg}`
            : `Faire a refusé la mise à jour (HTTP ${res.status}).`,
        };
      }
    } catch (err) {
      logger.error("[Faire Update] PATCH threw", { productId, error: String(err) });
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur réseau Faire.",
      };
    }
  }

  // 4.bis) PATCH variant individuel pour chaque variante existante touchée
  // par un changement STRUCTUREL (name, images, measurements, tariff_code, active).
  // ⚠️ On NE met PAS les prix ici : Faire répond 200 mais ignore le champ
  // (cf. en-tête du fichier + faire-prices.ts). Les SKU `pricesOnlyChanged`
  // sont gérés en bloc à la fin via faireUpdatePrices().
  const existingVariantSkusToPatch = new Set<string>(
    diff.variantsChanged.filter((sku) => faireVariantIdBySku.has(sku)),
  );
  for (const sku of existingVariantSkusToPatch) {
    const variantInfo = variants.find((v) => v.sku === sku);
    const faireVid = faireVariantIdBySku.get(sku)!;
    if (!variantInfo) continue;
    // Body partiel : champs modifiables (hors prix) — la doc Faire interdit
    // la modif d'options ET de prix via ce endpoint.
    const variantBody: Record<string, unknown> = {
      sku: variantInfo.payload.sku,
      name: variantInfo.payload.name,
      active: variantInfo.payload.active,
      ...(variantInfo.payload.measurements
        ? { measurements: variantInfo.payload.measurements }
        : {}),
      ...(variantInfo.payload.tariff_code
        ? { tariff_code: variantInfo.payload.tariff_code }
        : {}),
      ...(variantInfo.payload.images ? { images: variantInfo.payload.images } : {}),
      ...(variantInfo.payload.unit_multiplier
        ? { unit_multiplier: variantInfo.payload.unit_multiplier }
        : {}),
    };
    try {
      const res = await faireFetch(
        `/products/${encodeURIComponent(meta.faireProductId)}/variants/${encodeURIComponent(faireVid)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(variantBody),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("[Faire Update] PATCH variant failed", {
          productId,
          sku,
          faireVid,
          status: res.status,
          body: text.slice(0, 400),
        });
        let humanMsg = "";
        try {
          const j = JSON.parse(text) as {
            localized_message?: string;
            message?: string;
            field?: string;
          };
          humanMsg = j.localized_message || j.message || (j.field ? `champ : ${j.field}` : "");
        } catch {
          if (text) humanMsg = text.slice(0, 150);
        }
        return {
          success: false,
          error: humanMsg
            ? `Faire a refusé la mise à jour de la variante "${sku}" (HTTP ${res.status}) : ${humanMsg}`
            : `Faire a refusé la mise à jour de la variante "${sku}" (HTTP ${res.status}).`,
        };
      }
    } catch (err) {
      logger.error("[Faire Update] PATCH variant threw", {
        productId,
        sku,
        faireVid,
        error: String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur réseau Faire (variante).",
      };
    }
  }

  // Inventory à part : Faire ignore `available_quantity` dans le PATCH produit
  // (même règle qu'à la création), donc on doit le pousser quand le stock a
  // changé en plus d'autre chose.
  const stockUpdates = diff.inventoryOnlyChanged.length > 0
    ? diff.inventoryOnlyChanged
    : diff.variantsChanged.filter((sku) => {
        const prev = prevSnapshot?.variants?.[sku];
        const next = nextSnapshot.variants[sku];
        return prev && prev.availableQuantity !== next.availableQuantity;
      });
  if (stockUpdates.length > 0) {
    const updates: FaireInventoryUpdate[] = stockUpdates.map((sku) => ({
      sku,
      currentQuantity: nextSnapshot.variants[sku].availableQuantity,
    }));
    await faireUpdateInventory(updates);
  }

  // Prix à part : même règle que le stock — Faire les ignore quand on les
  // envoie via PATCH variant individuel. On pousse les SKU dont le prix a
  // changé (qu'ils aient été classés pricesOnly OU mélangés à un changement
  // structurel) via le batch /product-prices/by-skus.
  const priceChangedSkus = new Set<string>([
    ...diff.pricesOnlyChanged,
    ...diff.variantsChanged.filter((sku) => {
      const prev = prevSnapshot?.variants?.[sku];
      const next = nextSnapshot.variants[sku];
      if (!prev || !next) return false;
      return (
        prev.wholesalePriceCents !== next.wholesalePriceCents ||
        prev.retailPriceCents !== next.retailPriceCents
      );
    }),
  ]);
  if (priceChangedSkus.size > 0) {
    const priceUpdates: FairePriceUpdate[] = [];
    for (const sku of priceChangedSkus) {
      const next = nextSnapshot.variants[sku];
      if (!next) continue;
      priceUpdates.push({
        sku,
        wholesaleCents: next.wholesalePriceCents,
        retailCents: next.retailPriceCents,
      });
    }
    const pricesRes = await faireUpdatePrices(priceUpdates);
    if (!pricesRes.success) {
      return {
        success: false,
        error: `PATCH prix échoué (${pricesRes.failedCount}/${priceUpdates.length} SKU).`,
      };
    }
  }

  await saveSnapshot(productId, nextSnapshot);

  return { success: true, diff, noop: false };
}

async function saveSnapshot(productId: string, snapshot: FaireSyncSnapshot): Promise<void> {
  await prisma.product.update({
    where: { id: productId },
    data: {
      faireLastSyncSnapshot: snapshot as unknown as Prisma.JsonObject,
      faireSyncRequired: false,
    },
  });
  try {
    revalidateTag("products", "default");
  } catch {
    // hors contexte Next
  }
}
