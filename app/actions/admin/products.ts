"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateProductTranslations } from "@/lib/translate";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ColorInput {
  dbId?: string;         // ProductColor.id when editing existing (undefined for new)
  colorId: string;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

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
  imagePaths?: { colorId: string; paths: string[] }[]; // images grouped by colorId
  compositions: CompositionInput[];
  similarProductIds: string[];
  tagNames: string[];
  isBestSeller: boolean;
  status: "OFFLINE" | "ONLINE";
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  translations?: TranslationInput[];
}

// ─────────────────────────────────────────────
// Server-side variant validation
// ─────────────────────────────────────────────

function validateVariants(colors: ColorInput[]): void {
  // No two UNIT variants with same colorId
  const unitByColor = new Map<string, boolean>();
  for (const c of colors) {
    if (c.saleType === "UNIT") {
      if (unitByColor.has(c.colorId)) {
        throw new Error("Une couleur ne peut avoir qu'une variante à l'unité.");
      }
      unitByColor.set(c.colorId, true);
    }
  }

  // No two PACK variants with same colorId + packQuantity + size
  const packKeys = new Set<string>();
  for (const c of colors) {
    if (c.saleType === "PACK") {
      const key = `${c.colorId}__${c.packQuantity ?? ""}__${(c.size ?? "").trim().toLowerCase()}`;
      if (packKeys.has(key)) {
        throw new Error("Une couleur ne peut pas avoir deux paquets de même quantité et de même taille.");
      }
      packKeys.add(key);
    }
  }
}

// ─────────────────────────────────────────────
// Créer un produit
// ─────────────────────────────────────────────

export async function createProduct(input: ProductInput): Promise<{ id: string }> {
  await requireAdmin();

  validateVariants(input.colors);

  const existing = await prisma.product.findUnique({ where: { reference: input.reference }, select: { id: true } });
  if (existing) throw new Error("Cette référence existe déjà.");

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

  const product = await prisma.product.create({
    data: {
      reference:             input.reference.trim().toUpperCase(),
      name:                  input.name.trim(),
      description:           input.description.trim(),
      categoryId:    input.categoryId,
      isBestSeller:  input.isBestSeller,
      status:        input.status,
      subCategories: { connect: input.subCategoryIds.map((id) => ({ id })) },
      tags:          { create: tagRecords.map((t) => ({ tagId: t.id })) },
      dimensionLength:       input.dimensionLength,
      dimensionWidth:        input.dimensionWidth,
      dimensionHeight:       input.dimensionHeight,
      dimensionDiameter:     input.dimensionDiameter,
      dimensionCircumference: input.dimensionCircumference,
      colors: {
        create: input.colors.map((color, idx) => ({
          colorId:       color.colorId,
          unitPrice:     color.unitPrice,
          weight:        color.weight,
          stock:         color.stock,
          isPrimary:     color.isPrimary || idx === 0,
          saleType:      color.saleType,
          packQuantity:  color.packQuantity,
          size:          color.size,
          discountType:  color.discountType,
          discountValue: color.discountValue,
        })),
      },
      compositions: {
        create: input.compositions.map((c) => ({
          compositionId: c.compositionId,
          percentage:    c.percentage,
        })),
      },
    },
  });

  // Images: create ProductColorImage entries grouped by (productId, colorId)
  if (input.imagePaths && input.imagePaths.length > 0) {
    const imageData: { productId: string; colorId: string; path: string; order: number }[] = [];
    // Deduplicate by colorId (same colorId can appear in multiple variants, images are shared)
    const seenColorIds = new Set<string>();
    for (const group of input.imagePaths) {
      if (seenColorIds.has(group.colorId)) continue;
      seenColorIds.add(group.colorId);
      group.paths.forEach((path, order) => {
        imageData.push({ productId: product.id, colorId: group.colorId, path, order });
      });
    }
    if (imageData.length > 0) {
      await prisma.productColorImage.createMany({ data: imageData });
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

  // Traductions manuelles
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
    }
  }

  revalidatePath("/admin/produits");
  return { id: product.id };
}

