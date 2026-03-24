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

/** Create a new size and optionally link it to categories */
export async function createSize(name: string, categoryIds: string[]) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Le nom est requis.");

  const existing = await prisma.size.findUnique({ where: { name: trimmed } });
  if (existing) throw new Error(`La taille « ${trimmed} » existe déjà.`);

  // Get max position for ordering
  const maxPos = await prisma.size.aggregate({ _max: { position: true } });
  const position = (maxPos._max.position ?? -1) + 1;

  await prisma.size.create({
    data: {
      name: trimmed,
      position,
      categories: {
        create: categoryIds.map((categoryId) => ({ categoryId })),
      },
    },
  });

  revalidatePath("/admin/tailles");
  revalidatePath("/admin/categories");
  revalidateTag("sizes", "default");
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

  revalidatePath("/admin/tailles");
  revalidatePath("/admin/categories");
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
  revalidatePath("/admin/tailles");
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

  revalidatePath("/admin/tailles");
  revalidateTag("sizes", "default");
}
