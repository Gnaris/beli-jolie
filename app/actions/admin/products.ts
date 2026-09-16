"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { recalculateAllRulesForProduct } from "@/lib/collection-rules";
import { invalidateProductTranslations, translateTextStrict } from "@/lib/translate";
import { emitProductEvent } from "@/lib/product-events";
import { autoTranslateProduct, autoTranslateTag } from "@/lib/auto-translate";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import { generateSku } from "@/lib/sku";
import {
  deleteFiles,
  keyFromDbPath,
  productImageDir,
  renameProductFolder,
  deleteDirectory,
  slugify,
  substituteReferenceInPath,
  substituteReferenceInDestDir,
} from "@/lib/storage";
import { requireCurrentTenant } from "@/lib/tenant";
import { revalidateProductPublicPage } from "@/lib/product-url-server";
import {
  guardAdminActionOtp,
  applyPauseChoice,
} from "@/lib/admin-action-otp";
import { getImagePaths } from "@/lib/image-utils";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { normalizePrimaryFlag } from "@/lib/normalize-primary-flag";
import { getCountryByIso, listManufacturingCountries } from "@/lib/countries";
import { anyVariantHasImage } from "@/lib/variant-image-coverage";
import { resolvePrimaryColorId, listAvailableColorIds } from "@/lib/product-primary-color";
import { rotatePrimaryIfNeeded } from "@/lib/rotate-primary-service";
import {
  validateVariants,
  validateVariantBounds,
  validateProductFields,
  clampVariantStocks,
  isMultiColorPackInput,
  type ColorInput,
  type PackLineInput,
  type SizeEntryInput,
} from "@/lib/product-variant-validation";
import { normalizeMicrostoreSubCategoryId } from "@/lib/microstore-subcategory";
import {
  validateOverridesNotMatchingPrincipal,
  detectPfsColorConflicts,
  formatConflictsMessage,
  type VariantColorRefInput,
} from "@/lib/pfs-color-conflicts";
import {
  validateEfashionOverridesNotMatchingPrincipal,
  detectEfashionColorConflicts,
  formatEfashionConflictsMessage,
  type EfashionVariantColorRefInput,
} from "@/lib/efashion-color-conflicts";
import {
  isProtectedSizeName,
  isProtectedSizeVirtualId,
  PROTECTED_SIZE_NAME,
  PROTECTED_SIZE_PFS_REF,
  PROTECTED_SIZE_VIRTUAL_ID,
  withProtectedSize,
} from "@/lib/protected-sizes";

/**
 * Compte les images du produit groupées par colorId.
 * Lit le modèle au niveau produit (productId + colorId), pas la relation legacy productColorId.
 */
