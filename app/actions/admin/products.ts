"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { invalidateProductTranslations } from "@/lib/translate";
import { notifyRestockAlerts } from "@/lib/notifications";
import { emitProductEvent } from "@/lib/product-events";
import { autoTranslateProduct, autoTranslateTag } from "@/lib/auto-translate";
import { generateSku } from "@/lib/sku";
import { deleteFiles, keyFromDbPath } from "@/lib/storage";
import { getImagePaths } from "@/lib/image-utils";
import { getPfsAnnexes } from "@/lib/pfs-annexes";
import { normalizePrimaryFlag } from "@/lib/normalize-primary-flag";
import { findMissingImageCoverage } from "@/lib/variant-image-coverage";
import {
  validateVariants,
  isMultiColorPackInput,
  type ColorInput,
  type PackLineInput,
  type SizeEntryInput,
} from "@/lib/product-variant-validation";
import { isProtectedSizeName } from "@/lib/protected-sizes";

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
  colors: ColorInput[];
  imagePaths?: { colorId: string; variantDbId?: string; variantIndex?: number; paths: string[]; orders?: number[] }[]; // images grouped per variant
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
  manufacturingCountryId?: string | null;
  seasonId?: string | null;
  translations?: TranslationInput[];
  discountPercent: number | null; // Remise en % (ex: 15 = -15%). null = pas de remise
  sizeDetailsTu?: string | null; // Détail taille unique (ex: "52-56")
  isIncomplete?: boolean;
}

// validateVariants + isMultiColorPackInput : voir `lib/product-variant-validation.ts`

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
// Créer un produit
// ─────────────────────────────────────────────

