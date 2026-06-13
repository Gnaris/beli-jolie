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
 *      - uniquement inventoryOnlyChanged
 *           → PATCH /product-inventory/by-skus (via faire-inventory)
 *      - uniquement pricesOnlyChanged
 *           → PATCH /products/{id} avec variants[].prices (voie fiable
 *             confirmée le 2026-06-12 — éviter le bulk by-skus moins stable)
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
 */
export function buildPatchBody(
  diff: FaireSyncDiff,
  fullBody: Record<string, unknown>,
  pricesOnly: boolean,
): Record<string, unknown> {
  if (pricesOnly) {
    return { variants: fullBody.variants };
  }

  const out: Record<string, unknown> = {};
  if (diff.productChanged) {
    for (const key of [
      "name",
      "description",
      "short_description",
      "taxonomy_type",
      "country_of_manufacture",
      "materials",
      "hs_code",
      "minimum_order_quantity",
      "per_style_minimum_order_quantity",
    ]) {
      if (key in fullBody) out[key] = fullBody[key];
    }
  }
  if (diff.lifecycleChanged) {
    out.lifecycle_state = fullBody.lifecycle_state;
  }
  if (diff.saleStateChanged) {
    out.sale_state = fullBody.sale_state;
  }
  // Variants : pour les changements structurels ou prix, on renvoie le tableau
  // complet (Faire ne supporte pas un patch "par delta" propre).
  if (diff.variantsChanged.length > 0 || diff.variantsAdded.length > 0) {
    out.variants = fullBody.variants;
    // variant_option_sets recalculé en cas d'ajout/suppression de couleur.
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
  const lifecycleState =
    product.status === "ARCHIVED" ? "RETIRED" : "PUBLISHED";
  const saleState = product.status === "ONLINE" ? "FOR_SALE" : "NOT_FOR_SALE";

  const { body, variants } = buildFaireProductPayload(
    product,
    ctx,
    configs.faireWholesale,
    configs.faireRetail,
    lifecycleState === "RETIRED" ? "PUBLISHED" : lifecycleState,
  );
  // Override les états dans le body (publish met DRAFT par défaut).
  body.lifecycle_state = lifecycleState;
  body.sale_state = saleState;

  const nextSnapshot = buildFaireSnapshot(
    product,
    ctx,
    variants,
    lifecycleState,
    saleState,
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
    !diff.saleStateChanged &&
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

  // 3) Cas "prices only" → PATCH /products/{id} avec variants[].prices uniquement.
  const pricesOnlyMode =
    !diff.productChanged &&
    !diff.lifecycleChanged &&
    !diff.saleStateChanged &&
    diff.variantsChanged.length === 0 &&
    diff.variantsAdded.length === 0 &&
    diff.variantsRemoved.length === 0 &&
    diff.pricesOnlyChanged.length > 0;

  // 4) Construit le PATCH partiel.
  const patchBody = buildPatchBody(diff, body as Record<string, unknown>, pricesOnlyMode);

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
      return { success: false, error: `Faire a refusé la mise à jour (HTTP ${res.status}).` };
    }
  } catch (err) {
    logger.error("[Faire Update] PATCH threw", { productId, error: String(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur réseau Faire.",
    };
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
