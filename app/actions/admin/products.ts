"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SaleOptionInput {
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  size: string | null;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

export interface ColorInput {
  colorId: string;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleOptions: SaleOptionInput[];
  imagePaths: string[];
}

export interface CompositionInput {
  compositionId: string;
  percentage: number;
}

export interface ProductInput {
  reference: string;
  name: string;
  description: string;
  categoryId: string;
  subCategoryIds: string[];
  colors: ColorInput[];
  compositions: CompositionInput[];
  similarProductIds: string[];
  tagNames: string[];
  isBestSeller: boolean;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
}

// ─────────────────────────────────────────────
// Créer un produit
// ─────────────────────────────────────────────

export async function createProduct(input: ProductInput): Promise<{ id: string }> {
  await requireAdmin();

  const existing = await prisma.product.findUnique({ where: { reference: input.reference } });
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
      subCategories: { connect: input.subCategoryIds.map((id) => ({ id })) },
      tags:          { create: tagRecords.map((t) => ({ tagId: t.id })) },
      dimensionLength:       input.dimensionLength,
      dimensionWidth:        input.dimensionWidth,
      dimensionHeight:       input.dimensionHeight,
      dimensionDiameter:     input.dimensionDiameter,
      dimensionCircumference: input.dimensionCircumference,
      colors: {
        create: input.colors.map((color, idx) => ({
          colorId:   color.colorId,
          unitPrice: color.unitPrice,
          weight:    color.weight,
          stock:     color.stock,
          isPrimary: color.isPrimary || idx === 0,
          saleOptions: {
            create: color.saleOptions.map((opt) => ({
              saleType:      opt.saleType,
              packQuantity:  opt.packQuantity,
              size:          opt.size,
              discountType:  opt.discountType,
              discountValue: opt.discountValue,
            })),
          },
          images: {
            create: color.imagePaths.map((path, index) => ({ path, order: index })),
          },
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

  revalidatePath("/admin/produits");
  return { id: product.id };
}

// ─────────────────────────────────────────────
// Modifier un produit
// ─────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  await requireAdmin();

  const dup = await prisma.product.findFirst({
    where: { reference: input.reference.trim().toUpperCase(), NOT: { id } },
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

    // Couleurs existantes
    const existingColors = await tx.productColor.findMany({
      where: { productId: id },
      select: { id: true, colorId: true },
    });

    const newColorIds = input.colors.map((c) => c.colorId);

    // Supprimer couleurs retirées (cascade supprime options + images)
    const toDelete = existingColors.filter((ec) => !newColorIds.includes(ec.colorId));
    for (const del of toDelete) {
      await tx.productColor.delete({ where: { id: del.id } });
    }

    // Créer ou mettre à jour chaque couleur
    for (const colorInput of input.colors) {
      const existing = existingColors.find((ec) => ec.colorId === colorInput.colorId);

      if (existing) {
        await tx.productColor.update({
          where: { id: existing.id },
          data: {
            unitPrice: colorInput.unitPrice,
            weight:    colorInput.weight,
            stock:     colorInput.stock,
            isPrimary: colorInput.isPrimary,
          },
        });
        await tx.saleOption.deleteMany({ where: { colorId: existing.id } });
        await tx.saleOption.createMany({
          data: colorInput.saleOptions.map((opt) => ({
            colorId:       existing.id,
            saleType:      opt.saleType,
            packQuantity:  opt.packQuantity,
            size:          opt.size,
            discountType:  opt.discountType,
            discountValue: opt.discountValue,
          })),
        });
        await tx.productImage.deleteMany({ where: { colorId: existing.id } });
        await tx.productImage.createMany({
          data: colorInput.imagePaths.map((path, order) => ({ colorId: existing.id, path, order })),
        });
      } else {
        await tx.productColor.create({
          data: {
            productId: id,
            colorId:   colorInput.colorId,
            unitPrice: colorInput.unitPrice,
            weight:    colorInput.weight,
            stock:     colorInput.stock,
            isPrimary: colorInput.isPrimary,
            saleOptions: {
              create: colorInput.saleOptions.map((opt) => ({
                saleType:      opt.saleType,
                packQuantity:  opt.packQuantity,
                size:          opt.size,
                discountType:  opt.discountType,
                discountValue: opt.discountValue,
              })),
            },
            images: {
              create: colorInput.imagePaths.map((path, order) => ({ path, order })),
            },
          },
        });
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
// Tags
// ─────────────────────────────────────────────

export async function getAllTags() {
  return prisma.tag.findMany({ orderBy: { name: "asc" } });
}
