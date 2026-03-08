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
  stock: number;
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
}

export interface ColorInput {
  colorId: string;
  unitPrice: number;
  weight: number;
  isPrimary: boolean;
  saleOptions: SaleOptionInput[];
  imagePaths: string[];
}

export interface ProductInput {
  reference: string;
  name: string;
  description: string;
  composition: string;
  categoryId: string;
  subCategoryId: string | null;
  colors: ColorInput[];
}

// ─────────────────────────────────────────────
// Créer un produit
// ─────────────────────────────────────────────

export async function createProduct(input: ProductInput): Promise<{ id: string }> {
  await requireAdmin();

  const existing = await prisma.product.findUnique({ where: { reference: input.reference } });
  if (existing) throw new Error("Cette référence existe déjà.");

  const product = await prisma.product.create({
    data: {
      reference:     input.reference.trim().toUpperCase(),
      name:          input.name.trim(),
      description:   input.description.trim(),
      composition:   input.composition.trim(),
      categoryId:    input.categoryId,
      subCategoryId: input.subCategoryId || null,
      colors: {
        create: input.colors.map((color, idx) => ({
          colorId:    color.colorId,
          unitPrice:  color.unitPrice,
          weight:     color.weight,
          isPrimary:  color.isPrimary || idx === 0,
          saleOptions: {
            create: color.saleOptions.map((opt) => ({
              saleType:      opt.saleType,
              packQuantity:  opt.packQuantity,
              stock:         opt.stock,
              discountType:  opt.discountType,
              discountValue: opt.discountValue,
            })),
          },
          images: {
            create: color.imagePaths.map((path, index) => ({ path, order: index })),
          },
        })),
      },
    },
  });

  revalidatePath("/admin/produits");
  return { id: product.id };
}

// ─────────────────────────────────────────────
// Modifier un produit
// ─────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  await requireAdmin();

  // Vérifier unicité référence (hors ce produit)
  const dup = await prisma.product.findFirst({
    where: { reference: input.reference.trim().toUpperCase(), NOT: { id } },
  });
  if (dup) throw new Error("Cette référence est déjà utilisée par un autre produit.");

  await prisma.$transaction(async (tx) => {
    // Mise à jour des champs de base
    await tx.product.update({
      where: { id },
      data: {
        reference:     input.reference.trim().toUpperCase(),
        name:          input.name.trim(),
        description:   input.description.trim(),
        composition:   input.composition.trim(),
        categoryId:    input.categoryId,
        subCategoryId: input.subCategoryId || null,
      },
    });

    // Couleurs existantes
    const existingColors = await tx.productColor.findMany({
      where: { productId: id },
      select: { id: true, colorId: true },
    });

    const newColorIds = input.colors.map((c) => c.colorId);

    // Supprimer les couleurs retirées (cascade supprime options + images)
    const toDelete = existingColors.filter((ec) => !newColorIds.includes(ec.colorId));
    for (const del of toDelete) {
      await tx.productColor.delete({ where: { id: del.id } });
    }

    // Créer ou mettre à jour chaque couleur
    for (const colorInput of input.colors) {
      const existing = existingColors.find((ec) => ec.colorId === colorInput.colorId);

      if (existing) {
        // Mise à jour unitPrice + weight + isPrimary
        await tx.productColor.update({
          where: { id: existing.id },
          data: { unitPrice: colorInput.unitPrice, weight: colorInput.weight, isPrimary: colorInput.isPrimary },
        });
        // Reconstruction des options de vente
        await tx.saleOption.deleteMany({ where: { colorId: existing.id } });
        await tx.saleOption.createMany({
          data: colorInput.saleOptions.map((opt) => ({
            colorId:       existing.id,
            saleType:      opt.saleType,
            packQuantity:  opt.packQuantity,
            stock:         opt.stock,
            discountType:  opt.discountType,
            discountValue: opt.discountValue,
          })),
        });
        // Reconstruction des images (gère le réordonnancement)
        await tx.productImage.deleteMany({ where: { colorId: existing.id } });
        await tx.productImage.createMany({
          data: colorInput.imagePaths.map((path, order) => ({
            colorId: existing.id, path, order,
          })),
        });
      } else {
        // Nouvelle couleur ajoutée
        await tx.productColor.create({
          data: {
            productId: id,
            colorId:   colorInput.colorId,
            unitPrice: colorInput.unitPrice,
            weight:    colorInput.weight,
            isPrimary: colorInput.isPrimary,
            saleOptions: {
              create: colorInput.saleOptions.map((opt) => ({
                saleType:      opt.saleType,
                packQuantity:  opt.packQuantity,
                stock:         opt.stock,
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
  });

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${id}/modifier`);
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
