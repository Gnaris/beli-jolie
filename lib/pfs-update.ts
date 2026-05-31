/**
 * PFS Update — Mise à jour en place d'un produit existant sur PFS.
 *
 * Au lieu de supprimer et recréer le produit (comme le fait pfsRefreshProduct),
 * cette fonction modifie directement le produit existant :
 *   - PATCH des champs produit (nom, description, composition, catégorie…)
 *   - PATCH des variantes existantes (prix, stock, poids)
 *   - Création des nouvelles variantes
 *   - Suppression des variantes retirées
 *   - Synchronisation des images (ajout/suppression)
 */

import { prisma } from "@/lib/prisma";
import {
  pfsUpdateProduct,
  pfsCreateVariants,
  pfsPatchVariants,
  pfsDeleteVariant,
  pfsUploadImage,
  pfsDeleteImage,
  pfsUpdateStatus,
  pfsRemoveStar,
  pfsTranslate,
  pfsGetCategories,
  pfsGetFamilies,
  pfsGetColors,
  type PfsProductUpdateData,
  type PfsVariantCreateData,
  type PfsVariantUpdateData,
} from "@/lib/pfs-api-write";
import { pfsGetVariants, pfsCheckReference } from "@/lib/pfs-api";
import { mapLocalToPfsStatus } from "@/lib/pfs-status";
import {
  applyMarketplaceMarkup,
  loadMarketplaceMarkupConfigs,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import sharp from "sharp";
import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";
import { emitProductEvent } from "@/lib/product-events";
import { requirePfsBrand } from "@/lib/pfs-brand";
import {
  diffSnapshots,
  diffIsEmpty,
  PFS_SNAPSHOT_VERSION,
  type PfsSyncSnapshot,
  type PfsProductFieldsSnapshot,
  type PfsImagesSnapshot,
  type PfsVariantSnapshot,
} from "@/lib/pfs-sync-diff";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { assertNoPfsColorConflicts } from "@/lib/pfs-color-conflicts";

export type PfsUpdateResult =
  | { success: true; archived: boolean }
  | { success: false; error: string };

type ProgressCallback = (progress: PfsUpdateProgress) => void;

export interface PfsUpdateProgress {
  productId: string;
  productName: string;
  reference: string;
  status: "queued" | "in_progress" | "success" | "error";
  step?: string;
  error?: string;
}

interface FullVariant {
  id: string;
  pfsVariantId: string | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  colorId: string | null;
  color: { id: string; name: string; pfsColorRef: string | null } | null;
  pfsColorRefOverride: string | null;
  packLines: {
    colorId: string;
    color: { id: string; name: string; pfsColorRef: string | null };
    position: number;
    pfsColorRefOverride: string | null;
    sizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  }[];
  images: { path: string; order: number; colorId: string }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  primaryColorId: string | null;
  pfsProductId: string | null;
  pfsLastSyncSnapshot: unknown;
  isBestSeller: boolean;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  category: {
    id: string;
    pfsCategoryId: string | null;
    pfsGender: string | null;
    pfsFamilyId: string | null;
    pfsFamilyName: string | null;
    pfsCategoryName: string | null;
  };
  colors: FullVariant[];
  colorImages: { path: string; order: number; colorId: string }[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { pfsCompositionRef: string | null };
  }[];
  manufacturingCountry: { isoCode: string | null; pfsCountryRef: string | null } | null;
  season: { pfsRef: string | null } | null;
  sizeDetailsTu: string | null;
}

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      primaryColorId: true,
      pfsProductId: true,
      pfsLastSyncSnapshot: true,
      isBestSeller: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      sizeDetailsTu: true,
      category: {
        select: {
          id: true,
          pfsCategoryId: true,
          pfsGender: true,
          pfsFamilyId: true,
          pfsFamilyName: true,
          pfsCategoryName: true,
        },
      },
      colors: {
        select: {
          id: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          isPrimary: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
          },
          colorId: true,
          color: { select: { id: true, name: true, pfsColorRef: true } },
          pfsColorRefOverride: true,
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true, pfsColorRef: true } },
              position: true,
              pfsColorRefOverride: true,
              sizes: {
                select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
                orderBy: { size: { position: "asc" as const } },
              },
            },
            orderBy: { position: "asc" as const },
          },
          images: {
            select: { path: true, order: true, colorId: true },
            orderBy: { order: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" as const },
      },
      compositions: {
        select: { percentage: true, composition: { select: { pfsCompositionRef: true } } },
      },
      manufacturingCountry: { select: { isoCode: true, pfsCountryRef: true } },
      season: { select: { pfsRef: true } },
    },
  }) as unknown as FullProduct | null;
}

// ── Helpers (same as pfs-publish.ts) ──

async function buildColorLabelToRefMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const pfsColors = await pfsGetColors();
    for (const c of pfsColors) {
      const frLabel = c.labels?.fr?.trim();
      if (frLabel) map.set(frLabel, c.reference);
      map.set(c.reference, c.reference);
    }
  } catch (err) {
    logger.warn("[PFS Update] Failed to load PFS color references", {
      error: err,
    });
  }
  return map;
}

function resolvePfsColorRef(
  color: { name: string; pfsColorRef: string | null },
  colorRefMap?: Map<string, string>,
  overrideRef?: string | null,
): string {
  if (overrideRef?.trim()) return overrideRef.trim();
  if (color.pfsColorRef) return color.pfsColorRef;
  return colorRefMap?.get(color.name) ?? color.name;
}