// ─────────────────────────────────────────────
// Modifier un produit
// ─────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  await requireAdmin();

  validateVariants(input.colors);

  const dup = await prisma.product.findFirst({
    where: { reference: input.reference.trim().toUpperCase(), NOT: { id } },
    select: { id: true },
  });
  if (dup) throw new Error("Cette référence est déjà utilisée par un autre produit.");

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

  await prisma.$transaction(async (tx) => {
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
        subCategories: { set: input.subCategoryIds.map((id) => ({ id })) },
        dimensionLength:       input.dimensionLength,
        dimensionWidth:        input.dimensionWidth,
        dimensionHeight:       input.dimensionHeight,
        dimensionDiameter:     input.dimensionDiameter,
        dimensionCircumference: input.dimensionCircumference,
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
      select: { id: true },
    });
    const existingIds = existingVariants.map((v) => v.id);

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
    for (const colorInput of input.colors) {
      if (colorInput.dbId) {
        // Update existing
        await tx.productColor.update({
          where: { id: colorInput.dbId },
          data: {
            colorId:       colorInput.colorId,
            unitPrice:     colorInput.unitPrice,
            weight:        colorInput.weight,
            stock:         colorInput.stock,
            isPrimary:     colorInput.isPrimary,
            saleType:      colorInput.saleType,
            packQuantity:  colorInput.packQuantity,
            size:          colorInput.size,
            discountType:  colorInput.discountType,
            discountValue: colorInput.discountValue,
          },
        });
      } else {
        // Create new variant
        await tx.productColor.create({
          data: {
            productId:     id,
            colorId:       colorInput.colorId,
            unitPrice:     colorInput.unitPrice,
            weight:        colorInput.weight,
            stock:         colorInput.stock,
            isPrimary:     colorInput.isPrimary,
            saleType:      colorInput.saleType,
            packQuantity:  colorInput.packQuantity,
            size:          colorInput.size,
            discountType:  colorInput.discountType,
            discountValue: colorInput.discountValue,
          },
        });
      }
    }

    // ── Images: full replace per unique (productId, colorId) group ──────────
    if (input.imagePaths && input.imagePaths.length > 0) {
      // Collect unique colorIds from the submitted image groups
      const colorIdsWithImages = [...new Set(input.imagePaths.map((g) => g.colorId))];

      // Delete existing images for these colorIds
      await tx.productColorImage.deleteMany({
        where: { productId: id, colorId: { in: colorIdsWithImages } },
      });

      // Insert new images
      const imageData: { productId: string; colorId: string; path: string; order: number }[] = [];
      const seenColorIds = new Set<string>();
      for (const group of input.imagePaths) {
        if (seenColorIds.has(group.colorId)) continue;
        seenColorIds.add(group.colorId);
        group.paths.forEach((path, order) => {
          imageData.push({ productId: id, colorId: group.colorId, path, order });
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
  });

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
    // Aucune traduction fournie : invalider le cache pour forcer une re-traduction auto
    await invalidateProductTranslations(id);
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${id}/modifier`);
  revalidatePath(`/produits/${id}`);
}

// ─────────────────────────────────────────────
// Supprimer un produit
// ─────────────────────────────────────────────

export async function deleteProduct(id: string) {
  await requireAdmin();
  await prisma.product.delete({ where: { id } });
  revalidatePath("/admin/produits");
  redirect("/admin/produits");
}

// ─────────────────────────────────────────────
// Actions en masse
// ─────────────────────────────────────────────

export async function bulkUpdateProductStatus(
  productIds: string[],
  status: "ONLINE" | "OFFLINE"
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

  // Check images exist
  const imageCountMap = new Map<string, number>();
  if (status === "ONLINE") {
    const imageCounts = await prisma.productColorImage.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds } },
      _count: { id: true },
    });
    for (const ic of imageCounts) imageCountMap.set(ic.productId, ic._count.id);
  }

  const success: string[] = [];
  const errors: { id: string; reference: string; reason: string }[] = [];

  for (const product of products) {
    if (status === "ONLINE") {
      const reasons: string[] = [];
      if (product.colors.length === 0) reasons.push("aucune variante");
      if ((imageCountMap.get(product.id) ?? 0) === 0) reasons.push("aucune image");
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
  return { success, errors };
}

export async function bulkDeleteProducts(
  productIds: string[]
): Promise<{ deleted: number }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

  const result = await prisma.product.deleteMany({
    where: { id: { in: productIds } },
  });

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  return { deleted: result.count };
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
  size?: string | null;
  discountType?: "PERCENT" | "AMOUNT" | null;
  discountValue?: number | null;
}

export async function updateVariantQuick(
  variantId: string,
  data: VariantQuickUpdate
): Promise<void> {
  await requireAdmin();

  const variant = await prisma.productColor.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });
  if (!variant) throw new Error("Variante introuvable.");

  await prisma.productColor.update({
    where: { id: variantId },
    data,
  });

  revalidatePath("/admin/produits");
  revalidatePath(`/produits/${variant.productId}`);
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

  // Get distinct productIds for revalidation
  const variants = await prisma.productColor.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, productId: true },
  });

  if (variants.length === 0) throw new Error("Aucune variante trouvée.");

  await prisma.productColor.updateMany({
    where: { id: { in: variantIds } },
    data,
  });

  const productIds = [...new Set(variants.map((v) => v.productId))];
  revalidatePath("/admin/produits");
  for (const pid of productIds) {
    revalidatePath(`/produits/${pid}`);
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
  revalidatePath("/admin/mots-cles");
  return tag;
}

export async function deleteTag(id: string) {
  await requireAdmin();
  await prisma.tag.delete({ where: { id } });
  revalidatePath("/admin/mots-cles");
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

  revalidatePath("/admin/mots-cles");
  revalidatePath("/produits");
}

// ─────────────────────────────────────────────
// Rafraîchir la date de création (pour réapparaître en "Nouveauté")
// ─────────────────────────────────────────────

export async function refreshProduct(productId: string): Promise<void> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw new Error("Produit introuvable.");

  await prisma.product.update({
    where: { id: productId },
    data: { createdAt: new Date() },
  });

  revalidatePath("/admin/produits");
  revalidatePath(`/produits/${productId}`);
  revalidatePath("/produits");
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

  revalidatePath("/admin/mots-cles");
  revalidatePath("/produits");
}
