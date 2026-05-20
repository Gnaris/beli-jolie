"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { deleteFile, keyFromDbPath } from "@/lib/storage";

export type ColorMergeConflictKind =
  | "variant_duplicate"
  | "pack_line_duplicate"
  | "image_duplicate";

export interface ColorMergeConflict {
  kind: ColorMergeConflictKind;
  productId: string;
  reference: string;
  productName: string;
}

export interface AffectedProduct {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
}

export interface CheckColorMergeConflictsResult {
  conflicts: ColorMergeConflict[];
  affectedProductCount: number;
  absorbedColorName: string;
  keptColorName: string;
}

export type MergeColorsResult =
  | { success: false; conflicts: ColorMergeConflict[] }
  | {
      success: true;
      affectedProducts: AffectedProduct[];
      keptColorName: string;
      absorbedColorName: string;
    };

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

async function purgePatternFile(dbPath: string | null | undefined): Promise<void> {
  if (!dbPath) return;
  try {
    await deleteFile(keyFromDbPath(dbPath));
  } catch (err) {
    logger.warn("[color-merge] Failed to delete pattern file", { path: dbPath, error: err });
  }
}

export async function checkColorMergeConflicts(
  keptId: string,
  absorbedId: string,
): Promise<CheckColorMergeConflictsResult> {
  await requireAdmin();
  if (keptId === absorbedId) {
    throw new Error("La couleur gardée et la couleur à supprimer sont identiques.");
  }
  const [kept, absorbed] = await Promise.all([
    prisma.color.findUnique({ where: { id: keptId }, select: { name: true } }),
    prisma.color.findUnique({ where: { id: absorbedId }, select: { name: true } }),
  ]);
  if (!kept) throw new Error("Couleur à garder introuvable.");
  if (!absorbed) throw new Error("Couleur à supprimer introuvable.");

  const conflicts: ColorMergeConflict[] = [];

  // 1) Doublon variante : un produit qui a déjà les deux couleurs en variante
  const variantDupes = await prisma.$queryRaw<
    Array<{ productId: string; reference: string; name: string }>
  >`
    SELECT pc.productId as productId, p.reference as reference, p.name as name
    FROM ProductColor pc
    JOIN Product p ON p.id = pc.productId
    WHERE pc.colorId IN (${keptId}, ${absorbedId})
    GROUP BY pc.productId, p.reference, p.name
    HAVING COUNT(DISTINCT pc.colorId) = 2
  `;
  for (const row of variantDupes) {
    conflicts.push({
      kind: "variant_duplicate",
      productId: row.productId,
      reference: row.reference,
      productName: row.name,
    });
  }

  // 2) Doublon pack-line (viole unique productColorId+colorId)
  const packDupes = await prisma.$queryRaw<
    Array<{ productId: string; reference: string; name: string }>
  >`
    SELECT pc.productId as productId, p.reference as reference, p.name as name
    FROM PackColorLine pcl
    JOIN ProductColor pc ON pc.id = pcl.productColorId
    JOIN Product p ON p.id = pc.productId
    WHERE pcl.colorId IN (${keptId}, ${absorbedId})
    GROUP BY pcl.productColorId, pc.productId, p.reference, p.name
    HAVING COUNT(DISTINCT pcl.colorId) = 2
  `;
  for (const row of packDupes) {
    conflicts.push({
      kind: "pack_line_duplicate",
      productId: row.productId,
      reference: row.reference,
      productName: row.name,
    });
  }

  // 3) Doublon d'image (viole unique productId+colorId+order)
  const imageDupes = await prisma.$queryRaw<
    Array<{ productId: string; reference: string; name: string }>
  >`
    SELECT pci.productId as productId, p.reference as reference, p.name as name
    FROM ProductColorImage pci
    JOIN Product p ON p.id = pci.productId
    WHERE pci.colorId IN (${keptId}, ${absorbedId})
    GROUP BY pci.productId, pci.\`order\`, p.reference, p.name
    HAVING COUNT(DISTINCT pci.colorId) = 2
  `;
  for (const row of imageDupes) {
    // Évite le doublon si déjà signalé en variant_duplicate
    if (conflicts.some((c) => c.productId === row.productId)) continue;
    conflicts.push({
      kind: "image_duplicate",
      productId: row.productId,
      reference: row.reference,
      productName: row.name,
    });
  }

  const affectedSet = await collectAffectedProductIds(absorbedId);

  return {
    conflicts,
    affectedProductCount: affectedSet.size,
    absorbedColorName: absorbed.name,
    keptColorName: kept.name,
  };
}

async function collectAffectedProductIds(colorId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const v = await prisma.productColor.findMany({
    where: { colorId },
    select: { productId: true },
    distinct: ["productId"],
  });
  for (const r of v) set.add(r.productId);
  const pl = await prisma.packColorLine.findMany({
    where: { colorId },
    select: { productColor: { select: { productId: true } } },
  });
  for (const r of pl) set.add(r.productColor.productId);
  const img = await prisma.productColorImage.findMany({
    where: { colorId },
    select: { productId: true },
    distinct: ["productId"],
  });
  for (const r of img) set.add(r.productId);
  const pri = await prisma.product.findMany({
    where: { primaryColorId: colorId },
    select: { id: true },
  });
  for (const r of pri) set.add(r.id);
  return set;
}

export async function mergeColors(
  keptId: string,
  absorbedId: string,
): Promise<MergeColorsResult> {
  await requireAdmin();

  // Re-vérifie les conflits (anti TOCTOU)
  const check = await checkColorMergeConflicts(keptId, absorbedId);
  if (check.conflicts.length > 0) {
    return { success: false, conflicts: check.conflicts };
  }

  const absorbedRow = await prisma.color.findUnique({
    where: { id: absorbedId },
    select: { name: true, patternImage: true },
  });
  if (!absorbedRow) throw new Error("Couleur à supprimer déjà introuvable.");

  // Snapshot des productIds AVANT la transaction
  const affectedIds = await collectAffectedProductIds(absorbedId);

  await prisma.$transaction(async (tx) => {
    await tx.productColor.updateMany({
      where: { colorId: absorbedId },
      data: { colorId: keptId },
    });
    await tx.packColorLine.updateMany({
      where: { colorId: absorbedId },
      data: { colorId: keptId },
    });
    await tx.productColorImage.updateMany({
      where: { colorId: absorbedId },
      data: { colorId: keptId },
    });
    await tx.product.updateMany({
      where: { primaryColorId: absorbedId },
      data: { primaryColorId: keptId },
    });
    // ColorTranslation supprimée en cascade via la FK onDelete: Cascade
    await tx.color.delete({ where: { id: absorbedId } });
  });

  await purgePatternFile(absorbedRow.patternImage);

  const affectedProducts = await loadAffectedProductMeta([...affectedIds]);

  revalidateTag("colors", "default");
  revalidatePath("/admin/couleurs");
  revalidatePath("/admin/produits");

  return {
    success: true,
    affectedProducts,
    keptColorName: check.keptColorName,
    absorbedColorName: absorbedRow.name,
  };
}

export async function loadAffectedProductMeta(
  productIds: string[],
): Promise<AffectedProduct[]> {
  if (productIds.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      reference: true,
      name: true,
      colors: {
        where: { isPrimary: true },
        select: {
          images: { orderBy: { order: "asc" }, take: 1, select: { path: true } },
        },
        take: 1,
      },
    },
  });
  return products.map((p) => ({
    productId: p.id,
    reference: p.reference,
    productName: p.name,
    firstImage: p.colors[0]?.images[0]?.path ?? null,
  }));
}