function getEffectiveColorRef(variant: FullVariant, colorRefMap?: Map<string, string>): string | null {
  if (!variant.color) return null;
  if (variant.pfsColorRefOverride?.trim()) return variant.pfsColorRefOverride.trim();
  if (variant.color.pfsColorRef) return variant.color.pfsColorRef;
  return colorRefMap?.get(variant.color.name) ?? variant.color.name;
}

function getPfsUnitPrice(variant: FullVariant, markup?: MarkupConfig): number {
  const price = Number(variant.unitPrice);
  let unitPrice: number;
  if (variant.saleType !== "PACK") {
    unitPrice = price;
  } else {
    const qty = variant.packQuantity && variant.packQuantity > 0 ? variant.packQuantity : 1;
    unitPrice = Math.round((price / qty) * 100) / 100;
  }
  return markup ? applyMarketplaceMarkup(unitPrice, markup) : unitPrice;
}

const getSizeRef = (vs: { size: { name: string; pfsSizeRef: string | null } }) =>
  vs.size.pfsSizeRef || vs.size.name || "TU";

function buildDimensionsSuffix(
  product: Pick<
    FullProduct,
    "dimensionLength" | "dimensionWidth" | "dimensionHeight" | "dimensionDiameter" | "dimensionCircumference"
  >,
): string {
  const parts: string[] = [];
  if (product.dimensionLength != null) parts.push(`Longueur : ${product.dimensionLength}mm`);
  if (product.dimensionWidth != null) parts.push(`Largeur : ${product.dimensionWidth}mm`);
  if (product.dimensionHeight != null) parts.push(`Hauteur : ${product.dimensionHeight}mm`);
  if (product.dimensionDiameter != null) parts.push(`Diamètre : ${product.dimensionDiameter}mm`);
  if (product.dimensionCircumference != null) parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

async function convertToJpeg(imagePath: string): Promise<Buffer> {
  const { readFile, keyFromDbPath } = await import("@/lib/storage");
  const buffer = await readFile(keyFromDbPath(imagePath));
  return sharp(buffer).jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
}

async function resolvePfsCategoryIds(category: {
  id: string;
  pfsCategoryId: string | null;
  pfsFamilyId: string | null;
  pfsFamilyName: string | null;
  pfsCategoryName: string | null;
  pfsGender: string | null;
}): Promise<{ pfsCategoryId: string | null; pfsFamilyId: string | null }> {
  const result = { pfsCategoryId: category.pfsCategoryId, pfsFamilyId: category.pfsFamilyId };
  if (result.pfsCategoryId && result.pfsFamilyId) return result;

  try {
    const pickFr = (labels: Record<string, string> | undefined | null, fallback = ""): string => {
      if (!labels) return fallback;
      return labels.fr ?? labels.en ?? Object.values(labels)[0] ?? fallback;
    };
    const normalize = (s: string) => s.replace(/_/g, " ").trim().toLowerCase();

    if (!result.pfsFamilyId && category.pfsFamilyName) {
      const families = await pfsGetFamilies();
      const target = normalize(category.pfsFamilyName);
      const match = families.find((f) => normalize(pickFr(f.labels, f.id)) === target);
      if (match) result.pfsFamilyId = match.id;
    }

    if (!result.pfsCategoryId && category.pfsCategoryName) {
      const categories = await pfsGetCategories();
      const target = normalize(category.pfsCategoryName);
      const match = categories.find((c) => {
        const label = normalize(pickFr(c.labels));
        if (label !== target) return false;
        if (result.pfsFamilyId && c.family) {
          const catFamilyId = typeof c.family === "string" ? c.family : c.family.id;
          return catFamilyId === result.pfsFamilyId;
        }
        return true;
      });
      if (match) result.pfsCategoryId = match.id;
    }

    const updates: Record<string, string> = {};
    if (result.pfsFamilyId && !category.pfsFamilyId) updates.pfsFamilyId = result.pfsFamilyId;
    if (result.pfsCategoryId && !category.pfsCategoryId) updates.pfsCategoryId = result.pfsCategoryId;
    if (Object.keys(updates).length > 0) {
      await prisma.category.update({ where: { id: category.id }, data: updates });
    }
  } catch (err) {
    logger.warn("[PFS Update] Failed to auto-resolve PFS category IDs", {
      error: err,
    });
  }

  return result;
}

// ── Build variant create data (same logic as pfs-publish.ts) ──

function buildVariantCreateData(
  variant: FullVariant,
  colorRefMap: Map<string, string>,
  pfsMarkup?: MarkupConfig,
): PfsVariantCreateData | null {
  if (variant.saleType === "UNIT") {
    const colorRef = getEffectiveColorRef(variant, colorRefMap);
    if (!colorRef) return null;
    const sizeRef = variant.variantSizes[0] ? getSizeRef(variant.variantSizes[0]) : "TU";
    return {
      type: "ITEM",
      color: colorRef,
      size: sizeRef,
      price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
      weight: variant.weight,
      stock_qty: variant.stock ?? 0,
      is_active: (variant.stock ?? 0) > 0,
    };
  }

  if (variant.saleType === "PACK") {
    const packEntries: { color: string; size: string; qty: number }[] = [];
    let firstColorRef: string | null = null;
    let firstSizeRef = "TU";

    if (variant.packLines.length > 0) {
      for (const pl of variant.packLines) {
        if (!pl.color?.name) continue;
        const plColorRef = resolvePfsColorRef(pl.color, colorRefMap, pl.pfsColorRefOverride);
        if (!firstColorRef) firstColorRef = plColorRef;
        if (pl.sizes && pl.sizes.length > 0) {
          for (const ps of pl.sizes) {
            const sizeRef = ps.size.pfsSizeRef || ps.size.name || "TU";
            if (firstSizeRef === "TU") firstSizeRef = sizeRef;
            packEntries.push({ color: plColorRef, size: sizeRef, qty: ps.quantity });
          }
        } else {
          packEntries.push({ color: plColorRef, size: "TU", qty: variant.packQuantity ?? 1 });
        }
      }
    } else if (variant.color?.name) {
      firstColorRef = resolvePfsColorRef(variant.color, colorRefMap, variant.pfsColorRefOverride);
      const variantSizes =
        variant.variantSizes.length > 0
          ? variant.variantSizes
          : [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: variant.packQuantity ?? 1 }];
      for (const vs of variantSizes) {
        const sizeRef = getSizeRef(vs);
        if (firstSizeRef === "TU") firstSizeRef = sizeRef;
        packEntries.push({ color: firstColorRef, size: sizeRef, qty: vs.quantity });
      }
    }

    if (!firstColorRef || packEntries.length === 0) return null;

    return {
      type: "PACK",
      color: firstColorRef,
      size: firstSizeRef,
      price_eur_ex_vat: getPfsUnitPrice(variant, pfsMarkup),
      weight: variant.weight,
      stock_qty: variant.stock ?? 0,
      is_active: (variant.stock ?? 0) > 0,
      packs: packEntries,
    };
  }

  return null;
}

