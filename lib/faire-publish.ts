/**
 * Faire Publish — POST /products + PATCH inventory + sauvegarde des IDs.
 *
 * Chaîne synchrone (Faire n'a pas de mode callback async pour la création) :
 *   1. loadProductFull       — charge le produit BJ avec ses couleurs/images
 *   2. validate              — utilise faire-shape pour pré-rejeter
 *   3. POST /products        — crée en DRAFT par défaut
 *   4. lit la réponse        — récupère `id` produit + `id` de chaque variante
 *   5. mappe en BDD          — faireProductId + ProductColor.faireVariantId
 *   6. PATCH inventory bulk  — pousse le stock réel (le available_quantity
 *                              envoyé dans le POST initial est ignoré)
 *   7. sauve le snapshot     — pour permettre les diffs incrémentaux ensuite
 *
 * Note proxy images : Faire exige JPEG/PNG ≥ 1000×1000. Le proxy actuel
 * `/api/marketplace-image` renvoie du WebP tel quel. L'extension JPEG du
 * proxy (`?format=jpeg`) sera ajoutée en étape 3.B — pour le moment le helper
 * d'URL annote le param mais le proxy l'ignorera silencieusement (= le test
 * réel reste à faire en 3.B).
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { faireFetch } from "@/lib/faire-api";
import { buildFaireVariantSkus } from "@/lib/faire-sku";
import {
  applyFaireMarkupWithClamp,
  loadMarketplaceMarkupConfigs,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import { buildFaireDescription } from "@/lib/faire-description";
import {
  validateFaireProductShape,
  type FaireShapeValidation,
} from "@/lib/faire-shape";
import {
  faireUpdateInventory,
  type FaireInventoryUpdate,
} from "@/lib/faire-inventory";
import {
  FAIRE_SNAPSHOT_VERSION,
  type FaireSyncSnapshot,
  type FaireVariantSnapshot,
} from "@/lib/faire-sync-diff";
import { buildFaireImageUrl } from "@/lib/marketplace-image";
import { buildBrandedMarketplaceUrl } from "@/lib/branded-image-display";
import { getCurrentTenantIdSafe, getTenantBaseUrl } from "@/lib/tenant";
import { getCachedFaireMadeInExcluded } from "@/lib/cached-data";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type FairePublishResult =
  | {
      success: true;
      faireProductId: string;
      variantMap: { bjVariantId: string; sku: string; faireVariantId: string | null }[];
      warnings: string[];
    }
  | { success: false; error: string; details?: FaireShapeValidation };

interface FullVariant {
  id: string;
  faireVariantId: string | null;
  unitPrice: Prisma.Decimal | number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  disabled: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  colorId: string | null;
  color: { id: string; name: string } | null;
  faireColorNameOverride: string | null;
  variantSizes: { size: { name: string }; quantity: number }[];
  packLines: {
    colorId: string;
    color: { id: string; name: string };
    position: number;
    faireColorNameOverride: string | null;
    sizes: { size: { name: string }; quantity: number }[];
  }[];
}

/** Retourne le nom envoyé à Faire : override trim si présent, sinon Color.name. */
export function faireColorNameOf(
  colorName: string | undefined,
  override: string | null | undefined,
): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : (colorName ?? "Couleur");
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  primaryColorId: string | null;
  hsCode: { code: string } | null;
  category: {
    id: string;
    name: string;
    faireTaxonomyId: string | null;
  } | null;
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: Prisma.Decimal | number;
    composition: { name: string };
  }[];
  countryIsoCode: string | null;
  // Dimensions stockées en mm dans la BDD (cohérent avec Faire qui attend des mm).
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  // Détail texte associé à la "Taille Unique" (ex : "38-42"), rendu en fin de
  // description Faire : « Taille Unique (38-42) ».
  sizeDetailsTu: string | null;
}

// ─────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────

export async function loadFaireProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      primaryColorId: true,
      hsCode: { select: { code: true } },
      category: {
        select: {
          id: true,
          name: true,
          faireTaxonomyId: true,
        },
      },
      colors: {
        select: {
          id: true,
          faireVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          disabled: true,
          saleType: true,
          packQuantity: true,
          colorId: true,
          color: { select: { id: true, name: true } },
          faireColorNameOverride: true,
          variantSizes: { select: { size: { select: { name: true } }, quantity: true } },
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true } },
              position: true,
              faireColorNameOverride: true,
              sizes: {
                select: { size: { select: { name: true } }, quantity: true },
                orderBy: { size: { position: "asc" as const } },
              },
            },
            orderBy: { position: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" as const },
      },
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true } },
        },
      },
      countryIsoCode: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      sizeDetailsTu: true,
    },
  }) as unknown as FullProduct | null;
}

// ─────────────────────────────────────────────
// Pricing / image helpers
// ─────────────────────────────────────────────

function getVariantUnitPrice(v: FullVariant): number {
  return Number(v.unitPrice);
}

/**
 * Prix wholesale + retail à envoyer à Faire pour une variante donnée.
 * Pour les PACK, le markup s'applique au prix unitaire (total / packQuantity),
 * puis ×packQuantity pour reconstituer le total. C'est la même règle que les
 * autres marketplaces (cf. `lib/marketplace-pricing.ts` doc PACK).
 */