async function countImagesByColorForProduct(productId: string): Promise<Map<string, number>> {
  const rows = await prisma.productColorImage.groupBy({
    by: ["colorId"],
    where: { productId },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.colorId, r._count._all);
  return map;
}


/** Collect all sizeIds referenced across UNIT sizeEntries and PACK packLines. */
function collectSizeIds(colors: ColorInput[]): string[] {
  const ids = new Set<string>();
  for (const c of colors) {
    for (const se of c.sizeEntries) ids.add(se.sizeId);
    for (const pl of c.packLines ?? []) {
      for (const se of pl.sizeEntries) ids.add(se.sizeId);
    }
  }
  return [...ids];
}

/** Throws if a variant uses « Taille unique » but `sizeDetailsTu` is empty. */
async function assertTailleUniqueDetails(input: ProductInput): Promise<void> {
  const sizeIds = collectSizeIds(input.colors);
  if (sizeIds.length === 0) return;
  const sizes = await prisma.size.findMany({
    where: { id: { in: sizeIds } },
    select: { name: true },
  });
  const usesTailleUnique = sizes.some((s) => isProtectedSizeName(s.name));
  if (usesTailleUnique && !input.sizeDetailsTu?.trim()) {
    throw new Error(
      "Le champ « Détail taille unique » est obligatoire quand une variante utilise la taille unique."
    );
  }
}

/**
 * Replaces the virtual « Taille unique » id with the real Size row cuid.
 * The Size row is created lazily on first save — single point where the
 * protected size is persisted, so it never appears in the database until
 * it is actually attached to a product.
 */
async function resolveProtectedSizeId(input: ProductInput): Promise<ProductInput> {
  const usesVirtual = input.colors.some(
    (c) =>
      c.sizeEntries.some((se) => isProtectedSizeVirtualId(se.sizeId)) ||
      (c.packLines ?? []).some((pl) =>
        pl.sizeEntries.some((se) => isProtectedSizeVirtualId(se.sizeId)),
      ),
  );
  if (!usesVirtual) return input;
  let row = await prisma.size.findFirst({
    where: { name: PROTECTED_SIZE_NAME },
    select: { id: true },
  });
  if (!row) {
    row = await prisma.size.create({
      data: { name: PROTECTED_SIZE_NAME, pfsSizeRef: PROTECTED_SIZE_PFS_REF, position: 0 },
      select: { id: true },
    });
  }
  const swap = (sizeId: string): string => (isProtectedSizeVirtualId(sizeId) ? row.id : sizeId);
  return {
    ...input,
    colors: input.colors.map((c) => ({
      ...c,
      sizeEntries: c.sizeEntries.map((se) => ({ ...se, sizeId: swap(se.sizeId) })),
      packLines: c.packLines?.map((pl) => ({
        ...pl,
        sizeEntries: pl.sizeEntries.map((se) => ({ ...se, sizeId: swap(se.sizeId) })),
      })),
    })),
  };
}

// Marketplace sync (PFS) is handled live via API in publishProductToMarketplaces /
// refreshProductOnMarketplaces. Local product deletion never touches the remote
// marketplace — the admin removes the product there manually if needed.
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
// SizeEntryInput, PackLineInput, ColorInput sont définis dans
// `lib/product-variant-validation.ts` et ré-exportés en haut de ce fichier.

export interface CompositionInput {
  compositionId: string;
  percentage: number;
}

export interface TranslationInput {
  locale: string;
  name: string;
  description: string;
}

export interface ProductInput {
  reference: string;
  name: string;
  description: string;
  categoryId: string;
  subCategoryIds: string[];
  /** Sous-catégorie à utiliser dans la colonne "Catégorie" de l'export Microstore.
   *  null/undefined = catégorie principale (comportement par défaut). */
  microstoreSubCategoryId?: string | null;
  colors: ColorInput[];
  // Couleur principale du produit (déterminée au niveau Product). Si null/undefined,
  // auto-assignation par le serveur depuis la 1ʳᵉ couleur disponible.
  primaryColorId?: string | null;
  // Images : 1 entrée par couleur (productId × colorId). Les champs variantDbId
  // et variantIndex sont conservés pour rétro-compatibilité mais ignorés.
  imagePaths?: { colorId: string; variantDbId?: string; variantIndex?: number; paths: string[]; orders?: number[] }[];
  compositions: CompositionInput[];
  similarProductIds: string[];
  bundleChildIds: string[];
  bundleParentIds?: string[];
  tagNames: string[];
  isBestSeller: boolean;
  status: "OFFLINE" | "ONLINE" | "ARCHIVED";
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  hsCodeId?: string | null;
  countryIsoCode?: string | null;
  seasonId?: string | null;
  /** Note interne admin. Jamais exposée sur le site ni marketplaces. */
  note?: string | null;
  translations?: TranslationInput[];
  discountPercent: number | null; // Remise en % (ex: 15 = -15%). null = pas de remise
  sizeDetailsTu?: string | null; // Détail taille unique (ex: "52-56")
  isIncomplete?: boolean;
}

// validateVariants + isMultiColorPackInput : voir `lib/product-variant-validation.ts`

/**
 * Charge les pfsColorRef de toutes les couleurs référencées par les variantes
 * (et par les lignes de pack) puis valide qu'aucun override secondaire n'est
 * identique au mapping principal de sa couleur. Throw si violation.
 *
 * Utilisé par createProduct + updateProduct.
 */
async function validatePfsColorOverridesOrThrow(colors: ColorInput[]): Promise<void> {
  const colorIds = new Set<string>();
  for (const c of colors) {
    if (c.colorId && c.pfsColorRefOverride) colorIds.add(c.colorId);
    if (c.packLines) {
      for (const pl of c.packLines) {
        if (pl.colorId && pl.pfsColorRefOverride) colorIds.add(pl.colorId);
      }
    }
  }
  if (colorIds.size === 0) return;

  const rows = await prisma.color.findMany({
    where: { id: { in: [...colorIds] } },
    select: { id: true, pfsColorRef: true },
  });
  const principalRefByColorId = new Map<string, string | null>(
    rows.map((r) => [r.id, r.pfsColorRef]),
  );
  validateOverridesNotMatchingPrincipal(
    colors.map((c) => ({
      colorId: c.colorId ?? null,
      pfsColorRefOverride: c.pfsColorRefOverride ?? null,
      packLines: c.packLines?.map((pl) => ({
        colorId: pl.colorId,
        pfsColorRefOverride: pl.pfsColorRefOverride ?? null,
      })),
    })),
    principalRefByColorId,
  );
}

/** Normalise un override : trim + null si vide. */
function normalizeOverride(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

/** Normalise un override eFashion (Int) : conserve les nombres entiers positifs, null sinon. */
function normalizeEfashionOverride(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : null;
}

/**
 * Miroir eFashion de `validatePfsColorOverridesOrThrow` : refuse un override
 * eFashion identique au mapping principal (`Color.efashionColorId`) de sa
 * couleur. Throw si violation. Utilisé par create/updateProduct.
 */
async function validateEfashionColorOverridesOrThrow(colors: ColorInput[]): Promise<void> {
  const colorIds = new Set<string>();
  for (const c of colors) {
    if (c.colorId && c.efashionColorIdOverride != null) colorIds.add(c.colorId);
    if (c.packLines) {
      for (const pl of c.packLines) {
        if (pl.colorId && pl.efashionColorIdOverride != null) colorIds.add(pl.colorId);
      }
    }
  }
  if (colorIds.size === 0) return;

  const rows = await prisma.color.findMany({
    where: { id: { in: [...colorIds] } },
    select: { id: true, efashionColorId: true },
  });
  const principalIdByColorId = new Map<string, number | null>(
    rows.map((r) => [r.id, r.efashionColorId]),
  );
  validateEfashionOverridesNotMatchingPrincipal(
    colors.map((c) => ({
      colorId: c.colorId ?? null,
      efashionColorIdOverride: c.efashionColorIdOverride ?? null,
      packLines: c.packLines?.map((pl) => ({
        colorId: pl.colorId,
        efashionColorIdOverride: pl.efashionColorIdOverride ?? null,
      })),
    })),
    principalIdByColorId,
  );
}

/**
 * Refuse d'enregistrer le produit si deux couleurs différentes finissent par
 * pointer sur le même mapping PFS effectif (mapping principal de la couleur OU
 * override secondaire). Détecte la collision quel que soit le combo :
 *  - principal A vs principal B (deux fiches couleur mal mappées en biblio)
 *  - principal A vs override B (override qui écrase mais tape sur autre chose)
 *  - override A vs override B
 * Deux variantes/lignes de pack pointant sur la MÊME couleur BJ ne comptent
 * pas comme un conflit (c'est juste la même couleur réutilisée).
 * Throw un message clair listant les couleurs incriminées. Utilisé par
 * create/updateProduct.
 */
async function assertNoPfsMappingConflictsOrThrow(colors: ColorInput[]): Promise<void> {
  const colorIds = new Set<string>();
  for (const c of colors) {
    if (c.colorId) colorIds.add(c.colorId);
    if (c.packLines) {
      for (const pl of c.packLines) {
        if (pl.colorId) colorIds.add(pl.colorId);
      }
    }
  }
  if (colorIds.size < 2) return;

  const rows = await prisma.color.findMany({
    where: { id: { in: [...colorIds] } },
    select: { id: true, name: true, pfsColorRef: true },
  });
  const colorById = new Map(rows.map((r) => [r.id, r]));

  const items: VariantColorRefInput[] = [];
  let idx = 0;
  for (const c of colors) {
    if (c.colorId) {
      const color = colorById.get(c.colorId);
      if (color) {
        items.push({
          key: `v${idx}`,
          colorId: c.colorId,
          label: color.name,
          principalRef: color.pfsColorRef,
          overrideRef: normalizeOverride(c.pfsColorRefOverride),
        });
      }
    }
    if (c.packLines) {
      for (const [plIdx, pl] of c.packLines.entries()) {
        if (!pl.colorId) continue;
        const color = colorById.get(pl.colorId);
        if (!color) continue;
        items.push({
          key: `v${idx}-pl${plIdx}`,
          colorId: pl.colorId,
          label: color.name,
          principalRef: color.pfsColorRef,
          overrideRef: normalizeOverride(pl.pfsColorRefOverride),
        });
      }
    }
    idx += 1;
  }

  const conflicts = detectPfsColorConflicts(items);
  if (conflicts.length > 0) {
    throw new Error(
      formatConflictsMessage(conflicts) +
        " Modifiez le mapping secondaire depuis la section « Mapping Marketplaces » pour lever le conflit.",
    );
  }
}

/**
 * Miroir eFashion de `assertNoPfsMappingConflictsOrThrow`. eFashion crée un
 * « produit » par couleur — deux couleurs BJ qui pointent sur le même
 * `efashionColorId` déclenchent une collision côté marketplace. On bloque au
 * save pour ne jamais laisser un produit dans cet état invalide.
 */
async function assertNoEfashionMappingConflictsOrThrow(colors: ColorInput[]): Promise<void> {
  const colorIds = new Set<string>();
  for (const c of colors) {
    if (c.colorId) colorIds.add(c.colorId);
    if (c.packLines) {
      for (const pl of c.packLines) {
        if (pl.colorId) colorIds.add(pl.colorId);
      }
    }
  }
  if (colorIds.size < 2) return;

  const rows = await prisma.color.findMany({
    where: { id: { in: [...colorIds] } },
    select: { id: true, name: true, efashionColorId: true },
  });
  const colorById = new Map(rows.map((r) => [r.id, r]));

  const items: EfashionVariantColorRefInput[] = [];
  let idx = 0;
  for (const c of colors) {
    if (c.colorId) {
      const color = colorById.get(c.colorId);
      if (color) {
        items.push({
          key: `v${idx}`,
          colorId: c.colorId,
          label: color.name,
          principalId: color.efashionColorId,
          overrideId: normalizeEfashionOverride(c.efashionColorIdOverride),
        });
      }
    }
    if (c.packLines) {
      for (const [plIdx, pl] of c.packLines.entries()) {
        if (!pl.colorId) continue;
        const color = colorById.get(pl.colorId);
        if (!color) continue;
        items.push({
          key: `v${idx}-pl${plIdx}`,
          colorId: pl.colorId,
          label: color.name,
          principalId: color.efashionColorId,
          overrideId: normalizeEfashionOverride(pl.efashionColorIdOverride),
        });
      }
    }
    idx += 1;
  }

  const conflicts = detectEfashionColorConflicts(items);
  if (conflicts.length > 0) {
    throw new Error(
      formatEfashionConflictsMessage(conflicts) +
        " Modifiez le mapping secondaire depuis la section « Mapping Marketplaces » pour lever le conflit.",
    );
  }
}

// ─────────────────────────────────────────────
// SKU assignment for all variants of a product
// ─────────────────────────────────────────────

/**
 * Assign SKUs to all variants of a product that don't have one yet.
 * Format: {reference}_{COULEUR-SOUSCOULEUR}_{UNIT|PACK}_{index}
 * Index is global across all variants, based on creation order.
 */
async function assignVariantSkus(
  productId: string,
  reference: string,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<void> {
  const db = tx || prisma;
  const variants = await db.productColor.findMany({
    where: { productId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sku: true,
      saleType: true,
      colorId: true,
      color: { select: { name: true } },
      packLines: {
        orderBy: { position: "asc" },
        select: { color: { select: { name: true } } },
      },
    },
  });

  const updates: Promise<unknown>[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const colorNames: string[] = v.packLines.length > 0
      ? v.packLines.map((l) => l.color.name)
      : (v.color?.name ? [v.color.name] : []);

    const sku = generateSku(
      reference.trim().toUpperCase(),
      colorNames,
      v.saleType as "UNIT" | "PACK",
      i + 1
    );

    if (v.sku !== sku) {
      updates.push(
        db.productColor.update({
          where: { id: v.id },
          data: { sku },
        })
      );
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

// ─────────────────────────────────────────────
// Vérifier la disponibilité d'une référence (pré-check non-throw)
// ─────────────────────────────────────────────
// Appelée par le formulaire avant createProduct / updateProduct pour afficher
// un message clair à l'utilisatrice. En production, Next.js masque le message
// des Error remontés depuis une server action ("An error occurred in the Server
// Components render…") — d'où ce retour { available } qui n'est pas sanitisé.

export async function checkProductReferenceAvailable(
  reference: string,
  excludeProductId?: string,
): Promise<{ available: boolean }> {
  await requireAdmin();
  const ref = reference.trim().toUpperCase();
  if (!ref) return { available: false };
  const existing = await prisma.product.findFirst({
    where: excludeProductId
      ? { reference: ref, NOT: { id: excludeProductId } }
      : { reference: ref },
    select: { id: true },
  });
  return { available: !existing };
}

// ─────────────────────────────────────────────
// Créer un produit
// ─────────────────────────────────────────────

export async function createProduct(input: ProductInput): Promise<{ id: string }> {
  await requireAdmin();
  input = await resolveProtectedSizeId(input);

  // Garde-fous toujours appliqués (AUDIT [7]) : remise produit 0-100 %,
  // prix/stock/poids/quantités jamais négatifs — y compris en brouillon.
  validateProductFields(input);
  clampVariantStocks(input.colors);
  validateVariantBounds(input.colors);

  // Skip strict variant validation for incomplete products
  if (!input.isIncomplete) {
    validateVariants(input.colors);
    await assertTailleUniqueDetails(input);
  }
  // Toujours valider les overrides PFS secondaires : un override égal au mapping
  // principal est interdit qu'on soit en draft ou non.
  await validatePfsColorOverridesOrThrow(input.colors);
  // Idem pour les overrides eFashion.
  await validateEfashionColorOverridesOrThrow(input.colors);
  // Blocage inter-couleurs : deux couleurs distinctes ne peuvent pas partager
  // le même mapping PFS/eFashion effectif (que ce soit via principal ou override).
  await assertNoPfsMappingConflictsOrThrow(input.colors);
  await assertNoEfashionMappingConflictsOrThrow(input.colors);

  // Garantir une seule variante primaire avant l'écriture en BDD
  input = { ...input, colors: normalizePrimaryFlag(input.colors) };

  if (/\s/.test(input.reference)) throw new Error("La référence ne doit pas contenir d'espaces.");

  const existing = await prisma.product.findFirst({ where: { reference: input.reference }, select: { id: true } });
  if (existing) throw new Error("Cette référence existe déjà.");

  // Vérifier que la catégorie existe
  const categoryExists = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!categoryExists) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");

  // Vérifier le pays de fabrication (ISO alpha-2 dans lib/countries.ts)
  if (input.countryIsoCode && !getCountryByIso(input.countryIsoCode)) {
    throw new Error("Le pays de fabrication sélectionné n'existe pas.");
  }
  if (input.seasonId) {
    const seasonExists = await prisma.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
    if (!seasonExists) throw new Error("La saison sélectionnée n'existe plus. Rechargez la page.");
  }

  // Upsert tags
  const tagRecords = await Promise.all(
    input.tagNames.map(async (n) => {
      const normalized = n.trim().toLowerCase();
      let tag = await prisma.tag.findFirst({ where: { name: normalized } });
      if (!tag) {
        tag = await prisma.tag.create({ data: { name: normalized } });
      }
      // Auto-translate new tags (fire-and-forget, checks if translations exist)
      autoTranslateTag(tag.id, normalized);
      return tag;
    })
  );

  // ── Couleur principale au niveau produit ──
  // L'union des colorId disponibles = colorId des variantes + colorId des packLines
  // (pour permettre de désigner principale une couleur n'apparaissant qu'en pack).
  const availableColorIds = listAvailableColorIds({
    colors: input.colors.map((c) => ({
      colorId: isMultiColorPackInput(c)
        ? (c.packLines?.[0]?.colorId ?? c.colorId ?? null)
        : (c.colorId ?? null),
      packLines: (c.packLines ?? []).map((pl) => ({ colorId: pl.colorId })),
    })),
  });
  const resolvedPrimaryColorId = resolvePrimaryColorId(input.primaryColorId, availableColorIds);

  const product = await prisma.product.create({
    data: {
      reference:             input.reference.trim().toUpperCase(),
      name:                  input.name.trim(),
      description:           input.description.trim(),
      note:                  input.note?.trim() ? input.note.trim() : null,
      categoryId:    input.categoryId,
      isBestSeller:  input.isBestSeller,
      status:        input.status,
      isIncomplete:  input.isIncomplete ?? false,
      primaryColorId: resolvedPrimaryColorId,
      subCategories: { connect: input.subCategoryIds.map((id) => ({ id })) },
      microstoreSubCategoryId: normalizeMicrostoreSubCategoryId(
        input.microstoreSubCategoryId,
        input.subCategoryIds,
      ),
      tags:          { create: tagRecords.map((t) => ({ tagId: t.id })) },
      dimensionLength:       input.dimensionLength,
      dimensionWidth:        input.dimensionWidth,
      dimensionHeight:       input.dimensionHeight,
      dimensionDiameter:     input.dimensionDiameter,
      dimensionCircumference: input.dimensionCircumference,
      hsCodeId: input.hsCodeId || null,
      countryIsoCode: input.countryIsoCode || null,
      seasonId: input.seasonId || null,
      discountPercent: input.discountPercent,
      sizeDetailsTu: input.sizeDetailsTu?.trim() || null,
      compositions: {
        create: input.compositions.map((c) => ({
          compositionId: c.compositionId,
          percentage:    c.percentage,
        })),
      },
    },
  });

  // Create variants one by one to guarantee order
  const createdVariants: { id: string; colorId: string | null }[] = [];
  for (let i = 0; i < input.colors.length; i++) {
    const color = input.colors[i];
    const isMultiPack = isMultiColorPackInput(color);
    // Pour un pack multi-couleurs, colorId = 1ère couleur du pack (cohérence SKU/index).
    // La composition réelle vit dans packLines.
    const primaryColorId = isMultiPack
      ? (color.packLines?.[0]?.colorId || color.colorId || null)
      : (color.colorId || null);
    const variant = await prisma.productColor.create({
      data: {
        productId:               product.id,
        colorId:                 primaryColorId,
        unitPrice:               color.unitPrice,
        weight:                  color.weight,
        stock:                   color.stock,
        isPrimary:               color.isPrimary,
        saleType:                color.saleType,
        packQuantity:            color.packQuantity,
        disabled:                color.disabled ?? false,
        pfsColorRefOverride:     normalizeOverride(color.pfsColorRefOverride),
        efashionColorIdOverride: normalizeEfashionOverride(color.efashionColorIdOverride),
        ankorsColorNameOverride: normalizeOverride(color.ankorsColorNameOverride),
        faireColorNameOverride:  normalizeOverride(color.faireColorNameOverride),
      },
      select: { id: true, colorId: true },
    });
    createdVariants.push(variant);

    if (isMultiPack && color.packLines) {
      // Lignes multi-couleurs du pack : couleur + tailles/quantités
      for (let li = 0; li < color.packLines.length; li++) {
        const line = color.packLines[li];
        await prisma.packColorLine.create({
          data: {
            productColorId:          variant.id,
            colorId:                 line.colorId,
            position:                li,
            pfsColorRefOverride:     normalizeOverride(line.pfsColorRefOverride),
            efashionColorIdOverride: normalizeEfashionOverride(line.efashionColorIdOverride),
            ankorsColorNameOverride: normalizeOverride(line.ankorsColorNameOverride),
            faireColorNameOverride:  normalizeOverride(line.faireColorNameOverride),
            sizes: {
              create: line.sizeEntries.map((se) => ({ sizeId: se.sizeId, quantity: se.quantity })),
            },
          },
        });
      }
    } else if (color.sizeEntries && color.sizeEntries.length > 0) {
      // UNIT ou PACK mono-couleur legacy : tailles classiques
      await prisma.variantSize.createMany({
        data: color.sizeEntries.map((se) => ({
          productColorId: variant.id,
          sizeId: se.sizeId,
          quantity: se.quantity,
          ...(se.pricePerUnit != null ? { pricePerUnit: se.pricePerUnit } : {}),
        })),
      });
    }
  }

  // Assign SKUs to all newly created variants
  await assignVariantSkus(product.id, input.reference);

  // Images : 1 entrée par (productId, colorId, order) — couleur attachée AU PRODUIT,
  // pas à une variante (productColorId reste NULL). Une couleur partagée par plusieurs
  // variantes ne génère donc qu'un seul jeu d'images.
  if (input.imagePaths && input.imagePaths.length > 0) {
    const imageData: { productId: string; colorId: string; productColorId: null; path: string; order: number }[] = [];
    const seen = new Set<string>(); // dédup par (colorId, order, path)
    for (const group of input.imagePaths) {
      if (group.paths.length === 0) continue;
      const colorId = group.colorId;
      if (!colorId) continue;
      group.paths.forEach((path, idx) => {
        const order = group.orders?.[idx] ?? idx;
        const key = `${colorId}::${order}::${path}`;
        if (seen.has(key)) return;
        seen.add(key);
        imageData.push({ productId: product.id, colorId, productColorId: null, path, order });
      });
    }
    if (imageData.length > 0) {
      await prisma.productColorImage.createMany({ data: imageData });
    }
  }

  // Auto-downgrade to OFFLINE seulement si AUCUNE couleur n'a la moindre
  // image. Les couleurs sans image sont simplement ignorées côté affichage
  // public et côté push marketplaces — pas besoin de basculer tout le
  // produit OFFLINE pour autant.
  let effectiveStatus = input.status;
  if (input.status === "ONLINE" && createdVariants.length > 0) {
    const variantsWithDetails = await prisma.productColor.findMany({
      where: { productId: product.id },
      select: {
        id: true,
        colorId: true,
        color: { select: { name: true } },
      },
    });
    const imageCountByColor = await countImagesByColorForProduct(product.id);
    const coverageInput = variantsWithDetails.map((v) => ({
      id: v.id,
      colorId: v.colorId,
      colorName: v.color?.name ?? null,
      imageCount: v.colorId ? (imageCountByColor.get(v.colorId) ?? 0) : 0,
    }));
    if (!anyVariantHasImage(coverageInput)) {
      effectiveStatus = "OFFLINE";
      await prisma.product.update({ where: { id: product.id }, data: { status: "OFFLINE" } });
    }
  }

  // Produits similaires — bidirectionnel (A→B et B→A)
  if (input.similarProductIds.length > 0) {
    await prisma.productSimilar.createMany({
      data: [
        ...input.similarProductIds.map((similarId) => ({ productId: product.id, similarId })),
        ...input.similarProductIds.map((similarId) => ({ productId: similarId, similarId: product.id })),
      ],
      skipDuplicates: true,
    });
  }

  // Composition produit (ensemble → sous-produits, directionnel)
  if (input.bundleChildIds.length > 0) {
    await prisma.productBundle.createMany({
      data: input.bundleChildIds.map((childId) => ({ parentId: product.id, childId })),
      skipDuplicates: true,
    });
  }

  // Traductions manuelles : marquées `manualEdit: true` pour ne pas être
  // écrasées par un futur job d'auto-traduction (cf. `_autoTranslateProduct`).
  const existingLocales: string[] = [];
  if (input.translations && input.translations.length > 0) {
    const validTranslations = input.translations.filter((t) => t.name.trim() || t.description.trim());
    if (validTranslations.length > 0) {
      await prisma.productTranslation.createMany({
        data: validTranslations.map((t) => ({
          productId:   product.id,
          locale:      t.locale,
          name:        t.name,
          description: t.description,
          manualEdit:  true,
        })),
        skipDuplicates: true,
      });
      existingLocales.push(...validTranslations.map((t) => t.locale));
    }
  }

  // Auto-translate missing locales (fire-and-forget)
  autoTranslateProduct(product.id, input.name, input.description, existingLocales);

  revalidatePath("/admin/produits");
  revalidateTag("products", "default");
  revalidateTag("tags", "default");

  if (effectiveStatus === "ONLINE") {
    emitProductEvent({ type: "PRODUCT_ONLINE", productId: product.id });
  }

  // Recalcule l'appartenance de ce produit aux collections avec règles auto.
  // Ne throw jamais (encapsule ses erreurs) — un échec ne doit pas casser la
  // création du produit.
  await recalculateAllRulesForProduct(product.id);

  // Marketplace publishing (PFS) is triggered from the save dialog, not here.

  return { id: product.id };
}

// ─────────────────────────────────────────────
// Modifier un produit
// ─────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<{ variantDbIds: string[] }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();
  input = await resolveProtectedSizeId(input);

  // [override-debug] Trace : on log les overrides PFS reçus dans le payload pour
  // confirmer que le formulaire envoie bien les overrides de TOUTES les variantes.
  logger.info("[updateProduct] [override-debug] payload colors received", {
    productId: id,
    reference: input.reference,
    colors: input.colors?.map((c) => ({
      dbId: c.dbId ?? null,
      colorId: c.colorId ?? null,
      pfsColorRefOverride: c.pfsColorRefOverride ?? null,
      packLines: c.packLines?.map((pl) => ({
        colorId: pl.colorId,
        pfsColorRefOverride: pl.pfsColorRefOverride ?? null,
      })) ?? [],
    })),
  });

  // ── Defensive validation: DB non-nullable constraints ────────
  if (!input.reference?.trim()) throw new Error("La référence est requise.");
  if (/\s/.test(input.reference)) throw new Error("La référence ne doit pas contenir d'espaces.");
  if (!input.name?.trim()) throw new Error("Le nom est requis.");
  if (!input.categoryId) throw new Error("La catégorie est requise.");

  // Garde-fous toujours appliqués (AUDIT [7]) : remise produit 0-100 %,
  // prix/stock/poids/quantités jamais négatifs — y compris en brouillon.
  validateProductFields(input);
  clampVariantStocks(input.colors);
  validateVariantBounds(input.colors);

  // Strict validation only when going ONLINE (not for drafts or OFFLINE saves)
  if (input.status === "ONLINE") {
    if (!input.description?.trim()) throw new Error("La description est requise.");
    if (!input.colors || input.colors.length === 0) {
      throw new Error("Au moins une variante est requise.");
    }
    validateVariants(input.colors);
    await assertTailleUniqueDetails(input);
  }
  // Toujours valider les overrides PFS secondaires (cf. createProduct).
  await validatePfsColorOverridesOrThrow(input.colors);
  // Idem pour les overrides eFashion.
  await validateEfashionColorOverridesOrThrow(input.colors);

  // Garantir une seule variante primaire (corrige aussi les produits legacy
  // créés avant le fix où plusieurs variantes pouvaient être marquées primaires).
  input = { ...input, colors: normalizePrimaryFlag(input.colors) };

  const oldProduct = await prisma.product.findUnique({
    where: { id },
    select: {
      reference: true,
      status: true,
      isBestSeller: true,
      name: true,
      description: true,
      note: true,
      categoryId: true,
      countryIsoCode: true,
      seasonId: true,
      hsCodeId: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      primaryColorId: true,
      // Utilisé pour autoriser le renommage de la référence sur un brouillon
      // jamais publié (aucun ID marketplace posé).
      isIncomplete: true,
      // Pour décider si on doit poser les drapeaux « Synchro nécessaire »
      // sur les marketplaces liées après la mise à jour.
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
      microstoreProductId: true,
      // Compositions actuelles — utilisées pour détecter un changement de
      // composition sur le save (sinon le badge orange resterait éteint).
      compositions: {
        select: { compositionId: true, percentage: true },
      },
    },
  });

  // ── Référence verrouillée après création (sauf brouillon jamais publié) ──
  // Décision cliente 2026-08-21 (incident A2251(2)/(3)) : la référence
  // sert de clé aux marketplaces (PFS/Ankor/eFa/Faire/OC) et aux chemins
  // fichiers. La modifier a posteriori provoque des décalages (images
  // fantômes, images considérées orphelines et supprimées, échec
  // « Invalid attachment » côté OC…). Le UI passe déjà le champ en
  // readOnly en mode édition, ce bloc est un garde-fou serveur.
  //
  // Exception 2026-09-04 : un brouillon (`isIncomplete = true`) qui n'a
  // jamais été poussé sur AUCUNE marketplace peut voir sa référence
  // renommée — aucun lien externe à casser. Le UI l'ouvre déjà en mode
  // « create » dans ce cas.
  const _oldRefLocked = oldProduct?.reference ?? "";
  const _submittedRefLocked = input.reference.trim().toUpperCase();
  const _neverPublishedDraft = !!oldProduct?.isIncomplete
    && !oldProduct?.pfsProductId
    && !oldProduct?.ankorsProductId
    && !oldProduct?.efashionReferenceBase
    && !oldProduct?.faireProductId
    && !oldProduct?.orderchampProductId
    && !oldProduct?.microstoreProductId;
  const _refCanChange = _neverPublishedDraft;
  const _effectiveRef = _refCanChange
    ? (_submittedRefLocked || _oldRefLocked)
    : (_oldRefLocked || _submittedRefLocked);
  if (
    !_refCanChange
    && _oldRefLocked
    && _submittedRefLocked
    && _submittedRefLocked !== _oldRefLocked
  ) {
    logger.warn("[updateProduct] Reference change ignored (locked after creation)", {
      productId: id,
      oldRef: _oldRefLocked,
      submittedRef: _submittedRefLocked,
    });
  }

  const dup = await prisma.product.findFirst({
    where: { reference: _effectiveRef, NOT: { id } },
    select: { id: true },
  });
  if (dup) throw new Error("Cette référence est déjà utilisée par un autre produit.");

  // Vérifier que la catégorie existe
  const categoryExists = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!categoryExists) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");

  // Vérifier le pays de fabrication (ISO alpha-2 dans lib/countries.ts)
  if (input.countryIsoCode && !getCountryByIso(input.countryIsoCode)) {
    throw new Error("Le pays de fabrication sélectionné n'existe pas.");
  }
  if (input.seasonId) {
    const seasonExists = await prisma.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
    if (!seasonExists) throw new Error("La saison sélectionnée n'existe plus. Rechargez la page.");
  }

  // Upsert tags
  const tagRecords = await Promise.all(
    input.tagNames.map(async (n) => {
      const normalized = n.trim().toLowerCase();
      let tag = await prisma.tag.findFirst({ where: { name: normalized } });
      if (!tag) {
        tag = await prisma.tag.create({ data: { name: normalized } });
      }
      return tag;
    })
  );

  // Référence verrouillée : cf. bloc « Référence verrouillée après
  // création » plus haut. Ces variables restent utilisées par les
  // requêtes en aval. Un vrai renommage n'a lieu que pour un brouillon
  // jamais publié (aucun ID marketplace posé).
  const oldRef = _oldRefLocked;
  const newRefUpper = _effectiveRef;
  let folderRenameSwaps: { oldDbPath: string; newDbPath: string }[] = [];
  let folderRenamed = false;
  if (_refCanChange && oldRef && oldRef !== newRefUpper) {
    try {
      const { renamed } = await renameProductFolder(oldRef, newRefUpper, tenant.slug);
      folderRenameSwaps = renamed;
      folderRenamed = true;
    } catch (err) {
      logger.error("[Storage] renameProductFolder failed", {
        productId: id,
        oldRef,
        newRef: newRefUpper,
        error: err,
      });
      // On laisse passer : le swap de path ne sera pas effectué, mais la
      // BDD reste cohérente. L'admin peut relancer un save plus tard.
      folderRenameSwaps = [];
    }
  }

  // Map BDD-path → BDD-path (toutes tailles : large/md/thumb).
  const pathRenameMap = new Map<string, string>();
  for (const { oldDbPath, newDbPath } of folderRenameSwaps) {
    pathRenameMap.set(oldDbPath, newDbPath);
  }

  let txResult: {
    oldStockMap: Map<string, number>;
    oldVariantMap: Map<string, {
      stock: number;
      unitPrice: number;
      saleType: "UNIT" | "PACK";
      packQuantity: number | null;
      totalPackQty: number;
      pfsColorRefOverride: string | null;
      efashionColorIdOverride: number | null;
      ankorsColorNameOverride: string | null;
      faireColorNameOverride: string | null;
      disabled: boolean;
    }>;
    variantIdMap: { colorInput: ColorInput; variantId: string; isNew: boolean }[];
    orphanImagePaths: string[];
    resolvedPrimaryAfter: string | null;
    imageMappingChanged: boolean;
  } | null = null;
  try {
    txResult = await prisma.$transaction(async (tx) => {
    // Si le dossier a été renommé sur le disque, mettre à jour les paths
    // (large uniquement — md/thumb sont dérivés à la lecture) en BDD avant
    // toute autre opération.
    if (folderRenameSwaps.length > 0) {
      const existingImages = await tx.productColorImage.findMany({
        where: { productId: id },
        select: { id: true, path: true },
      });
      for (const img of existingImages) {
        const next = pathRenameMap.get(img.path);
        if (next && next !== img.path) {
          await tx.productColorImage.update({
            where: { id: img.id },
            data: { path: next },
          });
        }
      }
    }

    // ── Filet de sécurité : rattrapage des paths desync ─────────────
    // renameProductFolder ne rattrape que les fichiers présents sur le
    // disque au moment du save. Si un upload async est terminé APRÈS le
    // rename (worker écrit à l'ancien destDir capturé à l'enqueue), le
    // path BDD reste sur l'ancien slug produit → orphelin à jamais.
    //
    // On fait une substitution textuelle sur `ProductColorImage.path`
    // pour toute entrée qui contient encore l'ancien slug + on réécrit
    // les jobs `ImageProcessingJob` en vol pour qu'ils atterrissent au
    // bon endroit.
    if (oldRef && oldRef !== newRefUpper) {
      const oldSlugRef = slugify(oldRef);
      const newSlugRef = slugify(newRefUpper);
      if (oldSlugRef !== newSlugRef) {
        const oldFolderPart = `/uploads/${tenant.slug}/produits/${oldSlugRef}/`;

        const desyncedImages = await tx.productColorImage.findMany({
          where: { productId: id, path: { contains: oldFolderPart } },
          select: { id: true, path: true },
        });
        for (const img of desyncedImages) {
          const nextPath = substituteReferenceInPath(img.path, oldSlugRef, newSlugRef, tenant.slug);
          if (nextPath !== img.path) {
            await tx.productColorImage.update({
              where: { id: img.id },
              data: { path: nextPath },
            });
          }
        }

        // Réécrit les jobs image en vol (PENDING/PROCESSING) pour qu'ils
        // écrivent le fichier au nouveau path.
        const inflightJobs = await tx.imageProcessingJob.findMany({
          where: {
            productId: id,
            status: { in: ["PENDING", "PROCESSING"] },
            destDir: { contains: `/produits/${oldSlugRef}` },
          },
          select: { id: true, destDir: true, filename: true, dbPath: true },
        });
        for (const job of inflightJobs) {
          const newDestDir = substituteReferenceInDestDir(job.destDir, oldSlugRef, newSlugRef);
          const newFilename = job.filename.startsWith(`${oldSlugRef}-`)
            ? `${newSlugRef}-` + job.filename.slice(oldSlugRef.length + 1)
            : job.filename;
          const newDbPath = substituteReferenceInPath(job.dbPath, oldSlugRef, newSlugRef, tenant.slug);
          await tx.imageProcessingJob.update({
            where: { id: job.id },
            data: { destDir: newDestDir, filename: newFilename, dbPath: newDbPath },
          });
        }
      }
    }

    // Mise à jour des champs de base
    // NB : `reference` est verrouillée après création — on force `newRefUpper`
    // (= ancienne référence si le client tente d'en soumettre une nouvelle,
    // cf. bloc « Référence verrouillée après création » plus haut).
    await tx.product.update({
      where: { id },
      data: {
        reference:             newRefUpper,
        name:                  input.name.trim(),
        description:           input.description.trim(),
        note:                  input.note === undefined ? undefined : (input.note?.trim() ? input.note.trim() : null),
        categoryId:    input.categoryId,
        isBestSeller:  input.isBestSeller,
        status:        input.status,
        isIncomplete:  input.isIncomplete ?? false,
        subCategories: { set: input.subCategoryIds.map((id) => ({ id })) },
        microstoreSubCategoryId: normalizeMicrostoreSubCategoryId(
          input.microstoreSubCategoryId,
          input.subCategoryIds,
        ),
        dimensionLength:       input.dimensionLength,
        dimensionWidth:        input.dimensionWidth,
        dimensionHeight:       input.dimensionHeight,
        dimensionDiameter:     input.dimensionDiameter,
        dimensionCircumference: input.dimensionCircumference,
        hsCodeId: input.hsCodeId || null,
        countryIsoCode: input.countryIsoCode || null,
        seasonId: input.seasonId || null,
        discountPercent: input.discountPercent,
        sizeDetailsTu: input.sizeDetailsTu?.trim() || null,
      },
    });

    // Tags — reconstruction complète
    await tx.productTag.deleteMany({ where: { productId: id } });
    if (tagRecords.length > 0) {
      await tx.productTag.createMany({
        data: tagRecords.map((t) => ({ productId: id, tagId: t.id })),
        skipDuplicates: true,
      });
    }

    // Compositions — reconstruction complète.
    // Défensif : le payload peut contenir 2 lignes sur la même compositionId
    // (double-clic, résidu d'état React) → dédoublonner sinon P2002 sur
    // ProductComposition_productId_compositionId_key et le save entier échoue.
    const dedupedCompositions = Array.from(
      new Map(input.compositions.map((c) => [c.compositionId, c])).values(),
    );
    await tx.productComposition.deleteMany({ where: { productId: id } });
    if (dedupedCompositions.length > 0) {
      await tx.productComposition.createMany({
        data: dedupedCompositions.map((c) => ({
          productId:     id,
          compositionId: c.compositionId,
          percentage:    c.percentage,
        })),
        skipDuplicates: true,
      });
    }

    // ── Variants (flat ProductColor rows) ──────────────────────────────────
    // Strategy: match by dbId if present. Create new rows when no dbId.
    // Delete rows whose id is not in any submitted dbId.

    const existingVariants = await tx.productColor.findMany({
      where: { productId: id },
      select: { id: true, colorId: true, stock: true, unitPrice: true, saleType: true, packQuantity: true,
        pfsColorRefOverride: true, efashionColorIdOverride: true,
        ankorsColorNameOverride: true, faireColorNameOverride: true, disabled: true,
        variantSizes: { select: { quantity: true } },
        packLines: { select: { colorId: true } } },
    });
    const existingIds = existingVariants.map((v) => v.id);
    const oldStockMap = new Map(existingVariants.map((v) => [v.id, v.stock]));
    const oldVariantMap = new Map(existingVariants.map((v) => [v.id, {
      stock: v.stock,
      unitPrice: Number(v.unitPrice ?? 0),
      saleType: v.saleType as "UNIT" | "PACK",
      packQuantity: v.packQuantity,
      totalPackQty: v.variantSizes?.reduce((s: number, vs: { quantity: number }) => s + vs.quantity, 0) || (v.packQuantity ?? 12),
      pfsColorRefOverride: v.pfsColorRefOverride ?? null,
      efashionColorIdOverride: v.efashionColorIdOverride ?? null,
      ankorsColorNameOverride: v.ankorsColorNameOverride ?? null,
      faireColorNameOverride: v.faireColorNameOverride ?? null,
      disabled: v.disabled ?? false,
    }]));
    // Verrouillage post-création : on garde colorId / saleType / packQuantity
    // de la base et on ignore ce que le client envoie pour les variantes existantes.
    // Cf. UI : ColorVariantManager (LOCKED_VARIANT_TOOLTIP).
    const existingByDbId = new Map(existingVariants.map((v) => [v.id, v]));

    // Brouillon non publié : pour un produit Hors ligne jamais lié à aucune
    // marketplace, on autorise la correction de la couleur d'une variante UNIT
    // existante (la composition tailles et le saleType restent figés). Idem côté
    // UI dans ColorVariantManager (prop `allowColorEdit`).
    const productUnlinkedDraft =
      !!oldProduct &&
      oldProduct.status === "OFFLINE" &&
      !oldProduct.pfsProductId &&
      !oldProduct.ankorsProductId &&
      !oldProduct.efashionReferenceBase &&
      !oldProduct.faireProductId;

    // IDs that must be kept (those with dbId provided)
    const submittedDbIds = input.colors
      .filter((c) => c.dbId)
      .map((c) => c.dbId as string);

    // Rows to delete = existing rows NOT in submittedDbIds
    const toDeleteIds = existingIds.filter((eid) => !submittedDbIds.includes(eid));

    // ── Fusion « variante supprimée puis ré-ajoutée avant Save » ─────────
    // Cas concret : l'admin supprime Rouge dans le formulaire, l'ajoute à
    // nouveau plus tard, puis enregistre. Côté serveur, on recevrait normalement
    // une suppression (ancienne Rouge → delete) + une création (nouvelle
    // Rouge → create) → perte des images / liaisons marketplaces (eFashion,
    // PFS, Ankorstore) attachées à l'ancienne. On préserve la variante
    // existante en y injectant un dbId rétro-actif, ce qui transforme le
    // delete+create en un update simple. Les overrides modifiables (prix,
    // poids, stock, primary, disabled) suivent la nouvelle saisie ; les
    // champs verrouillés (colorId, saleType, packQuantity, sizes) restent
    // ceux de la base, comme pour toute variante existante.
    //
    // Limité aux variantes UNIT mono-couleur : les packs multi-couleurs ont
    // une composition (packLines) qui dépend de Color, fusionner deviendrait
    // ambigu si la nouvelle saisie diffère.
    for (const c of input.colors) {
      if (c.dbId) continue;
      if (isMultiColorPackInput(c)) continue;
      if (!c.colorId) continue;
      const match = existingByDbId.get(
        existingIds.find((eid) => {
          const ex = existingByDbId.get(eid);
          return (
            ex !== undefined &&
            ex.colorId === c.colorId &&
            ex.saleType === c.saleType &&
            toDeleteIds.includes(eid)
          );
        }) ?? "",
      );
      if (match) {
        c.dbId = match.id;
        const idx = toDeleteIds.indexOf(match.id);
        if (idx >= 0) toDeleteIds.splice(idx, 1);
      }
    }

    if (toDeleteIds.length > 0) {
      // Delete CartItems that reference these variants first
      await tx.cartItem.deleteMany({
        where: { variantId: { in: toDeleteIds } },
      });
      // Delete the variants
      await tx.productColor.deleteMany({
        where: { id: { in: toDeleteIds } },
      });
    }

    // Update existing variants and create new ones
    // Pour les variantes existantes (dbId fourni) : on n'autorise QUE les modifs
    // de prix / poids / stock / isPrimary / disabled. La couleur, le saleType,
    // packQuantity, sizeEntries et packLines sont figés (cf. ColorVariantManager LOCK).
    const variantIdMap: { colorInput: ColorInput; variantId: string; isNew: boolean }[] = [];
    for (const colorInput of input.colors) {
      if (colorInput.dbId) {
        // Update existing — ignore les champs verrouillés en lisant la base
        const existing = existingByDbId.get(colorInput.dbId);
        if (!existing) {
          // Cas anormal : un dbId envoyé qui n'existe pas en base. On ignore par sécurité.
          continue;
        }
        // Exception : sur brouillon non lié, la couleur d'une variante UNIT
        // peut être corrigée — pas de composition tailles couplée à la couleur,
        // donc pas de risque de cassure. saleType et packQuantity restent figés.
        const allowColorChange =
          productUnlinkedDraft &&
          existing.saleType === "UNIT" &&
          !!colorInput.colorId &&
          colorInput.colorId !== existing.colorId;
        await tx.productColor.update({
          where: { id: colorInput.dbId },
          data: {
            // colorId : verrouillé sauf brouillon non publié + UNIT.
            colorId:                 allowColorChange ? colorInput.colorId : existing.colorId,
            // saleType / packQuantity : toujours verrouillés.
            saleType:                existing.saleType,
            packQuantity:            existing.packQuantity,
            // Champs librement modifiables :
            unitPrice:               colorInput.unitPrice,
            weight:                  colorInput.weight,
            stock:                   colorInput.stock,
            isPrimary:               colorInput.isPrimary,
            disabled:                colorInput.disabled ?? false,
            pfsColorRefOverride:     normalizeOverride(colorInput.pfsColorRefOverride),
            efashionColorIdOverride: normalizeEfashionOverride(colorInput.efashionColorIdOverride),
            ankorsColorNameOverride: normalizeOverride(colorInput.ankorsColorNameOverride),
            faireColorNameOverride:  normalizeOverride(colorInput.faireColorNameOverride),
          },
        });
        variantIdMap.push({ colorInput, variantId: colorInput.dbId, isNew: false });
      } else {
        // Create new variant — couleur / saleType / sizes / packLines libres
        const isMultiPack = isMultiColorPackInput(colorInput);
        const primaryColorId = isMultiPack
          ? (colorInput.packLines?.[0]?.colorId || colorInput.colorId || null)
          : (colorInput.colorId || null);
        const created = await tx.productColor.create({
          data: {
            productId:               id,
            colorId:                 primaryColorId,
            unitPrice:               colorInput.unitPrice,
            weight:                  colorInput.weight,
            stock:                   colorInput.stock,
            isPrimary:               colorInput.isPrimary,
            saleType:                colorInput.saleType,
            packQuantity:            colorInput.packQuantity,
            disabled:                colorInput.disabled ?? false,
            pfsColorRefOverride:     normalizeOverride(colorInput.pfsColorRefOverride),
            efashionColorIdOverride: normalizeEfashionOverride(colorInput.efashionColorIdOverride),
            ankorsColorNameOverride: normalizeOverride(colorInput.ankorsColorNameOverride),
            faireColorNameOverride:  normalizeOverride(colorInput.faireColorNameOverride),
          },
        });
        variantIdMap.push({ colorInput, variantId: created.id, isNew: true });
      }
    }

    // ── Variant sizes / packLines : on ne reconstruit QUE pour les variantes
    // nouvellement créées. Les variantes existantes gardent leurs sizes/packLines
    // intactes (verrouillage post-création).
    const newVariantIds = variantIdMap.filter((v) => v.isNew).map((v) => v.variantId);

    if (newVariantIds.length > 0) {
      await tx.variantSize.deleteMany({
        where: { productColorId: { in: newVariantIds } },
      });
    }
    const variantSizeData: { productColorId: string; sizeId: string; quantity: number; pricePerUnit?: number }[] = [];
    for (const { colorInput, variantId, isNew } of variantIdMap) {
      if (!isNew) continue; // sizes verrouillées sur variante existante
      if (isMultiColorPackInput(colorInput)) continue; // pack multi-couleurs : sizes vivent dans packLines
      if (colorInput.sizeEntries && colorInput.sizeEntries.length > 0) {
        for (const se of colorInput.sizeEntries) {
          variantSizeData.push({
            productColorId: variantId,
            sizeId: se.sizeId,
            quantity: se.quantity,
            ...(se.pricePerUnit != null ? { pricePerUnit: se.pricePerUnit } : {}),
          });
        }
      }
    }
    if (variantSizeData.length > 0) {
      await tx.variantSize.createMany({ data: variantSizeData });
    }

    // ── Pack multi-couleurs : reconstruction uniquement pour les nouvelles variantes
    if (newVariantIds.length > 0) {
      await tx.packColorLine.deleteMany({
        where: { productColorId: { in: newVariantIds } },
      });
    }
    for (const { colorInput, variantId, isNew } of variantIdMap) {
      if (!isNew) continue; // packLines verrouillées sur variante existante
      if (!isMultiColorPackInput(colorInput) || !colorInput.packLines) continue;
      for (let li = 0; li < colorInput.packLines.length; li++) {
        const line = colorInput.packLines[li];
        await tx.packColorLine.create({
          data: {
            productColorId:          variantId,
            colorId:                 line.colorId,
            position:                li,
            pfsColorRefOverride:     normalizeOverride(line.pfsColorRefOverride),
            efashionColorIdOverride: normalizeEfashionOverride(line.efashionColorIdOverride),
            ankorsColorNameOverride: normalizeOverride(line.ankorsColorNameOverride),
            faireColorNameOverride:  normalizeOverride(line.faireColorNameOverride),
            sizes: {
              create: line.sizeEntries.map((se) => ({ sizeId: se.sizeId, quantity: se.quantity })),
            },
          },
        });
      }
    }

    // ── Override PFS secondaire des packLines pour les variantes EXISTANTES ──
    // La composition (colorId + sizes) reste verrouillée mais l'override est un
    // champ scalaire indépendant qu'on doit pouvoir éditer.
    for (const { colorInput, variantId, isNew } of variantIdMap) {
      if (isNew) continue;
      if (!isMultiColorPackInput(colorInput) || !colorInput.packLines) continue;
      const existingLines = await tx.packColorLine.findMany({
        where: { productColorId: variantId },
        select: { id: true, colorId: true },
      });
      const lineByColorId = new Map(existingLines.map((l) => [l.colorId, l.id]));
      for (const line of colorInput.packLines) {
        const lineId = lineByColorId.get(line.colorId);
        if (!lineId) continue;
        await tx.packColorLine.update({
          where: { id: lineId },
          data: {
            pfsColorRefOverride:     normalizeOverride(line.pfsColorRefOverride),
            efashionColorIdOverride: normalizeEfashionOverride(line.efashionColorIdOverride),
            ankorsColorNameOverride: normalizeOverride(line.ankorsColorNameOverride),
            faireColorNameOverride:  normalizeOverride(line.faireColorNameOverride),
          },
        });
      }
    }

    // ── Assign/update SKUs for all variants ──────────
    await assignVariantSkus(id, input.reference, tx);

    // ── Images : full replace + cleanup disque ─────────────────────────
    // Quand l'admin envoie `imagePaths` (défini, même vide), c'est l'état
    // complet souhaité après save : on compare avec ce qui est en BDD pour
    // capturer les orphelins disque (ancienne photo retirée d'un slot,
    // couleur entière supprimée, etc.) avant de reconstruire les entrées.
    // Suppression effective du disque après commit.
    let orphanImagePaths: string[] = [];
    let imageMappingChanged = false;
    if (input.imagePaths !== undefined) {
      const previousImageRecords = await tx.productColorImage.findMany({
        where: { productId: id },
        select: { path: true, colorId: true, order: true },
      });
      const previousPaths = new Set(previousImageRecords.map((r) => r.path));
      const keptPaths = new Set<string>();
      for (const group of input.imagePaths) {
        for (const p of group.paths) keptPaths.add(p);
      }
      orphanImagePaths = [...previousPaths].filter((p) => !keptPaths.has(p));

      // Reconstruire les entrées BDD (1 par (productId, colorId, order)).
      await tx.productColorImage.deleteMany({ where: { productId: id } });

      const imageData: { productId: string; colorId: string; productColorId: null; path: string; order: number }[] = [];
      const seen = new Set<string>(); // dédup par (colorId, order, path)
      for (const group of input.imagePaths) {
        if (group.paths.length === 0) continue;
        const colorId = group.colorId;
        if (!colorId) continue;
        group.paths.forEach((path, idx) => {
          const order = group.orders?.[idx] ?? idx;
          const key = `${colorId}::${order}::${path}`;
          if (seen.has(key)) return;
          seen.add(key);
          imageData.push({ productId: id, colorId, productColorId: null, path, order });
        });
      }
      if (imageData.length > 0) {
        await tx.productColorImage.createMany({ data: imageData });
      }

      // Détection d'un changement du mapping (colorId, order, path) — couvre :
      // ajout / retrait / réordonnancement dans une couleur, ET déplacement
      // d'une photo d'une couleur à une autre (même fichier, colorId différent).
      // Ce flag est utilisé plus bas pour lever `*SyncRequired = true` sur les
      // marketplaces liées : sans ça, un simple move inter-couleurs ne
      // déclencherait pas de badge « Synchro nécessaire » et le push n'irait
      // jamais chercher les nouvelles photos.
      const previousSig = [...previousImageRecords]
        .map((r) => `${r.colorId}::${r.order}::${r.path}`)
        .sort()
        .join("|");
      const newSig = imageData
        .map((r) => `${r.colorId}::${r.order}::${r.path}`)
        .sort()
        .join("|");
      imageMappingChanged = previousSig !== newSig;
    }

    // ── Couleur principale (Product.primaryColorId) ──
    // L'union se calcule depuis les variantes effectivement présentes en BDD
    // après le bloc variantes (toDelete + create + update).
    const variantsAfter = await tx.productColor.findMany({
      where: { productId: id },
      select: {
        colorId: true,
        packLines: { select: { colorId: true } },
      },
    });
    const availableColorIdsAfter = listAvailableColorIds({
      colors: variantsAfter.map((v) => ({
        colorId: v.colorId,
        packLines: v.packLines.map((pl) => ({ colorId: pl.colorId })),
      })),
    });
    const resolvedPrimaryAfter = resolvePrimaryColorId(input.primaryColorId, availableColorIdsAfter);
    await tx.product.update({
      where: { id },
      data: { primaryColorId: resolvedPrimaryAfter },
    });

    // Produits similaires — bidirectionnel, reconstruction complète
    await tx.productSimilar.deleteMany({
      where: { OR: [{ productId: id }, { similarId: id }] },
    });
    if (input.similarProductIds.length > 0) {
      await tx.productSimilar.createMany({
        data: [
          ...input.similarProductIds.map((sid) => ({ productId: id, similarId: sid })),
          ...input.similarProductIds.map((sid) => ({ productId: sid, similarId: id })),
        ],
        skipDuplicates: true,
      });
    }

    // Composition produit — reconstruction complète (directionnel, parent = cet ensemble)
    await tx.productBundle.deleteMany({ where: { parentId: id } });
    if (input.bundleChildIds.length > 0) {
      await tx.productBundle.createMany({
        data: input.bundleChildIds.map((childId) => ({ parentId: id, childId })),
        skipDuplicates: true,
      });
    }

    return { oldStockMap, oldVariantMap, variantIdMap, orphanImagePaths, resolvedPrimaryAfter, imageMappingChanged };
    }, { timeout: 30000 });
  } catch (err) {
    // Si la transaction échoue après un rename de dossier, on remet le dossier
    // à son ancien nom pour rester cohérent avec la BDD inchangée.
    if (folderRenamed) {
      try {
        await renameProductFolder(newRefUpper, oldRef, tenant.slug);
      } catch (rollbackErr) {
        logger.error("[Storage] Failed to rollback product folder rename", {
          productId: id,
          oldRef,
          newRef: newRefUpper,
          error: rollbackErr,
        });
      }
    }
    throw err;
  }
  if (!txResult) {
    // Should be unreachable: the transaction either returns a value or throws.
    throw new Error("Erreur interne : transaction sans résultat.");
  }
  const { oldStockMap, oldVariantMap, variantIdMap, orphanImagePaths, resolvedPrimaryAfter, imageMappingChanged } = txResult;

  // ── Suppression effective des fichiers image orphelins (post-transaction) ──
  // Toute image présente en BDD avant le save mais absente de l'état envoyé
  // par l'admin → on supprime les 3 tailles (large/md/thumb) du disque.
  // Best-effort : on logge en cas d'échec mais on ne fait pas échouer le save.
  if (orphanImagePaths.length > 0) {
    const keys = orphanImagePaths.flatMap((path) => {
      const paths = getImagePaths(path);
      return [paths.large, paths.medium, paths.thumb].map(keyFromDbPath);
    });
    try {
      await deleteFiles(keys);
      logger.info(`[Storage] Deleted ${keys.length} orphan image files for product ${id}`);
    } catch (err) {
      logger.error(`[Storage] Failed to delete orphan image files for product ${id}`, {
        error: err,
      });
    }
  }

  // Traductions : remplacer toutes les traductions existantes. Les entrées
  // proviennent de la ProductForm (onglet EN saisi manuellement) → on pose
  // `manualEdit: true` pour les protéger d'un futur écrasement par l'auto-
  // traduction PFS. Les autres locales (sans saisie) restent auto-traduites
  // en fond après `autoTranslateProduct(...)`.
  if (input.translations !== undefined) {
    await prisma.productTranslation.deleteMany({ where: { productId: id } });
    const validTranslations = input.translations.filter((t) => t.name.trim() || t.description.trim());
    if (validTranslations.length > 0) {
      await prisma.productTranslation.createMany({
        data: validTranslations.map((t) => ({
          productId:   id,
          locale:      t.locale,
          name:        t.name,
          description: t.description,
          manualEdit:  true,
        })),
        skipDuplicates: true,
      });
    }
  } else {
    // Aucune traduction fournie : invalider le cache et auto-traduire
    await invalidateProductTranslations(id);
    autoTranslateProduct(id, input.name, input.description);
  }

  // Auto-downgrade to OFFLINE seulement si AUCUNE couleur n'a la moindre
  // image (ou aucune variante). Les couleurs partiellement sans image ne
  // bloquent plus le passage en ligne : elles sont masquées côté public et
  // ignorées côté push marketplaces tant qu'aucune image n'est ajoutée.
  let effectiveStatus = input.status;
  if (input.status === "ONLINE") {
    const allVariants = await prisma.productColor.findMany({
      where: { productId: id },
      select: {
        id: true,
        colorId: true,
        color: { select: { name: true } },
      },
    });
    const imageCountByColor = await countImagesByColorForProduct(id);
    const coverageInput = allVariants.map((v) => ({
      id: v.id,
      colorId: v.colorId,
      colorName: v.color?.name ?? null,
      imageCount: v.colorId ? (imageCountByColor.get(v.colorId) ?? 0) : 0,
    }));
    const noVariants = allVariants.length === 0;
    if (noVariants || !anyVariantHasImage(coverageInput)) {
      effectiveStatus = "OFFLINE";
      await prisma.product.update({ where: { id }, data: { status: "OFFLINE" } });
    }
  }

  // Depuis 2026-08-07 : plus d'auto-archive local sur rupture totale. L'admin
  // garde le contrôle du statut ; un produit peut être ONLINE avec 0 en stock.

  revalidatePath("/admin/produits");
  // ── Drapeaux « Synchronisation nécessaire » ────────────────────────
  // Si le produit est lié à un marketplace et qu'au moins un champ clé a
  // changé, on lève le drapeau correspondant. Le badge orange dans l'admin
  // s'allume immédiatement, et l'utilisatrice peut soit pousser la modif
  // (1 clic sur le badge), soit l'ignorer (X au survol). La modale
  // marketplace au save (qui enqueue refresh PFS / Ankorstore / eFashion)
  // déclenche les actions de refresh, et celles-ci remettent le drapeau
  // à false à la fin — donc cocher la case empêche le badge de rester
  // orange visible (loading prend le pas, puis vert).
  if (oldProduct) {
    // Signature triée des compositions pour comparer indépendamment de l'ordre.
    const compositionSig = (
      list: { compositionId: string; percentage: number }[],
    ): string =>
      list
        .map((c) => `${c.compositionId}:${c.percentage}`)
        .sort()
        .join("|");
    const compositionsChanged =
      compositionSig(oldProduct.compositions) !==
      compositionSig(input.compositions);

    // Changement niveau variante : prix / stock / poids / saleType /
    // packQuantity / override couleur PFS. On compare pour chaque variante
    // qui existait déjà (dbId présent dans input ET dans oldVariantMap).
    // Ajouter / retirer une variante compte aussi.
    let variantsChanged = false;
    const oldVariantIds = new Set(oldVariantMap.keys());
    const inputExistingIds = new Set<string>();
    for (const c of input.colors) {
      if (c.dbId && oldVariantMap.has(c.dbId)) {
        inputExistingIds.add(c.dbId);
        const prev = oldVariantMap.get(c.dbId)!;
        const newPfsOverride = normalizeOverride(c.pfsColorRefOverride);
        const newEfashionOverride = normalizeEfashionOverride(c.efashionColorIdOverride);
        const newAnkorsOverride = normalizeOverride(c.ankorsColorNameOverride);
        const newFaireOverride = normalizeOverride(c.faireColorNameOverride);
        if (
          Number(prev.unitPrice) !== Number(c.unitPrice) ||
          prev.stock !== c.stock ||
          prev.pfsColorRefOverride !== newPfsOverride ||
          prev.efashionColorIdOverride !== newEfashionOverride ||
          prev.ankorsColorNameOverride !== newAnkorsOverride ||
          prev.faireColorNameOverride !== newFaireOverride ||
          prev.disabled !== (c.disabled ?? false)
        ) {
          variantsChanged = true;
          break;
        }
      } else {
        // Variante nouvelle (pas de dbId ou id inconnu) → changement
        variantsChanged = true;
        break;
      }
    }
    if (!variantsChanged) {
      // Une variante existante n'est plus dans l'input → suppression
      for (const oid of oldVariantIds) {
        if (!inputExistingIds.has(oid)) {
          variantsChanged = true;
          break;
        }
      }
    }

    const fieldsChanged =
      oldProduct.name !== input.name.trim() ||
      oldProduct.description !== (input.description?.trim() ?? "") ||
      oldProduct.status !== effectiveStatus ||
      oldProduct.isBestSeller !== input.isBestSeller ||
      oldProduct.categoryId !== input.categoryId ||
      oldProduct.countryIsoCode !== (input.countryIsoCode || null) ||
      oldProduct.seasonId !== (input.seasonId || null) ||
      // Le code SH (numéro douanier) est envoyé à Orderchamp (champ `hsCode`)
      // et à Faire (colonne `code_douanier`). Changer ce champ doit poser
      // le flag orange « Synchro nécessaire » pour propager la nouvelle valeur.
      oldProduct.hsCodeId !== (input.hsCodeId || null) ||
      oldProduct.reference !== newRefUpper ||
      // Changement de couleur principale : impacte les marketplaces qui exposent
      // la photo principale du produit (Faire racine, PFS, Ankorstore, eFashion).
      // Sans ça, le badge orange « Synchro nécessaire » resterait éteint alors
      // que la photo principale envoyée à la marketplace doit changer.
      oldProduct.primaryColorId !== resolvedPrimaryAfter ||
      compositionsChanged ||
      variantsChanged ||
      // Un déplacement de photo entre couleurs (ou réordonnancement, ajout/retrait)
      // change le mapping (colorId, order, path). On considère ça comme un
      // changement clé pour que le badge orange s'allume et que le push
      // marketplaces envoie les nouvelles photos.
      imageMappingChanged;
    if (fieldsChanged) {
      const flagsData: Prisma.ProductUpdateInput = {};
      if (oldProduct.pfsProductId) flagsData.pfsSyncRequired = true;
      if (oldProduct.ankorsProductId) flagsData.ankorsSyncRequired = true;
      if (oldProduct.efashionReferenceBase) flagsData.efashionSyncRequired = true;
      if (oldProduct.faireProductId) flagsData.faireSyncRequired = true;
      if (oldProduct.orderchampProductId) flagsData.orderchampSyncRequired = true;
      if (oldProduct.microstoreProductId != null) {
        flagsData.microstoreSyncRequired = true;
        // On ne pose `microstorePhotosDirty` que si la modif touche vraiment
        // aux images (mapping (colorId, order, path) ou changement de couleur
        // principale). Sinon les push Microstore fiche seule resteront rapides.
        if (
          imageMappingChanged ||
          oldProduct.primaryColorId !== resolvedPrimaryAfter
        ) {
          (flagsData as unknown as { microstorePhotosDirty?: boolean }).microstorePhotosDirty = true;
        }
      }
      if (Object.keys(flagsData).length > 0) {
        await prisma.product.update({ where: { id }, data: flagsData });
      }
    }
  }

  revalidatePath(`/admin/produits/${id}/modifier`);
  await revalidateProductPublicPage(id);
  revalidateTag("products", "default");
  revalidateTag("tags", "default");

  // Emit real-time events
  if (oldProduct) {
    if (oldProduct.status !== "ONLINE" && effectiveStatus === "ONLINE") {
      emitProductEvent({ type: "PRODUCT_ONLINE", productId: id });
    } else if (oldProduct.status === "ONLINE" && effectiveStatus !== "ONLINE") {
      emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
    } else if (oldProduct.isBestSeller !== input.isBestSeller) {
      emitProductEvent({ type: "BESTSELLER_CHANGED", productId: id });
    } else if (effectiveStatus === "ONLINE") {
      emitProductEvent({ type: "PRODUCT_UPDATED", productId: id });
    }
  }

  // Marketplace republication is no longer automatic on edit.
  void oldVariantMap;

  // Rotation auto couleur principale : si la sauvegarde a laissé la principale
  // sur une couleur entièrement en rupture (toutes ses variantes stock=0 ou
  // disabled) alors qu'une autre couleur a du stock, on bascule la principale
  // vers cette autre. Mode immédiat car c'est une seule action explicite
  // (pas de rafale à fusionner comme sur updateVariantQuick).
  await rotatePrimaryIfNeeded(id, { immediate: true });

  // Recalcule l'appartenance de ce produit aux collections avec règles auto.
  // Un changement de saison / catégorie / tag / composition peut le faire entrer
  // dans certaines collections et sortir d'autres. Idem si le statut passe à
  // ONLINE (il devient candidat) ou en sort (les lignes AUTO sont retirées).
  await recalculateAllRulesForProduct(id);

  // Return variant DB IDs in the same order as input.colors
  // so the client can update its local state without a page reload.
  return {
    variantDbIds: variantIdMap.map((v) => v.variantId),
  };
}

// ─────────────────────────────────────────────
// Toggle Best Seller (lightweight, no full save)
// ─────────────────────────────────────────────

export async function toggleBestSeller(productId: string, isBestSeller: boolean): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      isBestSeller: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
    },
  });
  if (!product) return { success: false, error: "Produit introuvable." };
  if (product.isBestSeller === isBestSeller) return { success: true };

  // Poser les drapeaux « Synchro nécessaire » sur les marketplaces liées :
  // sans ça, l'étoile bascule uniquement en local et n'est jamais renvoyée
  // à PFS (seul PFS expose une notion d'étoile via STAR/REMOVE_STAR pour
  // l'instant, mais on prépare le terrain pour les autres si l'API évolue).
  const flagsData: Prisma.ProductUpdateInput = { isBestSeller };
  if (product.pfsProductId) flagsData.pfsSyncRequired = true;

  await prisma.product.update({
    where: { id: productId },
    data: flagsData,
  });

  revalidateTag("products", "default");
  emitProductEvent({ type: "BESTSELLER_CHANGED", productId });

  return { success: true };
}