// ── Snapshot helpers (used to diff against pfsLastSyncSnapshot) ──

function buildProductFieldsSnapshot(
  product: FullProduct,
): PfsProductFieldsSnapshot {
  const composition = product.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => ({ id: c.composition.pfsCompositionRef!, value: Number(c.percentage) }));
  if (composition.length === 0) {
    composition.push({ id: "ACIERINOXYDABLE", value: 100 });
  }
  return {
    reference: product.reference,
    nameSource: product.name,
    descSource: product.description,
    dimensions: buildDimensionsSuffix(product),
    composition,
    country:
      product.manufacturingCountry?.isoCode ??
      product.manufacturingCountry?.pfsCountryRef ??
      "CN",
    season: product.season?.pfsRef ?? "PE2026",
    gender: product.category.pfsGender || "WOMAN",
    category: product.category.pfsCategoryId ?? null,
    family: product.category.pfsFamilyId ?? null,
    sizeDetailsTu: product.sizeDetailsTu,
  };
}

function buildVariantSnapshot(
  variant: FullVariant,
  pfsMarkup?: MarkupConfig,
  colorRefMap?: Map<string, string>,
): PfsVariantSnapshot {
  const stock = variant.stock ?? 0;
  const effective = getEffectiveColorRef(variant, colorRefMap) ?? undefined;
  return {
    price: getPfsUnitPrice(variant, pfsMarkup),
    stock,
    weight: variant.weight,
    isActive: stock > 0,
    colorRef: effective,
  };
}