function getFaireVariantPrices(
  v: FullVariant,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig,
): { wholesaleCents: number; retailCents: number } {
  let basePrice = getVariantUnitPrice(v);
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    basePrice = basePrice / v.packQuantity;
  }
  const { wholesale, retail } = applyFaireMarkupWithClamp(
    basePrice,
    wholesaleConfig,
    retailConfig,
  );

  let wholesaleFinal = wholesale;
  let retailFinal = retail;
  if (v.saleType === "PACK" && v.packQuantity && v.packQuantity > 0) {
    wholesaleFinal = wholesale * v.packQuantity;
    retailFinal = retail * v.packQuantity;
  }

  return {
    wholesaleCents: Math.round(wholesaleFinal * 100),
    retailCents: Math.round(retailFinal * 100),
  };
}

function buildImagesByColorId(
  colorImages: { path: string; order: number; colorId: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const sorted = [...colorImages].sort((a, b) => a.order - b.order);
  for (const img of sorted) {
    if (!map.has(img.colorId)) map.set(img.colorId, []);
    map.get(img.colorId)!.push(img.path);
  }
  return map;
}

function packColorLabel(v: FullVariant): string {
  if (v.packLines.length > 0) {
    return v.packLines
      .map((pl) => faireColorNameOf(pl.color?.name, pl.faireColorNameOverride))
      .join("/");
  }
  return faireColorNameOf(v.color?.name, v.faireColorNameOverride);
}

function effectiveStock(v: FullVariant, productStatus: string): number {
  if (productStatus === "ARCHIVED") return 0;
  // Variante désactivée localement : Faire n'a pas de vrai flag « désactiver »
  // par variante — la seule façon propre de la rendre inachetable côté portail
  // est de pousser stock = 0. Le vrai stock reste en BDD (réactivable).
  if (v.disabled) return 0;
  return v.stock ?? 0;
}

// ─────────────────────────────────────────────
// Payload builder
// ─────────────────────────────────────────────

export interface FairePublishContext {
  taxonomyTypeId: string;
  /** Code SH brut (ex : "7117.19.00"). Posé en `tariff_code` sur chaque variante. */
  tariffCode: string | null;
  /** Pays alpha-2 ISO (ex : "CN", "FR"). Envoyé en `made_in_country`. */
  countryAlpha2: string;
  /** Description finale (description produit + composition + code SH automatiques). */
  description: string;
  countryUsedFallback: boolean;
}

export interface FaireVariantPayload {
  bjVariantId: string;
  sku: string;
  /** Cents EUR — gardés à part pour les snapshots/diff, PAS envoyés à Faire. */
  wholesalePriceCents: number;
  retailPriceCents: number;
  payload: {
    /**
     * ID Faire `po_xxx` de la variante existante. Présent UNIQUEMENT pour
     * les variantes déjà publiées (matching par id côté Faire au PATCH).
     * Absent à la création — Faire le génère lui-même.
     */
    id?: string;
    /** Stable per BJ ProductColor — réutilisé sur retry (idempotence Faire). */
    idempotence_token: string;
    sku: string;
    name: string;
    available_quantity: number;
    active: boolean;
    options: { name: string; value: string }[];
    images?: { url: string }[];
    measurements?: {
      weight?: number;
      mass_unit?: "GRAMS";
      length?: number;
      width?: number;
      height?: number;
      distance_unit?: "CENTIMETERS";
    };
    /** Code SH douanier (ex : "7117.19.00"). Faire le veut sur la variante. */
    tariff_code?: string;
    /**
     * Prix par région. Format moderne (depuis 2021). Les champs racine
     * `wholesale_price_cents` / `retail_price_cents` sont DÉPRÉCIÉS et
     * interprétés par Faire comme un prix en devise par défaut (USD), ce qui
     * crée des incohérences de geo_constraints entre variantes. On envoie
     * UNIQUEMENT `prices[]` avec geo_constraint explicite EUROPEAN_UNION/EUR
     * pour que toutes les variantes (existantes ou nouvelles) aient le même
     * périmètre géographique. Tout autre champ briserait la règle « consistent
     * prices for different countries » que Faire vérifie au PATCH.
     */
    prices: {
      geo_constraint: { country_group: "EUROPEAN_UNION" };
      wholesale_price: { amount_minor: number; currency: "EUR" };
      retail_price: { amount_minor: number; currency: "EUR" };
    }[];
    /** Quantité par carton (>0). Pour vente à l'unité, 1. */
    unit_multiplier?: number;
  };
}

/**
 * Décide si le produit doit exposer un axe `Size` en plus de `Color` côté Faire.
 *
 * Règle : uniquement si les variantes UNIT couvrent au moins DEUX tailles
 * distinctes. Sinon on garde 1 seul axe Color (comportement historique).
 *
 * Pourquoi ce seuil : les 1051 produits déjà en ligne sur Faire ont tous
 * « Taille unique » comme unique valeur de taille. Ne pas activer l'axe Size
 * pour eux garantit que leur SKU et leur schéma d'options restent inchangés
 * au prochain resync — pas de faux diff, pas de recréation de variantes côté
 * Faire. Le déclenchement se fait naturellement pour les 42 produits bloqués
 * (bagues H30, H32, etc.) qui ont plusieurs tailles réelles.
 */
function shouldExposeSizeAxis(product: FullProduct): boolean {
  const sizes = new Set<string>();
  for (const c of product.colors) {
    if (c.saleType !== "UNIT") continue;
    for (const s of c.variantSizes) sizes.add(s.size.name);
  }
  return sizes.size >= 2;
}

/**
 * "Ligne Faire" élémentaire : un couple (variante BJ, taille) qui produira
 * exactement une entrée dans le tableau `variants[]` envoyé à Faire.
 *
 * - Quand l'axe Size est actif : chaque `variantSize` d'une variante BJ UNIT
 *   génère une ligne. Une variante BJ multi-taille produit N lignes qui
 *   partagent le même `bjVariantId` (le mapping stock/prix côté Faire pointe
 *   vers la même variante en BDD).
 * - Quand l'axe Size est inactif : une seule ligne par variante BJ (avec
 *   `sizeName = null`), stock = stock global de la variante.
 */
interface FaireLine {
  bjVariant: FullVariant;
  sizeName: string | null;
  /** Stock effectif de cette ligne (par taille si axe actif, sinon global). */
  stockEffective: number;
}

function buildFaireLines(
  product: FullProduct,
  sizeAxis: boolean,
): FaireLine[] {
  const lines: FaireLine[] = [];
  for (const v of product.colors) {
    if (sizeAxis) {
      // Une ligne par taille. Si la variante n'a aucune taille alors qu'on
      // active l'axe (cas mixte hypothétique), on skip — Faire exige que toutes
      // les variantes aient une valeur pour chaque axe déclaré. En pratique,
      // shouldExposeSizeAxis ne renvoie true que quand ≥ 2 tailles existent,
      // donc les variantes sans taille sont marginales.
      for (const s of v.variantSizes) {
        // Variante désactivée = toutes ses lignes-taille passent à 0.
        const perSize = product.status === "ARCHIVED" || v.disabled ? 0 : s.quantity;
        lines.push({ bjVariant: v, sizeName: s.size.name, stockEffective: perSize });
      }
    } else {
      lines.push({ bjVariant: v, sizeName: null, stockEffective: effectiveStock(v, product.status) });
    }
  }
  return lines;
}

export function buildFaireProductPayload(
  product: FullProduct,
  ctx: FairePublishContext,
  wholesaleConfig: MarkupConfig,
  retailConfig: MarkupConfig,
  lifecycleState: "DRAFT" | "PUBLISHED" = "DRAFT",
  idempotenceSalt: string = Date.now().toString(36),
  /**
   * URL de base publique du tenant courant (ex : `https://issyma.fr`). Utilisée
   * pour bâtir les URLs `/api/marketplace-image?...` envoyées à Faire. Sans ce
   * paramètre, le fallback env (`NEXTAUTH_URL` = `beliandjolie.com` en prod)
   * ferait pointer les images Issyma sur le domaine BJ → refus 403 côté proxy
   * (isolation multi-tenant du path).
   */
  imageBaseUrl?: string,
  /**
   * Toggle `branded_reference_badge_enabled`. Quand true, la 1ʳᵉ image de la
   * couleur principale est remplacée par l'URL `/api/branded-image?...` qui
   * compose le badge « Réf » à la volée (JPEG pour Faire).
   */
  brandedBadgeEnabled: boolean = false,
): {
  body: Record<string, unknown>;
  variants: FaireVariantPayload[];
  optionValues: string[];
  productImagesCount: number;
  productImageUrls: string[];
} {
  const imagesByColorId = buildImagesByColorId(product.colorImages);
  const sizeAxis = shouldExposeSizeAxis(product);
  const lines = buildFaireLines(product, sizeAxis);

  // Helper URL Faire pour une image donnée : bascule sur /api/branded-image
  // (format JPEG, minWidth 1000) quand c'est la 1ère image de la couleur
  // principale ET que le toggle badge est actif.
  const brandedBaseUrl =
    imageBaseUrl ??
    process.env.MARKETPLACE_IMAGE_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "https://beliandjolie.com";
  const faireUrlFor = (
    path: string,
    context: { colorId: string | null; index: number },
  ): string => {
    if (
      brandedBadgeEnabled &&
      product.primaryColorId &&
      context.colorId === product.primaryColorId &&
      context.index === 0
    ) {
      return buildBrandedMarketplaceUrl(path, product.reference, {
        baseUrl: brandedBaseUrl,
        size: "large",
        format: "jpeg",
        minWidth: 1000,
      });
    }
    return buildFaireImageUrl(path, imageBaseUrl);
  };

  const skuByLine = buildFaireVariantSkus(
    product.reference,
    lines.map((l) => ({
      // Suffixe l'ID BJ avec la taille pour garantir un SKU unique par ligne
      // quand une même variante BJ est éclatée en N lignes (multi-taille).
      // Le suffixe entre dans les 8 derniers chars → contribue à l'unicité.
      id: sizeAxis && l.sizeName
        ? `${l.bjVariant.id}-${l.sizeName}`
        : l.bjVariant.id,
      saleType: l.bjVariant.saleType,
      color: l.bjVariant.color,
      sizeName: sizeAxis ? l.sizeName : null,
    })),
  );

  const variants: FaireVariantPayload[] = [];
  const colorValuesSet = new Set<string>();
  const sizeValuesSet = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const v = line.bjVariant;
    const lineKey = sizeAxis && line.sizeName ? `${v.id}-${line.sizeName}` : v.id;
    const sku = skuByLine.get(lineKey) ?? v.id;
    const prices = getFaireVariantPrices(v, wholesaleConfig, retailConfig);
    const stock = line.stockEffective;
    const colorLabel = v.saleType === "PACK" ? packColorLabel(v) : faireColorNameOf(v.color?.name, v.faireColorNameOverride);
    colorValuesSet.add(colorLabel);
    if (sizeAxis && line.sizeName) sizeValuesSet.add(line.sizeName);

    const imgPaths = imagesByColorId.get(v.colorId ?? "") ?? [];
    // `sequence` (0-indexed) : Faire utilise ce champ pour l'ordre d'affichage
    // côté galerie de la variante. Sans ça, Faire conserve l'ordre historique
    // des images existantes même quand on PATCH avec un nouveau tableau.
    // Toggle badge sur couleur principale : on INSÈRE l'URL brandée en tête
    // (sequence 0) puis on enchaîne avec les photos SUIVANTES (imgPaths[1..]).
    // On NE remet PAS imgPaths[0] en version brute juste après : côté variante,
    // Faire n'accepte qu'une seule image « principale » (pas de tag Hero
    // supporté au niveau variante) et considère la branded + la raw de la même
    // source comme 2 candidates → refuse le PATCH avec HTTP 400 « 2 images
    // principales pour 'X' » (incident U02/Multicolore 2026-07-29).
    let variantImagesList: { url: string; sequence: number }[] | undefined;
    if (imgPaths.length > 0) {
      const brandedUrl = faireUrlFor(imgPaths[0]!, { colorId: v.colorId ?? null, index: 0 });
      const rawFirstUrl = faireUrlFor(imgPaths[0]!, { colorId: v.colorId ?? null, index: 999 });
      const isBrandedInserted = brandedUrl !== rawFirstUrl;
      if (isBrandedInserted) {
        variantImagesList = [
          { url: brandedUrl, sequence: 0 },
          ...imgPaths.slice(1, 5).map((p, idx) => ({
            url: faireUrlFor(p, { colorId: v.colorId ?? null, index: 999 }),
            sequence: idx + 1,
          })),
        ];
      } else {
        variantImagesList = imgPaths.slice(0, 5).map((p, idx) => ({
          url: faireUrlFor(p, { colorId: v.colorId ?? null, index: idx }),
          sequence: idx,
        }));
      }
    }
    const images = variantImagesList;

    // measurements (schéma `ExternalMeasurementsV2`, cf. docs/faire-api.md §6).
    // - weight : poids en grammes (BDD = kg → ×1000). `mass_unit` obligatoire si weight.
    // - length/width/height : dimensions au niveau VARIANTE (BJ les stocke au niveau
    //   produit en mm, on convertit ÷10 pour envoyer en CENTIMETERS — unité
    //   naturelle pour Faire et plus lisible côté portail brand). `distance_unit`
    //   obligatoire si dim.
    const measurementsObj: NonNullable<FaireVariantPayload["payload"]["measurements"]> = {};
    if (v.weight > 0) {
      measurementsObj.weight = Math.round(v.weight * 1000);
      measurementsObj.mass_unit = "GRAMS";
    }
    const hasAnyDim =
      (product.dimensionLength && product.dimensionLength > 0) ||
      (product.dimensionWidth && product.dimensionWidth > 0) ||
      (product.dimensionHeight && product.dimensionHeight > 0);
    if (hasAnyDim) {
      // Arrondi à 1 décimale pour rester précis sans bruit (ex 42 mm → 4.2 cm).
      const mmToCm = (mm: number) => Math.round((mm / 10) * 10) / 10;
      if (product.dimensionLength && product.dimensionLength > 0)
        measurementsObj.length = mmToCm(product.dimensionLength);
      if (product.dimensionWidth && product.dimensionWidth > 0)
        measurementsObj.width = mmToCm(product.dimensionWidth);
      if (product.dimensionHeight && product.dimensionHeight > 0)
        measurementsObj.height = mmToCm(product.dimensionHeight);
      measurementsObj.distance_unit = "CENTIMETERS";
    }
    const measurements = Object.keys(measurementsObj).length > 0 ? measurementsObj : undefined;

    const sizeSuffix = sizeAxis && line.sizeName ? ` — ${line.sizeName}` : "";
    const variantName =
      v.saleType === "PACK" && v.packQuantity
        ? `${colorLabel} (pack ${v.packQuantity})${sizeSuffix}`
        : `${colorLabel}${sizeSuffix}`;

    // Options envoyées à Faire : toujours Color, + Size quand l'axe est actif.
    // Les 2 axes doivent apparaître dans le même ordre que `variant_option_sets`
    // — Faire n'y attache pas de sémantique mais rester cohérent facilite la
    // lecture du portail.
    const optionsPayload: { name: string; value: string }[] = [
      { name: "Color", value: colorLabel },
    ];
    if (sizeAxis && line.sizeName) {
      optionsPayload.push({ name: "Size", value: line.sizeName });
    }

    variants.push({
      bjVariantId: v.id,
      sku,
      wholesalePriceCents: prices.wholesaleCents,
      retailPriceCents: prices.retailCents,
      payload: {
        // `id` Faire si on connaît déjà la variante. Permet à PATCH
        // /products/{id} de matcher proprement les variantes existantes au
        // lieu de croire qu'on crée des doublons (« Duplicate variants with
        // same options »). Absent pour les nouvelles variantes → Faire les
        // crée à partir du payload.
        //
        // ⚠️ On ne réutilise l'ID Faire QUE quand une seule ligne existe pour
        // cette variante BJ (`v.faireVariantId` désigne une variante Faire
        // unique). Dans le cas éclaté multi-taille, plusieurs lignes partagent
        // le même bjVariantId mais chaque taille est une variante Faire
        // distincte — on laisse Faire matcher par SKU.
        ...(v.faireVariantId && !(sizeAxis && line.sizeName)
          ? { id: v.faireVariantId }
          : {}),
        // Token unique par ligne (variante + taille) + salt timestamp. Sans
        // la taille, deux lignes issues d'une même variante BJ multi-taille
        // partageraient le même token → Faire rejetterait pour cause de
        // duplicate idempotence.
        idempotence_token: line.sizeName
          ? `bj-var-${v.id}-${line.sizeName}-${idempotenceSalt}`
          : `bj-var-${v.id}-${idempotenceSalt}`,
        sku,
        name: variantName,
        available_quantity: stock,
        // Une variante désactivée doit être `active: false` côté Faire pour ne
        // plus s'afficher, en plus du stock 0. Sans ça, elle reste visible
        // « épuisée » sur le portail alors que la cliente l'a explicitement
        // masquée.
        active: !v.disabled && (stock > 0 || product.status !== "ARCHIVED"),
        options: optionsPayload,
        ...(images ? { images } : {}),
        ...(measurements ? { measurements } : {}),
        ...(ctx.tariffCode ? { tariff_code: ctx.tariffCode } : {}),
        // Quantité par carton — Faire impose > 0 dès qu'on envoie `prices`.
        // 1 = vente à l'unité (pas d'emballage par carton).
        unit_multiplier: 1,
        // Prix EUR explicite avec geo_constraint EUROPEAN_UNION.
        // PAS de `wholesale_price_cents` ni `retail_price_cents` racine :
        // Faire les déprécie depuis 2021 et les considère comme un prix dans
        // la devise par défaut de la brand (USD) → casse la cohérence des
        // geo_constraints entre variantes au PATCH (« All variants must have
        // consistent prices for different countries »).
        prices: [
          {
            geo_constraint: { country_group: "EUROPEAN_UNION" as const },
            wholesale_price: { amount_minor: prices.wholesaleCents, currency: "EUR" as const },
            retail_price: { amount_minor: prices.retailCents, currency: "EUR" as const },
          },
        ],
      },
    });
  }

  // Images niveau produit — Faire exige au moins 1 image racine pour publier
  // (erreur PUBLISHED_PRODUCT_NEEDS_AT_LEAST_ONE_IMAGE sinon, même si chaque
  // variante a ses images).
  //
  // Stratégie « couleur principale d'abord » : on monte la galerie principale
  // Faire en mettant TOUTES les photos de la couleur primaire d'abord (dans
  // leur ordre BDD), puis TOUTES les photos des autres couleurs (dans l'ordre
  // BJ). Max 5 images.
  //
  // Choix cliente (juin 2026, sur F137) : préférable que la galerie Faire
  // expose la couleur principale complètement plutôt que d'alterner les
  // couleurs. Les autres couleurs restent visibles dans les variantes en bas
  // de fiche Faire.
  const orderedColorIds: string[] = [];
  if (product.primaryColorId && imagesByColorId.has(product.primaryColorId)) {
    orderedColorIds.push(product.primaryColorId);
  }
  for (const c of product.colors) {
    const cid = c.colorId;
    if (cid && imagesByColorId.has(cid) && !orderedColorIds.includes(cid)) {
      orderedColorIds.push(cid);
    }
  }

  const galleryPaths: string[] = [];
  const seenPaths = new Set<string>();
  for (const cid of orderedColorIds) {
    const imgs = imagesByColorId.get(cid) ?? [];
    for (const img of imgs) {
      if (!seenPaths.has(img)) {
        galleryPaths.push(img);
        seenPaths.add(img);
        if (galleryPaths.length >= 5) break;
      }
    }
    if (galleryPaths.length >= 5) break;
  }

  // Image vedette Faire (« mettre à la une » côté portail) = image qui porte
  // le tag `"Hero"`. Ce tag est INDÉPENDANT de `sequence` : Faire affichait
  // toujours l'ancienne vedette même quand on changeait l'ordre du tableau.
  // En envoyant explicitement `tags: ["Hero"]` sur la 1ʳᵉ image du payload,
  // Faire pose le tag sur celle-ci ET le retire automatiquement des autres.
  // Constat juin 2026 sur F137 : sans ce tag, changer la couleur principale
  // n'avait aucun effet visible côté portail Faire.
  //
  // `sequence` (0, 1, 2…) reste utile pour l'ordre dans la galerie complète.
  // Le 1er élément de galleryPaths provient toujours de la couleur principale
  // (cf. `orderedColorIds` ci-dessus). Toggle branded → on INSÈRE l'URL brandée
  // en tête (Hero) puis la photo brute en sequence 1, puis les autres.
  let productImages: { url: string; sequence: number; tags?: string[] }[];
  if (galleryPaths.length > 0) {
    const brandedUrl = faireUrlFor(galleryPaths[0]!, { colorId: product.primaryColorId ?? null, index: 0 });
    const rawFirstUrl = faireUrlFor(galleryPaths[0]!, { colorId: product.primaryColorId ?? null, index: 999 });
    const isBrandedInserted = brandedUrl !== rawFirstUrl;
    if (isBrandedInserted) {
      productImages = [
        { url: brandedUrl, sequence: 0, tags: ["Hero"] },
        ...galleryPaths.slice(0, 4).map((p, idx) => ({
          url: faireUrlFor(p, { colorId: null, index: 999 }),
          sequence: idx + 1,
        })),
      ];
    } else {
      productImages = galleryPaths.map((p, idx) => ({
        url: faireUrlFor(p, { colorId: idx === 0 ? (product.primaryColorId ?? null) : null, index: idx }),
        sequence: idx,
        ...(idx === 0 ? { tags: ["Hero"] } : {}),
      }));
    }
  } else {
    productImages = [];
  }

  // Note : `sale_state` est read-only côté Faire — c'est Faire qui bascule
  // automatiquement entre FOR_SALE et SALES_PAUSED selon le stock vs MOQ.
  // Tenter de l'envoyer renvoie HTTP 400 "product field 'sale_state' is read-only".
  // Note : `idempotence_token` est obligatoire à la création — utilisé pour
  // éviter les doublons en cas de retry. Stable par produit BJ.
  // Token incluant un suffixe schema-version : si on change le format du
  // payload, on bumpe ce suffixe pour ne pas tomber sur un cache d'erreur
  // d'une ancienne tentative.
  const body: Record<string, unknown> = {
    idempotence_token: `bj-product-${product.id}-${idempotenceSalt}`,
    name: product.name,
    description: ctx.description,
    // Faire limite le short_description à 75 caractères. On part du nom du
    // produit (souvent court et descriptif) plutôt que de la description
    // complète qui contient maintenant composition + dimensions + code SH.
    short_description: (product.description?.trim() || product.name).slice(0, 75),
    lifecycle_state: lifecycleState,
    taxonomy_type: { id: ctx.taxonomyTypeId },
    made_in_country: ctx.countryAlpha2,
    minimum_order_quantity: 1,
    // Note : `per_style_minimum_order_quantity` ne doit PAS être envoyé tant
    // qu'on n'expose pas d'axe Size dans `variant_option_sets`. Faire renvoie
    // sinon HTTP 400 « Le produit sans variantes de taille ne peut pas être
    // défini sur tailles personnalisées ».
    // unit_multiplier = 1 obligatoire (>0). Représente la "quantité par carton" :
    // ici on vend à l'unité (pas par carton), donc 1.
    unit_multiplier: 1,
    variant_option_sets: sizeAxis
      ? [
          { name: "Color", values: Array.from(colorValuesSet) },
          { name: "Size", values: Array.from(sizeValuesSet) },
        ]
      : [{ name: "Color", values: Array.from(colorValuesSet) }],
    variants: variants.map((v) => v.payload),
    ...(productImages.length > 0 ? { images: productImages } : {}),
    // PAS de wholesale_price_cents / retail_price_cents racine : champs
    // dépréciés côté Faire et absents du schéma ExternalProductV2. Tout le
    // prix est porté par variants[].prices[].
  };

  return {
    body,
    variants,
    optionValues: Array.from(colorValuesSet),
    productImagesCount: productImages.length,
    /** URLs des images au niveau produit racine — gardées pour le snapshot diff. */
    productImageUrls: productImages.map((i) => i.url),
  };
}

