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

/**
 * Mapping ProductStatus BJ → lifecycle_state Faire.
 *   - ONLINE  → PUBLISHED (visible aux acheteurs)
 *   - OFFLINE → UNPUBLISHED (caché côté acheteurs, réactivable d'un clic)
 *   - ARCHIVED → UNPUBLISHED (idem — Faire ne distingue pas les deux)
 *   - SYNCING (état transitoire) → PUBLISHED par défaut
 * Faire n'expose pas `sale_state` en écriture (read-only), donc UNPUBLISHED
 * est notre seul levier pour « cacher » un produit sans le supprimer.
 */
export function faireLifecycleFromStatus(
  status: string,
): "PUBLISHED" | "UNPUBLISHED" {
  return status === "ARCHIVED" || status === "OFFLINE"
    ? "UNPUBLISHED"
    : "PUBLISHED";
}

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
 * ⚠️ Variantes : ce body ne contient JAMAIS de `variants[]`. La création,
 * la modification et la suppression de variantes passent par les endpoints
 * dédiés :
 *   - création :  POST    /products/{id}/variants
 *   - modif :     PATCH   /products/{id}/variants/{vid}
 *   - suppr :     DELETE  /products/{id}/variants/{vid}
 *
 * Inclure `variants[]` dans le PATCH produit déclenche des erreurs subtiles
 * (« Duplicate variants with same options » sur les existantes ; « All
 * variants must have consistent prices for different countries » si les
 * geo_constraints divergent), et empêche de récupérer proprement les IDs
 * Faire des nouvelles variantes.
 */
export function buildPatchBody(
  diff: FaireSyncDiff,
  fullBody: Record<string, unknown>,
  pricesOnly: boolean,
  hasNewVariants: boolean = false,
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
  // Lifecycle : on l'inclut DÈS QU'un PATCH /products/{id} est envoyé (peu
  // importe la raison — champ produit, nouvelles variantes, etc.). Pas
  // seulement quand le diff le dit changé : la mémoire de sync peut dériver
  // de l'état réel Faire (clic manuel sur le portail, race condition…).
  // Renvoyer le lifecycle « voulu » à chaque PATCH garantit que Faire
  // converge vers notre état BJ. C'est idempotent côté Faire (un PATCH avec
  // le même lifecycle ne fait rien).
  const willPatch = diff.productChanged || diff.lifecycleChanged || hasNewVariants;
  if (willPatch) {
    out.lifecycle_state = fullBody.lifecycle_state;
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
  const lifecycleState = faireLifecycleFromStatus(product.status);

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
  // individuellement) des nouvelles (à créer via POST /products/{id}/variants).
  const faireVariantIdBySku = new Map<string, string>();
  const bjVariantIdBySku = new Map<string, string>();
  for (const v of variants) {
    bjVariantIdBySku.set(v.sku, v.bjVariantId);
    const bjVariant = product.colors.find((c) => c.id === v.bjVariantId);
    if (bjVariant?.faireVariantId) {
      faireVariantIdBySku.set(v.sku, bjVariant.faireVariantId);
    }
  }
  const newVariantsToCreate = variants.filter((v) => !faireVariantIdBySku.has(v.sku));
  const hasNewVariants = newVariantsToCreate.length > 0;

  // 4) PATCH /products/{id} — uniquement les champs produit (jamais de
  // variants[]). Les nouvelles variantes sont créées via POST dédié juste
  // après. Les existantes sont patchées via PATCH variant individuel plus bas.
  const patchBody = buildPatchBody(
    diff,
    body as Record<string, unknown>,
    pricesOnlyMode,
    hasNewVariants,
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

  // 4.ter) POST /products/{id}/variants pour chaque nouvelle variante.
  // Endpoint dédié : Faire renvoie l'ID Faire `po_xxx` qu'on persiste sur
  // ProductColor.faireVariantId. Le payload contient déjà `prices[]` EUR/EU
  // (cohérent avec les variantes existantes) et PAS les champs dépréciés
  // `wholesale_price_cents`/`retail_price_cents`. Si un POST échoue, on
  // s'arrête immédiatement pour ne pas laisser le produit dans un état
  // intermédiaire — le retry recréera juste la/les variantes manquantes.
  const createdFaireVariantIds: { bjVariantId: string; faireVariantId: string }[] = [];
  for (const newVariant of newVariantsToCreate) {
    try {
      const res = await faireFetch(
        `/products/${encodeURIComponent(meta.faireProductId)}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(newVariant.payload),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error("[Faire Update] POST variant failed", {
          productId,
          sku: newVariant.sku,
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
            ? `Faire a refusé la création de la variante "${newVariant.sku}" (HTTP ${res.status}) : ${humanMsg}`
            : `Faire a refusé la création de la variante "${newVariant.sku}" (HTTP ${res.status}).`,
        };
      }
      const data = (await res.json().catch(() => null)) as { id?: string } | null;
      if (data?.id) {
        faireVariantIdBySku.set(newVariant.sku, data.id);
        createdFaireVariantIds.push({
          bjVariantId: newVariant.bjVariantId,
          faireVariantId: data.id,
        });
      } else {
        logger.warn("[Faire Update] POST variant réponse sans id", {
          productId,
          sku: newVariant.sku,
        });
      }
    } catch (err) {
      logger.error("[Faire Update] POST variant threw", {
        productId,
        sku: newVariant.sku,
        error: String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur réseau Faire (création variante).",
      };
    }
  }

  // Persiste immédiatement les `faireVariantId` reçus avant le reste du flow,
  // pour qu'un échec en aval ne laisse pas la BDD désynchronisée.
  if (createdFaireVariantIds.length > 0) {
    await prisma.$transaction(
      createdFaireVariantIds.map((m) =>
        prisma.productColor.update({
          where: { id: m.bjVariantId },
          data: { faireVariantId: m.faireVariantId },
        }),
      ),
    );
  }

  // 4.bis) PATCH variant individuel pour chaque variante existante touchée
  // par un changement STRUCTUREL (name, images, measurements, tariff_code, active).
  // ⚠️ On NE met PAS les prix ici : Faire répond 200 mais ignore le champ
  // (cf. en-tête du fichier + faire-prices.ts). Les SKU `pricesOnlyChanged`
  // sont gérés en bloc à la fin via faireUpdatePrices().
  const existingVariantSkusToPatch = new Set<string>(
    diff.variantsChanged.filter(
      (sku) =>
        faireVariantIdBySku.has(sku) &&
        !createdFaireVariantIds.find((c) => bjVariantIdBySku.get(sku) === c.bjVariantId),
    ),
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

  // Inventory à part : Faire ignore `available_quantity` au POST/PATCH produit
  // (même règle qu'à la création), donc on doit le pousser quand le stock a
  // changé ET pour chaque nouvelle variante (son stock initial ne passe pas
  // par le POST /products/{id}/variants).
  const stockUpdates = Array.from(
    new Set<string>([
      ...diff.variantsAdded.filter((sku) => nextSnapshot.variants[sku]?.availableQuantity > 0),
      ...(diff.inventoryOnlyChanged.length > 0
        ? diff.inventoryOnlyChanged
        : diff.variantsChanged.filter((sku) => {
            const prev = prevSnapshot?.variants?.[sku];
            const next = nextSnapshot.variants[sku];
            return prev && prev.availableQuantity !== next.availableQuantity;
          })),
    ]),
  );
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
