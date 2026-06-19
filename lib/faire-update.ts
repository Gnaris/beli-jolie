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
  type FaireVariantSnapshot,
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
 * Variantes :
 *   - cas standard (modif champ produit, ou modif variantes existantes) :
 *     ce body ne contient PAS `variants[]`. La modif/suppr des variantes
 *     existantes passe par les endpoints dédiés (`PATCH /products/{id}/variants/{vid}`,
 *     `DELETE /products/{id}/variants/{vid}`).
 *   - cas « nouvelle variante » (hasNewVariants=true) : on inclut `variants[]`
 *     ET `variant_option_sets` dans le PATCH produit. Pourquoi :
 *       a) Faire valide chaque variante contre `variant_option_sets` — sans
 *          mise à jour préalable de la liste des couleurs autorisées, le POST
 *          /variants dédié échoue avec HTTP 400 « Color:Marron is not one of
 *          the values for Color ».
 *       b) Le POST /variants dédié ne permet PAS d'enrichir variant_option_sets
 *          en même temps, et un PATCH /products/{id} qui ne touche QUE
 *          variant_option_sets est silencieusement ignoré par Faire (constaté
 *          en prod sur F137, juin 2026).
 *       c) La doc OpenAPI (§ patch /products/{id}) précise : « Variants can be
 *          updated/created with this endpoint ». Les variantes existantes
 *          portent leur `id` Faire pour que Faire les matche au lieu de croire
 *          à des doublons (« Duplicate variants with same options »).
 *
 * Note : les anciennes erreurs « All variants must have consistent prices for
 * different countries » venaient des champs dépréciés `wholesale_price_cents` /
 * `retail_price_cents` racine. Ils sont retirés depuis le commit 70dd4b6, tous
 * les prix sont EUR/EUROPEAN_UNION, donc l'inclusion de `variants[]` dans le
 * PATCH est désormais sûre.
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
    ]) {
      if (key in fullBody) out[key] = fullBody[key];
    }
  }
  // Images racine : ENVOI CONDITIONNEL. Faire déduplique les images par contenu :
  // si la même image est déjà à la racine (ou sur une variante), re-pousser la
  // même URL la marque à nouveau comme « principale » et Faire répond HTTP 400
  // « Tentative de mise à jour de l'image […] avec 2 images principales ». On
  // n'inclut donc `images` que quand la liste a réellement changé. Quand le
  // snapshot est null (post-reset), `productImagesChanged` est false → Faire
  // garde son état d'images intact (refresh manuel via le script si besoin).
  if (diff.productImagesChanged && "images" in fullBody) {
    out.images = fullBody.images;
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
  // Quand on crée une ou plusieurs nouvelles variantes, on envoie variants[]
  // (avec `id` sur les existantes) + variant_option_sets complet, dans un
  // seul PATCH. Faire applique alors les nouvelles valeurs d'option et crée
  // les variantes manquantes en une opération atomique. Voir l'en-tête de
  // cette fonction pour le raisonnement complet.
  //
  // ⚠️ Pour les variantes EXISTANTES (qui ont un `id` Faire), on retire
  // `images` du payload si leurs images n'ont pas changé. Sinon Faire les
  // re-traite et déclenche l'erreur « 2 images principales ». Les nouvelles
  // variantes (sans `id`) conservent leurs `images` (création).
  if (hasNewVariants) {
    if (Array.isArray(fullBody.variant_option_sets)) {
      out.variant_option_sets = fullBody.variant_option_sets;
    }
    if (Array.isArray(fullBody.variants)) {
      const variantsImagesChangedSet = new Set(diff.variantsImagesChanged);
      out.variants = (fullBody.variants as Record<string, unknown>[]).map((v) => {
        const sku = typeof v.sku === "string" ? v.sku : "";
        const hasId = typeof v.id === "string" && v.id.length > 0;
        if (hasId && !variantsImagesChangedSet.has(sku)) {
          const { images: _omitImages, ...rest } = v;
          return rest;
        }
        return v;
      });
    }
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
    // Rien à pousser côté Faire, mais on enregistre quand même le nouveau
    // snapshot. Il peut contenir des `faireVariantId` qui manquaient dans
    // l'ancienne version (rétro-compat des snapshots pré-juin 2026, sans
    // lesquels la suppression de variantes ne peut pas trouver l'ID Faire).
    // Reset aussi `faireSyncRequired`.
    await saveSnapshot(productId, nextSnapshot);
    return { success: true, diff, noop: true };
  }

  // 1) Suppressions de variantes (avant les ajouts pour éviter conflit de SKU).
  // Pour les snapshots récents, l'ID Faire `po_xxx` est stocké directement.
  // Pour les snapshots anciens (avant juin 2026) ou si le champ est null,
  // on retombe sur un GET /products/{id} qui retourne la liste actuelle des
  // variantes Faire — on matche alors par SKU.
  let faireVariantIdBySkuFromFaire: Map<string, string> | null = null;
  // Narrowed capture pour la closure : TS ne propage pas le `if (!meta)`
  // initial à travers les fermetures, on fige donc l'id ici.
  const faireProductIdForFetch: string = meta.faireProductId;
  async function resolveFaireVariantId(sku: string, prevId?: string | null): Promise<string | null> {
    if (prevId) return prevId;
    if (!faireVariantIdBySkuFromFaire) {
      faireVariantIdBySkuFromFaire = new Map();
      try {
        const res = await faireFetch(`/products/${encodeURIComponent(faireProductIdForFetch)}`, {
          method: "GET",
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as
            | { variants?: { id?: string; sku?: string }[] }
            | null;
          for (const v of data?.variants ?? []) {
            if (v.sku && v.id) faireVariantIdBySkuFromFaire.set(v.sku, v.id);
          }
        } else {
          logger.warn("[Faire Update] Fallback GET product failed", {
            productId,
            status: res.status,
          });
        }
      } catch (err) {
        logger.warn("[Faire Update] Fallback GET product threw", {
          productId,
          error: String(err),
        });
      }
    }
    return faireVariantIdBySkuFromFaire.get(sku) ?? null;
  }

  for (const sku of diff.variantsRemoved) {
    const snapshotId = prevSnapshot?.variants?.[sku]?.faireVariantId ?? null;
    const prevId = await resolveFaireVariantId(sku, snapshotId);
    if (!prevId) {
      logger.warn("[Faire Update] DELETE variant : ID Faire introuvable (snapshot + fetch)", {
        productId,
        sku,
      });
      continue;
    }
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
  // individuellement) des nouvelles (créées par le PATCH consolidé).
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

  // 4) PATCH /products/{id} — champs produit, +variants[] et variant_option_sets
  // quand on a des nouvelles variantes (voir docstring de buildPatchBody).
  const patchBody = buildPatchBody(
    diff,
    body as Record<string, unknown>,
    pricesOnlyMode,
    hasNewVariants,
  );

  const hasProductPatchPayload = Object.keys(patchBody).length > 0;
  const createdFaireVariantIds: { bjVariantId: string; faireVariantId: string }[] = [];

  // ⚠️ Image vedette Faire (tag `"Hero"`) — quand l'ordre des images racine
  // change (typiquement quand la couleur principale BJ change), envoyer
  // simplement `tags: ["Hero"]` sur la nouvelle 1ʳᵉ image ne suffit pas :
  // Faire conserve le tag « Hero » sur les images existantes dont le hash est
  // déjà connu, et a tendance à reposer ce tag sur les nouvelles images
  // téléchargées dans la foulée. Du coup, plusieurs images peuvent porter
  // « Hero » en même temps et le portail Faire continue d'afficher l'ancienne.
  //
  // Parade : juste AVANT le PATCH product avec images, supprimer côté Faire
  // toutes les images racine qui portent encore le tag « Hero ». Le PATCH
  // suivant (qui inclut `tags: ["Hero"]` sur sa 1ʳᵉ image) recrée alors
  // l'image vedette proprement, sans concurrence.
  if (hasProductPatchPayload && diff.productImagesChanged) {
    try {
      const res = await faireFetch(`/products/${encodeURIComponent(meta.faireProductId)}`, {
        method: "GET",
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { images?: { id?: string; tags?: string[] }[] }
          | null;
        const allImages = data?.images ?? [];
        const heroImages = allImages.filter((img) =>
          (img.tags ?? []).includes("Hero") && img.id,
        );
        // Faire interdit de supprimer la DERNIÈRE image d'un produit publié
        // (HTTP 400). On garde donc au moins 1 image en stock à chaque DELETE.
        let remaining = allImages.length;
        for (const img of heroImages) {
          if (remaining <= 1) break;
          try {
            const delRes = await faireFetch(
              `/products/${encodeURIComponent(meta.faireProductId)}/images/${encodeURIComponent(img.id!)}`,
              { method: "DELETE" },
            );
            if (delRes.ok || delRes.status === 404) {
              remaining -= 1;
            } else {
              logger.warn("[Faire Update] DELETE image Hero : status non-OK", {
                productId,
                imgId: img.id,
                status: delRes.status,
              });
            }
          } catch (err) {
            logger.warn("[Faire Update] DELETE image Hero : exception", {
              productId,
              imgId: img.id,
              error: String(err),
            });
          }
        }
      } else {
        logger.warn("[Faire Update] GET product pour images Hero : status non-OK", {
          productId,
          status: res.status,
        });
      }
    } catch (err) {
      logger.warn("[Faire Update] GET product pour images Hero : exception", {
        productId,
        error: String(err),
      });
    }
  }

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

      // Si on a envoyé des nouvelles variantes dans variants[], on récupère
      // leurs IDs Faire `po_xxx` depuis la réponse pour les persister.
      if (hasNewVariants) {
        const data = (await res.json().catch(() => null)) as
          | { variants?: { id?: string; sku?: string }[] }
          | null;
        const respVariants = data?.variants ?? [];
        for (const newVariant of newVariantsToCreate) {
          const match = respVariants.find((rv) => rv.sku === newVariant.sku);
          if (match?.id) {
            faireVariantIdBySku.set(newVariant.sku, match.id);
            createdFaireVariantIds.push({
              bjVariantId: newVariant.bjVariantId,
              faireVariantId: match.id,
            });
          } else {
            logger.warn("[Faire Update] PATCH response sans ID pour nouvelle variante", {
              productId,
              sku: newVariant.sku,
            });
          }
        }
      }
    } catch (err) {
      logger.error("[Faire Update] PATCH threw", { productId, error: String(err) });
      return {
        success: false,
        error: err instanceof Error ? err.message : "Erreur réseau Faire.",
      };
    }
  }

  // Persiste immédiatement les `faireVariantId` reçus avant le reste du flow,
  // pour qu'un échec en aval ne laisse pas la BDD désynchronisée. On met
  // aussi à jour le snapshot en mémoire : sans ça, une suppression future
  // de cette variante n'aurait aucun moyen de retrouver l'ID Faire à
  // appeler en DELETE (le snapshot écrit en fin de flow doit refléter
  // l'état réel côté Faire, pas l'état initial du build).
  if (createdFaireVariantIds.length > 0) {
    for (const m of createdFaireVariantIds) {
      const variantPayload = variants.find((v) => v.bjVariantId === m.bjVariantId);
      if (variantPayload && nextSnapshot.variants[variantPayload.sku]) {
        nextSnapshot.variants[variantPayload.sku].faireVariantId = m.faireVariantId;
      }
    }
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
  //
  // ⚠️ Si on a envoyé `variants[]` dans le PATCH consolidé (hasNewVariants),
  // les variantes existantes ont DÉJÀ été mises à jour dans cet appel — on
  // saute ce bloc pour éviter un PATCH redondant et un risque de race sur
  // les images.
  const existingVariantSkusToPatch = hasNewVariants
    ? new Set<string>()
    : new Set<string>(
        diff.variantsChanged.filter(
          (sku) =>
            faireVariantIdBySku.has(sku) &&
            !createdFaireVariantIds.find((c) => bjVariantIdBySku.get(sku) === c.bjVariantId),
        ),
      );
  const variantsImagesChangedSet = new Set(diff.variantsImagesChanged);

  // ⚠️ Bug Faire « 2 images principales » : même quand le diff identifie qu'une
  // image a changé (variantsImagesChanged.has(sku) = true), envoyer la nouvelle
  // URL directement dans le PATCH variant échoue avec HTTP 400 « Tentative de
  // mise à jour de l'image pour 'Couleur' avec 2 images principales » — Faire
  // tente de poser is_main=true sur la nouvelle image mais l'ancienne porte
  // déjà ce drapeau. Parade : DELETE chacune des images existantes côté Faire
  // pour cette variante AVANT le PATCH, puis envoyer les nouvelles dans le
  // PATCH (Faire les recrée propres sans conflit).
  //
  // Optimisation : un seul GET /products/{id} pour récupérer tous les IDs
  // d'images à supprimer, quel que soit le nombre de variantes concernées.
  const faireImageIdsByFaireVariantId = new Map<string, string[]>();
  if (variantsImagesChangedSet.size > 0) {
    try {
      const res = await faireFetch(`/products/${encodeURIComponent(meta.faireProductId)}`, {
        method: "GET",
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { variants?: { id?: string; images?: { id?: string }[] }[] }
          | null;
        for (const v of data?.variants ?? []) {
          if (!v.id) continue;
          const ids = (v.images ?? [])
            .map((i) => i.id)
            .filter((id): id is string => typeof id === "string");
          if (ids.length > 0) faireImageIdsByFaireVariantId.set(v.id, ids);
        }
      } else {
        logger.warn("[Faire Update] GET product pour images variant : status non-OK", {
          productId,
          status: res.status,
        });
      }
    } catch (err) {
      logger.warn("[Faire Update] GET product pour images variant : exception", {
        productId,
        error: String(err),
      });
    }
  }

  for (const sku of existingVariantSkusToPatch) {
    const variantInfo = variants.find((v) => v.sku === sku);
    const faireVid = faireVariantIdBySku.get(sku)!;
    if (!variantInfo) continue;

    const shouldSendImages =
      variantsImagesChangedSet.has(sku) && Boolean(variantInfo.payload.images);

    // DELETE les images existantes de la variante côté Faire si on s'apprête
    // à en envoyer de nouvelles. Sans ça, Faire refuse avec « 2 images
    // principales » (cf. bloc explicatif au-dessus).
    if (shouldSendImages) {
      const oldImageIds = faireImageIdsByFaireVariantId.get(faireVid) ?? [];
      for (const imgId of oldImageIds) {
        try {
          const delRes = await faireFetch(
            `/products/${encodeURIComponent(meta.faireProductId)}/variants/${encodeURIComponent(faireVid)}/images/${encodeURIComponent(imgId)}`,
            { method: "DELETE" },
          );
          if (!delRes.ok && delRes.status !== 404) {
            logger.warn("[Faire Update] DELETE variant image : status non-OK", {
              productId,
              sku,
              imgId,
              status: delRes.status,
            });
          }
        } catch (err) {
          logger.warn("[Faire Update] DELETE variant image : exception", {
            productId,
            sku,
            imgId,
            error: String(err),
          });
        }
      }
    }

    // Body partiel : champs modifiables (hors prix) — la doc Faire interdit
    // la modif d'options ET de prix via ce endpoint.
    // `images` n'est inclus que pour les SKU dont les images ont réellement
    // changé. Cf. parade « 2 images principales » au-dessus.
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
      ...(shouldSendImages ? { images: variantInfo.payload.images } : {}),
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
    // Pour les variantes fraîchement créées par le PATCH consolidé, Faire
    // peut renvoyer 404 sur /product-inventory/by-skus le temps que son
    // index SKU se propage. On laisse ~3s, et on retente une fois si le
    // premier appel a échoué — généralement suffisant.
    if (hasNewVariants) {
      await new Promise((r) => setTimeout(r, 3000));
    }
    const inv = await faireUpdateInventory(updates);
    if (!inv.success && hasNewVariants) {
      logger.warn("[Faire Update] Inventory échec après création — retry dans 3s", {
        productId,
        failedCount: inv.failedCount,
      });
      await new Promise((r) => setTimeout(r, 3000));
      await faireUpdateInventory(updates);
    }
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