// ─────────────────────────────────────────────
// Verrouillage manuel — bloque le bouton « Rafraîchir » (boutique +
// marketplaces). Indépendant du statut : un produit ONLINE complet peut
// être verrouillé pour protéger sa fiche d'un refresh accidentel.
// ─────────────────────────────────────────────

export async function toggleProductLock(
  productId: string,
  locked: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { locked: true },
  });
  if (!product) return { success: false, error: "Produit introuvable." };
  if (product.locked === locked) return { success: true };

  await prisma.product.update({
    where: { id: productId },
    data: { locked },
  });

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");

  return { success: true };
}

// ─────────────────────────────────────────────
// Marqueur « Important » côté admin — équivalent d'un favori partagé.
// Toggle rapide via l'étoile de la ligne (liste) et l'icône de la fiche
// produit. N'a aucun effet sur les marketplaces ni sur la boutique
// publique : sert uniquement au filtrage / tri interne admin.
// ─────────────────────────────────────────────

export async function toggleProductImportant(
  productId: string,
  important: boolean,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { important: true },
  });
  if (!product) return { success: false, error: "Produit introuvable." };
  if (product.important === important) return { success: true };

  await prisma.product.update({
    where: { id: productId },
    data: { important },
  });

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${productId}/modifier`);
  revalidateTag("products", "default");

  return { success: true };
}

// ─────────────────────────────────────────────
// Supprimer un produit — suppression définitive si jamais vendu,
// sinon archivage (obligation légale 10 ans + historique commandes)
// ─────────────────────────────────────────────

export async function deleteProduct(id: string): Promise<{ action: "deleted" | "archived"; orderCount: number }> {
  await requireAdmin();
  const tenant = await requireCurrentTenant();

  const product = await prisma.product.findUnique({
    where: { id },
    select: { reference: true },
  });
  if (!product) throw new Error("Produit introuvable.");

  const orderCount = await prisma.orderItem.count({ where: { productRef: product.reference } });

  // Product has been ordered → archive only (retention obligation + history integrity)
  if (orderCount > 0) {
    await prisma.product.update({
      where: { id },
      data: { status: "ARCHIVED" },
    });
    revalidatePath("/admin/produits");
    revalidatePath("/produits");
    revalidateTag("products", "default");
    emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
    return { action: "archived", orderCount };
  }

  // Never ordered → full permanent deletion
  const variantIds = await prisma.productColor.findMany({
    where: { productId: id },
    select: { id: true },
  });
  if (variantIds.length > 0) {
    await prisma.cartItem.deleteMany({
      where: { variantId: { in: variantIds.map((v) => v.id) } },
    });
  }

  const productImages = await prisma.productColorImage.findMany({
    where: { productId: id },
    select: { path: true },
  });
  if (productImages.length > 0) {
    const keys = productImages.flatMap(({ path }) => {
      const paths = getImagePaths(path);
      return [paths.large, paths.medium, paths.thumb].map(keyFromDbPath);
    });
    try {
      await deleteFiles(keys);
      logger.info(`[Storage] Deleted ${keys.length} images for product ${id}`);
    } catch (err) {
      logger.error(`[Storage] Failed to delete images for product ${id}`, {
        error: err,
      });
    }
  }

  // Supprime aussi le dossier dédié (rapide, propre — supprime également
  // d'éventuels fichiers orphelins qui ne seraient plus référencés en BDD).
  try {
    await deleteDirectory(productImageDir(product.reference, tenant.slug));
  } catch (err) {
    logger.error(`[Storage] Failed to delete product folder for ${id}`, {
      error: err,
    });
  }

  await prisma.product.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("products", "default");
  return { action: "deleted", orderCount: 0 };
}

// ─────────────────────────────────────────────
// Archiver / Désarchiver un produit
// ─────────────────────────────────────────────

export async function archiveProduct(id: string) {
  await requireAdmin();
  await prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });
  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
  // La propagation aux marketplaces est laissee a l'UI : une modale apparait
  // apres l'action avec des cases a cocher (PFS + Ankorstore) que l'admin
  // peut decocher pour ne pas pousser cette fois.
}

export async function unarchiveProduct(id: string) {
  await requireAdmin();
  await prisma.product.update({ where: { id }, data: { status: "OFFLINE" } });
  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
}

// ─────────────────────────────────────────────
// Actions en masse
// ─────────────────────────────────────────────

/**
 * Évalue, pour une liste d'ids de produits brouillons (OFFLINE), lesquels
 * peuvent être mis en ligne + publiés sur les marketplaces, et pour ceux qui
 * ne peuvent pas, retourne la liste détaillée des raisons. Sert à la modale
 * « Publier brouillons » de la liste admin.
 */
export interface BulkPublishDraftPreviewItem {
  id: string;
  reference: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  eligible: boolean;
  reasons: string[];
  pfsAlreadyPublished: boolean;
  ankorsAlreadyPublished: boolean;
  /** true si au moins une couleur est déjà liée à eFashion (efashionProductId != null) */
  efashionAlreadyPublished: boolean;
  /** Toggle Microstore par produit — sert à afficher le compteur Microstore
   *  dans la modale (Microstore n'a pas d'ID marketplace, l'upsert est
   *  idempotent). */
  microstoreEnabled: boolean;
}

export async function previewBulkPublishDrafts(
  productIds: string[],
): Promise<BulkPublishDraftPreviewItem[]> {
  await requireAdmin();
  if (productIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      categoryId: true,
      status: true,
      pfsProductId: true,
      ankorsProductId: true,
      microstoreEnabled: true,
      compositions: { select: { percentage: true } },
      colors: {
        select: {
          id: true,
          colorId: true,
          color: { select: { name: true } },
          unitPrice: true,
          stock: true,
          weight: true,
          saleType: true,
          packQuantity: true,
          efashionProductId: true,
          variantSizes: {
            select: {
              sizeId: true,
              size: { select: { name: true } },
              quantity: true,
            },
          },
          packLines: {
            select: { id: true, sizes: { select: { id: true } } },
          },
        },
      },
    },
  });

  // Comptage images par (productId, colorId) en une seule requête.
  const imageRows = await prisma.productColorImage.groupBy({
    by: ["productId", "colorId"],
    where: { productId: { in: productIds } },
    _count: { _all: true },
  });
  const imagesByProductColor = new Map<string, number>();
  for (const r of imageRows) {
    imagesByProductColor.set(`${r.productId}::${r.colorId}`, r._count._all);
  }

  const { evaluateProductPublishability } = await import("@/lib/product-publishability");

  return products.map((p): BulkPublishDraftPreviewItem => {
    const imageCountByColorId: Record<string, number> = {};
    for (const v of p.colors) {
      if (v.colorId) {
        const key = `${p.id}::${v.colorId}`;
        imageCountByColorId[v.colorId] = imagesByProductColor.get(key) ?? 0;
      }
    }
    const compositionPercentTotal = p.compositions.reduce(
      (sum, c) => sum + Number(c.percentage ?? 0),
      0,
    );
    const result = evaluateProductPublishability({
      id: p.id,
      reference: p.reference,
      name: p.name,
      description: p.description ?? "",
      categoryId: p.categoryId ?? null,
      compositionCount: p.compositions.length,
      compositionPercentTotal,
      imageCountByColorId,
      variants: p.colors.map((v) => ({
        id: v.id,
        colorId: v.colorId,
        colorName: v.color?.name ?? null,
        unitPrice: Number(v.unitPrice),
        stock: v.stock,
        weight: Number(v.weight),
        saleType: v.saleType,
        packQuantity: v.packQuantity,
        sizes: v.variantSizes.map((s) => ({
          sizeId: s.sizeId,
          sizeName: s.size?.name ?? null,
          quantity: s.quantity,
        })),
        packLinesCount: v.packLines.length,
        packLinesSizesTotal: v.packLines.reduce((sum, l) => sum + l.sizes.length, 0),
      })),
    });

    return {
      id: p.id,
      reference: p.reference,
      name: p.name,
      status: p.status,
      eligible: result.eligible,
      reasons: result.reasons,
      pfsAlreadyPublished: !!p.pfsProductId,
      ankorsAlreadyPublished: !!p.ankorsProductId,
      efashionAlreadyPublished: p.colors.some((c) => c.efashionProductId != null),
      microstoreEnabled: !!p.microstoreEnabled,
    };
  });
}

export async function bulkUpdateProductStatus(
  productIds: string[],
  status: "ONLINE" | "OFFLINE" | "ARCHIVED",
  otpCheck?: {
    otpId: string;
    code: string;
    pauseChoice?: "15min" | "1h" | "24h" | null;
  } | null,
): Promise<{ success: string[]; errors: { id: string; reference: string; reason: string }[] }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

  // ─── Vérification OTP uniquement pour l'archivage (destructif côté marketplaces) ───
  if (status === "ARCHIVED") {
    const tenantForGuard = await requireCurrentTenant();
    await guardAdminActionOtp({
      action: "archive",
      productIds,
      adminId: session.user.id,
      tenantId: tenantForGuard.id,
      otp: otpCheck ? { otpId: otpCheck.otpId, code: otpCheck.code } : null,
    });
    if (otpCheck?.pauseChoice !== undefined && otpCheck.pauseChoice !== null) {
      await applyPauseChoice(tenantForGuard.id, otpCheck.pauseChoice);
    }
  }

  const success: string[] = [];
  const errors: { id: string; reference: string; reason: string }[] = [];
  // Ids dont le drapeau `isIncomplete` est périmé : ils passent l'évaluation
  // complète, on doit donc le remettre à false en même temps que le statut.
  // (Bug historique : ancienne version du save laissait le drapeau à true sur
  // les imports PFS même après complétion — cf. lib/refresh-eligibility.ts.)
  const staleIncompleteIds: string[] = [];

  if (status === "ONLINE") {
    // Pour ONLINE on charge le payload complet nécessaire à l'évaluateur
    // partagé (mêmes règles que la modale "Publier brouillons" via
    // previewBulkPublishDrafts).
    const productsFull = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        reference: true,
        name: true,
        description: true,
        categoryId: true,
        status: true,
        isIncomplete: true,
        compositions: { select: { percentage: true } },
        colors: {
          select: {
            id: true,
            colorId: true,
            color: { select: { name: true } },
            unitPrice: true,
            stock: true,
            weight: true,
            saleType: true,
            packQuantity: true,
            variantSizes: {
              select: {
                sizeId: true,
                size: { select: { name: true } },
                quantity: true,
              },
            },
            packLines: {
              select: { id: true, sizes: { select: { id: true } } },
            },
          },
        },
      },
    });

    // Comptage images par (productId, colorId) — sert au check "au moins une
    // variante a une image", déjà fait par evaluateProductPublishability.
    const allImages = await prisma.productColorImage.groupBy({
      by: ["productId", "colorId"],
      where: { productId: { in: productIds } },
      _count: { _all: true },
    });
    const imagesByProductColor = new Map<string, number>();
    for (const row of allImages) {
      imagesByProductColor.set(`${row.productId}::${row.colorId}`, row._count._all);
    }

    const { evaluateProductPublishability } = await import("@/lib/product-publishability");

    for (const p of productsFull) {
      const imageCountByColorId: Record<string, number> = {};
      for (const v of p.colors) {
        if (v.colorId) {
          imageCountByColorId[v.colorId] =
            imagesByProductColor.get(`${p.id}::${v.colorId}`) ?? 0;
        }
      }
      const compositionPercentTotal = p.compositions.reduce(
        (sum, c) => sum + Number(c.percentage ?? 0),
        0,
      );
      const result = evaluateProductPublishability({
        id: p.id,
        reference: p.reference,
        name: p.name,
        description: p.description ?? "",
        categoryId: p.categoryId ?? null,
        compositionCount: p.compositions.length,
        compositionPercentTotal,
        imageCountByColorId,
        variants: p.colors.map((v) => ({
          id: v.id,
          colorId: v.colorId,
          colorName: v.color?.name ?? null,
          unitPrice: Number(v.unitPrice),
          stock: v.stock,
          weight: Number(v.weight),
          saleType: v.saleType,
          packQuantity: v.packQuantity,
          sizes: v.variantSizes.map((s) => ({
            sizeId: s.sizeId,
            sizeName: s.size?.name ?? null,
            quantity: s.quantity,
          })),
          packLinesCount: v.packLines.length,
          packLinesSizesTotal: v.packLines.reduce((sum, l) => sum + l.sizes.length, 0),
        })),
      });

      if (!result.eligible) {
        errors.push({
          id: p.id,
          reference: p.reference,
          reason: result.reasons.join(", "),
        });
        continue;
      }

      // La rupture totale (toutes les couleurs à stock=0) ne bloque plus la
      // mise en ligne : c'est à l'admin de décider. La cliente peut mettre en
      // ligne un produit en attendant du restock.
      success.push(p.id);
      if (p.isIncomplete) staleIncompleteIds.push(p.id);
    }
  } else {
    // OFFLINE / ARCHIVED : pas de pré-validation, on accepte tous les ids existants.
    const productsBasic = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    for (const p of productsBasic) {
      success.push(p.id);
    }
  }

  if (success.length > 0) {
    if (status === "ONLINE" && staleIncompleteIds.length > 0) {
      // Reset du drapeau périmé en même temps que la mise en ligne (les autres
      // produits ONLINE n'ont pas besoin du reset, on évite la sur-écriture).
      await prisma.$transaction([
        prisma.product.updateMany({
          where: { id: { in: success } },
          data: { status },
        }),
        prisma.product.updateMany({
          where: { id: { in: staleIncompleteIds } },
          data: { isIncomplete: false },
        }),
      ]);
    } else {
      await prisma.product.updateMany({
        where: { id: { in: success } },
        data: { status },
      });
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");

  // Emit SSE events for each updated product
  for (const pid of success) {
    if (status === "ONLINE") {
      emitProductEvent({ type: "PRODUCT_ONLINE", productId: pid });
    } else {
      emitProductEvent({ type: "PRODUCT_OFFLINE", productId: pid });
    }
  }

  // La propagation aux marketplaces est laissee a l'UI bulk : une modale avec
  // cases a cocher (PFS + Ankorstore) apparait apres et enqueue les push
  // selon le choix de l'admin.

  return { success, errors };
}

// ─────────────────────────────────────────────
// Mise à jour en masse d'attributs produit (catégorie, code SH, composition,
// pays de fabrication, saison, best-seller). Chaque champ est optionnel ;
// `undefined` = on ne touche pas. `compositions` quand fourni remplace
// entièrement la composition existante. La propagation marketplaces est
// laissée à l'UI (modale avec cases à cocher après).
// ─────────────────────────────────────────────

export interface BulkProductAttributesInput {
  categoryId?: string;
  /** Liste de sous-catégories à appliquer (remplace l'existant). [] = vide la liste. */
  subCategoryIds?: string[];
  /**
   * Étiquette Microstore : `null` = catégorie principale (défaut), sinon
   * id d'une sous-catégorie qui DOIT être présente dans `subCategoryIds`
   * ET avoir un `microstoreCategoryId` non-null. Absent (`undefined`) =
   * on ne touche pas, sauf reset automatique si la catégorie ou les
   * sous-cats changent (comportement historique).
   */
  microstoreSubCategoryId?: string | null;
  /** null = retire le code SH du produit. */
  hsCodeId?: string | null;
  /** null = retire le pays de fabrication. Code ISO alpha-2 (ex: "CN"). */
  countryIsoCode?: string | null;
  /** null = retire la saison. */
  seasonId?: string | null;
  isBestSeller?: boolean;
  /**
   * Marqueur « Important » admin (étoile jaune de la ligne). Aucun effet sur
   * les marketplaces ni sur la boutique publique — sert uniquement au
   * filtrage / tri interne admin. Pas de flag `*SyncRequired` posé.
   */
  important?: boolean;
  /** Remplace toute la composition. Liste vide = on supprime la composition. */
  compositions?: { compositionId: string; percentage: number }[];
}

export async function bulkUpdateProductAttributes(
  productIds: string[],
  input: BulkProductAttributesInput,
): Promise<{ updated: number; success: string[]; errors: { id: string; reference: string; reason: string }[] }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");
  if (productIds.length > 1000) throw new Error("Maximum 1000 produits à la fois.");

  // Vérifier qu'au moins un champ est fourni
  const hasAny =
    input.categoryId !== undefined ||
    input.subCategoryIds !== undefined ||
    input.microstoreSubCategoryId !== undefined ||
    input.hsCodeId !== undefined ||
    input.countryIsoCode !== undefined ||
    input.seasonId !== undefined ||
    input.isBestSeller !== undefined ||
    input.important !== undefined ||
    input.compositions !== undefined;
  if (!hasAny) throw new Error("Aucune modification demandée.");

  // Vérif des FK
  if (input.categoryId) {
    const c = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!c) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");
  }
  if (input.subCategoryIds && input.subCategoryIds.length > 0) {
    const subs = await prisma.subCategory.findMany({
      where: { id: { in: input.subCategoryIds } },
      select: { id: true, categoryId: true },
    });
    if (subs.length !== input.subCategoryIds.length) {
      throw new Error("Une sous-catégorie sélectionnée n'existe plus. Rechargez la page.");
    }
    if (input.categoryId) {
      const wrong = subs.find((s) => s.categoryId !== input.categoryId);
      if (wrong) throw new Error("Une sous-catégorie sélectionnée n'appartient pas à la catégorie choisie.");
    }
  }
  // Étiquette Microstore : la sous-cat choisie doit exister, être mappée à un
  // ID Microstore, et faire partie des `subCategoryIds` transmis (sinon on
  // stockerait un id orphelin — refusé par `normalizeMicrostoreSubCategoryId`).
  if (input.microstoreSubCategoryId) {
    if (input.subCategoryIds === undefined) {
      throw new Error("Étiquette Microstore : la liste des sous-catégories doit être fournie.");
    }
    if (!input.subCategoryIds.includes(input.microstoreSubCategoryId)) {
      throw new Error(
        "La sous-catégorie choisie pour Microstore doit être attribuée au produit.",
      );
    }
    const msSub = await prisma.subCategory.findUnique({
      where: { id: input.microstoreSubCategoryId },
      select: { id: true, name: true, microstoreCategoryId: true },
    });
    if (!msSub) {
      throw new Error("La sous-catégorie choisie pour Microstore n'existe plus. Rechargez la page.");
    }
    if (msSub.microstoreCategoryId == null) {
      throw new Error(
        `La sous-catégorie « ${msSub.name} » n'est pas mappée à Microstore — mappez-la d'abord dans /admin/categories.`,
      );
    }
  }
  if (input.hsCodeId) {
    const h = await prisma.hsCode.findUnique({ where: { id: input.hsCodeId }, select: { id: true } });
    if (!h) throw new Error("Le code SH sélectionné n'existe plus. Rechargez la page.");
  }
  if (input.countryIsoCode && !getCountryByIso(input.countryIsoCode)) {
    throw new Error("Le pays de fabrication sélectionné n'existe pas.");
  }
  if (input.seasonId) {
    const s = await prisma.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
    if (!s) throw new Error("La saison sélectionnée n'existe plus. Rechargez la page.");
  }
  if (input.compositions && input.compositions.length > 0) {
    const ids = [...new Set(input.compositions.map((c) => c.compositionId))];
    const comps = await prisma.composition.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (comps.length !== ids.length) {
      throw new Error("Une composition sélectionnée n'existe plus. Rechargez la page.");
    }
    const total = input.compositions.reduce((sum, c) => sum + c.percentage, 0);
    if (Math.round(total * 100) !== 10000) {
      throw new Error(`La somme des pourcentages doit faire 100% (actuel : ${total}%).`);
    }
    for (const c of input.compositions) {
      if (c.percentage <= 0 || c.percentage > 100) {
        throw new Error("Chaque pourcentage doit être entre 0 et 100.");
      }
    }
  }

  // Charger les produits existants (avec IDs marketplaces pour poser les flags syncRequired).
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      reference: true,
      categoryId: true,
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
      microstoreProductId: true,
    },
  });
  if (products.length === 0) throw new Error("Aucun produit trouvé.");

  const success: string[] = [];
  const errors: { id: string; reference: string; reason: string }[] = [];

  // Champs scalaires applicables d'un coup via updateMany (sauf relations M2M
  // et compositions qui nécessitent un par-produit).
  const scalarData: Record<string, unknown> = {};
  if (input.categoryId !== undefined) scalarData.categoryId = input.categoryId;
  if (input.hsCodeId !== undefined) scalarData.hsCodeId = input.hsCodeId;
  if (input.countryIsoCode !== undefined) scalarData.countryIsoCode = input.countryIsoCode;
  if (input.seasonId !== undefined) scalarData.seasonId = input.seasonId;
  if (input.isBestSeller !== undefined) scalarData.isBestSeller = input.isBestSeller;
  // « Important » n'impacte ni marketplaces ni boutique publique : pas de flag
  // syncRequired à poser, on met juste à jour la colonne.
  if (input.important !== undefined) scalarData.important = input.important;

  // Boucle produit (transactions individuelles pour ne pas tout perdre si un
  // produit échoue ; les vérifs FK ont déjà été faites en amont).
  for (const p of products) {
    try {
      await prisma.$transaction(async (tx) => {
        // Si on change la catégorie sans toucher aux sous-cats, on vide les
        // sous-cats existantes (elles appartenaient à l'ancienne catégorie).
        const needsResetSubCats =
          input.categoryId !== undefined &&
          input.categoryId !== p.categoryId &&
          input.subCategoryIds === undefined;

        // Étiquette Microstore :
        //   - `input.microstoreSubCategoryId !== undefined` → valeur explicite
        //     (validée plus haut) : `null` = catégorie principale, id = sous-cat.
        //   - sinon reset auto si catégorie change ou sous-cats remplacées
        //     (id potentiellement orphelin).
        const explicitMicrostoreChoice = input.microstoreSubCategoryId !== undefined;
        const needsResetMicrostoreSub =
          !explicitMicrostoreChoice &&
          (needsResetSubCats || input.subCategoryIds !== undefined);

        // Marketplaces liées → flag « Synchro nécessaire » systématique. Ainsi,
        // si la cliente annule la modale de propagation qui suit ou décoche
        // une marketplace (y compris en maintenance), le badge orange lui
        // rappellera la modif en attente.
        // Exception : si le SEUL champ modifié est `important` (marqueur admin
        // interne), on ne pose aucun drapeau syncRequired — cette étoile n'est
        // jamais poussée vers les marketplaces.
        const onlyImportantChange =
          input.important !== undefined &&
          input.categoryId === undefined &&
          input.subCategoryIds === undefined &&
          input.microstoreSubCategoryId === undefined &&
          input.hsCodeId === undefined &&
          input.countryIsoCode === undefined &&
          input.seasonId === undefined &&
          input.isBestSeller === undefined &&
          input.compositions === undefined;

        const syncFlags: Record<string, boolean> = {};
        if (!onlyImportantChange) {
          if (p.pfsProductId) syncFlags.pfsSyncRequired = true;
          if (p.ankorsProductId) syncFlags.ankorsSyncRequired = true;
          if (p.efashionReferenceBase) syncFlags.efashionSyncRequired = true;
          if (p.faireProductId) syncFlags.faireSyncRequired = true;
          if (p.orderchampProductId) syncFlags.orderchampSyncRequired = true;
          if (p.microstoreProductId != null) syncFlags.microstoreSyncRequired = true;
        }

        await tx.product.update({
          where: { id: p.id },
          data: {
            ...scalarData,
            ...syncFlags,
            ...(input.subCategoryIds !== undefined && {
              subCategories: { set: input.subCategoryIds.map((id) => ({ id })) },
            }),
            ...(needsResetSubCats && {
              subCategories: { set: [] },
            }),
            ...(explicitMicrostoreChoice && {
              microstoreSubCategoryId: input.microstoreSubCategoryId ?? null,
            }),
            ...(needsResetMicrostoreSub && {
              microstoreSubCategoryId: null,
            }),
          },
        });

        if (input.compositions !== undefined) {
          await tx.productComposition.deleteMany({ where: { productId: p.id } });
          if (input.compositions.length > 0) {
            await tx.productComposition.createMany({
              data: input.compositions.map((c) => ({
                productId: p.id,
                compositionId: c.compositionId,
                percentage: c.percentage,
              })),
            });
          }
        }
      });
      success.push(p.id);
    } catch (e) {
      logger.error("[bulkUpdateProductAttributes] echec produit", { error: e, productId: p.id });
      errors.push({
        id: p.id,
        reference: p.reference,
        reason: e instanceof Error ? e.message : "Erreur inconnue",
      });
    }
  }

  // Produits demandés mais introuvables en BDD
  for (const reqId of productIds) {
    if (!products.find((p) => p.id === reqId)) {
      errors.push({ id: reqId, reference: reqId, reason: "Produit introuvable." });
    }
  }

  if (success.length > 0) {
    revalidatePath("/admin/produits");
    revalidatePath("/produits");
    revalidateTag("products", "default");
    for (const pid of success) {
      emitProductEvent({ type: "PRODUCT_UPDATED", productId: pid });
    }
  }

  return { updated: success.length, success, errors };
}

// ─────────────────────────────────────────────
// Prévisualisation : indique quels produits seront supprimés définitivement
// vs archivés (déjà vendus), AVANT de lancer l'action.
// ─────────────────────────────────────────────

export async function previewProductDeletion(productIds: string[]): Promise<{
  willDelete: { id: string; reference: string }[];
  willArchive: { id: string; reference: string; orderCount: number }[];
}> {
  await requireAdmin();
  if (productIds.length === 0) return { willDelete: [], willArchive: [] };

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, reference: true },
  });
  if (products.length === 0) return { willDelete: [], willArchive: [] };

  const refs = products.map((p) => p.reference);
  const orderCounts = await prisma.orderItem.groupBy({
    by: ["productRef"],
    where: { productRef: { in: refs } },
    _count: { id: true },
  });

  const countByRef = new Map(orderCounts.map((oc) => [oc.productRef, oc._count.id]));
  const willArchive = products
    .filter((p) => (countByRef.get(p.reference) ?? 0) > 0)
    .map((p) => ({ id: p.id, reference: p.reference, orderCount: countByRef.get(p.reference) ?? 0 }));
  const willDelete = products
    .filter((p) => (countByRef.get(p.reference) ?? 0) === 0)
    .map((p) => ({ id: p.id, reference: p.reference }));

  return { willDelete, willArchive };
}

export async function bulkDeleteProducts(
  productIds: string[],
  otpCheck?: {
    otpId: string;
    code: string;
    pauseChoice?: "15min" | "1h" | "24h" | null;
  } | null,
): Promise<{
  deleted: number;
  archived: { id: string; reference: string; orderCount: number }[];
}> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  const tenant = await requireCurrentTenant();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

  // ─── Vérification OTP (sauf si pause active) ───
  await guardAdminActionOtp({
    action: "delete",
    productIds,
    adminId: session.user.id,
    tenantId: tenant.id,
    otp: otpCheck ? { otpId: otpCheck.otpId, code: otpCheck.code } : null,
  });
  if (otpCheck?.pauseChoice !== undefined && otpCheck.pauseChoice !== null) {
    await applyPauseChoice(tenant.id, otpCheck.pauseChoice);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, reference: true },
  });

  const refToId = new Map(products.map((p) => [p.reference, p.id]));
  const refs = products.map((p) => p.reference);

  const orderCounts = await prisma.orderItem.groupBy({
    by: ["productRef"],
    where: { productRef: { in: refs } },
    _count: { id: true },
  });

  // Products with existing orders → archive (retention + history)
  const orderedRefs = new Set(orderCounts.map((oc) => oc.productRef));
  const archivedProducts = orderCounts.map((oc) => ({
    id: refToId.get(oc.productRef) ?? "",
    reference: oc.productRef,
    orderCount: oc._count.id,
  }));
  const archivedIds = archivedProducts.map((p) => p.id).filter(Boolean);

  if (archivedIds.length > 0) {
    await prisma.product.updateMany({
      where: { id: { in: archivedIds } },
      data: { status: "ARCHIVED" },
    });
    for (const pid of archivedIds) {
      emitProductEvent({ type: "PRODUCT_OFFLINE", productId: pid });
    }
  }

  // Products never ordered → full permanent deletion
  const deletableIds = productIds.filter((pid) => {
    const prod = products.find((p) => p.id === pid);
    return prod && !orderedRefs.has(prod.reference);
  });

  let deleted = 0;
  if (deletableIds.length > 0) {
    const allImages = await prisma.productColorImage.findMany({
      where: { productId: { in: deletableIds } },
      select: { path: true },
    });
    if (allImages.length > 0) {
      const keys = allImages.flatMap(({ path }) => {
        const paths = getImagePaths(path);
        return [paths.large, paths.medium, paths.thumb].map(keyFromDbPath);
      });
      try {
        await deleteFiles(keys);
        logger.info(`[Storage] Deleted ${keys.length} images for ${deletableIds.length} products`);
      } catch (err) {
        logger.error(`[Storage] Failed to delete images during bulk delete`, {
          error: err,
        });
      }
    }

    // Suppression des dossiers produits (un par référence).
    const deletableRefs = products
      .filter((p) => deletableIds.includes(p.id))
      .map((p) => p.reference);
    for (const ref of deletableRefs) {
      try {
        await deleteDirectory(productImageDir(ref, tenant.slug));
      } catch (err) {
        logger.error(`[Storage] Failed to delete product folder for ${ref}`, {
          error: err,
        });
      }
    }

    const variantIds = await prisma.productColor.findMany({
      where: { productId: { in: deletableIds } },
      select: { id: true },
    });
    if (variantIds.length > 0) {
      await prisma.cartItem.deleteMany({
        where: { variantId: { in: variantIds.map((v) => v.id) } },
      });
    }

    const result = await prisma.product.deleteMany({
      where: { id: { in: deletableIds } },
    });
    deleted = result.count;
  }

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  return { deleted, archived: archivedProducts };
}

// ─────────────────────────────────────────────
// Mise à jour rapide d'une variante
// ─────────────────────────────────────────────

export interface VariantQuickUpdate {
  unitPrice?: number;
  stock?: number;
  weight?: number;
  saleType?: "UNIT" | "PACK";
  packQuantity?: number | null;
  disabled?: boolean;
}

export async function updateVariantQuick(
  variantId: string,
  data: VariantQuickUpdate
): Promise<void> {
  await requireAdmin();

  const variant = await prisma.productColor.findUnique({
    where: { id: variantId },
    select: { productId: true, stock: true },
  });
  if (!variant) throw new Error("Variante introuvable.");

  await prisma.productColor.update({
    where: { id: variantId },
    data,
  });

  // Depuis 2026-08-07 : plus d'auto-archive local sur rupture totale.

  // Toute modif prix/stock/poids/packQty pose un badge orange « Synchro nécessaire »
  // sur les marketplaces liées. Si la cliente annule / décoche la modale de
  // propagation (ou si la marketplace est en maintenance plateforme), le flag
  // reste posé et le badge orange l'invite à pousser plus tard. Symétrique à
  // updateProduct qui fait la même chose sur les champs clés.
  const productForFlags = await prisma.product.findUnique({
    where: { id: variant.productId },
    select: {
      pfsProductId: true,
      ankorsProductId: true,
      efashionReferenceBase: true,
      faireProductId: true,
      orderchampProductId: true,
      microstoreProductId: true,
    },
  });
  if (productForFlags) {
    const flagsData: Prisma.ProductUpdateInput = {};
    if (productForFlags.pfsProductId) flagsData.pfsSyncRequired = true;
    if (productForFlags.ankorsProductId) flagsData.ankorsSyncRequired = true;
    if (productForFlags.efashionReferenceBase) flagsData.efashionSyncRequired = true;
    if (productForFlags.faireProductId) flagsData.faireSyncRequired = true;
    if (productForFlags.orderchampProductId) flagsData.orderchampSyncRequired = true;
    if (productForFlags.microstoreProductId != null) flagsData.microstoreSyncRequired = true;
    if (Object.keys(flagsData).length > 0) {
      await prisma.product.update({
        where: { id: variant.productId },
        data: flagsData,
      });
    }
  }

  revalidatePath("/admin/produits");
  await revalidateProductPublicPage(variant.productId);
  emitProductEvent({ type: "STOCK_CHANGED", productId: variant.productId });
  // Marketplace stock sync removed — re-export Excel to update marketplaces.

  // Rotation auto couleur principale : si cette modif a mis la couleur
  // principale du produit entièrement en rupture, on bascule vers une autre.
  if (data.stock !== undefined || data.disabled !== undefined) {
    await rotatePrimaryIfNeeded(variant.productId);
  }
}

// ─────────────────────────────────────────────
// Mise à jour de la remise produit
// ─────────────────────────────────────────────

export async function updateProductDiscount(
  productId: string,
  discountPercent: number | null
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  if (discountPercent !== null && (discountPercent <= 0 || discountPercent > 100)) {
    return { success: false, error: "La remise doit être entre 0 et 100%." };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) return { success: false, error: "Produit introuvable." };

  await prisma.product.update({
    where: { id: productId },
    data: { discountPercent },
  });

  revalidateTag("products", "default");
  emitProductEvent({ type: "PRODUCT_UPDATED", productId });

  return { success: true };
}

// ─────────────────────────────────────────────
// Note interne standalone — sauvegarde indépendante du formulaire produit
// ─────────────────────────────────────────────
export async function updateProductNoteOnly(
  productId: string,
  note: string,
): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const trimmed = note.trim();
  if (trimmed.length > 2000) {
    return { success: false, error: "Note trop longue (max 2000 caractères)." };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) return { success: false, error: "Produit introuvable." };

  await prisma.product.update({
    where: { id: productId },
    data: { note: trimmed || null },
  });

  revalidatePath(`/admin/produits/${productId}/modifier`);
  return { success: true };
}

// ─────────────────────────────────────────────
// Mise à jour en masse de variantes
// ─────────────────────────────────────────────

export async function bulkUpdateVariants(
  variantIds: string[],
  data: VariantQuickUpdate
): Promise<{ updated: number }> {
  await requireAdmin();

  if (variantIds.length === 0) throw new Error("Aucune variante sélectionnée.");
  if (variantIds.length > 200) throw new Error("Maximum 200 variantes à la fois.");

  // Get distinct productIds + current stock for restock alerts
  const variants = await prisma.productColor.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, productId: true, stock: true },
  });

  if (variants.length === 0) throw new Error("Aucune variante trouvée.");

  await prisma.productColor.updateMany({
    where: { id: { in: variantIds } },
    data,
  });

  const productIds = [...new Set(variants.map((v) => v.productId))];

  // Depuis 2026-08-07 : plus d'auto-archive local sur rupture totale.

  revalidatePath("/admin/produits");
  for (const pid of productIds) {
    await revalidateProductPublicPage(pid);
    emitProductEvent({ type: "STOCK_CHANGED", productId: pid });
  }

  return { updated: variants.length };
}

// ─────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────

export async function getAllTags() {
  return prisma.tag.findMany({ orderBy: { name: "asc" } });
}

// ─────────────────────────────────────────────
// Ajouter/retirer des tags en masse sur plusieurs produits.
// Idempotent : ajouter un tag déjà présent est un no-op (skipDuplicates).
// Aucune propagation marketplace : les tags sont internes à la boutique.
// ─────────────────────────────────────────────

export async function bulkAddTagsToProducts(
  productIds: string[],
  tagIds: string[],
): Promise<{ productsCount: number; tagsCount: number; linksCreated: number }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");
  if (tagIds.length === 0) throw new Error("Aucun tag sélectionné.");
  if (productIds.length > 1000) throw new Error("Maximum 1000 produits à la fois.");

  const [products, tags] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true } }),
    prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } }),
  ]);
  if (products.length === 0) throw new Error("Aucun produit trouvé.");
  if (tags.length === 0) throw new Error("Aucun tag trouvé.");

  const data = products.flatMap((p) =>
    tags.map((t) => ({ productId: p.id, tagId: t.id })),
  );

  const result = await prisma.productTag.createMany({ data, skipDuplicates: true });

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  for (const p of products) {
    emitProductEvent({ type: "PRODUCT_UPDATED", productId: p.id });
  }

  return {
    productsCount: products.length,
    tagsCount: tags.length,
    linksCreated: result.count,
  };
}

export async function bulkRemoveTagsFromProducts(
  productIds: string[],
  tagIds: string[],
): Promise<{ productsCount: number; tagsCount: number; linksRemoved: number }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");
  if (tagIds.length === 0) throw new Error("Aucun tag sélectionné.");
  if (productIds.length > 1000) throw new Error("Maximum 1000 produits à la fois.");

  const result = await prisma.productTag.deleteMany({
    where: {
      productId: { in: productIds },
      tagId: { in: tagIds },
    },
  });

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  for (const pid of productIds) {
    emitProductEvent({ type: "PRODUCT_UPDATED", productId: pid });
  }

  return {
    productsCount: productIds.length,
    tagsCount: tagIds.length,
    linksRemoved: result.count,
  };
}

export async function createTag(name: string) {
  await requireAdmin();
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) throw new Error("Nom invalide.");
  let tag = await prisma.tag.findFirst({ where: { name: trimmed } });
  if (!tag) {
    tag = await prisma.tag.create({ data: { name: trimmed } });
  }
  revalidatePath("/admin/produits");
  return tag;
}

export async function deleteTag(id: string) {
  await requireAdmin();
  await prisma.tag.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidatePath("/produits");
}

export async function updateTagDirect(
  id: string,
  name: string,
  translations: Record<string, string>
) {
  await requireAdmin();
  if (!name.trim()) throw new Error("Le nom est requis.");
  await prisma.tag.update({ where: { id }, data: { name: name.trim() } });

  for (const locale of NON_DEFAULT_LOCALES) {
    const val = translations[locale]?.trim();
    if (val) {
      await prisma.tagTranslation.upsert({
        where: { tagId_locale: { tagId: id, locale } },
        update: { name: val },
        create: { tagId: id, locale, name: val },
      });
    } else {
      await prisma.tagTranslation.deleteMany({ where: { tagId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
}

// ─────────────────────────────────────────────
// Rafraîchir la date de création (pour réapparaître en "Nouveauté")
// ─────────────────────────────────────────────

export async function refreshProduct(productId: string): Promise<void> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true },
  });
  if (!product) throw new Error("Produit introuvable.");

  await prisma.product.update({
    where: { id: productId },
    data: { lastRefreshedAt: new Date() },
  });

  revalidatePath("/admin/produits");
  await revalidateProductPublicPage(productId);
  revalidatePath("/produits");
  revalidateTag("products", "default");

  if (product.status === "ONLINE") {
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });
  }
}

export async function updateTag(id: string, formData: FormData) {
  await requireAdmin();
  const name = (formData.get("name") as string)?.trim();
  if (!name) throw new Error("Le nom est requis.");

  await prisma.tag.update({ where: { id }, data: { name } });

  for (const locale of NON_DEFAULT_LOCALES) {
    const val = (formData.get(`name_${locale}`) as string)?.trim();
    if (val) {
      await prisma.tagTranslation.upsert({
        where: { tagId_locale: { tagId: id, locale } },
        update: { name: val },
        create: { tagId: id, locale, name: val },
      });
    } else {
      await prisma.tagTranslation.deleteMany({ where: { tagId: id, locale } });
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
}

// ─────────────────────────────────────────────
// Save only translations for an existing product
// ─────────────────────────────────────────────

export async function saveProductTranslations(
  productId: string,
  translations: { locale: string; name: string; description: string }[],
  options: { source?: "manual" | "auto" } = {},
) {
  await requireAdmin();

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Produit introuvable.");

  // `source` distingue une saisie admin (onglet EN du form → verrouille contre
  // toute future auto-traduction) d'un batch auto-translate (le mot-à-mot PFS
  // ne doit PAS poser le verrou).
  const isManual = options.source !== "auto";

  await prisma.productTranslation.deleteMany({ where: { productId } });

  const valid = translations.filter((t) => t.name.trim() || t.description.trim());
  if (valid.length > 0) {
    await prisma.productTranslation.createMany({
      data: valid.map((t) => ({
        productId,
        locale: t.locale,
        name: t.name,
        description: t.description,
        manualEdit: isManual,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * Traduit en anglais le nom + description des produits sélectionnés depuis la
 * barre d'action bulk (menu "Plus"). Force l'écrasement des ProductTranslation
 * existantes pour la locale "en" — l'utilisatrice a explicitement demandé
 * "on remplace" pour repartir de la version FR courante.
 *
 * Ne dépend PAS du flag `auto_translate_enabled` (SiteConfig) car c'est une
 * action manuelle.
 */
export async function bulkTranslateProducts(
  productIds: string[],
): Promise<{ translated: number; failed: number; skipped: number }> {
  await requireAdmin();
  if (productIds.length === 0) return { translated: 0, failed: 0, skipped: 0 };

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, description: true },
  });

  let translated = 0;
  let failed = 0;
  let skipped = 0;

  const CONCURRENCY = 5;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const chunk = products.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (p) => {
        const nameFr = p.name.trim();
        if (!nameFr) {
          skipped++;
          return;
        }
        try {
          const descFr = (p.description ?? "").trim();
          const [translatedName, translatedDesc] = await Promise.all([
            translateTextStrict(nameFr, "fr", "en"),
            descFr ? translateTextStrict(descFr, "fr", "en") : Promise.resolve(""),
          ]);
          if (translatedName === null) {
            failed++;
            return;
          }
          const finalName = translatedName.trim();
          const finalDesc = translatedDesc === null ? "" : (translatedDesc ?? "");
          await prisma.productTranslation.upsert({
            where: { productId_locale: { productId: p.id, locale: "en" } },
            update: { name: finalName, description: finalDesc },
            create: { productId: p.id, locale: "en", name: finalName, description: finalDesc },
          });
          translated++;
        } catch (err) {
          logger.error("[bulkTranslateProducts] échec", { error: err, productId: p.id });
          failed++;
        }
      }),
    );
  }

  revalidateTag("products", "default");
  revalidatePath("/admin/produits");

  return { translated, failed, skipped };
}

/**
 * Revalidate all caches after a background import completes.
 * Called from the client when the import job status changes to COMPLETED,
 * because revalidateTag doesn't work inside fire-and-forget background jobs.
 */
export async function revalidateAfterImport() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return;

  revalidateTag("products", "default");
  revalidateTag("categories", "default");
  revalidateTag("colors", "default");
  revalidateTag("tags", "default");
  revalidateTag("compositions", "default");
  revalidateTag("seasons", "default");
  revalidateTag("sizes", "default");
}

/**
 * Get detailed product statistics for the admin product stats tab.
 */
export async function fetchProductFormAttributes() {
  await requireAdmin();
  const [categories, colors, compositions, tags, seasons, sizes, annexes, hsCodes] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: {
        subCategories: {
          orderBy: { name: "asc" },
          select: { id: true, name: true, slug: true, microstoreCategoryId: true },
        },
      },
    }),
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true, efashionColorId: true },
    }),
    prisma.composition.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.season.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.size.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
    getPfsAnnexes().catch(() => null),
    prisma.hsCode.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, label: true },
    }),
  ]);
  const pfsSizes = (annexes?.sizes ?? []).map((ref) => ({ reference: ref, label: ref }));

  return {
    categories,
    colors: colors.map((c) => ({
      id: c.id,
      name: c.name,
      hex: c.hex,
      patternImage: c.patternImage,
      pfsColorRef: c.pfsColorRef,
      efashionColorId: c.efashionColorId,
    })),
    compositions,
    tags,
    manufacturingCountries: listManufacturingCountries().map((c) => ({
      id: c.code,
      name: c.name,
      isoCode: c.code,
    })),
    seasons,
    sizes: withProtectedSize(sizes.map((s) => ({ id: s.id, name: s.name }))),
    pfsSizes,
    hsCodes,
  };
}

export async function getProductStats(productId: string) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { reference: true } });
  if (!product) return null;

  const [items, cartItems, views, priceHistory] = await Promise.all([
    prisma.orderItem.findMany({
      where: { productRef: product.reference },
      include: {
        order: {
          select: { createdAt: true, userId: true, status: true, user: { select: { company: true } } },
        },
      },
    }),
    prisma.cartItem.count({ where: { variant: { productId } } }),
    prisma.productView.count({ where: { productId } }),
    prisma.priceHistory.findMany({
      where: { productColor: { productId } },
      include: { changedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const totalRevenue = items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
  const totalQuantitySold = items.reduce((sum, i) => sum + i.quantity, 0);
  const orderIds = new Set(items.map((i) => i.orderId));

  // Monthly sales (last 12 months)
  const monthlySales: Record<string, { revenue: number; quantity: number }> = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlySales[key] = { revenue: 0, quantity: 0 };
  }
  for (const item of items) {
    const d = item.order.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlySales[key]) {
      monthlySales[key].revenue += Number(item.lineTotal);
      monthlySales[key].quantity += item.quantity;
    }
  }

  // Sales by color
  const colorMap: Record<string, { quantity: number; revenue: number }> = {};
  for (const item of items) {
    const color = item.colorName || "N/A";
    if (!colorMap[color]) colorMap[color] = { quantity: 0, revenue: 0 };
    colorMap[color].quantity += item.quantity;
    colorMap[color].revenue += Number(item.lineTotal);
  }

  // Top clients
  const clientMap: Record<string, { company: string; quantity: number; revenue: number }> = {};
  for (const item of items) {
    const uid = item.order.userId;
    if (!clientMap[uid]) clientMap[uid] = { company: item.order.user.company || "N/A", quantity: 0, revenue: 0 };
    clientMap[uid].quantity += item.quantity;
    clientMap[uid].revenue += Number(item.lineTotal);
  }

  return {
    totalRevenue,
    totalQuantitySold,
    totalOrders: orderIds.size,
    inCartsCount: cartItems,
    viewCount: views,
    claimCount: 0,
    monthlySales: Object.entries(monthlySales).map(([month, data]) => ({ month, ...data })),
    salesByColor: Object.entries(colorMap).map(([colorName, data]) => ({ colorName, ...data })),
    topClients: Object.values(clientMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    priceHistory: priceHistory.map((ph) => ({
      date: ph.createdAt.toISOString(),
      field: ph.field,
      oldPrice: Number(ph.oldPrice),
      newPrice: Number(ph.newPrice),
      admin: `${ph.changedBy.firstName} ${ph.changedBy.lastName}`,
    })),
  };
}
