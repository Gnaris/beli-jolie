"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateProductTranslations } from "@/lib/translate";
import { notifyRestockAlerts } from "@/lib/notifications";
import { emitProductEvent } from "@/lib/product-events";
import { pfsUpdateStatus, type PfsStatus } from "@/lib/pfs-api-write";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SizeEntryInput {
  sizeId: string;
  quantity: number;
  pricePerUnit?: number; // PACK only — prix par unité pour cette taille
}

export interface PackColorLineInput {
  colorIds: string[];   // Ordered color IDs for this line
  position: number;
}

export interface ColorInput {
  dbId?: string;         // ProductColor.id when editing existing (undefined for new)
  colorId: string | null; // Couleur principale (UNIT) — null pour PACK multi-couleur
  subColorIds?: string[]; // IDs de sous-couleurs optionnelles (ex: Doré → [Rouge, Noir])
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizeEntries: SizeEntryInput[];         // Tailles avec quantités
  packColorLines: PackColorLineInput[];  // PACK: lignes de couleur
  discountType: "PERCENT" | "AMOUNT" | null;
  discountValue: number | null;
  pfsColorRef?: string | null; // Override PFS color for multi-color variants
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
  imagePaths?: { colorId: string; subColorIds?: string[]; variantDbId?: string; paths: string[]; orders?: number[] }[]; // images grouped per variant
  compositions: CompositionInput[];
  similarProductIds: string[];
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
  isIncomplete?: boolean;
}

// ─────────────────────────────────────────────
// Server-side variant validation
// ─────────────────────────────────────────────

/** Build a group key from ColorInput (colorId + ordered sub-color IDs). Order matters. */
function colorInputGroupKey(c: ColorInput): string {
  if (!c.colorId) return "";
  if (!c.subColorIds || c.subColorIds.length === 0) return c.colorId;
  return `${c.colorId}::${c.subColorIds.join(",")}`;
}