// ─────────────────────────────────────────────
// Snapshot builder (pour faire-sync-diff)
// ─────────────────────────────────────────────

export function buildFaireSnapshot(
  product: FullProduct,
  ctx: FairePublishContext,
  variants: FaireVariantPayload[],
  lifecycleState: "DRAFT" | "PUBLISHED" | "UNPUBLISHED",
  rootImages: string[],
): FaireSyncSnapshot {
  const variantSnapshot: Record<string, FaireVariantSnapshot> = {};
  for (const v of variants) {
    const p = v.payload;
    variantSnapshot[v.sku] = {
      sku: v.sku,
      wholesalePriceCents: v.wholesalePriceCents,
      retailPriceCents: v.retailPriceCents,
      availableQuantity: p.available_quantity,
      active: p.active,
      colorOption: p.options.find((o) => o.name === "Color")?.value ?? "",
      images: (p.images ?? []).map((i) => i.url),
      weightGrams: p.measurements?.weight ?? null,
      lengthCm: p.measurements?.length ?? null,
      widthCm: p.measurements?.width ?? null,
      heightCm: p.measurements?.height ?? null,
      tariffCode: p.tariff_code ?? null,
      // ID Faire connu au moment du build (existant). Pour les nouvelles
      // variantes (créées dans le même PATCH), `p.id` est undefined ici ;
      // le flow update mute le snapshot avec le nouvel ID après réponse
      // Faire, avant saveSnapshot.
      faireVariantId: p.id ?? null,
    };
  }
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: product.name,
      shortDescription: (product.description?.trim() || product.name).slice(0, 75),
      description: ctx.description,
      taxonomyTypeId: ctx.taxonomyTypeId,
      countryAlpha2: ctx.countryAlpha2,
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: rootImages,
    },
    variants: variantSnapshot,
    lifecycleState,
  };
}

