"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

/** Create a new size and optionally link it to categories. Returns created size. */
export async function createSize(name: string, categoryIds: string[]) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom est requis.");

  const existing = await prisma.size.findUnique({ where: { name: trimmed } });
  if (existing) throw new Error(`La taille « ${trimmed} » existe déjà.`);

  // Get max position for ordering
  const maxPos = await prisma.size.aggregate({ _max: { position: true } });
  const position = (maxPos._max.position ?? -1) + 1;

  const created = await prisma.size.create({
    data: {
      name: trimmed,
      position,
      categories: {
        create: categoryIds.map((categoryId) => ({ categoryId })),
      },
    },
  });

  revalidatePath("/admin/produits");
  revalidateTag("sizes", "default");

  return { id: created.id, name: created.name };
}

/** Create multiple sizes at once. Returns created count and any skipped names. */
export async function createSizesBatch(names: string[], categoryIds: string[]) {
  await requireAdmin();

  const trimmedNames = names.map((n) => n.trim()).filter(Boolean);
  if (trimmedNames.length === 0) throw new Error("Au moins un nom est requis.");

  // Check existing
  const existing = await prisma.size.findMany({
    where: { name: { in: trimmedNames } },
    select: { name: true },
  });
  const existingSet = new Set(existing.map((e) => e.name));

  const toCreate = trimmedNames.filter((n) => !existingSet.has(n));
  const skipped = trimmedNames.filter((n) => existingSet.has(n));

  if (toCreate.length === 0) {
    throw new Error(`Toutes les tailles existent déjà : ${skipped.join(", ")}`);
  }

  // Get max position
  const maxPos = await prisma.size.aggregate({ _max: { position: true } });
  let position = (maxPos._max.position ?? -1) + 1;

  // Create all in transaction
  await prisma.$transaction(
    toCreate.map((name) =>
      prisma.size.create({
        data: {
          name,
          position: position++,
          categories: {
            create: categoryIds.map((categoryId) => ({ categoryId })),
          },
        },
      })
    )
  );

  revalidatePath("/admin/produits");
  revalidateTag("sizes", "default");

  return { created: toCreate.length, skipped };
}

/** Update a size name and its category links */
export async function updateSize(
  id: string,
  name: string,
  categoryIds: string[]
) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom est requis.");

  // Check uniqueness
  const conflict = await prisma.size.findFirst({
    where: { name: trimmed, id: { not: id } },
  });
  if (conflict) throw new Error(`La taille « ${trimmed} » existe déjà.`);

  // Update name + replace category links
  await prisma.$transaction([
    prisma.size.update({ where: { id }, data: { name: trimmed } }),
    prisma.sizeCategoryLink.deleteMany({ where: { sizeId: id } }),
    ...categoryIds.map((categoryId) =>
      prisma.sizeCategoryLink.create({ data: { sizeId: id, categoryId } })
    ),
  ]);

  revalidatePath("/admin/produits");
  revalidateTag("sizes", "default");
}

/** Delete a size (fails if used in variants) */
export async function deleteSize(id: string) {
  await requireAdmin();

  const usageCount = await prisma.variantSize.count({
    where: { sizeId: id },
  });
  if (usageCount > 0) {
    throw new Error(
      `Impossible de supprimer : cette taille est utilisée par ${usageCount} variante(s).`
    );
  }

  await prisma.size.delete({ where: { id } });
  revalidatePath("/admin/produits");
  revalidateTag("sizes", "default");
}

/** Toggle a PFS size mapping for a BJ size (M2M: one BJ size can link to multiple PFS sizes) */
export async function toggleSizePfsMapping(sizeId: string, pfsSizeRef: string) {
  await requireAdmin();

  const trimmedRef = pfsSizeRef.trim();
  if (!trimmedRef) throw new Error("La référence PFS est requise.");

  // Check if mapping already exists
  const existing = await prisma.sizePfsMapping.findUnique({
    where: { sizeId_pfsSizeRef: { sizeId, pfsSizeRef: trimmedRef } },
  });

  if (existing) {
    // Remove mapping
    await prisma.sizePfsMapping.delete({ where: { id: existing.id } });
  } else {
    // Create mapping
    await prisma.sizePfsMapping.create({
      data: { sizeId, pfsSizeRef: trimmedRef },
    });
  }

  revalidateTag("sizes", "default");

  // Return updated mappings for this size
  const mappings = await prisma.sizePfsMapping.findMany({
    where: { sizeId },
    select: { pfsSizeRef: true },
  });
  return mappings.map((m) => m.pfsSizeRef);
}

/** Assign an existing size to a category (creates SizeCategoryLink if not exists) */
export async function assignSizeToCategory(sizeId: string, categoryId: string) {
  await requireAdmin();

  const existing = await prisma.sizeCategoryLink.findUnique({
    where: { sizeId_categoryId: { sizeId, categoryId } },
  });
  if (existing) return; // Already linked

  await prisma.sizeCategoryLink.create({
    data: { sizeId, categoryId },
  });

  revalidateTag("sizes", "default");
}

/** Reorder sizes by providing an ordered array of ids */
export async function reorderSizes(orderedIds: string[]) {
  await requireAdmin();

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.size.update({ where: { id }, data: { position: index } })
    )
  );

  revalidatePath("/admin/produits");
  revalidateTag("sizes", "default");
}
