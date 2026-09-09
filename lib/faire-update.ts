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
import { faireRenameVariantSku } from "@/lib/faire-rename-sku";
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
import {
  faireSyncVariantLifecycles,
  lifecycleFromDisabled,
  type FaireVariantLifecycleUpdate,
} from "@/lib/faire-variant-lifecycle";
import { loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";
import { getCurrentTenantIdSafe, getTenantBaseUrl } from "@/lib/tenant";
import { getCachedFaireMadeInExcluded } from "@/lib/cached-data";

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
  /**
   * Sur une resync forcée (link ou clic « Resynchroniser »), on inclut
   * `variants[]` avec `id` + `prices[]` même quand aucune nouvelle variante
   * n'est à créer. C'est le seul chemin fiable pour propager le prix de
   * vente (retail_price) : la doc Faire indique que `PATCH /products/{id}`
   * avec `variants[].prices[]` marche à 100 %, alors que le batch
   * `/product-prices/by-skus` (utilisé sinon) est « INCONSTANT » et laisse
   * parfois le retail inchangé (cf. docs/faire-api.md:63).
   */
  forceIncludeVariantsWithPrices: boolean = false,
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
  const willPatch =
    diff.productChanged ||
    diff.lifecycleChanged ||
    hasNewVariants ||
    forceIncludeVariantsWithPrices;
  if (willPatch) {
    out.lifecycle_state = fullBody.lifecycle_state;
  }
  // Quand on crée une ou plusieurs nouvelles variantes, on envoie variants[]
  // (avec `id` sur les existantes) + variant_option_sets complet, dans un
  // seul PATCH. Faire applique alors les nouvelles valeurs d'option et crée
  // les variantes manquantes en une opération atomique. Voir l'en-tête de
  // cette fonction pour le raisonnement complet.
  //
  // Sur `forceIncludeVariantsWithPrices` (resync/link) sans nouvelle
  // variante, on envoie quand même `variants[]` avec `id` + `prices[]` mais
  // SANS `variant_option_sets` (pas de changement d'axes, Faire refuserait
  // le rename d'options existantes). Ce format garantit l'application du
  // retail_price — le batch by-skus qui suit sert de filet mais n'est plus
  // notre seul canal.
  //
  // ⚠️ Pour les variantes EXISTANTES (qui ont un `id` Faire), on retire
  // `images` du payload si leurs images n'ont pas changé. Sinon Faire les
  // re-traite et déclenche l'erreur « 2 images principales ». Les nouvelles
  // variantes (sans `id`) conservent leurs `images` (création).
  const shouldSendVariants = hasNewVariants || forceIncludeVariantsWithPrices;
  if (shouldSendVariants) {
    if (hasNewVariants && Array.isArray(fullBody.variant_option_sets)) {
      // variant_option_sets seulement quand on crée : sinon Faire rejette
      // « Product variant options cannot be changed » si les libellés d'axes
      // ont bougé entre 2 syncs.
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

/**
 * Aligne un PATCH body Faire avec l'état RÉEL du produit côté Faire, quand ce
 * dernier a été créé hors Beli & Jolie (portail Faire, ou brand qui a bougé
 * les libellés manuellement).
 *
 * Faire refuse toute modif d'options d'une variante existante avec :
 *   « Product variant options cannot be changed. » (HTTP 400)
 * Cette erreur tombe DÈS QUE le nom de dimension ou la casse d'une valeur
 * diverge — même si conceptuellement on parle de la même couleur. Cas vu en
 * prod (2026-07, tenant issyma, produit 93126) :
 *   - Faire stocke `variant_option_sets: [{ name: "Couleur", values:
 *     ["Vert pomme", "marron", ...] }]`
 *   - Notre code envoie `[{ name: "Color", values: ["Vert Pomme",
 *     "Brun foncé", ...] }]` + 2 nouvelles couleurs (Moutarde, Taupe).
 *   → Faire lit ça comme « tu renommes la dimension ET tu changes les
 *     libellés des variantes existantes » → refus global.
 *
 * Deux normalisations appliquées :
 *   1. Nom de dimension : on remplace nos noms par ceux de Faire, par index
 *      (dimension i BJ ↔ dimension i Faire). Suffisant tant qu'on n'a que 2
 *      axes max (Color puis Size).
 *   2. Valeur des options des variantes EXISTANTES (id Faire connu) : on
 *      force la valeur exacte que Faire a stockée pour ce vid. Résultat :
 *      les variantes existantes restent bit-à-bit identiques côté options,
 *      seules les NOUVELLES apparaissent avec nos libellés BJ.
 *
 * `variant_option_sets.values` est aussi reconstruit : valeurs Faire d'abord
 * (ordre + casse originaux), puis ajout des nouvelles valeurs BJ absentes
 * (comparaison casse-insensible pour ne pas insérer un doublon comme
 * "Vert Pomme" à côté de "Vert pomme").
 */
export function reconcilePatchBodyWithFaireOptions(
  patchBody: Record<string, unknown>,
  faireState: {
    variants: { id: string; options?: { name?: string; value?: string }[] }[];
    variantOptionSets: { name: string; values: string[] }[];
  },
): Record<string, unknown> {
  // Cas particulier : Faire ne matérialise AUCUN axe de variantes indexé.
  // Se produit quand le produit a été créé/publié côté Faire avec une seule
  // variante (Faire ne crée pas d'axe s'il n'y a rien à choisir — la variante
  // sortie s'appelle « default » avec `options: []`). Envoyer des `options`
  // sur ces variantes déclenche « Product variant options cannot be changed »
  // (HTTP 400). Parade : on strip `options` et `variant_option_sets` du body
  // pour rester bit-à-bit compatible avec l'état Faire. Cas vu en prod
  // 2026-07-30 sur JG162 / JG61 / JG65 (tenant issyma) — un seul coloris.
  //
  // ⚠️ Ce strip n'est valide QUE si notre payload contient au maximum 1
  // variante (donc miroir de l'état axisless Faire). Si on envoie plusieurs
  // variantes (typiquement quand la cliente ajoute de nouvelles couleurs à un
  // produit historiquement mono-coloris chez Faire), stripper les options
  // fait rejeter Faire avec « A product with multiple variants must have
  // options » (HTTP 400). Dans ce cas on garde les options + variant_option_sets
  // : Faire tentera d'ajouter l'axe. Si ça échoue avec « Product variant
  // options cannot be changed », l'erreur surface à l'UI et la cliente peut
  // relier le produit pour repartir sur une fiche saine. Cas vu 2026-08-02
  // sur issyma ref JG16 (1 coloris Faire + 2 nouveaux à créer).
  const patchVariantsArr = Array.isArray(patchBody.variants)
    ? (patchBody.variants as Record<string, unknown>[])
    : [];
  if (faireState.variantOptionSets.length === 0 && patchVariantsArr.length <= 1) {
    const stripped: Record<string, unknown> = { ...patchBody };
    delete stripped.variant_option_sets;
    stripped.variants = patchVariantsArr.map((v) => {
      const { options: _drop, ...rest } = v;
      return rest;
    });
    return stripped;
  }
  if (faireState.variantOptionSets.length === 0) {
    // Faire est sans axe mais on introduit plusieurs variantes → on garde le
    // body tel quel (options + variant_option_sets). Rien à réconcilier côté
    // libellés puisque Faire n'a pas d'options à préserver.
    return patchBody;
  }

  const bjOptionSets = Array.isArray(patchBody.variant_option_sets)
    ? (patchBody.variant_option_sets as { name?: string; values?: string[] }[])
    : [];

  // Map { name BJ → name Faire } par index de dimension (couleur puis taille).
  const nameMap = new Map<string, string>();
  for (let i = 0; i < bjOptionSets.length; i++) {
    const bjName = bjOptionSets[i]?.name;
    const faireName = faireState.variantOptionSets[i]?.name;
    if (
      typeof bjName === "string" &&
      typeof faireName === "string" &&
      bjName !== faireName
    ) {
      nameMap.set(bjName, faireName);
    }
  }

  // Map { vid Faire → options[] réelles } — pour caler les variantes existantes.
  const faireOptionsByVid = new Map<string, { name: string; value: string }[]>();
  for (const v of faireState.variants) {
    const opts = (v.options ?? [])
      .filter(
        (o): o is { name: string; value: string } =>
          typeof o?.name === "string" && typeof o?.value === "string",
      );
    if (opts.length > 0) faireOptionsByVid.set(v.id, opts);
  }

  const rewrittenBody: Record<string, unknown> = { ...patchBody };

  // Axes présents chez Faire mais non couverts par ce que BJ envoie. Cas vu
  // 2026-08-04 sur issyma 15110 et 680LEOPARD : Faire connaît [Color, Tallie]
  // alors que BJ n'envoie que [Color] (produit BJ mono-taille « Taille unique »
  // → `shouldExposeSizeAxis` renvoie false). Sans compensation, chaque variante
  // envoyée n'a qu'une option (Color) alors que Faire en attend deux →
  // « Product variant options cannot be changed » (HTTP 400).
  //
  // Parade appliquée en 2 endroits :
  //   - Dans chaque `variants[i].options` : on complète jusqu'à
  //     `faireState.variantOptionSets.length`, en récupérant la valeur Faire
  //     exacte pour les variantes existantes (via `faireOptionsByVid`) ou en
  //     tombant sur la valeur unique de l'axe pour les nouvelles variantes
  //     (Faire « Tallie: TU 38-42 » a 1 seule valeur → sans ambiguïté).
  //   - Dans `variant_option_sets` UNIQUEMENT si BJ en avait envoyé (bloc 2
  //     ci-dessous) : on injecte les axes Faire supplémentaires tels quels
  //     pour que le PATCH ne « supprime » pas Tallie par omission.

  // 1) Reconstruit variants[]
  if (Array.isArray(patchBody.variants)) {
    rewrittenBody.variants = (patchBody.variants as Record<string, unknown>[]).map(
      (v) => {
        const vid = typeof v.id === "string" ? v.id : null;
        const faireOpts = vid ? faireOptionsByVid.get(vid) : undefined;
        const bjOpts = Array.isArray(v.options)
          ? (v.options as { name?: string; value?: string }[])
          : [];
        const rewrittenOptions = bjOpts.map((opt, idx) => {
          const renamedName =
            typeof opt.name === "string"
              ? (nameMap.get(opt.name) ?? opt.name)
              : opt.name;
          // Variante existante : force les valeurs Faire (par index).
          if (faireOpts && faireOpts[idx]) {
            return { name: faireOpts[idx].name, value: faireOpts[idx].value };
          }
          return { name: renamedName, value: opt.value };
        });

        // Axes Faire au-delà de ce que la variante BJ couvre : on complète.
        const appendedOptions: { name: string; value: string }[] = [];
        for (
          let idx = rewrittenOptions.length;
          idx < faireState.variantOptionSets.length;
          idx++
        ) {
          const faireAxis = faireState.variantOptionSets[idx];
          if (faireOpts && faireOpts[idx]) {
            appendedOptions.push({
              name: faireOpts[idx].name,
              value: faireOpts[idx].value,
            });
            continue;
          }
          // Nouvelle variante : on ne peut inférer qu'à condition que l'axe
          // Faire n'ait qu'une seule valeur (cas typique Tallie « TU 38-42 »).
          if (faireAxis.values.length === 1) {
            appendedOptions.push({
              name: faireAxis.name,
              value: faireAxis.values[0],
            });
          }
          // Sinon on saute silencieusement — Faire renverra un 400 explicite
          // sur la variante concernée avec le vrai nom d'axe manquant.
        }

        return {
          ...v,
          options: [...rewrittenOptions, ...appendedOptions],
        };
      },
    );
  }

  // Axes supplémentaires à ajouter dans variant_option_sets — uniquement si
  // BJ a envoyé au moins un set (voir explication au bloc 2 plus bas).
  const extraFaireAxes = faireState.variantOptionSets.slice(bjOptionSets.length);

  // 2) Reconstruit variant_option_sets : name Faire + valeurs mergées, puis
  //    concatène les axes Faire supplémentaires tels quels.
  //    ⚠️ On ne réintroduit `variant_option_sets` QUE si BJ en avait envoyé
  //    à l'origine. En resync forcée sans nouvelle variante, buildPatchBody
  //    omet ce champ à dessein (le PATCH partiel laisse Faire garder son état) —
  //    injecter les axes ici transformerait le PATCH en « replacement » sur
  //    des axes qui n'ont pas bougé, et masquerait des futurs bugs.
  if (bjOptionSets.length > 0) {
    const mergedSets = bjOptionSets.map((set, i) => {
      const faireSet = faireState.variantOptionSets[i];
      if (!faireSet) return set;
      const faireValues = faireSet.values;
      const bjValues = Array.isArray(set.values) ? set.values : [];
      const knownLower = new Set(faireValues.map((v) => v.toLowerCase()));
      const additional: string[] = [];
      for (const v of bjValues) {
        const key = v.toLowerCase();
        if (!knownLower.has(key)) {
          knownLower.add(key);
          additional.push(v);
        }
      }
      return {
        name: faireSet.name,
        values: [...faireValues, ...additional],
      };
    });
    rewrittenBody.variant_option_sets = [
      ...mergedSets,
      ...extraFaireAxes.map((axis) => ({
        name: axis.name,
        values: [...axis.values],
      })),
    ];
  }

  return rewrittenBody;
}

export async function faireUpdateProduct(
  productId: string,
  options?: { forceFullSync?: boolean },
): Promise<FaireUpdateResult> {
  const meta = await loadFaireProductMeta(productId);
  if (!meta) return { success: false, error: "Produit introuvable." };
  if (!meta.faireProductId) {
    return { success: false, error: "Produit pas encore publié sur Faire." };
  }
  const forceFullSync = options?.forceFullSync === true;

  const product = await loadFaireProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable (loader)." };

  // Cohérent avec le filtre côté publish : Faire ne reçoit que les variantes
  // UNIT. Si seules les variantes PACK ont été modifiées, on n'a rien à
  // pousser côté Faire (l'update est un noop côté marketplace).
  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — Faire n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour synchroniser sur Faire.",
    };
  }

  const excludedMadeInIsoCodes = await getCachedFaireMadeInExcluded();
  const ctxResult = buildPublishContext(product, { excludedMadeInIsoCodes });
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
  const tenantId = await getCurrentTenantIdSafe();
  const imageBaseUrl = tenantId ? (await getTenantBaseUrl(tenantId)) ?? undefined : undefined;
  // Badge « Réf » désactivé de force pour Faire depuis 2026-07-30 : malgré
  // plusieurs corrections dimensions/format, Faire ne rend pas le badge dans
  // ses vignettes → on n'envoie plus l'URL brandée. Le toggle DB reste actif
  // pour la boutique + PFS + eFashion.
  const brandedBadgeEnabled = false;
  const { body, variants, productImageUrls } = buildFaireProductPayload(
    product,
    ctx,
    configs.faireWholesale,
    configs.faireRetail,
    lifecycleState === "UNPUBLISHED" ? "PUBLISHED" : lifecycleState,
    `update-${meta.faireProductId}`,
    imageBaseUrl,
    brandedBadgeEnabled,
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

  const realPrevSnapshot = (meta.faireLastSyncSnapshot ?? null) as FaireSyncSnapshot | null;

  // Détection d'un renommage de SKU (typiquement quand l'admin renomme la
  // référence BJ, ex A1720 → A1721 : les SKU passent de A1720_BLEU à
  // A1721_BLEU, mais l'ID Faire `po_xxx` de chaque variante reste identique).
  // Sans traitement dédié, le diff verrait « variante A1720_BLEU supprimée +
  // variante A1721_BLEU créée » → DELETE + CREATE côté Faire = perte de
  // l'URL/historique acheteurs. On envoie donc un PATCH SKU-only sur chaque
  // variante existante et on remappe le snapshot précédent pour que le diff
  // considère la variante inchangée.
  if (realPrevSnapshot) {
    const prevSkuByFaireId = new Map<string, string>();
    const prevByColor = new Map<string, { oldSku: string; faireVariantId: string }>();
    for (const [sku, v] of Object.entries(realPrevSnapshot.variants)) {
      if (v.faireVariantId) prevSkuByFaireId.set(v.faireVariantId, sku);
      if (v.faireVariantId && v.colorOption && !prevByColor.has(v.colorOption)) {
        prevByColor.set(v.colorOption, { oldSku: sku, faireVariantId: v.faireVariantId });
      }
    }
    for (const [newSku, next] of Object.entries(nextSnapshot.variants)) {
      let faireVariantIdToRename: string | null = null;
      let oldSku: string | undefined;
      if (next.faireVariantId) {
        oldSku = prevSkuByFaireId.get(next.faireVariantId);
        if (oldSku && oldSku !== newSku) {
          faireVariantIdToRename = next.faireVariantId;
        }
      } else {
        // Fallback : `ProductColor.faireVariantId` non posé en BDD (liaison
        // ancienne). On matche par colorOption pour retrouver l'ID Faire
        // historique côté snapshot et repropage l'ID sur le nouveau snapshot.
        const match = prevByColor.get(next.colorOption ?? "");
        if (match && match.oldSku !== newSku) {
          oldSku = match.oldSku;
          faireVariantIdToRename = match.faireVariantId;
          next.faireVariantId = match.faireVariantId;
        }
      }
      if (!faireVariantIdToRename || !oldSku) continue;
      const renameRes = await faireRenameVariantSku(
        meta.faireProductId,
        faireVariantIdToRename,
        newSku,
      );
      if (renameRes.success) {
        logger.info("[Faire Update] SKU renommé", {
          productId,
          faireVariantId: faireVariantIdToRename,
          from: oldSku,
          to: newSku,
        });
        // Remappe la variante dans le snapshot précédent sous la nouvelle
        // clé, pour que `diffSnapshots` ne la voie plus comme
        // « supprimée + ajoutée ». On corrige aussi le champ `sku` interne
        // pour rester cohérent en cas de comparaison ultérieure.
        const prevEntry = realPrevSnapshot.variants[oldSku];
        delete realPrevSnapshot.variants[oldSku];
        realPrevSnapshot.variants[newSku] = { ...prevEntry, sku: newSku };
      } else {
        logger.warn("[Faire Update] Rename SKU échoué — le diff va tenter delete+create", {
          productId,
          faireVariantId: faireVariantIdToRename,
          from: oldSku,
          to: newSku,
          error: renameRes.error,
        });
      }
    }
  }

  // En resynchro forcée, on force `prev = null` pour que le diff considère tout
  // comme à pousser (champs produit, variantes, lifecycle). On garde toutefois
  // le snapshot réel pour les fallback (résolution d'ID Faire de variante par SKU).
  // `forceImages: true` demande au diff de marquer aussi les images comme
  // changées — le flow ci-dessous DELETE les anciennes images côté Faire
  // avant le PATCH, ce qui évite l'erreur « 2 images principales » qui est
  // la raison pour laquelle le diff « null prev » les excluait par défaut.
  const prevSnapshot = forceFullSync ? null : realPrevSnapshot;
  const diff = diffSnapshots(prevSnapshot, nextSnapshot, {
    forceImages: forceFullSync,
  });

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
  //
  // Ce même GET sert aussi à :
  //   - réconcilier les `faireVariantId` stockés en BDD contre la réalité Faire
  //     (une variante peut avoir été supprimée côté Faire sans que la BDD ne le
  //     sache — un PATCH sur son vid renverrait alors 404 et casserait toute la
  //     synchro) ;
  //   - récupérer les IDs d'images (racine + variantes) à supprimer avant les
  //     PATCH image (parade « 2 images principales »).
  // On mémoïse la réponse pour éviter 2-3 GET redondants par appel.
  // Narrowed capture pour la closure : TS ne propage pas le `if (!meta)`
  // initial à travers les fermetures, on fige donc l'id ici.
  const faireProductIdForFetch: string = meta.faireProductId;
  type FaireProductState = {
    variants: {
      id: string;
      sku: string;
      images?: { id?: string }[];
      options?: { name?: string; value?: string }[];
    }[];
    rootImages: { id: string; tags?: string[] }[];
    variantOptionSets: { name: string; values: string[] }[];
  };
  let faireProductStateCache: FaireProductState | null | undefined;
  async function getFaireProductState(): Promise<FaireProductState | null> {
    if (faireProductStateCache !== undefined) return faireProductStateCache;
    try {
      const res = await faireFetch(`/products/${encodeURIComponent(faireProductIdForFetch)}`, {
        method: "GET",
      });
      if (!res.ok) {
        logger.warn("[Faire Update] GET product state : status non-OK", {
          productId,
          status: res.status,
        });
        faireProductStateCache = null;
        return null;
      }
      const data = (await res.json().catch(() => null)) as
        | {
            variants?: {
              id?: string;
              sku?: string;
              images?: { id?: string }[];
              options?: { name?: string; value?: string }[];
            }[];
            images?: { id?: string; tags?: string[] }[];
            variant_option_sets?: { name?: string; values?: string[] }[];
          }
        | null;
      faireProductStateCache = {
        variants: (data?.variants ?? []).filter(
          (v): v is {
            id: string;
            sku: string;
            images?: { id?: string }[];
            options?: { name?: string; value?: string }[];
          } => typeof v.id === "string" && typeof v.sku === "string",
        ),
        rootImages: (data?.images ?? []).filter(
          (i): i is { id: string; tags?: string[] } => typeof i.id === "string",
        ),
        variantOptionSets: (data?.variant_option_sets ?? [])
          .filter(
            (s): s is { name: string; values: string[] } =>
              typeof s?.name === "string" && Array.isArray(s?.values),
          )
          .map((s) => ({
            name: s.name,
            values: s.values.filter((v): v is string => typeof v === "string"),
          })),
      };
      return faireProductStateCache;
    } catch (err) {
      logger.warn("[Faire Update] GET product state : exception", {
        productId,
        error: String(err),
      });
      faireProductStateCache = null;
      return null;
    }
  }
  async function resolveFaireVariantId(sku: string, prevId?: string | null): Promise<string | null> {
    if (prevId) return prevId;
    const state = await getFaireProductState();
    if (!state) return null;
    return state.variants.find((v) => v.sku === sku)?.id ?? null;
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

  // 3.ter) Réconciliation vids stales : Faire peut avoir supprimé une variante
  // (via un flow antérieur ou manuellement côté portail) sans que la BDD ne
  // l'apprenne. Sans cette purge, un PATCH sur un vid stale renverrait 404 et
  // ferait échouer toute la synchro à chaque tentative (cas rencontré 2026-07
  // sur W138/Écru : `po_grj7cer22b` en BDD, absent chez Faire). On vérifie
  // chaque vid contre l'état Faire réel, on clear les stales en BDD, et la
  // variante bascule automatiquement dans `newVariantsToCreate` — auto-guérie.
  const staleFaireVariantIds: { bjVariantId: string; sku: string; staleVid: string }[] = [];
  if (faireVariantIdBySku.size > 0) {
    const state = await getFaireProductState();
    if (state !== null) {
      const validVids = new Set(state.variants.map((v) => v.id));
      for (const [sku, vid] of Array.from(faireVariantIdBySku.entries())) {
        if (!validVids.has(vid)) {
          const bjId = bjVariantIdBySku.get(sku);
          if (bjId) staleFaireVariantIds.push({ bjVariantId: bjId, sku, staleVid: vid });
          faireVariantIdBySku.delete(sku);
        }
      }
    }
  }
  if (staleFaireVariantIds.length > 0) {
    logger.warn("[Faire Update] Vids stales purgés — variantes reclassées en création", {
      productId,
      stales: staleFaireVariantIds,
    });
    await prisma.$transaction(
      staleFaireVariantIds.map((s) =>
        prisma.productColor.update({
          where: { id: s.bjVariantId },
          data: { faireVariantId: null },
        }),
      ),
    );
    // Le payload Faire a été construit AVANT la réconciliation avec
    // `buildFaireProductPayload`, qui pose `id: <vid>` sur les variantes
    // ayant un `faireVariantId` en BDD. Pour les stales, ce `id` inconnu
    // de Faire fait rejeter le PATCH consolidé avec « Invalid product
    // variant IDs ». On le retire pour que Faire les traite comme des
    // créations.
    const staleSkus = new Set(staleFaireVariantIds.map((s) => s.sku));
    const bodyRecord = body as Record<string, unknown>;
    if (Array.isArray(bodyRecord.variants)) {
      bodyRecord.variants = (bodyRecord.variants as Record<string, unknown>[]).map((v) => {
        const sku = typeof v.sku === "string" ? v.sku : "";
        if (staleSkus.has(sku) && "id" in v) {
          const { id: _omit, ...rest } = v;
          return rest;
        }
        return v;
      });
    }
  }

  // 3.quinquies) Adoption des vids orphelins par SKU.
  //
  // Cas : une variante BJ dont `faireVariantId` est null en BDD peut
  // correspondre à une variante Faire déjà existante avec le même SKU.
  // Se produit quand un PATCH précédent a bien créé la variante côté Faire
  // mais que notre code n'a pas persisté l'id (timeout réseau, race, job
  // interrompu). Sans adoption, chaque nouvelle tentative renvoie la
  // variante SANS id → Faire rejette avec « Duplicate variants with same
  // options » (2 variantes candidates pour la même valeur Color).
  //
  // Cas vu 2026-09-09 sur W124 : suppression Bleu + ajout Marine. Faire
  // avait créé Marine (`po_aswmet5p84`) mais notre BDD n'a pas retenu
  // l'id → boucle d'erreurs à chaque push jusqu'à réparation manuelle
  // (UPDATE ProductColor).
  const orphanSkus = variants
    .filter((v) => !faireVariantIdBySku.has(v.sku))
    .map((v) => v.sku);
  if (orphanSkus.length > 0) {
    const state = await getFaireProductState();
    if (state) {
      const faireIdBySku = new Map<string, string>();
      for (const fv of state.variants) faireIdBySku.set(fv.sku, fv.id);
      const adoptions: {
        bjVariantId: string;
        sku: string;
        faireVariantId: string;
      }[] = [];
      for (const sku of orphanSkus) {
        const vid = faireIdBySku.get(sku);
        const bjId = bjVariantIdBySku.get(sku);
        if (vid && bjId) {
          adoptions.push({ bjVariantId: bjId, sku, faireVariantId: vid });
          faireVariantIdBySku.set(sku, vid);
        }
      }
      if (adoptions.length > 0) {
        logger.warn("[Faire Update] Vids orphelins adoptés par match SKU", {
          productId,
          adoptions,
        });
        await prisma.$transaction(
          adoptions.map((a) =>
            prisma.productColor.update({
              where: { id: a.bjVariantId },
              data: { faireVariantId: a.faireVariantId },
            }),
          ),
        );
        // Le payload contient déjà ces variantes SANS `id` (car pas de
        // `faireVariantId` en BDD au moment du build). On injecte l'id
        // adopté pour que le PATCH consolidé matche la variante existante
        // au lieu de tenter une re-création (« Duplicate variants »).
        const adoptedBySku = new Map(
          adoptions.map((a) => [a.sku, a.faireVariantId] as const),
        );
        const bodyRecord = body as Record<string, unknown>;
        if (Array.isArray(bodyRecord.variants)) {
          bodyRecord.variants = (
            bodyRecord.variants as Record<string, unknown>[]
          ).map((v) => {
            const sku = typeof v.sku === "string" ? v.sku : "";
            const adoptedVid = adoptedBySku.get(sku);
            if (adoptedVid && !("id" in v)) {
              return { id: adoptedVid, ...v };
            }
            return v;
          });
        }
      }
    }
  }

  // 3.quater) Migration axisless → axe couleur.
  //
  // Cas : Faire connaît le produit avec ≥ 1 variante SANS axe (options: []),
  // typiquement quand la fiche a été publiée à l'époque où elle n'avait qu'un
  // coloris. La cliente a depuis ajouté d'autres couleurs côté BJ et on
  // essaie de sync. Faire refuse alors 2 choses opposées :
  //   1. Envoyer options: [{Color, "X"}] sur la variante existante axisless
  //      → « Product variant options cannot be changed » (HTTP 400).
  //   2. Envoyer variants[] sans options quand il y a > 1 variante
  //      → « A product with multiple variants must have options » (HTTP 400).
  //
  // Seule issue : SUPPRIMER les variantes axisless côté Faire avant le PATCH,
  // pour que Faire nous laisse recréer une structure fresh avec l'axe Color.
  // Après DELETE, on nettoie la BDD (faireVariantId → null) et on invalide le
  // cache d'état ; le calcul de `newVariantsToCreate` juste en dessous
  // reclasse alors ces variantes en création → tout part propre dans le PATCH.
  //
  // Cas vu 2026-08-02 sur issyma JG16 (Bleu Ciel + Blush ajoutés à un p_
  // Faire qui n'avait que Jaune) et JG17 (Bleu ajouté à un p_ qui n'avait
  // que Blanc). Le premier fix (`reconcilePatchBodyWithFaireOptions` qui
  // gardait les options en multi-variant) était juste, il fallait juste ce
  // nettoyage préalable.
  if (variants.length > 1) {
    const preState = await getFaireProductState();
    if (preState && preState.variantOptionSets.length === 0 && preState.variants.length > 0) {
      const axislessVids = preState.variants.map((v) => v.id);
      logger.warn("[Faire Update] Migration axisless → axe : suppression variantes existantes", {
        productId,
        faireProductId: meta.faireProductId,
        vidsToDelete: axislessVids,
      });
      for (const vid of axislessVids) {
        try {
          const delRes = await faireFetch(
            `/products/${encodeURIComponent(meta.faireProductId)}/variants/${encodeURIComponent(vid)}`,
            { method: "DELETE" },
          );
          if (!delRes.ok && delRes.status !== 404) {
            const text = await delRes.text().catch(() => "");
            logger.error("[Faire Update] DELETE variante axisless échoué (migration bloquée)", {
              productId,
              vid,
              status: delRes.status,
              body: text.slice(0, 200),
            });
            return {
              success: false,
              error:
                `Faire ne peut pas ajouter d'axe couleur sur cette fiche (HTTP ${delRes.status} sur suppression de la variante existante). ` +
                `Merci de délier puis relier ce produit à Faire pour repartir sur une fiche propre.`,
            };
          }
        } catch (err) {
          logger.error("[Faire Update] DELETE variante axisless : exception réseau", {
            productId,
            vid,
            error: String(err),
          });
          return {
            success: false,
            error:
              "Erreur réseau Faire lors de la suppression de la variante existante — réessayer dans quelques secondes.",
          };
        }
      }
      // Purge BDD : ces vids ne pointent plus vers rien côté Faire.
      await prisma.productColor.updateMany({
        where: { productId, faireVariantId: { in: axislessVids } },
        data: { faireVariantId: null },
      });
      // Invalide le cache pour que la prochaine `getFaireProductState` renvoie
      // l'état à jour (0 variantes, 0 axe).
      faireProductStateCache = null;
      // Purge notre index SKU → vid pour que la variante ex-axisless bascule
      // en « à créer » dans le calcul de `newVariantsToCreate` juste après.
      const axislessSet = new Set(axislessVids);
      for (const [sku, vid] of Array.from(faireVariantIdBySku.entries())) {
        if (axislessSet.has(vid)) faireVariantIdBySku.delete(sku);
      }
      // Enfin, retire l'id des variantes concernées dans le payload : sans
      // ça, Faire refuserait avec « Invalid product variant IDs » (l'id ne
      // pointe plus vers une variante existante après le DELETE).
      const bodyRecord = body as Record<string, unknown>;
      if (Array.isArray(bodyRecord.variants)) {
        bodyRecord.variants = (bodyRecord.variants as Record<string, unknown>[]).map((v) => {
          if (typeof v.id === "string" && axislessSet.has(v.id)) {
            const { id: _omit, ...rest } = v;
            return rest;
          }
          return v;
        });
      }
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
    // Sur resync forcée : inclut variants[] avec prices[] via le chemin
    // fiable PATCH /products/{id} (batch by-skus laisse parfois le retail
    // inchangé — cf. docs/faire-api.md:63).
    forceFullSync,
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
    const state = await getFaireProductState();
    if (state) {
      // En resync forcé, on supprime TOUTES les images racine (Faire déduplique
      // par hash — renvoyer la même URL sur une image déjà « main » déclenche
      // « Tentative de mise à jour de l'image […] avec 2 images principales »).
      // Hors forceFullSync, on cible seulement les images taguées « Hero »
      // pour éviter la reposition du drapeau vedette.
      const imagesToDelete = forceFullSync
        ? state.rootImages
        : state.rootImages.filter((img) => (img.tags ?? []).includes("Hero"));
      // Faire interdit de supprimer la DERNIÈRE image d'un produit publié
      // (HTTP 400). On garde donc au moins 1 image en stock à chaque DELETE.
      let remaining = state.rootImages.length;
      for (const img of imagesToDelete) {
        if (remaining <= 1) break;
        try {
          const delRes = await faireFetch(
            `/products/${encodeURIComponent(meta.faireProductId)}/images/${encodeURIComponent(img.id)}`,
            { method: "DELETE" },
          );
          if (delRes.ok || delRes.status === 404) {
            remaining -= 1;
          } else {
            logger.warn("[Faire Update] DELETE image racine : status non-OK", {
              productId,
              imgId: img.id,
              status: delRes.status,
            });
          }
        } catch (err) {
          logger.warn("[Faire Update] DELETE image racine : exception", {
            productId,
            imgId: img.id,
            error: String(err),
          });
        }
      }
    }
  }

  if (hasProductPatchPayload) {
    // Réconciliation options ↔ Faire — évite « Product variant options cannot
    // be changed » quand notre nom de dimension ou nos libellés de valeurs
    // divergent de ce que Faire a stocké. Cas connus :
    //   - dimension « Color » (nous) vs « Couleur » (Faire, produit publié FR)
    //   - « Brun foncé » (nous) vs « marron » (casse/libellé Faire différents)
    //   - Faire sans axe du tout (produit à variante unique — voir docstring)
    // Doit tourner dès qu'on envoie `variants[]` dans le PATCH : soit pour
    // créer de nouvelles variantes (`hasNewVariants`), soit pour repousser
    // l'existant (`forceFullSync`). Sans cette généralisation, la resync
    // forcée d'un produit lié échoue avec 400 (régression 2026-07-30 sur
    // Issyma : 779, 8625, 89079-2, JG162, JG61, JG65 — audit PFS → sync Faire).
    let bodyToSend: Record<string, unknown> = patchBody;
    if (Array.isArray(patchBody.variants)) {
      const state = await getFaireProductState();
      if (state) {
        bodyToSend = reconcilePatchBodyWithFaireOptions(patchBody, state);
      }
    }
    try {
      const res = await faireFetch(`/products/${encodeURIComponent(meta.faireProductId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(bodyToSend),
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
        // Faire renvoie 404 avec `message: "p_xxx"` quand le produit a été
        // supprimé côté portail Faire (id orphelin en BDD). On surface un
        // message clair invitant la cliente à re-lier la fiche.
        if (res.status === 404 && humanMsg.trim() === meta.faireProductId) {
          return {
            success: false,
            error: "Produit non existant sur Faire — veuillez le relier depuis la modale Faire.",
          };
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

  // Variantes fantômes détectées à ce stade (PATCH variant 404) : leur
  // faireVariantId en BDD pointe vers un vid Faire supprimé. La purge amont
  // (bloc « 3.ter ») ne les a pas attrapées — soit le GET produit avait été
  // mis en cache avant la disparition, soit Faire a supprimé la variante en
  // réponse au PATCH product qui vient d'être envoyé. On les nettoie ici,
  // on les ré-inclura comme créations à la prochaine synchro.
  const stalesPurgedInLoop: { sku: string; staleVid: string }[] = [];

  // ⚠️ Bug Faire « 2 images principales » : même quand le diff identifie qu'une
  // image a changé (variantsImagesChanged.has(sku) = true), envoyer la nouvelle
  // URL directement dans le PATCH variant échoue avec HTTP 400 « Tentative de
  // mise à jour de l'image pour 'Couleur' avec 2 images principales » — Faire
  // tente de poser is_main=true sur la nouvelle image mais l'ancienne porte
  // déjà ce drapeau. Parade : DELETE chacune des images existantes côté Faire
  // pour cette variante AVANT le PATCH, puis envoyer les nouvelles dans le
  // PATCH (Faire les recrée propres sans conflit).
  //
  // Optimisation : on réutilise le state Faire déjà fetché plus haut (cache).
  const faireImageIdsByFaireVariantId = new Map<string, string[]>();
  if (variantsImagesChangedSet.size > 0) {
    const state = await getFaireProductState();
    if (state) {
      for (const v of state.variants) {
        const ids = (v.images ?? [])
          .map((i) => i.id)
          .filter((id): id is string => typeof id === "string");
        if (ids.length > 0) faireImageIdsByFaireVariantId.set(v.id, ids);
      }
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
        // Cas 404 : la variante existe encore en BDD BJ mais Faire ne la
        // connaît plus (suppression manuelle sur le portail, ou race avec le
        // PATCH product qu'on vient d'envoyer). Plutôt que bloquer toute la
        // synchro, on purge le vid côté BDD et on saute cette variante — la
        // prochaine synchro la ré-inclura dans variants[] comme création.
        if (res.status === 404) {
          logger.warn("[Faire Update] PATCH variant 404 — variante fantôme purgée", {
            productId,
            sku,
            faireVid,
          });
          const bjVariantId = bjVariantIdBySku.get(sku);
          if (bjVariantId) {
            await prisma.productColor.update({
              where: { id: bjVariantId },
              data: { faireVariantId: null },
            });
          }
          if (nextSnapshot.variants[sku]) {
            nextSnapshot.variants[sku].faireVariantId = null;
          }
          faireVariantIdBySku.delete(sku);
          stalesPurgedInLoop.push({ sku, staleVid: faireVid });
          continue;
        }
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
  // En resynchro forcée, on pousse le stock de TOUTES les variantes (même 0)
  // pour aligner Faire sur la BDD, indépendamment du diff. Sinon, on garde
  // la logique nominale basée sur le diff.
  // Skus dont le vid a été purgé pendant la boucle PATCH variant : on saute
  // stock/prix pour eux (la variante n'existe plus côté Faire ; la prochaine
  // synchro la recréera avec son stock/prix initial via le PATCH consolidé).
  const stalePurgedSkuSet = new Set(stalesPurgedInLoop.map((s) => s.sku));
  const stockUpdates = (forceFullSync
    ? Object.keys(nextSnapshot.variants).filter((sku) =>
        faireVariantIdBySku.has(sku),
      )
    : Array.from(
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
      )
  ).filter((sku) => !stalePurgedSkuSet.has(sku));
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
    let inv = await faireUpdateInventory(updates);
    if (!inv.success && hasNewVariants) {
      logger.warn("[Faire Update] Inventory échec après création — retry dans 3s", {
        productId,
        failedCount: inv.failedCount,
      });
      await new Promise((r) => setTimeout(r, 3000));
      inv = await faireUpdateInventory(updates);
    }
    // Signal « SKU inconnu chez Faire » : les endpoints batch by-skus matchent
    // uniquement les SKU que Faire connaît (pas via l'ID de variante). Après
    // une liaison manuelle, les variantes Faire portent souvent l'ancien SKU
    // brand → tout le batch est rejeté 404. On stoppe le flow et on demande
    // à l'admin de délier/relier (le rename SKU dans linkFaireProductManually
    // évite ça à l'avenir).
    if (!inv.success && inv.unknownSku) {
      return {
        success: false,
        error:
          `Faire ne reconnaît pas le code de variante « ${inv.unknownSku} ». ` +
          `Merci de délier puis relier ce produit à Faire depuis la modale.`,
      };
    }
  }

  // Prix à part : même règle que le stock — Faire les ignore quand on les
  // envoie via PATCH variant individuel. On pousse les SKU dont le prix a
  // changé (qu'ils aient été classés pricesOnly OU mélangés à un changement
  // structurel) via le batch /product-prices/by-skus.
  // En resynchro forcée, on pousse les prix de TOUTES les variantes liées
  // (Faire ignore les prix dans le PATCH variant individuel — on doit donc
  // passer par /product-prices/by-skus). Sinon, on s'appuie sur le diff.
  const priceChangedSkus = forceFullSync
    ? new Set<string>(
        Object.keys(nextSnapshot.variants).filter((sku) =>
          faireVariantIdBySku.has(sku),
        ),
      )
    : new Set<string>([
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
  for (const sku of stalePurgedSkuSet) priceChangedSkus.delete(sku);
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
      // Même filet que pour l'inventory : un SKU inconnu côté Faire rejette
      // tout le batch en bloc. On surface un message clair à l'admin.
      if (pricesRes.unknownSku) {
        return {
          success: false,
          error:
            `Faire ne reconnaît pas le code de variante « ${pricesRes.unknownSku} ». ` +
            `Merci de délier puis relier ce produit à Faire depuis la modale.`,
        };
      }
      return {
        success: false,
        error: `PATCH prix échoué (${pricesRes.failedCount}/${priceUpdates.length} SKU).`,
      };
    }
  }

  // Si des variantes fantômes ont été nettoyées dans la boucle PATCH variant,
  // on garde `faireSyncRequired = true` pour que la prochaine synchro les
  // recrée via le PATCH consolidé (variants[]). Le badge orange « Synchro
  // nécessaire » reste donc affiché côté admin, signal explicite qu'il faut
  // relancer.
  if (stalesPurgedInLoop.length > 0) {
    logger.warn("[Faire Update] Vids stales purgés en cours de boucle — resync requise", {
      productId,
      stales: stalesPurgedInLoop,
    });
    await prisma.product.update({
      where: { id: productId },
      data: { faireLastSyncSnapshot: nextSnapshot as unknown as Prisma.JsonObject },
    });
    try {
      revalidateTag("products", "default");
    } catch {
      // hors contexte Next
    }
    return { success: true, diff, noop: false };
  }

  // Sync `lifecycle_state` par variante — masque/publie côté Faire selon
  // `ProductColor.disabled`, sans toucher au stock. On calcule le diff par
  // rapport au snapshot précédent pour n'envoyer un PATCH que quand nécessaire
  // (Faire limite les appels — 429 fréquent en bulk).
  const lifecycleUpdates: FaireVariantLifecycleUpdate[] = [];
  for (const [sku, next] of Object.entries(nextSnapshot.variants)) {
    if (!next.faireVariantId) continue;
    const prev = realPrevSnapshot?.variants[sku];
    const prevDisabled = prev?.disabled;
    const nextDisabled = next.disabled ?? false;
    // Envoie si : premier sync (pas de prev), snapshot pré-2026-08-26
    // (prevDisabled === undefined), ou changement d'état.
    if (prevDisabled === nextDisabled) continue;
    lifecycleUpdates.push({
      faireProductId: meta.faireProductId,
      faireVariantId: next.faireVariantId,
      target: lifecycleFromDisabled(nextDisabled),
    });
  }
  if (lifecycleUpdates.length > 0) {
    const lifecycleRes = await faireSyncVariantLifecycles(lifecycleUpdates);
    if (!lifecycleRes.success) {
      logger.warn("[Faire Update] lifecycle variants partiel", {
        productId,
        failed: lifecycleRes.failedCount,
        updated: lifecycleRes.updatedCount,
      });
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
