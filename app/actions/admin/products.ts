"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { invalidateProductTranslations } from "@/lib/translate";
import { notifyRestockAlerts } from "@/lib/notifications";
import { emitProductEvent, type MarketplaceSyncProgress } from "@/lib/product-events";
import { pfsUpdateStatus, pfsDeleteProduct, type PfsStatus } from "@/lib/pfs-api-write";
import { triggerPfsSync } from "@/lib/pfs-reverse-sync";
import { autoTranslateProduct, autoTranslateTag } from "@/lib/auto-translate";
import { generateSku } from "@/lib/sku";

/**
 * Fire-and-forget: push product to Ankorstore.
 * If forceCreate=false (default), only syncs products already linked (ankorsProductId exists).
 * If forceCreate=true, always pushes (used on product creation).
 *
 * Uses pushProductToAnkorstoreInternal (no auth check) because fire-and-forget
 * runs outside the request context where getServerSession() is unavailable.
 */
function emitAnkors(productId: string, p: Omit<MarketplaceSyncProgress, "marketplace">) {
  emitProductEvent({ type: "MARKETPLACE_SYNC", productId, marketplaceSync: { marketplace: "ankorstore", ...p } });
}

function triggerAnkorstoreSync(productId: string, forceCreate = false, skipRevalidation = false) {
  logger.info("[Ankorstore] triggerAnkorstoreSync called", { productId, forceCreate });
  emitAnkors(productId, { step: "Vérification de la configuration...", progress: 0, status: "in_progress" });

  // Check if Ankorstore is enabled, then push
  import("@/lib/cached-data").then(({ getCachedSiteConfig }) =>
    getCachedSiteConfig("ankors_enabled").then((cfg) => {
      logger.info("[Ankorstore] ankors_enabled config", { value: cfg?.value });
      if (cfg?.value !== "true") {
        emitAnkors(productId, { step: "Ankorstore désactivé", progress: 100, status: "success" });
        return;
      }

      if (forceCreate) {
        // New product → always push (auto-detects import vs update)
        logger.info("[Ankorstore] Importing pushProductToAnkorstoreInternal", { productId });
        emitAnkors(productId, { step: "Préparation du produit...", progress: 10, status: "in_progress" });
        import("@/app/actions/admin/ankorstore").then(({ pushProductToAnkorstoreInternal }) => {
          logger.info("[Ankorstore] Calling pushProductToAnkorstoreInternal", { productId });
          emitAnkors(productId, { step: "Envoi vers Ankorstore...", progress: 30, status: "in_progress" });
          return pushProductToAnkorstoreInternal(productId, undefined, { skipRevalidation }).then((result) => {
            logger.info("[Ankorstore] Auto-sync result", { productId, result });
            if (result.success) {
              emitAnkors(productId, { step: "Publication terminée", progress: 100, status: "success" });
            } else {
              emitAnkors(productId, { step: "Erreur de publication", progress: 100, status: "error", error: result.error });
            }
          }).catch(async (err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn("[Ankorstore] Auto-sync failed", { productId, error: errMsg });
            emitAnkors(productId, { step: "Erreur de publication", progress: 100, status: "error", error: errMsg });
            // Persist error
            await prisma.product.update({
              where: { id: productId },
              data: { ankorsSyncStatus: "failed", ankorsSyncError: errMsg.slice(0, 5000) },
            }).catch(() => {});
          });
        });
        return;
      }

      // Existing product → only push if already linked
      prisma.product.findUnique({
        where: { id: productId },
        select: { ankorsProductId: true, status: true },
      }).then(async (prod) => {
        if (!prod?.ankorsProductId) {
          emitAnkors(productId, { step: "Produit non lié", progress: 100, status: "success" });
          return;
        }

        // OFFLINE → push update with all stocks at 0 (Ankorstore has no disable endpoint)
        if (prod.status === "OFFLINE") {
          emitAnkors(productId, { step: "Mise en rupture sur Ankorstore...", progress: 30, status: "in_progress" });
          const { pushProductToAnkorstoreInternal } = await import("@/app/actions/admin/ankorstore");
          const result = await pushProductToAnkorstoreInternal(productId, undefined, {
            skipRevalidation, zeroStock: true,
          });
          if (result.success) {
            emitAnkors(productId, { step: "Stock mis à 0 sur Ankorstore", progress: 100, status: "success" });
          } else {
            emitAnkors(productId, { step: "Erreur mise en rupture", progress: 100, status: "error", error: result.error });
          }
          return;
        }

        emitAnkors(productId, { step: "Envoi vers Ankorstore...", progress: 30, status: "in_progress" });
        const { pushProductToAnkorstoreInternal } = await import("@/app/actions/admin/ankorstore");
        const result = await pushProductToAnkorstoreInternal(productId, undefined, { skipRevalidation });
        if (result.success) {
          emitAnkors(productId, { step: "Publication terminée", progress: 100, status: "success" });
        } else {
          emitAnkors(productId, { step: "Erreur de publication", progress: 100, status: "error", error: result.error });
        }
      }).catch(async (err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error("[Ankorstore] Product sync failed", { productId, error: errMsg });
        emitAnkors(productId, { step: "Erreur de synchronisation", progress: 100, status: "error", error: errMsg });
        await prisma.product.update({
          where: { id: productId },
          data: { ankorsSyncStatus: "failed", ankorsSyncError: errMsg.slice(0, 5000) },
        }).catch(() => {});
      });
    })
  ).catch(async (err) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("[Ankorstore] triggerAnkorstoreSync chain failed", { productId, error: errMsg });
    emitAnkors(productId, { step: "Erreur de publication", progress: 100, status: "error", error: errMsg });
    // Persist error
    await prisma.product.update({
      where: { id: productId },
      data: { ankorsSyncStatus: "failed", ankorsSyncError: errMsg.slice(0, 5000) },
    }).catch(() => {});
  });
}

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
  imagePaths?: { colorId: string; subColorIds?: string[]; variantDbId?: string; variantIndex?: number; paths: string[]; orders?: number[] }[]; // images grouped per variant
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
  isIncomplete?: boolean;
  skipPfsSync?: boolean;
  skipAnkorstoreSync?: boolean;
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

  // PACK variants: must have exactly one color line + packQuantity >= 1
  for (const c of colors) {
    if (c.saleType === "PACK") {
      if (c.packColorLines.length !== 1) {
        throw new Error("Un paquet doit avoir exactement une ligne de couleur.");
      }
      if (c.packQuantity == null || c.packQuantity < 1) {
        throw new Error("Un paquet doit avoir une quantité d'au moins 1.");
      }
    }
  }

  // UNIT variants: max 1 size entry
  for (const c of colors) {
    if (c.saleType === "UNIT" && c.sizeEntries.length > 1) {
      throw new Error("Une variante à l'unité ne peut avoir qu'une seule taille.");
    }
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
      subColors: {
        orderBy: { position: "asc" },
        select: { color: { select: { name: true } } },
      },
      packColorLines: {
        orderBy: { position: "asc" },
        take: 1,
        select: {
          colors: {
            orderBy: { position: "asc" },
            select: { color: { select: { name: true } } },
          },
        },
      },
    },
  });

  const updates: Promise<unknown>[] = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    // Build color names array
    let colorNames: string[];
    if (v.saleType === "UNIT") {
      colorNames = [
        v.color?.name,
        ...v.subColors.map((sc) => sc.color.name),
      ].filter(Boolean) as string[];
    } else {
      // PACK: colors from the single PackColorLine
      const line = v.packColorLines[0];
      colorNames = line
        ? line.colors.map((c) => c.color.name)
        : [];
    }

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
  }

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
      // Fallback: match by colorId + ordered subColorIds (UNIT variants)
      if (!matched && group.colorId) {
        const groupSubIds = group.subColorIds ?? [];
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
      }
      if (!matched) continue;
      usedVariantIds.add(matched.id);
      // For PACK, colorId may be empty — use the first packColorLine color or fallback
      const effectiveColorId = group.colorId
        || input.colors[group.variantIndex ?? -1]?.packColorLines?.[0]?.colorIds?.[0]
        || matched.colorId
        || "";
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

  // Auto-downgrade to OFFLINE if any variant has no image
  let effectiveStatus = input.status;
  if (input.status === "ONLINE" && createdVariants.length > 0) {
    const variantImageCounts = await prisma.productColorImage.groupBy({
      by: ["productColorId"],
      where: { productColorId: { in: createdVariants.map((v) => v.id) } },
      _count: { id: true },
    });
    const variantIdsWithImages = new Set(variantImageCounts.map((v) => v.productColorId));
    const allHaveImages = createdVariants.every((v) => variantIdsWithImages.has(v.id));
    if (!allHaveImages) {
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

  // Fire-and-forget sync to PFS (skip drafts and explicitly skipped)
  if (!input.isIncomplete && !input.skipPfsSync) {
    triggerPfsSync(product.id);
  }

  // Fire-and-forget push to Ankorstore (creates the product with all variants)
  if (!input.isIncomplete && !input.skipAnkorstoreSync) {
    triggerAnkorstoreSync(product.id, true);
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
    select: { status: true, isBestSeller: true, pfsProductId: true },
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

    // ── Assign/update SKUs for all variants ──────────
    await assignVariantSkus(id, input.reference, tx);

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
        let variant: { id: string; colorId: string | null } | undefined;
        // Try direct match by variantDbId first
        variant = group.variantDbId
          ? currentVariants.find((v) => v.id === group.variantDbId)
          : undefined;
        // Try match by variantIndex (reliable for PACK and newly created variants)
        if (!variant && group.variantIndex != null && variantIdMap[group.variantIndex]) {
          const mappedId = variantIdMap[group.variantIndex].variantId;
          variant = currentVariants.find((v) => v.id === mappedId);
        }
        // Fallback: match by colorId + ordered subColorIds (UNIT variants)
        if (!variant && group.colorId) {
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
        // For PACK, colorId may be empty — derive from packColorLines or variant
        const effectiveColorId = group.colorId
          || input.colors[group.variantIndex ?? -1]?.packColorLines?.[0]?.colorIds?.[0]
          || variant.colorId
          || "";
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

    return oldStockMap;
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

  // Auto-downgrade to OFFLINE if any variant has no image
  let effectiveStatus = input.status;
  if (input.status === "ONLINE") {
    const allVariants = await prisma.productColor.findMany({
      where: { productId: id },
      select: { id: true, _count: { select: { images: true } } },
    });
    const allHaveImages = allVariants.length > 0 && allVariants.every((v) => v._count.images > 0);
    if (!allHaveImages) {
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

  // PFS best seller sync (only when the checkbox was actually toggled)
  if (oldProduct?.pfsProductId && oldProduct.isBestSeller !== input.isBestSeller) {
    const starStatus: PfsStatus = input.isBestSeller ? "STAR" : "REMOVE_STAR";
    pfsUpdateStatus([{ id: oldProduct.pfsProductId, status: starStatus }]).catch((err) => {
      logger.warn(`[PFS] Best seller sync failed for product ${id}`, { error: err });
    });
  }

  // Fire-and-forget sync to PFS (skip drafts and explicitly skipped)
  if (!input.isIncomplete && !input.skipPfsSync) {
    triggerPfsSync(id);
  }

  // Fire-and-forget sync to Ankorstore (price, color, variant changes)
  if (!input.isIncomplete && !input.skipAnkorstoreSync) {
    triggerAnkorstoreSync(id);
  }
}

// ─────────────────────────────────────────────
// Toggle Best Seller (lightweight, no full save)
// ─────────────────────────────────────────────

export async function toggleBestSeller(productId: string, isBestSeller: boolean): Promise<{ success: boolean; error?: string }> {
  await requireAdmin();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { isBestSeller: true, pfsProductId: true },
  });
  if (!product) return { success: false, error: "Produit introuvable." };
  if (product.isBestSeller === isBestSeller) return { success: true };

  await prisma.product.update({
    where: { id: productId },
    data: { isBestSeller },
  });

  revalidateTag("products", "default");
  emitProductEvent({ type: "BESTSELLER_CHANGED", productId });

  if (product.pfsProductId) {
    const starStatus: PfsStatus = isBestSeller ? "STAR" : "REMOVE_STAR";
    pfsUpdateStatus([{ id: product.pfsProductId, status: starStatus }]).catch((err) => {
      logger.warn(`[PFS] Best seller sync failed for product ${productId}`, { error: err });
    });
  }

  return { success: true };
}

// ─────────────────────────────────────────────
// Supprimer un produit (bloqué si commandes existent)
// ─────────────────────────────────────────────

export async function deleteProduct(
  id: string,
  deleteFromPfs = false,
  deleteFromAnkorstore = true,
  forceLocalDelete = false,
): Promise<{ success: true } | { success: false; marketplaceErrors: { marketplace: string; error: string }[] }> {
  await requireAdmin();

  // Check if product has any order items (legal: 10 years retention in France)
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      reference: true,
      pfsProductId: true,
      ankorsProductId: true,
      colors: {
        select: {
          sku: true,
          saleType: true,
          packQuantity: true,
          color: { select: { name: true } },
          packColorLines: {
            select: { colors: { select: { color: { select: { name: true } } }, orderBy: { position: "asc" } } },
            orderBy: { position: "asc" },
          },
          variantSizes: {
            select: { size: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!product) throw new Error("Produit introuvable.");

  const orderCount = await prisma.orderItem.count({ where: { productRef: product.reference } });
  if (orderCount > 0) {
    throw new Error(
      `Ce produit apparaît dans ${orderCount} commande(s). Il ne peut pas être supprimé (obligation légale 10 ans). Utilisez l'archivage à la place.`
    );
  }

  const marketplaceErrors: { marketplace: string; error: string }[] = [];

  // Delete from PFS if requested and product is synced — check existence first
  if (deleteFromPfs && product.pfsProductId && !forceLocalDelete) {
    try {
      const { pfsCheckReference } = await import("@/lib/pfs-api");
      const exists = await pfsCheckReference(product.reference).catch(() => null);
      if (exists) {
        await pfsDeleteProduct(product.pfsProductId);
        logger.info(`[PFS] Product ${id} deleted from PFS (${product.pfsProductId})`);
      } else {
        logger.info(`[PFS] Product ${id} not found on PFS, skipping delete`, { reference: product.reference });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[PFS] Failed to delete product ${id} from PFS`, { error: errMsg });
      marketplaceErrors.push({ marketplace: "Paris Fashion Shop", error: errMsg });
    }
  }

  // Delete from Ankorstore if requested — fetch real SKUs from Ankorstore API
  if (deleteFromAnkorstore && !forceLocalDelete) {
    try {
      const { ankorstoreSearchVariants } = await import("@/lib/ankorstore-api");
      const { ankorstoreDeleteProduct } = await import("@/lib/ankorstore-api-write");

      // Search Ankorstore for variants matching this product reference
      const ankorsVariants = await ankorstoreSearchVariants({ skuOrName: product.reference });
      const skus = ankorsVariants
        .map((v) => v.sku)
        .filter((s): s is string => !!s && s.startsWith(product.reference));

      if (skus.length === 0) {
        logger.info("[Ankorstore] No variants found on Ankorstore, skipping delete", { reference: product.reference });
      } else {
        const result = await ankorstoreDeleteProduct(product.reference, skus);
        if (result.success) {
          logger.info("[Ankorstore] Product deleted", { id, reference: product.reference, skus });
        } else {
          logger.warn("[Ankorstore] Delete returned failure", { id, reference: product.reference, error: result.error });
          marketplaceErrors.push({ marketplace: "Ankorstore", error: result.error ?? "Échec de suppression" });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn("[Ankorstore] Delete failed", { id, error: errMsg });
      marketplaceErrors.push({ marketplace: "Ankorstore", error: errMsg });
    }
  }

  // If marketplace errors and not forcing — return errors, let caller decide
  if (marketplaceErrors.length > 0 && !forceLocalDelete) {
    return { success: false, marketplaceErrors };
  }

  // Clean up CartItems referencing this product's variants (no cascade on CartItem.variant)
  const variantIds = await prisma.productColor.findMany({
    where: { productId: id },
    select: { id: true },
  });
  if (variantIds.length > 0) {
    await prisma.cartItem.deleteMany({
      where: { variantId: { in: variantIds.map((v) => v.id) } },
    });
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
      logger.warn(`[PFS] Archive status sync failed for product ${id}`, { error: err });
    });
  }
  triggerPfsSync(id);
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
      logger.warn(`[PFS] Unarchive status sync failed for product ${id}`, { error: err });
    });
  }
  triggerPfsSync(id);
  triggerAnkorstoreSync(id);
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

  // Check images exist per variant (each color must have at least one image)
  const variantsWithoutImages = new Map<string, string[]>();
  if (status === "ONLINE") {
    const allColors = await prisma.productColor.findMany({
      where: { productId: { in: productIds } },
      select: {
        id: true,
        productId: true,
        color: { select: { name: true } },
        _count: { select: { images: true } },
      },
    });
    for (const c of allColors) {
      if (c._count.images === 0) {
        const existing = variantsWithoutImages.get(c.productId) ?? [];
        existing.push(c.color?.name || "variante");
        variantsWithoutImages.set(c.productId, existing);
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
      const missingImgVariants = variantsWithoutImages.get(product.id);
      if (missingImgVariants) reasons.push(`image manquante : ${missingImgVariants.join(", ")}`);
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
        logger.warn("[PFS] Bulk status sync failed", { error: err });
      });
    }
  }

  // Fire-and-forget sync to PFS + Ankorstore for each updated product
  // skipRevalidation=true because we already called revalidateTag("products", "default") above
  for (const pid of success) {
    triggerPfsSync(pid);
    triggerAnkorstoreSync(pid, false, true);
  }

  return { success, errors };
}

export async function bulkDeleteProducts(
  productIds: string[],
  deleteFromPfs = false,
  deleteFromAnkorstore = true,
  forceLocalDelete = false,
): Promise<{
  deleted: number;
  protected: { id: string; reference: string; orderCount: number }[];
  pfsDeleted: number;
  ankorsDeleted: number;
  marketplaceErrors: { productId: string; reference: string; marketplace: string; error: string }[];
}> {
  await requireAdmin();
  if (productIds.length === 0) throw new Error("Aucun produit sélectionné.");

  // Find products with orders — cannot be deleted
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, reference: true, pfsProductId: true, ankorsProductId: true, colors: { select: { sku: true } } },
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

  // Emit marketplace sync events for protected products (they won't be deleted)
  for (const pp of protectedProducts) {
    if (deleteFromPfs) {
      emitProductEvent({ type: "MARKETPLACE_SYNC", productId: pp.id, marketplaceSync: { marketplace: "pfs", step: "Protégé (commandes)", progress: 100, status: "success" } });
    }
    if (deleteFromAnkorstore) {
      emitProductEvent({ type: "MARKETPLACE_SYNC", productId: pp.id, marketplaceSync: { marketplace: "ankorstore", step: "Protégé (commandes)", progress: 100, status: "success" } });
    }
  }

  // Track marketplace errors
  const marketplaceErrors: { productId: string; reference: string; marketplace: string; error: string }[] = [];

  // Delete from PFS if requested (skip if forceLocalDelete)
  let pfsDeleted = 0;
  if (deleteFromPfs && deletableIds.length > 0 && !forceLocalDelete) {
    const pfsProducts = products.filter((p) => deletableIds.includes(p.id) && p.pfsProductId);
    const nonPfsProducts = products.filter((p) => deletableIds.includes(p.id) && !p.pfsProductId);
    // Products not linked to PFS — emit immediate success
    for (const p of nonPfsProducts) {
      emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "pfs", step: "Non lié à PFS", progress: 100, status: "success" } });
    }
    const { pfsCheckReference } = await import("@/lib/pfs-api");
    for (const p of pfsProducts) {
      emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "pfs", step: "Suppression de PFS...", progress: 30, status: "in_progress" } });
      try {
        const exists = await pfsCheckReference(p.reference).catch(() => null);
        if (exists) {
          await pfsDeleteProduct(p.pfsProductId!);
          pfsDeleted++;
          logger.info(`[PFS] Product ${p.id} deleted from PFS (${p.pfsProductId})`);
          emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "pfs", step: "Supprimé de PFS", progress: 100, status: "success" } });
        } else {
          logger.info(`[PFS] Product ${p.id} not found on PFS, skipping delete`, { reference: p.reference });
          emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "pfs", step: "Non trouvé sur PFS", progress: 100, status: "success" } });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`[PFS] Failed to delete product ${p.id} from PFS`, { error: errMsg });
        emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "pfs", step: "Erreur de suppression", progress: 100, status: "error", error: errMsg } });
        marketplaceErrors.push({ productId: p.id, reference: p.reference, marketplace: "Paris Fashion Shop", error: errMsg });
      }
    }
  }

  // Delete from Ankorstore if requested and products are linked (skip if forceLocalDelete)
  let ankorsDeleted = 0;
  if (deleteFromAnkorstore && deletableIds.length > 0 && !forceLocalDelete) {
    const ankorsProducts = products.filter((p) => deletableIds.includes(p.id) && p.ankorsProductId);
    const nonAnkorsProducts = products.filter((p) => deletableIds.includes(p.id) && !p.ankorsProductId);
    // Products not linked to Ankorstore — emit immediate success
    for (const p of nonAnkorsProducts) {
      emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "ankorstore", step: "Non lié à Ankorstore", progress: 100, status: "success" } });
    }
    if (ankorsProducts.length > 0) {
      const { ankorstoreSearchVariants } = await import("@/lib/ankorstore-api");
      const { ankorstoreDeleteProduct } = await import("@/lib/ankorstore-api-write");
      for (const p of ankorsProducts) {
        emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "ankorstore", step: "Suppression d'Ankorstore...", progress: 30, status: "in_progress" } });
        try {
          // Fetch real SKUs from Ankorstore API
          const ankorsVariants = await ankorstoreSearchVariants({ skuOrName: p.reference });
          const skus = ankorsVariants
            .map((v) => v.sku)
            .filter((s): s is string => !!s && s.startsWith(p.reference));

          if (skus.length === 0) {
            logger.info("[Ankorstore] No variants found on Ankorstore, skipping delete", { reference: p.reference });
            emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "ankorstore", step: "Non trouvé sur Ankorstore", progress: 100, status: "success" } });
            continue;
          }
          await ankorstoreDeleteProduct(p.reference, skus);
          ankorsDeleted++;
          emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "ankorstore", step: "Supprimé d'Ankorstore", progress: 100, status: "success" } });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.warn("[Ankorstore] Bulk delete failed", { ref: p.reference, error: errMsg });
          emitProductEvent({ type: "MARKETPLACE_SYNC", productId: p.id, marketplaceSync: { marketplace: "ankorstore", step: "Erreur de suppression", progress: 100, status: "error", error: errMsg } });
          marketplaceErrors.push({ productId: p.id, reference: p.reference, marketplace: "Ankorstore", error: errMsg });
        }
      }
    }
  }

  // If marketplace errors occurred and not forcing local delete — stop here, let user decide
  if (marketplaceErrors.length > 0 && !forceLocalDelete) {
    return { deleted: 0, protected: protectedProducts, pfsDeleted, ankorsDeleted, marketplaceErrors };
  }

  let deleted = 0;
  if (deletableIds.length > 0) {
    // Clean up CartItems referencing variants of products to delete (no cascade on CartItem.variant)
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
  return { deleted, protected: protectedProducts, pfsDeleted, ankorsDeleted, marketplaceErrors: [] };
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
    select: { productId: true, stock: true, ankorsVariantId: true },
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

  triggerPfsSync(variant.productId);

  // Sync stock to Ankorstore if variant is linked
  if (data.stock != null && variant.ankorsVariantId) {
    import("@/lib/ankorstore-api-write")
      .then(({ ankorstoreUpdateVariantStock }) =>
        ankorstoreUpdateVariantStock(variant.ankorsVariantId!, data.stock!)
      )
      .catch((err) =>
        logger.warn("[Ankorstore] Stock sync failed for variant %s", {
          variantId,
          error: err instanceof Error ? err.message : String(err),
        })
      );
  }
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
    triggerPfsSync(pid);
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