// ─────────────────────────────────────────────
// Validation prep — résout taxonomyId / tariffCode / country / description
// ─────────────────────────────────────────────

export function buildPublishContext(
  product: Pick<
    FullProduct,
    | "category"
    | "hsCode"
    | "countryIsoCode"
    | "compositions"
    | "description"
    | "dimensionLength"
    | "dimensionWidth"
    | "dimensionHeight"
    | "colors"
    | "sizeDetailsTu"
  >,
  options: {
    /**
     * Codes ISO alpha-2 dont la mention « Made in {pays} » ne doit PAS être
     * ajoutée à la description Faire. Configurable dans
     * Admin > Paramètres > Marketplaces > Faire.
     */
    excludedMadeInIsoCodes?: readonly string[];
  } = {},
): {
  ok: boolean;
  ctx?: FairePublishContext;
  reason?: string;
} {
  const taxonomyTypeId = product.category?.faireTaxonomyId ?? null;
  if (!taxonomyTypeId) {
    const categoryName = product.category?.name?.trim() || "du produit";
    return {
      ok: false,
      reason: `La catégorie ${categoryName} n'a pas été mappée sur Faire.`,
    };
  }

  // Faire veut le code SH sur la VARIANTE en `tariff_code` (champ documenté
  // par l'IA Faire en juin 2026). Plus de format dédié — on envoie le `code`
  // brut tel que saisi par l'admin (qui peut déjà mettre les points si elle
  // veut, ex : "7117.19.00").
  const tariffCode = product.hsCode?.code?.trim() || null;

  // Faire veut le pays en alpha-2 dans `made_in_country` (ex : "CN", "FR").
  // L'isoCode en BDD est déjà alpha-2 — pas de conversion à faire.
  const rawAlpha2 = product.countryIsoCode?.trim().toUpperCase() || null;
  const countryAlpha2 = rawAlpha2 ?? "CN"; // fallback raisonnable pour catalogue made-in-China
  const countryUsedFallback = rawAlpha2 == null;

  // Nom du pays en anglais pour la mention « Made in ... » en fin de description
  // (audience Faire = acheteuses US/UK, français peu compris). On résout via
  // Intl.DisplayNames pour éviter une table maison isoCode → nom. On ne prend
  // PAS le fallback CN : si la cliente n'a pas renseigné de pays de fabrication
  // sur le produit, on préfère ne rien afficher plutôt qu'un « Made in China »
  // erroné (autres tenants, produits FR, etc.).
  //
  // Exclusion : la cliente peut configurer une liste de pays pour lesquels on
  // NE veut PAS afficher « Made in {pays} » (ex. pour un catalogue chinois
  // vendu à des acheteuses US où l'origine peut refroidir). Réglage dans
  // Admin > Paramètres > Marketplaces > Faire.
  const excludedSet = new Set(
    (options.excludedMadeInIsoCodes ?? []).map((c) => c.trim().toUpperCase()),
  );
  let madeInCountryEn: string | null = null;
  if (rawAlpha2 && !excludedSet.has(rawAlpha2)) {
    try {
      const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
      madeInCountryEn = displayNames.of(rawAlpha2) ?? null;
    } catch {
      madeInCountryEn = null;
    }
  }

  // Tailles disponibles pour la mention « Taille : X » / « Tailles : X, Y, Z »
  // / « Taille Unique (XX-YY) ». On ignore les variantes PACK (Faire ne reçoit
  // que du UNIT — cf. filtre en amont) et on dédup au niveau du builder.
  const sizes: string[] = [];
  for (const c of product.colors) {
    if (c.saleType !== "UNIT") continue;
    for (const s of c.variantSizes) {
      if (s.size?.name) sizes.push(s.size.name);
    }
  }

  // Description = description produit + composition + tailles + « Made in … »
  // appendus automatiquement. Le code SH reste sur la variante via
  // `tariff_code` mais n'est plus écrit en bas de description (pas pertinent
  // pour l'acheteuse). Les dimensions sont envoyées dans le champ structuré
  // `measurements` au niveau variante (cf. buildFaireProductPayload).
  const description = buildFaireDescription(
    product.description ?? "",
    product.compositions.map((c) => ({
      name: c.composition.name,
      percentage: Number(c.percentage),
    })),
    {
      sizes,
      sizeDetailsTu: product.sizeDetailsTu,
      madeInCountryEn,
    },
  );

  return {
    ok: true,
    ctx: {
      taxonomyTypeId,
      tariffCode,
      countryAlpha2,
      description,
      countryUsedFallback,
    },
  };
}