function buildImagesSnapshot(
  product: FullProduct,
  colorIdToPfsRef: Map<string, string>,
): PfsImagesSnapshot {
  const out: PfsImagesSnapshot = {};
  // Source unique : product.colorImages (level produit, dédupliqué).
  // On groupe par colorRef PFS, on dédupe par (path,order) au cas où des doublons
  // historiques resteraient en base, on trie, et on attribue les slots 1-indexés.
  const byColor = new Map<string, { path: string; order: number }[]>();
  const seen = new Set<string>();
  for (const img of product.colorImages) {
    const colorRef = colorIdToPfsRef.get(img.colorId);
    if (!colorRef) continue;
    const dedupKey = `${colorRef}::${img.order}::${img.path}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    if (!byColor.has(colorRef)) byColor.set(colorRef, []);
    byColor.get(colorRef)!.push({ path: img.path, order: img.order });
  }
  for (const [colorRef, list] of byColor) {
    const sorted = [...list].sort((a, b) => a.order - b.order);
    out[colorRef] = {};
    sorted.forEach((img, i) => {
      out[colorRef][String(i + 1)] = img.path;
    });
  }
  return out;
}

function readPreviousSnapshot(raw: unknown): PfsSyncSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<PfsSyncSnapshot>;
  if (obj.schemaVersion !== PFS_SNAPSHOT_VERSION) return null;
  if (!obj.product || !obj.variants || !obj.images) return null;
  return obj as PfsSyncSnapshot;
}

// ── Main update function ──

export async function pfsUpdateProductInPlace(
  productId: string,
  onProgress?: ProgressCallback,
  options?: { skipRevalidation?: boolean; forceFullSync?: boolean },
): Promise<PfsUpdateResult> {
  const product = await loadProductFull(productId);
  if (!product) return { success: false, error: "Produit introuvable en base" };
  if (!product.pfsProductId) return { success: false, error: "Produit non publié sur PFS (pas de pfsProductId)" };

  const pfsProductId = product.pfsProductId;

  const progress: PfsUpdateProgress = {
    productId,
    productName: product.name,
    reference: product.reference,
    status: "in_progress",
  };
  const report = (step: string) => {
    progress.step = step;
    onProgress?.(progress);
  };

  // Marque PFS obligatoire pour toute opération PFS, même un update PATCH.
  // (La marque elle-même n'est jamais renvoyée à PFS lors d'un update.)
  await requirePfsBrand();

  const markupConfigs = await loadMarketplaceMarkupConfigs();
  const pfsMarkup = markupConfigs.pfs;
  const colorRefMap = await buildColorLabelToRefMap();

  // Filet de sécurité : refuse de mettre à jour si conflit de mapping PFS.
  assertNoPfsColorConflicts(product.colors, colorRefMap);

  try {
    // Auto-resolve missing PFS IDs avant de construire le snapshot
    if (!product.category.pfsCategoryId || !product.category.pfsFamilyId) {
      const resolved = await resolvePfsCategoryIds(product.category);
      if (resolved.pfsCategoryId) product.category.pfsCategoryId = resolved.pfsCategoryId;
      if (resolved.pfsFamilyId) product.category.pfsFamilyId = resolved.pfsFamilyId;
    }

    // Map Color.id → PFS color ref (utile pour images + default_color)
    const colorIdToPfsRef = new Map<string, string>();
    for (const variant of product.colors) {
      if (variant.color) {
        const ref = getEffectiveColorRef(variant, colorRefMap);
        if (ref) colorIdToPfsRef.set(variant.color.id, ref);
      }
      for (const pl of variant.packLines) {
        if (pl.color) {
          const ref = resolvePfsColorRef(pl.color, colorRefMap, pl.pfsColorRefOverride);
          colorIdToPfsRef.set(pl.color.id, ref);
        }
      }
    }

    const allVariantsOutOfStock = product.colors.every((v) => (v.stock ?? 0) === 0);
    const targetStatus = mapLocalToPfsStatus(product.status, allVariantsOutOfStock);

    // Couleur principale = Product.primaryColorId (avec fallback isPrimary pour les produits non migrés).
    const primaryColorIdResolved = getProductPrimaryColorId({
      primaryColorId: product.primaryColorId,
      colors: product.colors.map((v) => ({
        colorId: v.colorId,
        isPrimary: v.isPrimary,
        packLines: v.packLines.map((pl) => ({ colorId: pl.colorId })),
      })),
    });
    const primaryColorRef = primaryColorIdResolved
      ? colorIdToPfsRef.get(primaryColorIdResolved) ?? null
      : null;

    // ── Construction du snapshot cible (ce qu'on veut que PFS reflète) ──
    const nextProductSnap = buildProductFieldsSnapshot(product);
    const nextVariantsSnap: Record<string, PfsVariantSnapshot> = {};
    for (const variant of product.colors) {
      if (variant.pfsVariantId) {
        nextVariantsSnap[variant.pfsVariantId] = buildVariantSnapshot(variant, pfsMarkup, colorRefMap);
      }
    }
    const nextImagesSnap = buildImagesSnapshot(product, colorIdToPfsRef);

    const nextSnapshot: PfsSyncSnapshot = {
      schemaVersion: PFS_SNAPSHOT_VERSION,
      product: nextProductSnap,
      defaultColor: primaryColorRef ?? null,
      variants: nextVariantsSnap,
      images: nextImagesSnap,
      status: targetStatus,
      isBestSeller: product.isBestSeller,
    };

    // ── Diff vs snapshot précédent ──
    // Diff target — null forces a full diff when forceFullSync is on.
    const realPrevSnapshot = readPreviousSnapshot(product.pfsLastSyncSnapshot);
    const prevSnapshot = options?.forceFullSync ? null : realPrevSnapshot;
    const diff = diffSnapshots(prevSnapshot, nextSnapshot);

    // committedSnapshot accumule ce qui a réussi côté PFS — initialisé sur le
    // vrai snapshot précédent (même en mode force) pour préserver l'état connu
    // en cas de crash partiel.
    const committedSnapshot: PfsSyncSnapshot = realPrevSnapshot
      ? { ...realPrevSnapshot }
      : {
          schemaVersion: PFS_SNAPSHOT_VERSION,
          product: nextProductSnap,
          defaultColor: null,
          variants: {},
          images: {},
          status: targetStatus,
          isBestSeller: false,
        };

    // Si rien n'a changé ET pas de variantes nouvelles à créer, on peut tout sauter
    const hasVariantsToCreate = product.colors.some((v) => !v.pfsVariantId);
    if (diffIsEmpty(diff) && !hasVariantsToCreate) {
      logger.info("[PFS Update] Aucun changement détecté, sync sautée", {
        pfsProductId,
        reference: product.reference,
      });
      report("Aucun changement à synchroniser");
      progress.status = "success";
      progress.step = "Aucun changement";
      onProgress?.(progress);
      if (!options?.skipRevalidation) {
        revalidateTag("products", "default");
      }
      return { success: true, archived: allVariantsOutOfStock };
    }

    // ── Step 1 : Update product fields (skippé si inchangé) ──
    if (diff.productChanged) {
      report("Mise à jour des informations produit...");

      const descriptionWithDims = product.description + buildDimensionsSuffix(product);
      const translated = await pfsTranslate(product.name, descriptionWithDims);

      const compositionArray = nextProductSnap.composition;

      // NB : `brand_name` n'est jamais renvoyé sur PATCH — la marque d'un
      // produit déjà publié est verrouillée par construction.
      const updateData: PfsProductUpdateData = {
        reference_code: nextProductSnap.reference,
        label: translated.productName,
        description: translated.productDescription,
        material_composition: compositionArray,
        country_of_manufacture: nextProductSnap.country,
        season_name: nextProductSnap.season,
        gender_label: nextProductSnap.gender,
      };
      if (nextProductSnap.category) updateData.category = nextProductSnap.category;
      if (nextProductSnap.family) updateData.family = nextProductSnap.family;
      if (nextProductSnap.sizeDetailsTu) updateData.size_details_tu = nextProductSnap.sizeDetailsTu;

      await pfsUpdateProduct(pfsProductId, updateData);
      committedSnapshot.product = nextProductSnap;
      logger.info("[PFS Update] Product fields updated", { pfsProductId, reference: product.reference });
    } else {
      logger.info("[PFS Update] Product fields unchanged → skip", { pfsProductId });
    }

    // ── Step 2 : Sync variants ──
    report("Synchronisation des variantes...");

    // Get existing PFS variants
    // NB : on inclut `packs` car les variantes PACK n'ont pas de `item` —
    // leur couleur principale vit dans packs[0].color.reference côté PFS.
    let existingPfsVariants: {
      id: string;
      type: string;
      item?: { color: { reference: string }; size: string };
      packs?: { color: { reference: string } }[];
      stock_qty: number;
    }[] = [];
    try {
      const pfsVariantsResp = await pfsGetVariants(pfsProductId);
      existingPfsVariants = pfsVariantsResp.data ?? [];
    } catch (err) {
      logger.warn("[PFS Update] Could not fetch existing PFS variants", {
        error: err,
      });
    }

    const existingPfsVariantIds = new Set(existingPfsVariants.map((v) => v.id));

    // Separate local variants into: has pfsVariantId (update) vs no pfsVariantId (create)
    const variantsToUpdate: { bjVariant: FullVariant; pfsVariantId: string }[] = [];
    const variantsToCreate: { bjVariant: FullVariant; pfsData: PfsVariantCreateData }[] = [];
    const localPfsVariantIds = new Set<string>();

    for (const variant of product.colors) {
      if (variant.pfsVariantId && existingPfsVariantIds.has(variant.pfsVariantId)) {
        // Existing variant on PFS → update
        variantsToUpdate.push({ bjVariant: variant, pfsVariantId: variant.pfsVariantId });
        localPfsVariantIds.add(variant.pfsVariantId);
      } else {
        // New variant → create
        const pfsData = buildVariantCreateData(variant, colorRefMap, pfsMarkup);
        if (pfsData) {
          variantsToCreate.push({ bjVariant: variant, pfsData });
        }
      }
    }

    // Find PFS variants that no longer exist locally → delete
    const variantsToDelete = existingPfsVariants.filter((v) => !localPfsVariantIds.has(v.id));

    // 2a. Patch existing variants — uniquement celles signalées dans le diff
    const changedSet = new Set(diff.variantsChanged);
    const variantsChangedUpdate = variantsToUpdate.filter(({ pfsVariantId: vid }) =>
      changedSet.has(vid),
    );

    // Sépare les changements en deux familles :
    //   - couleur effective modifiée → recreate (PFS ne permet pas de patcher
    //     la couleur d'une variante existante)
    //   - autres changements (prix/stock/poids) → patch normal
    //
    // Détection de changement de couleur :
    //   1) On compare au snapshot précédent (chemin nominal — update au save)
    //   2) Si le snapshot est absent (resynchro forcée ↻ ou snapshot vide),
    //      on compare à la couleur réelle remontée par pfsGetVariants — sinon
    //      on raterait les changements en mode forceFullSync.
    // [override-debug] : trace ce que le diff voit pour chaque variante
    // candidate au patch — permet de confirmer que les 2 Doré sont bien tous
    // les deux détectés comme changés en BDD.
    logger.info("[PFS Update] [override-debug] variantsToUpdate vs diff", {
      pfsProductId,
      reference: product.reference,
      forceFullSync: !!options?.forceFullSync,
      hasPrevSnapshot: !!prevSnapshot,
      changedVids: Array.from(changedSet),
      variantsToUpdate: variantsToUpdate.map((u) => {
        const prev = prevSnapshot?.variants[u.pfsVariantId];
        const next = nextVariantsSnap[u.pfsVariantId];
        return {
          bjId: u.bjVariant.id,
          colorName: u.bjVariant.color?.name ?? null,
          override: u.bjVariant.pfsColorRefOverride ?? null,
          pfsVariantId: u.pfsVariantId,
          inChangedSet: changedSet.has(u.pfsVariantId),
          prevColorRef: prev?.colorRef ?? null,
          nextColorRef: next?.colorRef ?? null,
        };
      }),
    });

    const variantsToRecreate: { bjVariant: FullVariant; oldPfsVariantId: string; pfsData: PfsVariantCreateData }[] = [];
    const variantsToPatch: typeof variantsChangedUpdate = [];
    for (const item of variantsChangedUpdate) {
      const prevVariantSnap = prevSnapshot?.variants[item.pfsVariantId];
      const nextVariantSnap = nextVariantsSnap[item.pfsVariantId];
      const nextColorRef = nextVariantSnap?.colorRef ?? null;
      let colorChanged = false;
      if (nextColorRef) {
        const prevColorRef = prevVariantSnap?.colorRef ?? null;
        if (prevColorRef) {
          colorChanged = prevColorRef !== nextColorRef;
        } else {
          // Snapshot absent (resynchro forcée OU produit refresh récent) :
          // on compare à la couleur réelle remontée par pfsGetVariants. Pour
          // ITEM la couleur vit dans `item.color.reference`, pour PACK dans
          // `packs[0].color.reference` (la couleur principale du pack côté PFS).
          // Si on n'a aucune info, on recrée par sécurité — le but ici est de
          // réaligner local et marketplace après une opération de réinit.
          const pfsVariant = existingPfsVariants.find((v) => v.id === item.pfsVariantId);
          const pfsRef =
            pfsVariant?.item?.color?.reference
            ?? pfsVariant?.packs?.[0]?.color?.reference
            ?? null;
          colorChanged = pfsRef !== null ? pfsRef !== nextColorRef : true;
        }
      }
      if (colorChanged) {
        const pfsData = buildVariantCreateData(item.bjVariant, colorRefMap, pfsMarkup);
        if (pfsData) {
          variantsToRecreate.push({
            bjVariant: item.bjVariant,
            oldPfsVariantId: item.pfsVariantId,
            pfsData,
          });
          continue;
        }
      }
      variantsToPatch.push(item);
    }

    if (variantsToPatch.length > 0) {
      const patches: PfsVariantUpdateData[] = variantsToPatch.map(({ bjVariant, pfsVariantId }) => ({
        variant_id: pfsVariantId,
        price_eur_ex_vat: getPfsUnitPrice(bjVariant, pfsMarkup),
        stock_qty: bjVariant.stock ?? 0,
        weight: bjVariant.weight,
        is_active: (bjVariant.stock ?? 0) > 0,
      }));

      try {
        await pfsPatchVariants(patches);
        // Marque ces variantes comme committées dans le snapshot
        for (const { pfsVariantId: vid } of variantsToPatch) {
          if (nextVariantsSnap[vid]) committedSnapshot.variants[vid] = nextVariantsSnap[vid];
        }
        logger.info("[PFS Update] Patched variants", {
          count: patches.length,
          skipped: variantsToUpdate.length - variantsToPatch.length - variantsToRecreate.length,
        });
      } catch (err) {
        logger.error("[PFS Update] Failed to patch variants", {
          error: err,
        });
      }
    } else if (variantsToUpdate.length > 0 && variantsToRecreate.length === 0) {
      logger.info("[PFS Update] All existing variants unchanged → skip patch", {
        count: variantsToUpdate.length,
      });
    }

    // 2a-bis. Recreate variants whose effective color changed (PFS variants
    // are color-immutable → delete then create with the new color).
    if (variantsToRecreate.length > 0) {
      report(
        `Recréation de ${variantsToRecreate.length} variante(s) suite à un changement de couleur PFS...`,
      );
      for (const item of variantsToRecreate) {
        try {
          await pfsDeleteVariant(item.oldPfsVariantId);
        } catch (err) {
          // PFS refuse souvent de supprimer une variante vendue. La nouvelle
          // variante a une couleur différente (c'est tout l'intérêt du
          // recreate) → aucun risque de doublon couleur+taille. On désactive
          // l'ancienne pour qu'elle disparaisse de la vitrine PFS, puis on
          // crée la nouvelle.
          logger.warn(
            "[PFS Update] Delete refused before recreate, deactivating old variant instead",
            {
              error: err,
              pfsVariantId: item.oldPfsVariantId,
            },
          );
          try {
            await pfsPatchVariants([
              { variant_id: item.oldPfsVariantId, stock_qty: 0, is_active: false },
            ]);
          } catch (patchErr) {
            logger.error("[PFS Update] Deactivation of old variant also failed", {
              error: patchErr,
              pfsVariantId: item.oldPfsVariantId,
            });
            // Même si la désactivation échoue, on tente la création : pire
            // cas, PFS rejette le doublon et on aura simplement raté ce run.
          }
        }
        try {
          const { variantIds } = await pfsCreateVariants(pfsProductId, [item.pfsData]);
          const newId = variantIds[0];
          if (!newId) {
            logger.error("[PFS Update] Recreate succeeded delete but create returned no id", {
              bjVariantId: item.bjVariant.id,
            });
            // Snapshot : on retire l'ancien (il a été supprimé sur PFS)
            delete committedSnapshot.variants[item.oldPfsVariantId];
            continue;
          }
          await prisma.productColor.update({
            where: { id: item.bjVariant.id },
            data: { pfsVariantId: newId },
          });
          // Si stock = 0 sur la nouvelle variante, force is_active=false côté PFS.
          if (item.pfsData.stock_qty === 0) {
            try {
              await pfsPatchVariants([{ variant_id: newId, stock_qty: 0, is_active: false }]);
            } catch { /* ignore */ }
          }
          // Snapshot : retire l'ancien id, ajoute le nouveau avec la nouvelle couleur
          delete committedSnapshot.variants[item.oldPfsVariantId];
          committedSnapshot.variants[newId] = buildVariantSnapshot(
            item.bjVariant,
            pfsMarkup,
            colorRefMap,
          );
          logger.info("[PFS Update] Recreated variant with new color", {
            oldPfsVariantId: item.oldPfsVariantId,
            newPfsVariantId: newId,
            color: item.pfsData.color,
          });
        } catch (err) {
          logger.error("[PFS Update] Failed to recreate variant after delete", {
            error: err,
            bjVariantId: item.bjVariant.id,
            color: item.pfsData.color,
          });
          // Ancien supprimé côté PFS, BDD garde encore l'ancien id : on l'efface
          // pour que le prochain run la traite comme une nouvelle variante à créer.
          try {
            await prisma.productColor.update({
              where: { id: item.bjVariant.id },
              data: { pfsVariantId: null },
            });
          } catch { /* ignore */ }
          delete committedSnapshot.variants[item.oldPfsVariantId];
        }
      }
    }

    // 2b. Create new variants
    if (variantsToCreate.length > 0) {
      report(`Création de ${variantsToCreate.length} nouvelle(s) variante(s)...`);
      try {
        const { variantIds } = await pfsCreateVariants(
          pfsProductId,
          variantsToCreate.map((v) => v.pfsData),
        );

        // Store new pfsVariantId in DB
        const newIdUpdates: { bjVariantId: string; pfsVariantId: string }[] = [];
        for (let i = 0; i < variantsToCreate.length; i++) {
          const newPfsVariantId = variantIds[i];
          if (newPfsVariantId) {
            newIdUpdates.push({
              bjVariantId: variantsToCreate[i].bjVariant.id,
              pfsVariantId: newPfsVariantId,
            });
          }
        }

        if (newIdUpdates.length > 0) {
          await prisma.$transaction(
            newIdUpdates.map((u) =>
              prisma.productColor.update({
                where: { id: u.bjVariantId },
                data: { pfsVariantId: u.pfsVariantId },
              }),
            ),
          );

          // Ajoute ces nouvelles variantes au snapshot committé
          for (const u of newIdUpdates) {
            const variant = variantsToCreate.find((v) => v.bjVariant.id === u.bjVariantId);
            if (variant) {
              committedSnapshot.variants[u.pfsVariantId] = buildVariantSnapshot(
                variant.bjVariant,
                pfsMarkup,
              );
            }
          }
        }

        // Patch zero-stock new variants to set is_active=false
        const zeroStockPatches: PfsVariantUpdateData[] = [];
        for (let i = 0; i < variantsToCreate.length; i++) {
          const vid = variantIds[i];
          if (variantsToCreate[i].pfsData.stock_qty === 0 && vid) {
            zeroStockPatches.push({ variant_id: vid, stock_qty: 0, is_active: false });
            // Reflète is_active=false dans le snapshot committé
            if (committedSnapshot.variants[vid]) {
              committedSnapshot.variants[vid] = {
                ...committedSnapshot.variants[vid],
                isActive: false,
              };
            }
          }
        }
        if (zeroStockPatches.length > 0) {
          try { await pfsPatchVariants(zeroStockPatches); } catch { /* ignore */ }
        }

        logger.info("[PFS Update] Created new variants", { count: newIdUpdates.length });
      } catch (err) {
        logger.error("[PFS Update] Failed to create new variants", {
          error: err,
        });
      }
    }

    // 2c. Delete removed variants
    // PFS refuse de supprimer une variante qui a déjà été vendue (verrou
    // historique côté Salesforce). Quand DELETE échoue, on désactive la
    // variante à la place (is_active=false + stock_qty=0) : PFS n'affiche
    // plus les variantes inactives dans la vitrine, et les commandes passées
    // restent rattachées proprement.
    if (variantsToDelete.length > 0) {
      report(`Suppression de ${variantsToDelete.length} variante(s) retirée(s)...`);
      for (const v of variantsToDelete) {
        try {
          await pfsDeleteVariant(v.id);
          delete committedSnapshot.variants[v.id];
          logger.info("[PFS Update] Deleted variant from PFS", { pfsVariantId: v.id });
        } catch (err) {
          logger.warn("[PFS Update] Delete refused, deactivating variant instead", {
            pfsVariantId: v.id,
            error: err,
          });
          try {
            await pfsPatchVariants([
              { variant_id: v.id, stock_qty: 0, is_active: false },
            ]);
            delete committedSnapshot.variants[v.id];
            logger.info("[PFS Update] Variant deactivated (delete fallback)", {
              pfsVariantId: v.id,
            });
          } catch (patchErr) {
            logger.error("[PFS Update] Deactivation fallback also failed", {
              pfsVariantId: v.id,
              error: patchErr,
            });
          }
        }
      }
    }

    // ── Step 3 : Sync images (diff-based) ──
    // En resync forcé (forceFullSync), on commence par effacer toutes les
    // images réellement présentes sur PFS pour ce produit, slot par slot et
    // couleur par couleur. Sinon, PFS conserve l'existant (upload = append,
    // pas overwrite) et l'on accumule des doublons à chaque resync.
    if (options?.forceFullSync) {
      report("Nettoyage des anciennes images sur PFS...");
      try {
        const checkRef = await pfsCheckReference(product.reference);
        const remoteImages = checkRef.product?.images;
        if (remoteImages) {
          let totalWiped = 0;
          for (const [colorRef, imageData] of Object.entries(remoteImages)) {
            if (colorRef === "DEFAULT") continue;
            const urls = Array.isArray(imageData) ? imageData : [imageData];
            for (let slot = 1; slot <= urls.length; slot++) {
              try {
                await pfsDeleteImage(pfsProductId, slot, colorRef);
                totalWiped++;
              } catch (err) {
                logger.warn("[PFS Update] Failed to wipe existing image (forceFullSync)", {
                  pfsProductId, colorRef, slot,
                  error: err,
                });
              }
            }
          }
          // Reset le snapshot d'images committed : tout ce qui était là est parti.
          committedSnapshot.images = {};
          logger.info("[PFS Update] Existing PFS images wiped before forceFullSync re-upload", {
            pfsProductId, wiped: totalWiped,
          });
        }
      } catch (err) {
        logger.warn("[PFS Update] checkReference failed during forceFullSync wipe — proceeding without wipe", {
          pfsProductId, reference: product.reference, error: err,
        });
      }
    }

    if (diff.imagesToUpload.length > 0 || diff.imagesToDelete.length > 0) {
      report("Synchronisation des images...");

      // S'assure que la racine du snapshot images existe pour chaque colorRef
      const ensureColor = (colorRef: string) => {
        if (!committedSnapshot.images[colorRef]) committedSnapshot.images[colorRef] = {};
      };

      let totalUploaded = 0;
      let totalDeleted = 0;

      // 3a. Suppressions ciblées (slots qui ont disparu)
      for (const { colorRef, slot } of diff.imagesToDelete) {
        try {
          await pfsDeleteImage(pfsProductId, slot, colorRef);
          if (committedSnapshot.images[colorRef]) {
            delete committedSnapshot.images[colorRef][String(slot)];
            if (Object.keys(committedSnapshot.images[colorRef]).length === 0) {
              delete committedSnapshot.images[colorRef];
            }
          }
          totalDeleted++;
        } catch (err) {
          logger.warn("[PFS Update] Failed to delete image", {
            colorRef, slot,
            error: err,
          });
        }
      }

      // 3b. Uploads ciblés (slots nouveaux ou modifiés)
      for (const { colorRef, slot, path } of diff.imagesToUpload) {
        try {
          const jpegBuffer = await convertToJpeg(path);
          await pfsUploadImage(pfsProductId, jpegBuffer, slot, colorRef, `image_${slot}.jpg`);
          ensureColor(colorRef);
          committedSnapshot.images[colorRef][String(slot)] = path;
          totalUploaded++;
        } catch (err) {
          logger.warn("[PFS Update] Image upload failed", {
            colorRef, slot,
            error: err,
          });
        }
      }

      logger.info("[PFS Update] Images synced (diff)", {
        uploaded: totalUploaded,
        deleted: totalDeleted,
        plannedUploads: diff.imagesToUpload.length,
        plannedDeletes: diff.imagesToDelete.length,
      });
    } else {
      logger.info("[PFS Update] Images unchanged → skip", { pfsProductId });
    }

    // ── Step 4 : Set default color (skippé si inchangé) ──
    if (diff.defaultColorChanged) {
      if (!primaryColorRef) {
        logger.error("[PFS Update] Cannot set default_color — no PFS ref resolved for primary color", {
          pfsProductId,
          reference: product.reference,
          primaryColorIdResolved,
          hint: "La couleur principale n'a pas de mapping PFS (pfsColorRef). Vérifie la couleur dans la bibliothèque ou pose un mapping secondaire sur la variante.",
        });
        throw new Error(
          "Impossible de mettre à jour la couleur principale sur PFS : la couleur sélectionnée n'a pas de correspondance Paris Fashion Shop. Ouvrez la bibliothèque de couleurs et renseignez la « Référence Paris Fashion Shop » pour cette couleur.",
        );
      }
      report("Mise à jour de la couleur principale sur PFS...");
      logger.info("[PFS Update] Setting default_color", {
        pfsProductId,
        reference: product.reference,
        previousDefaultColor: prevSnapshot?.defaultColor ?? null,
        nextDefaultColor: primaryColorRef,
      });
      await pfsUpdateProduct(pfsProductId, { default_color: primaryColorRef });
      committedSnapshot.defaultColor = primaryColorRef;
    }

    // ── Step 5 : Update status (skippé si inchangé) ──
    if (diff.statusChanged) {
      if (targetStatus === "READY_FOR_SALE") {
        report("Mise en ligne...");
      } else if (targetStatus === "ARCHIVED") {
        report("Archivage sur PFS...");
      } else {
        report("Mise en brouillon sur PFS...");
      }
      logger.info("[PFS Update] Updating status", {
        pfsProductId,
        targetStatus,
        localStatus: product.status,
        allVariantsOutOfStock,
      });
      try {
        await pfsUpdateStatus([{ id: pfsProductId, status: targetStatus }]);
        committedSnapshot.status = targetStatus;
      } catch (err) {
        logger.warn("[PFS Update] Failed to update status", {
          error: err,
        });
      }
    }

    // ── Step 5b : Best-Seller (skippé si inchangé) ──
    if (diff.bestSellerChanged) {
      if (product.isBestSeller) {
        report("Mise en avant sur PFS...");
        logger.info("[PFS Update] Setting best-seller (STAR)", { pfsProductId });
        try {
          await pfsUpdateStatus([{ id: pfsProductId, status: "STAR" }]);
          committedSnapshot.isBestSeller = true;
        } catch (err) {
          logger.warn("[PFS Update] Failed to STAR product", {
            error: err,
          });
        }
      } else {
        report("Retrait de la mise en avant sur PFS...");
        logger.info("[PFS Update] Removing best-seller (REMOVE_STAR)", { pfsProductId });
        try {
          await pfsRemoveStar(pfsProductId);
          committedSnapshot.isBestSeller = false;
        } catch (err) {
          logger.warn("[PFS Update] Failed to REMOVE_STAR product", {
            error: err,
          });
        }
      }
    }

    // ── Step 6 : Local DB update + sauvegarde du snapshot ──
    report("Mise à jour locale...");
    const dbUpdate: Record<string, unknown> = { pfsLastSyncSnapshot: committedSnapshot };
    if (allVariantsOutOfStock && product.status === "ONLINE") {
      dbUpdate.status = "OFFLINE";
    }
    await prisma.product.update({
      where: { id: productId },
      data: dbUpdate,
    });

    if (!options?.skipRevalidation) {
      revalidateTag("products", "default");
    }
    emitProductEvent({
      type: allVariantsOutOfStock ? "PRODUCT_OFFLINE" : "PRODUCT_UPDATED",
      productId,
    });

    progress.status = "success";
    progress.step = "Terminé";
    onProgress?.(progress);
    logger.info("[PFS Update] Success", { reference: product.reference, pfsProductId });

    return { success: true, archived: allVariantsOutOfStock };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Update] Error", { reference: product.reference, error: errorMsg });

    progress.status = "error";
    progress.error = errorMsg;
    onProgress?.(progress);

    return { success: false, error: errorMsg };
  }
}