export async function createProduct(input: ProductInput): Promise<{ id: string }> {
  await requireAdmin();

  // Skip strict variant validation for incomplete products
  if (!input.isIncomplete) {
    validateVariants(input.colors);
    await assertTailleUniqueDetails(input);
  }

  // Garantir une seule variante primaire avant l'écriture en BDD
  input = { ...input, colors: normalizePrimaryFlag(input.colors) };

  if (/\s/.test(input.reference)) throw new Error("La référence ne doit pas contenir d'espaces.");

  const existing = await prisma.product.findUnique({ where: { reference: input.reference }, select: { id: true } });
  if (existing) throw new Error("Cette référence existe déjà.");

  // Vérifier que la catégorie existe
  const categoryExists = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!categoryExists) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");

  // Vérifier les FK optionnelles
  if (input.manufacturingCountryId) {
    const countryExists = await prisma.manufacturingCountry.findUnique({ where: { id: input.manufacturingCountryId }, select: { id: true } });
    if (!countryExists) throw new Error("Le pays de fabrication sélectionné n'existe plus. Rechargez la page.");
  }
  if (input.seasonId) {
    const seasonExists = await prisma.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
    if (!seasonExists) throw new Error("La saison sélectionnée n'existe plus. Rechargez la page.");
  }

  // Upsert tags
  const tagRecords = await Promise.all(
    input.tagNames.map(async (n) => {
      const tag = await prisma.tag.upsert({
        where: { name: n.trim().toLowerCase() },
        create: { name: n.trim().toLowerCase() },
        update: {},
      });
      // Auto-translate new tags (fire-and-forget, checks if translations exist)
      autoTranslateTag(tag.id, n.trim().toLowerCase());
      return tag;
    })
  );

  const product = await prisma.product.create({
    data: {
      reference:             input.reference.trim().toUpperCase(),
      name:                  input.name.trim(),
      description:           input.description.trim(),
      categoryId:    input.categoryId,
      isBestSeller:  input.isBestSeller,
      status:        input.status,
      isIncomplete:  input.isIncomplete ?? false,
      subCategories: { connect: input.subCategoryIds.map((id) => ({ id })) },
      tags:          { create: tagRecords.map((t) => ({ tagId: t.id })) },
      dimensionLength:       input.dimensionLength,
      dimensionWidth:        input.dimensionWidth,
      dimensionHeight:       input.dimensionHeight,
      dimensionDiameter:     input.dimensionDiameter,
      dimensionCircumference: input.dimensionCircumference,
      manufacturingCountryId: input.manufacturingCountryId || null,
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
        productId:     product.id,
        colorId:       primaryColorId,
        unitPrice:     color.unitPrice,
        weight:        color.weight,
        stock:         color.stock,
        isPrimary:     color.isPrimary,
        saleType:      color.saleType,
        packQuantity:  color.packQuantity,
        disabled:      color.disabled ?? false,
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
            productColorId: variant.id,
            colorId: line.colorId,
            position: li,
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

  // Images: create ProductColorImage entries linked to specific ProductColor variant
  if (input.imagePaths && input.imagePaths.length > 0) {
    const imageData: { productId: string; colorId: string; productColorId: string; path: string; order: number }[] = [];
    const usedVariantIds = new Set<string>();
    for (const group of input.imagePaths) {
      if (group.paths.length === 0) continue;
      let matched: { id: string; colorId: string | null } | undefined;
      // Try match by variantIndex first (reliable for PACK and new variants)
      if (group.variantIndex != null && createdVariants[group.variantIndex]) {
        matched = createdVariants[group.variantIndex];
      }
      // Fallback: match by colorId
      if (!matched && group.colorId) {
        for (let i = 0; i < input.colors.length; i++) {
          const cv = createdVariants[i];
          if (!cv || usedVariantIds.has(cv.id)) continue;
          if (cv.colorId !== group.colorId) continue;
          matched = cv;
          break;
        }
      }
      if (!matched) continue;
      usedVariantIds.add(matched.id);
      const effectiveColorId = group.colorId || matched.colorId || "";
      if (!effectiveColorId) continue; // Cannot create image without a colorId FK
      group.paths.forEach((path, idx) => {
        const order = group.orders?.[idx] ?? idx;
        imageData.push({ productId: product.id, colorId: effectiveColorId, productColorId: matched!.id, path, order });
      });
    }
    if (imageData.length > 0) {
      await prisma.productColorImage.createMany({ data: imageData });
    }
  }

  // Auto-downgrade to OFFLINE if any *color composition* has no image. UNIT+PACK
  // d'une même couleur partagent le même jeu d'images côté UI : on autorise donc
  // qu'une seule des deux porte les images en BDD.
  let effectiveStatus = input.status;
  if (input.status === "ONLINE" && createdVariants.length > 0) {
    const variantsWithDetails = await prisma.productColor.findMany({
      where: { productId: product.id },
      select: {
        id: true,
        colorId: true,
        color: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    const missing = findMissingImageCoverage(
      variantsWithDetails.map((v) => ({
        id: v.id,
        colorId: v.colorId,
        colorName: v.color?.name ?? null,
        imageCount: v._count.images,
      })),
    );
    if (missing.length > 0) {
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

  // Traductions manuelles
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

  // Marketplace publishing (PFS) is triggered from the save dialog, not here.

  return { id: product.id };
}

// ─────────────────────────────────────────────
// Modifier un produit
// ─────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<{ variantDbIds: string[] }> {
  await requireAdmin();

  // ── Defensive validation: DB non-nullable constraints ────────
  if (!input.reference?.trim()) throw new Error("La référence est requise.");
  if (/\s/.test(input.reference)) throw new Error("La référence ne doit pas contenir d'espaces.");
  if (!input.name?.trim()) throw new Error("Le nom est requis.");
  if (!input.categoryId) throw new Error("La catégorie est requise.");

  // Strict validation only when going ONLINE (not for drafts or OFFLINE saves)
  if (input.status === "ONLINE") {
    if (!input.description?.trim()) throw new Error("La description est requise.");
    if (!input.colors || input.colors.length === 0) {
      throw new Error("Au moins une variante est requise.");
    }
    validateVariants(input.colors);
    await assertTailleUniqueDetails(input);
  }

  // Garantir une seule variante primaire (corrige aussi les produits legacy
  // créés avant le fix où plusieurs variantes pouvaient être marquées primaires).
  input = { ...input, colors: normalizePrimaryFlag(input.colors) };

  const oldProduct = await prisma.product.findUnique({
    where: { id },
    select: {
      status: true,
      isBestSeller: true,
      name: true,
      description: true,
      categoryId: true,
      manufacturingCountryId: true,
      seasonId: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
    },
  });

  const dup = await prisma.product.findFirst({
    where: { reference: input.reference.trim().toUpperCase(), NOT: { id } },
    select: { id: true },
  });
  if (dup) throw new Error("Cette référence est déjà utilisée par un autre produit.");

  // Vérifier que la catégorie existe
  const categoryExists = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!categoryExists) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");

  // Vérifier les FK optionnelles
  if (input.manufacturingCountryId) {
    const countryExists = await prisma.manufacturingCountry.findUnique({ where: { id: input.manufacturingCountryId }, select: { id: true } });
    if (!countryExists) throw new Error("Le pays de fabrication sélectionné n'existe plus. Rechargez la page.");
  }
  if (input.seasonId) {
    const seasonExists = await prisma.season.findUnique({ where: { id: input.seasonId }, select: { id: true } });
    if (!seasonExists) throw new Error("La saison sélectionnée n'existe plus. Rechargez la page.");
  }

  // Upsert tags
  const tagRecords = await Promise.all(
    input.tagNames.map((n) =>
      prisma.tag.upsert({
        where: { name: n.trim().toLowerCase() },
        create: { name: n.trim().toLowerCase() },
        update: {},
      })
    )
  );

  const { oldStockMap, oldVariantMap, variantIdMap } = await prisma.$transaction(async (tx) => {
    // Mise à jour des champs de base
    await tx.product.update({
      where: { id },
      data: {
        reference:             input.reference.trim().toUpperCase(),
        name:                  input.name.trim(),
        description:           input.description.trim(),
        categoryId:    input.categoryId,
        isBestSeller:  input.isBestSeller,
        status:        input.status,
        isIncomplete:  input.isIncomplete ?? false,
        subCategories: { set: input.subCategoryIds.map((id) => ({ id })) },
        dimensionLength:       input.dimensionLength,
        dimensionWidth:        input.dimensionWidth,
        dimensionHeight:       input.dimensionHeight,
        dimensionDiameter:     input.dimensionDiameter,
        dimensionCircumference: input.dimensionCircumference,
        manufacturingCountryId: input.manufacturingCountryId || null,
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

    // Compositions — reconstruction complète
    await tx.productComposition.deleteMany({ where: { productId: id } });
    await tx.productComposition.createMany({
      data: input.compositions.map((c) => ({
        productId:     id,
        compositionId: c.compositionId,
        percentage:    c.percentage,
      })),
    });

    // ── Variants (flat ProductColor rows) ──────────────────────────────────
    // Strategy: match by dbId if present. Create new rows when no dbId.
    // Delete rows whose id is not in any submitted dbId.

    const existingVariants = await tx.productColor.findMany({
      where: { productId: id },
      select: { id: true, colorId: true, stock: true, unitPrice: true, saleType: true, packQuantity: true,
        variantSizes: { select: { quantity: true } } },
    });
    const existingIds = existingVariants.map((v) => v.id);
    const oldStockMap = new Map(existingVariants.map((v) => [v.id, v.stock]));
    const oldVariantMap = new Map(existingVariants.map((v) => [v.id, {
      stock: v.stock,
      unitPrice: Number(v.unitPrice ?? 0),
      saleType: v.saleType as "UNIT" | "PACK",
      packQuantity: v.packQuantity,
      totalPackQty: v.variantSizes?.reduce((s: number, vs: { quantity: number }) => s + vs.quantity, 0) || (v.packQuantity ?? 12),
    }]));
    // Verrouillage post-création : on garde colorId / saleType / packQuantity
    // de la base et on ignore ce que le client envoie pour les variantes existantes.
    // Cf. UI : ColorVariantManager (LOCKED_VARIANT_TOOLTIP).
    const existingByDbId = new Map(existingVariants.map((v) => [v.id, v]));

    // IDs that must be kept (those with dbId provided)
    const submittedDbIds = input.colors
      .filter((c) => c.dbId)
      .map((c) => c.dbId as string);

    // Rows to delete = existing rows NOT in submittedDbIds
    const toDeleteIds = existingIds.filter((eid) => !submittedDbIds.includes(eid));

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
        await tx.productColor.update({
          where: { id: colorInput.dbId },
          data: {
            // colorId / saleType / packQuantity : valeurs verrouillées, on garde
            // ce que la base contient et on ignore le client.
            colorId:       existing.colorId,
            saleType:      existing.saleType,
            packQuantity:  existing.packQuantity,
            // Champs librement modifiables :
            unitPrice:     colorInput.unitPrice,
            weight:        colorInput.weight,
            stock:         colorInput.stock,
            isPrimary:     colorInput.isPrimary,
            disabled:      colorInput.disabled ?? false,
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
            productId:     id,
            colorId:       primaryColorId,
            unitPrice:     colorInput.unitPrice,
            weight:        colorInput.weight,
            stock:         colorInput.stock,
            isPrimary:     colorInput.isPrimary,
            saleType:      colorInput.saleType,
            packQuantity:  colorInput.packQuantity,
            disabled:      colorInput.disabled ?? false,
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
            productColorId: variantId,
            colorId: line.colorId,
            position: li,
            sizes: {
              create: line.sizeEntries.map((se) => ({ sizeId: se.sizeId, quantity: se.quantity })),
            },
          },
        });
      }
    }

    // ── Assign/update SKUs for all variants ──────────
    await assignVariantSkus(id, input.reference, tx);

    // ── Images: full replace linked to specific ProductColor variant ──────────
    if (input.imagePaths && input.imagePaths.length > 0) {
      // Delete all existing images for this product then recreate
      await tx.productColorImage.deleteMany({
        where: { productId: id },
      });

      const currentVariants = await tx.productColor.findMany({
        where: { productId: id },
        select: { id: true, colorId: true },
      });

      const imageData: { productId: string; colorId: string; productColorId: string; path: string; order: number }[] = [];
      const usedVariantIds = new Set<string>();
      for (const group of input.imagePaths) {
        if (group.paths.length === 0) continue;
        let variant: { id: string; colorId: string | null } | undefined;
        variant = group.variantDbId
          ? currentVariants.find((v) => v.id === group.variantDbId)
          : undefined;
        if (!variant && group.variantIndex != null && variantIdMap[group.variantIndex]) {
          const mappedId = variantIdMap[group.variantIndex].variantId;
          variant = currentVariants.find((v) => v.id === mappedId);
        }
        if (!variant && group.colorId) {
          variant = currentVariants.find((v) => !usedVariantIds.has(v.id) && v.colorId === group.colorId);
        }
        if (!variant) continue;
        usedVariantIds.add(variant.id);
        const effectiveColorId = group.colorId || variant.colorId || "";
        if (!effectiveColorId) continue; // Cannot create image without a colorId FK
        group.paths.forEach((path, idx) => {
          const order = group.orders?.[idx] ?? idx;
          imageData.push({ productId: id, colorId: effectiveColorId, productColorId: variant!.id, path, order });
        });
      }
      if (imageData.length > 0) {
        await tx.productColorImage.createMany({ data: imageData });
      }
    }

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

    return { oldStockMap, oldVariantMap, variantIdMap };
  }, { timeout: 30000 });

  // Traductions : remplacer toutes les traductions existantes
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
        })),
        skipDuplicates: true,
      });
    }
  } else {
    // Aucune traduction fournie : invalider le cache et auto-traduire
    await invalidateProductTranslations(id);
    autoTranslateProduct(id, input.name, input.description);
  }

  // Restock alerts: check if any variant went from stock=0 to stock>0
  for (const colorInput of input.colors) {
    if (colorInput.dbId) {
      const oldStock = oldStockMap.get(colorInput.dbId) ?? 0;
      if (oldStock === 0 && colorInput.stock > 0) {
        notifyRestockAlerts(colorInput.dbId).catch(() => {});
      }
    }
  }

  // Auto-downgrade to OFFLINE si une composition de couleurs n'a aucune image.
  // UNIT et PACK d'une même couleur partagent le jeu d'images côté UI : on
  // autorise donc qu'une seule des deux porte les images en BDD.
  let effectiveStatus = input.status;
  if (input.status === "ONLINE") {
    const allVariants = await prisma.productColor.findMany({
      where: { productId: id },
      select: {
        id: true,
        colorId: true,
        color: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    const missing = findMissingImageCoverage(
      allVariants.map((v) => ({
        id: v.id,
        colorId: v.colorId,
        colorName: v.color?.name ?? null,
        imageCount: v._count.images,
      })),
    );
    const noVariants = allVariants.length === 0;
    if (noVariants || missing.length > 0) {
      effectiveStatus = "OFFLINE";
      await prisma.product.update({ where: { id }, data: { status: "OFFLINE" } });
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${id}/modifier`);
  revalidatePath(`/produits/${id}`);
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
    select: { isBestSeller: true },
  });
  if (!product) return { success: false, error: "Produit introuvable." };
  if (product.isBestSeller === isBestSeller) return { success: true };

  await prisma.product.update({
    where: { id: productId },
    data: { isBestSeller },
  });

  revalidateTag("products", "default");
  emitProductEvent({ type: "BESTSELLER_CHANGED", productId });

  return { success: true };
}

// ─────────────────────────────────────────────
// Supprimer un produit — suppression définitive si jamais vendu,
// sinon archivage (obligation légale 10 ans + historique commandes)
// ─────────────────────────────────────────────

export async function deleteProduct(id: string): Promise<{ action: "deleted" | "archived"; orderCount: number }> {
  await requireAdmin();

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
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
  // Marketplace status is no longer sync'd automatically — admin must regenerate
  // and re-upload the Excel archive (or delete the product from the marketplace).
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

export async function bulkUpdateProductStatus(
  productIds: string[],
  status: "ONLINE" | "OFFLINE" | "ARCHIVED"
): Promise<{ success: string[]; errors: { id: string; reference: string; reason: string }[] }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      colors: { select: { id: true, stock: true } },
      _count: { select: { colors: true } },
    },
  });

  // Check images at the *color composition* level: deux variantes partageant la
  // même composition (ex. Argent UNIT + Argent PACK) partagent le même jeu
  // d'images dans le formulaire, donc si l'une a une image l'autre est couverte.
  const missingByProduct = new Map<string, string[]>();
  if (status === "ONLINE") {
    const allColors = await prisma.productColor.findMany({
      where: { productId: { in: productIds } },
      select: {
        id: true,
        productId: true,
        colorId: true,
        color: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    const byProduct = new Map<string, typeof allColors>();
    for (const c of allColors) {
      const arr = byProduct.get(c.productId) ?? [];
      arr.push(c);
      byProduct.set(c.productId, arr);
    }
    for (const [productId, variants] of byProduct) {
      const missing = findMissingImageCoverage(
        variants.map((v) => ({
          id: v.id,
          colorId: v.colorId,
          colorName: v.color?.name ?? null,
          imageCount: v._count.images,
        })),
      );
      if (missing.length > 0) {
        missingByProduct.set(productId, missing.map((m) => m.label));
      }
    }
  }

  const success: string[] = [];
  const errors: { id: string; reference: string; reason: string }[] = [];

  for (const product of products) {
    if (status === "ONLINE") {
      const reasons: string[] = [];
      if (product.isIncomplete) reasons.push("produit en brouillon");
      if (product.colors.length === 0) reasons.push("aucune variante");
      if (product.colors.length > 0 && product.colors.every(c => c.stock === 0)) reasons.push("aucun stock");
      const missingImgLabels = missingByProduct.get(product.id);
      if (missingImgLabels) reasons.push(`image manquante : ${missingImgLabels.join(", ")}`);
      if (!product.categoryId) reasons.push("pas de catégorie");
      if (reasons.length > 0) {
        errors.push({ id: product.id, reference: product.reference, reason: reasons.join(", ") });
        continue;
      }
    }
    success.push(product.id);
  }

  if (success.length > 0) {
    await prisma.product.updateMany({
      where: { id: { in: success } },
      data: { status },
    });
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

  // Marketplace status is no longer sync'd automatically — admin re-generates Excel.

  return { success, errors };
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
): Promise<{
  deleted: number;
  archived: { id: string; reference: string; orderCount: number }[];
}> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

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
          error: err instanceof Error ? err.message : String(err),
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

  // Restock alert: stock was 0 and now > 0
  if (variant.stock === 0 && data.stock && data.stock > 0) {
    notifyRestockAlerts(variantId).catch(() => {});
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/produits/${variant.productId}`);
  emitProductEvent({ type: "STOCK_CHANGED", productId: variant.productId });
  // Marketplace stock sync removed — re-export Excel to update marketplaces.
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

  // Track variants with stock=0 before update (for restock alerts)
  const zeroStockVariantIds = data.stock && data.stock > 0
    ? variants.filter((v) => v.stock === 0).map((v) => v.id)
    : [];

  await prisma.productColor.updateMany({
    where: { id: { in: variantIds } },
    data,
  });

  // Fire restock alerts for variants that went from 0 → >0
  for (const vid of zeroStockVariantIds) {
    notifyRestockAlerts(vid).catch(() => {});
  }

  const productIds = [...new Set(variants.map((v) => v.productId))];
  revalidatePath("/admin/produits");
  for (const pid of productIds) {
    revalidatePath(`/produits/${pid}`);
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

export async function createTag(name: string) {
  await requireAdmin();
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) throw new Error("Nom invalide.");
  const tag = await prisma.tag.upsert({
    where: { name: trimmed },
    create: { name: trimmed },
    update: {},
  });
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

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
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
  revalidatePath(`/produits/${productId}`);
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

  for (const locale of ["en", "ar", "zh", "de", "es", "it"]) {
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
  translations: { locale: string; name: string; description: string }[]
) {
  await requireAdmin();

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("Produit introuvable.");

  await prisma.productTranslation.deleteMany({ where: { productId } });

  const valid = translations.filter((t) => t.name.trim() || t.description.trim());
  if (valid.length > 0) {
    await prisma.productTranslation.createMany({
      data: valid.map((t) => ({
        productId,
        locale: t.locale,
        name: t.name,
        description: t.description,
      })),
      skipDuplicates: true,
    });
  }
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
  revalidateTag("manufacturing-countries", "default");
  revalidateTag("seasons", "default");
  revalidateTag("sizes", "default");
}

/**
 * Get detailed product statistics for the admin product stats tab.
 */
export async function fetchProductFormAttributes() {
  await requireAdmin();
  const [categories, colors, compositions, tags, manufacturingCountries, seasons, sizes, annexes] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      include: { subCategories: { orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } } },
    }),
    prisma.color.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, hex: true, patternImage: true },
    }),
    prisma.composition.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.manufacturingCountry.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isoCode: true },
    }),
    prisma.season.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.size.findMany({
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
    getPfsAnnexes().catch(() => null),
  ]);
  const pfsSizes = (annexes?.sizes ?? []).map((ref) => ({ reference: ref, label: ref }));
  return {
    categories,
    colors: colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex, patternImage: c.patternImage })),
    compositions,
    tags,
    manufacturingCountries,
    seasons,
    sizes: sizes.map((s) => ({ id: s.id, name: s.name })),
    pfsSizes,
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