// ─────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────

/**
 * Résout l'URL de base à envoyer à Faire pour les images du tenant courant.
 * Sans tenant résolu (jobs cron/scripts), on renvoie `undefined` — le helper
 * `buildFaireImageUrl` retombera alors sur `NEXTAUTH_URL` / fallback env.
 */
async function resolveTenantImageBaseUrl(): Promise<string | undefined> {
  const tenantId = await getCurrentTenantIdSafe();
  if (!tenantId) return undefined;
  return (await getTenantBaseUrl(tenantId)) ?? undefined;
}

export async function fairePublishProduct(
  productId: string,
  options: { lifecycleState?: "DRAFT" | "PUBLISHED" } = {},
): Promise<FairePublishResult> {
  // ⚠️ Garde-fou strict : si un faireProductId est déjà renseigné, on REFUSE
  // de POST. Sinon on crée un doublon côté Faire (cas vu en réel sur F137 :
  // un fallback "update échoue → publish" avait dupliqué la fiche). Tout
  // chemin légitime qui veut recréer un produit DOIT explicitement remettre
  // `Product.faireProductId` à null en amont (cf. `faireRefreshProduct`).
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { faireProductId: true },
  });
  if (existing?.faireProductId) {
    return {
      success: false,
      error:
        `Ce produit est déjà lié à Faire (id ${existing.faireProductId}). ` +
        `Création refusée pour éviter un doublon. ` +
        `Utilisez « Resync » pour modifier la fiche existante, ou « Délier » ` +
        `+ « Rafraîchir » pour la remplacer volontairement.`,
    };
  }

  const product = await loadFaireProductFull(productId);
  if (!product) {
    return { success: false, error: "Produit introuvable." };
  }

  // Faire ne reçoit que les variantes UNIT. Les variantes PACK (même couleur
  // mais saleType différent) provoqueraient sinon HTTP 400 « Duplicate variants
  // with same options ». Aligné sur Ankorstore qui filtre aussi les packs.
  product.colors = product.colors.filter((v) => v.saleType === "UNIT");
  if (product.colors.length === 0) {
    return {
      success: false,
      error:
        "Aucune variante à l'unité — Faire n'accepte pas les packs. Ajoutez au moins une variante de type Unité pour publier sur Faire.",
    };
  }

  const excludedMadeInIsoCodes = await getCachedFaireMadeInExcluded();
  const ctxResult = buildPublishContext(product, { excludedMadeInIsoCodes });
  if (!ctxResult.ok || !ctxResult.ctx) {
    return { success: false, error: ctxResult.reason ?? "Contexte Faire invalide." };
  }
  const ctx = ctxResult.ctx;

  const configs = await loadMarketplaceMarkupConfigs();
  const lifecycleState = options.lifecycleState ?? "DRAFT";
  const imageBaseUrl = await resolveTenantImageBaseUrl();
  // Badge « Réf » désactivé de force pour Faire depuis 2026-07-30 : malgré
  // plusieurs corrections dimensions/format (JPEG, minWidth 1000), Faire ne
  // rend pas le badge dans ses vignettes → on n'envoie plus l'URL brandée. Le
  // toggle DB reste actif pour la boutique + PFS + eFashion.
  const brandedBadgeEnabled = false;
  const { body, variants, productImagesCount, productImageUrls } = buildFaireProductPayload(
    product,
    ctx,
    configs.faireWholesale,
    configs.faireRetail,
    lifecycleState,
    undefined,
    imageBaseUrl,
    brandedBadgeEnabled,
  );

  // Validation locale (rejet rapide avant l'aller-retour HTTP).
  // Le prix « produit » est celui de la première variante (utilisé uniquement
  // pour la règle BJ « retail >= 2× wholesale » côté validation, pas envoyé
  // à Faire — qui ne supporte plus les prix racine).
  const headWholesale = variants[0]?.wholesalePriceCents ?? 0;
  const headRetail = variants[0]?.retailPriceCents ?? 0;
  const validation = validateFaireProductShape({
    name: String(body.name),
    description: String(body.description ?? ""),
    taxonomyTypeId: ctx.taxonomyTypeId,
    wholesalePriceCents: headWholesale,
    retailPriceCents: headRetail,
    countryAlpha2: ctx.countryAlpha2,
    tariffCode: ctx.tariffCode,
    productImagesCount,
    variants: variants.map((v) => ({
      sku: v.sku,
      wholesalePriceCents: v.wholesalePriceCents,
      retailPriceCents: v.retailPriceCents,
      imagesCount: v.payload.images?.length ?? 0,
    })),
  });

  if (!validation.ok) {
    return {
      success: false,
      error: validation.errors[0] ?? "Produit invalide pour Faire.",
      details: validation,
    };
  }

  // POST /products
  let faireProductId: string;
  let createdVariants: { id: string; sku: string }[] = [];
  try {
    const res = await faireFetch(`/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.error("[Faire Publish] POST failed", {
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
        };
        humanMsg = j.localized_message || j.message || "";
        if (j.field) humanMsg = `${humanMsg} (champ : ${j.field})`;
      } catch {
        // body non JSON, on ignore
      }
      return {
        success: false,
        error: humanMsg
          ? `Faire a refusé la création (HTTP ${res.status}) : ${humanMsg}`
          : `Faire a refusé la création (HTTP ${res.status}).`,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      lifecycle_state?: string;
      variants?: { id?: string; sku?: string }[];
    };

    if (!data.id) {
      return { success: false, error: "Réponse Faire sans ID produit." };
    }
    if (data.lifecycle_state === "DELETED") {
      logger.error("[Faire Publish] Faire a renvoyé DELETED", { productId, data });
      return {
        success: false,
        error: "Faire a accepté puis supprimé le produit (champ inconnu ?). Vérifier les logs.",
      };
    }
    faireProductId = data.id;
    createdVariants = (data.variants ?? [])
      .filter((v): v is { id: string; sku: string } => !!v.id && !!v.sku);
  } catch (err) {
    logger.error("[Faire Publish] POST threw", { productId, error: String(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Erreur réseau Faire.",
    };
  }

  // Mappage variantes BJ ↔ Faire via SKU.
  const variantMap: { bjVariantId: string; sku: string; faireVariantId: string | null }[] =
    variants.map((v) => ({
      bjVariantId: v.bjVariantId,
      sku: v.sku,
      faireVariantId: createdVariants.find((cv) => cv.sku === v.sku)?.id ?? null,
    }));

  // Sauvegarde en BDD.
  const snapshot = buildFaireSnapshot(
    product,
    ctx,
    variants,
    lifecycleState,
    productImageUrls,
  );

  try {
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: {
          faireProductId,
          faireSyncRequired: false,
          faireLastSyncSnapshot: snapshot as unknown as Prisma.JsonObject,
        },
      }),
      ...variantMap
        .filter((v) => v.faireVariantId)
        .map((v) =>
          prisma.productColor.update({
            where: { id: v.bjVariantId },
            data: { faireVariantId: v.faireVariantId! },
          }),
        ),
    ]);
  } catch (err) {
    logger.error("[Faire Publish] BDD save failed", {
      productId,
      faireProductId,
      error: String(err),
    });
    return {
      success: false,
      error: "Produit créé chez Faire mais sauvegarde locale échouée.",
    };
  }

  // PATCH inventory pour pousser le stock (le available_quantity du POST est ignoré).
  const inventoryUpdates: FaireInventoryUpdate[] = variants
    .filter((v) => v.payload.available_quantity > 0)
    .map((v) => ({ sku: v.sku, currentQuantity: v.payload.available_quantity }));
  if (inventoryUpdates.length > 0) {
    const inv = await faireUpdateInventory(inventoryUpdates);
    if (!inv.success) {
      logger.warn("[Faire Publish] PATCH inventory partiel/raté", {
        productId,
        inv,
      });
    }
  }

  try {
    revalidateTag("products", "default");
  } catch {
    // hors contexte Next : ignorer.
  }

  return {
    success: true,
    faireProductId,
    variantMap,
    warnings: validation.warnings,
  };
}