function validateVariants(colors: ColorInput[]): void {
  // No two UNIT variants with same color group (colorId + ordered sub-colors)
  const unitByColor = new Map<string, boolean>();
  for (const c of colors) {
    if (c.saleType === "UNIT") {
      if (!c.colorId) throw new Error("Une variante UNIT doit avoir une couleur.");
      const gk = colorInputGroupKey(c);
      if (unitByColor.has(gk)) {
        throw new Error("Une couleur ne peut avoir qu'une variante à l'unité.");
      }
      unitByColor.set(gk, true);
    }
  }

  // PACK variants: must have exactly one color line
  for (const c of colors) {
    if (c.saleType === "PACK") {
      if (c.packColorLines.length !== 1) {
        throw new Error("Un paquet doit avoir exactement une ligne de couleur.");
      }
    }
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
  }

  const existing = await prisma.product.findUnique({ where: { reference: input.reference }, select: { id: true } });
  if (existing) throw new Error("Cette référence existe déjà.");

  // Vérifier que la catégorie existe
  const categoryExists = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!categoryExists) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");

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
      compositions: {
        create: input.compositions.map((c) => ({
          compositionId: c.compositionId,
          percentage:    c.percentage,
        })),
      },
    },
  });

  // Create variants one by one to guarantee order + inline sub-colors
  const createdVariants: { id: string; colorId: string | null }[] = [];
  for (let i = 0; i < input.colors.length; i++) {
    const color = input.colors[i];
    const variant = await prisma.productColor.create({
      data: {
        productId:     product.id,
        colorId:       color.colorId || null,
        unitPrice:     color.unitPrice,
        weight:        color.weight,
        stock:         color.stock,
        isPrimary:     color.isPrimary || i === 0,
        saleType:      color.saleType,
        packQuantity:  color.packQuantity,
        discountType:  color.discountType,
        discountValue: color.discountValue,
        pfsColorRef:   color.pfsColorRef || null,
        subColors: color.subColorIds && color.subColorIds.length > 0
          ? { create: color.subColorIds.map((scId, pos) => ({ colorId: scId, position: pos })) }
          : undefined,
      },
      select: { id: true, colorId: true },
    });
    createdVariants.push(variant);

    // Create variant sizes
    if (color.sizeEntries && color.sizeEntries.length > 0) {
      await prisma.variantSize.createMany({
        data: color.sizeEntries.map((se) => ({
          productColorId: variant.id,
          sizeId: se.sizeId,
          quantity: se.quantity,
          ...(se.pricePerUnit != null ? { pricePerUnit: se.pricePerUnit } : {}),
        })),
      });
    }

    // Create pack color lines for PACK variants
    if (color.saleType === "PACK" && color.packColorLines.length > 0) {
      for (const pcl of color.packColorLines) {
        const line = await prisma.packColorLine.create({
          data: {
            productColorId: variant.id,
            position: pcl.position,
          },
        });
        if (pcl.colorIds.length > 0) {
          await prisma.packColorLineColor.createMany({
            data: pcl.colorIds.map((cId, pos) => ({
              packColorLineId: line.id,
              colorId: cId,
              position: pos,
            })),
          });
        }
      }
    }
  }

  // Images: create ProductColorImage entries linked to specific ProductColor variant
  if (input.imagePaths && input.imagePaths.length > 0) {
    const imageData: { productId: string; colorId: string; productColorId: string; path: string; order: number }[] = [];
    const usedVariantIds = new Set<string>();
    for (const group of input.imagePaths) {
      if (group.paths.length === 0 || !group.colorId) continue;
      // Match variant by colorId + ordered subColorIds (order matters)
      const groupSubIds = group.subColorIds ?? [];
      let matched: { id: string; colorId: string | null } | undefined;
      for (let i = 0; i < input.colors.length; i++) {
        const cv = createdVariants[i];
        if (!cv || usedVariantIds.has(cv.id)) continue;
        if (cv.colorId !== group.colorId) continue;
        const inputSubs = input.colors[i].subColorIds ?? [];
        if (inputSubs.length !== groupSubIds.length) continue;
        if (inputSubs.every((s, j) => s === groupSubIds[j])) {
          matched = cv;
          break;
        }
      }
      if (!matched) continue;
      usedVariantIds.add(matched.id);
      group.paths.forEach((path, idx) => {
        const order = group.orders?.[idx] ?? idx;
        imageData.push({ productId: product.id, colorId: group.colorId, productColorId: matched!.id, path, order });
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
  revalidateTag("products", "default");
  revalidateTag("tags", "default");

  if (input.status === "ONLINE") {
    emitProductEvent({ type: "PRODUCT_ONLINE", productId: product.id });
  }

  return { id: product.id };
}

// ─────────────────────────────────────────────
// Modifier un produit
// ─────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<void> {
  await requireAdmin();

  // ── Defensive validation: DB non-nullable constraints ────────
  if (!input.reference?.trim()) throw new Error("La référence est requise.");
  if (!input.name?.trim()) throw new Error("Le nom est requis.");
  if (!input.categoryId) throw new Error("La catégorie est requise.");

  // Skip strict validation for incomplete products (variants, description, etc.)
  if (!input.isIncomplete) {
    if (!input.description?.trim()) throw new Error("La description est requise.");
    if (!input.colors || input.colors.length === 0) {
      throw new Error("Au moins une variante est requise.");
    }
    validateVariants(input.colors);
  }

  const oldProduct = await prisma.product.findUnique({
    where: { id },
    select: { status: true, isBestSeller: true },
  });

  const dup = await prisma.product.findFirst({
    where: { reference: input.reference.trim().toUpperCase(), NOT: { id } },
    select: { id: true },
  });
  if (dup) throw new Error("Cette référence est déjà utilisée par un autre produit.");

  // Vérifier que la catégorie existe
  const categoryExists = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!categoryExists) throw new Error("La catégorie sélectionnée n'existe plus. Rechargez la page.");

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

  const oldStockMap = await prisma.$transaction(async (tx) => {
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
      select: { id: true, stock: true },
    });
    const existingIds = existingVariants.map((v) => v.id);
    const oldStockMap = new Map(existingVariants.map((v) => [v.id, v.stock]));

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
    const variantIdMap: { colorInput: ColorInput; variantId: string }[] = [];
    for (const colorInput of input.colors) {
      if (colorInput.dbId) {
        // Update existing
        await tx.productColor.update({
          where: { id: colorInput.dbId },
          data: {
            colorId:       colorInput.colorId || null,
            unitPrice:     colorInput.unitPrice,
            weight:        colorInput.weight,
            stock:         colorInput.stock,
            isPrimary:     colorInput.isPrimary,
            saleType:      colorInput.saleType,
            packQuantity:  colorInput.packQuantity,
            discountType:  colorInput.discountType,
            discountValue: colorInput.discountValue,
            pfsColorRef:   colorInput.pfsColorRef || null,
          },
        });
        variantIdMap.push({ colorInput, variantId: colorInput.dbId });
      } else {
        // Create new variant
        const created = await tx.productColor.create({
          data: {
            productId:     id,
            colorId:       colorInput.colorId || null,
            unitPrice:     colorInput.unitPrice,
            weight:        colorInput.weight,
            stock:         colorInput.stock,
            isPrimary:     colorInput.isPrimary,
            saleType:      colorInput.saleType,
            packQuantity:  colorInput.packQuantity,
            discountType:  colorInput.discountType,
            discountValue: colorInput.discountValue,
            pfsColorRef:   colorInput.pfsColorRef || null,
          },
        });
        variantIdMap.push({ colorInput, variantId: created.id });
      }
    }

    // Sub-colors: full replace for all variants
    const allVariantIds = variantIdMap.map((v) => v.variantId);
    if (allVariantIds.length > 0) {
      await tx.productColorSubColor.deleteMany({
        where: { productColorId: { in: allVariantIds } },
      });
    }
    const subColorData: { productColorId: string; colorId: string; position: number }[] = [];
    for (const { colorInput, variantId } of variantIdMap) {
      if (colorInput.subColorIds && colorInput.subColorIds.length > 0) {
        for (let pos = 0; pos < colorInput.subColorIds.length; pos++) {
          subColorData.push({ productColorId: variantId, colorId: colorInput.subColorIds[pos], position: pos });
        }
      }
    }
    if (subColorData.length > 0) {
      await tx.productColorSubColor.createMany({ data: subColorData, skipDuplicates: true });
    }

    // ── Variant sizes: full replace for all variants ──────────
    if (allVariantIds.length > 0) {
      await tx.variantSize.deleteMany({
        where: { productColorId: { in: allVariantIds } },
      });
    }
    const variantSizeData: { productColorId: string; sizeId: string; quantity: number; pricePerUnit?: number }[] = [];
    for (const { colorInput, variantId } of variantIdMap) {
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

    // ── Pack color lines: full replace for all PACK variants ──────────
    if (allVariantIds.length > 0) {
      await tx.packColorLine.deleteMany({
        where: { productColorId: { in: allVariantIds } },
      });
    }
    for (const { colorInput, variantId } of variantIdMap) {
      if (colorInput.saleType === "PACK" && colorInput.packColorLines.length > 0) {
        for (const pcl of colorInput.packColorLines) {
          const line = await tx.packColorLine.create({
            data: { productColorId: variantId, position: pcl.position },
          });
          if (pcl.colorIds.length > 0) {
            await tx.packColorLineColor.createMany({
              data: pcl.colorIds.map((cId, pos) => ({
                packColorLineId: line.id,
                colorId: cId,
                position: pos,
              })),
            });
          }
        }
      }
    }

    // ── Images: full replace linked to specific ProductColor variant ──────────
    if (input.imagePaths && input.imagePaths.length > 0) {
      // Delete all existing images for this product then recreate
      await tx.productColorImage.deleteMany({
        where: { productId: id },
      });

      // Fetch current variants + their sub-colors
      const currentVariants = await tx.productColor.findMany({
        where: { productId: id },
        select: { id: true, colorId: true },
      });
      const currentSubColors = await tx.productColorSubColor.findMany({
        where: { productColorId: { in: currentVariants.map((v) => v.id) } },
        select: { productColorId: true, colorId: true },
        orderBy: { position: "asc" },
      });
      const subColorsByVariant = new Map<string, string[]>();
      for (const sc of currentSubColors) {
        const arr = subColorsByVariant.get(sc.productColorId) ?? [];
        arr.push(sc.colorId);
        subColorsByVariant.set(sc.productColorId, arr);
      }

      const imageData: { productId: string; colorId: string; productColorId: string; path: string; order: number }[] = [];
      const usedVariantIds = new Set<string>();
      for (const group of input.imagePaths) {
        if (group.paths.length === 0) continue;
        // Try direct match by variantDbId first
        let variant = group.variantDbId
          ? currentVariants.find((v) => v.id === group.variantDbId)
          : undefined;
        // Fallback: match by colorId + ordered subColorIds (order matters)
        if (!variant) {
          const groupSubIds = group.subColorIds ?? [];
          variant = currentVariants.find((v) => {
            if (usedVariantIds.has(v.id)) return false;
            if (v.colorId !== group.colorId) return false;
            const vSubs = subColorsByVariant.get(v.id) ?? [];
            if (vSubs.length !== groupSubIds.length) return false;
            return vSubs.every((s, i) => s === groupSubIds[i]);
          });
        }
        if (!variant) continue;
        usedVariantIds.add(variant.id);
        group.paths.forEach((path, idx) => {
          const order = group.orders?.[idx] ?? idx;
          imageData.push({ productId: id, colorId: group.colorId, productColorId: variant!.id, path, order });
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

    return oldStockMap;
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

  // Restock alerts: check if any variant went from stock=0 to stock>0
  for (const colorInput of input.colors) {
    if (colorInput.dbId) {
      const oldStock = oldStockMap.get(colorInput.dbId) ?? 0;
      if (oldStock === 0 && colorInput.stock > 0) {
        notifyRestockAlerts(colorInput.dbId).catch(() => {});
      }
    }
  }

  revalidatePath("/admin/produits");
  revalidatePath(`/admin/produits/${id}/modifier`);
  revalidatePath(`/produits/${id}`);
  revalidateTag("products", "default");
  revalidateTag("tags", "default");

  // Emit real-time events
  if (oldProduct) {
    if (oldProduct.status !== "ONLINE" && input.status === "ONLINE") {
      emitProductEvent({ type: "PRODUCT_ONLINE", productId: id });
    } else if (oldProduct.status === "ONLINE" && input.status !== "ONLINE") {
      emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
    } else if (oldProduct.isBestSeller !== input.isBestSeller) {
      emitProductEvent({ type: "BESTSELLER_CHANGED", productId: id });
    } else if (input.status === "ONLINE") {
      emitProductEvent({ type: "PRODUCT_UPDATED", productId: id });
    }
  }


}

// ─────────────────────────────────────────────
// Supprimer un produit (bloqué si commandes existent)
// ─────────────────────────────────────────────

export async function deleteProduct(id: string) {
  await requireAdmin();

  // Check if product has any order items (legal: 10 years retention in France)
  const product = await prisma.product.findUnique({ where: { id }, select: { reference: true } });
  if (!product) throw new Error("Produit introuvable.");

  const orderCount = await prisma.orderItem.count({ where: { productRef: product.reference } });
  if (orderCount > 0) {
    throw new Error(
      `Ce produit apparaît dans ${orderCount} commande(s). Il ne peut pas être supprimé (obligation légale 10 ans). Utilisez l'archivage à la place.`
    );
  }

  await prisma.product.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("products", "default");
  redirect("/admin/produits");
}

// ─────────────────────────────────────────────
// Archiver / Désarchiver un produit
// ─────────────────────────────────────────────

export async function archiveProduct(id: string) {
  await requireAdmin();
  const product = await prisma.product.findUnique({ where: { id }, select: { pfsProductId: true } });
  await prisma.product.update({ where: { id }, data: { status: "ARCHIVED" } });
  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
  if (product?.pfsProductId) {
    pfsUpdateStatus([{ id: product.pfsProductId, status: "ARCHIVED" }]).catch((err) => {
      console.warn(`[PFS] Archive status sync failed for product ${id}:`, err);
    });
  }
}

export async function unarchiveProduct(id: string) {
  await requireAdmin();
  const product = await prisma.product.findUnique({ where: { id }, select: { pfsProductId: true } });
  await prisma.product.update({ where: { id }, data: { status: "OFFLINE" } });
  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  emitProductEvent({ type: "PRODUCT_OFFLINE", productId: id });
  if (product?.pfsProductId) {
    pfsUpdateStatus([{ id: product.pfsProductId, status: "DRAFT" }]).catch((err) => {
      console.warn(`[PFS] Unarchive status sync failed for product ${id}:`, err);
    });
  }
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
      if (product.isIncomplete) reasons.push("produit incomplet");
      if (product.colors.length === 0) reasons.push("aucune variante");
      if (product.colors.length > 0 && product.colors.every(c => c.stock === 0)) reasons.push("aucun stock");
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
  revalidateTag("products", "default");

  // Emit SSE events for each updated product
  for (const pid of success) {
    if (status === "ONLINE") {
      emitProductEvent({ type: "PRODUCT_ONLINE", productId: pid });
    } else {
      emitProductEvent({ type: "PRODUCT_OFFLINE", productId: pid });
    }
  }

  // Sync status to PFS for linked products
  const pfsStatusMap: Record<string, PfsStatus> = {
    ONLINE: "READY_FOR_SALE",
    OFFLINE: "DRAFT",
    ARCHIVED: "ARCHIVED",
  };
  const pfsStatus = pfsStatusMap[status];
  if (pfsStatus) {
    const pfsUpdates = products
      .filter((p) => success.includes(p.id) && p.pfsProductId && p.status !== status)
      .map((p) => ({ id: p.pfsProductId!, status: pfsStatus }));
    if (pfsUpdates.length > 0) {
      pfsUpdateStatus(pfsUpdates).catch((err) => {
        console.warn(`[PFS] Bulk status sync failed:`, err);
      });
    }
  }

  return { success, errors };
}

export async function bulkDeleteProducts(
  productIds: string[]
): Promise<{ deleted: number; protected: { id: string; reference: string; orderCount: number }[] }> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

  // Find products with orders — cannot be deleted
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

  const protectedRefs = new Set(orderCounts.map((oc) => oc.productRef));
  const protectedProducts = orderCounts.map((oc) => ({
    id: refToId.get(oc.productRef) ?? "",
    reference: oc.productRef,
    orderCount: oc._count.id,
  }));

  const deletableIds = productIds.filter((pid) => {
    const prod = products.find((p) => p.id === pid);
    return prod && !protectedRefs.has(prod.reference);
  });

  let deleted = 0;
  if (deletableIds.length > 0) {
    const result = await prisma.product.deleteMany({
      where: { id: { in: deletableIds } },
    });
    deleted = result.count;
  }

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
  revalidateTag("products", "default");
  return { deleted, protected: protectedProducts };
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
    select: { id: true, status: true },
  });
  if (!product) throw new Error("Produit introuvable.");

  await prisma.product.update({
    where: { id: productId },
    data: { createdAt: new Date() },
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

  revalidatePath("/admin/mots-cles");
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
