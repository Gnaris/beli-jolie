"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build translation createMany data from a names map (skips the "fr" key — that's the canonical name) */
function buildTranslations(names: Record<string, string>, idKey: string, idValue: string) {
  return Object.entries(names)
    .filter(([locale, val]) => locale !== "fr" && val.trim())
    .map(([locale, val]) => ({
      [idKey]: idValue,
      locale,
      name: val.trim(),
    }));
}

export async function createColorQuick(
  names: Record<string, string>,
  hex: string | null,
  patternImage?: string | null,
  pfsColorRef?: string | null
): Promise<{ id: string; name: string; hex: string | null; patternImage: string | null; pfsColorRef: string | null }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");

  const existing = await prisma.color.findFirst({
    where: { name: frName },
    select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
  });
  if (existing) throw new Error(`La couleur "${frName}" existe déjà.`);

  const color = await prisma.color.create({
    data: { name: frName, hex: hex || null, patternImage: patternImage || null, pfsColorRef: pfsColorRef || null },
    select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
  });

  const translationData = buildTranslations(names, "colorId", color.id);
  if (translationData.length > 0) {
    await prisma.colorTranslation.createMany({
      data: translationData as { colorId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }

  revalidatePath("/admin/couleurs");
  revalidatePath("/admin/produits/nouveau");
  return color;
}

export async function createCategoryQuick(
  names: Record<string, string>,
  pfsCategoryId?: string | null
): Promise<{ id: string; name: string; subCategories: { id: string; name: string }[] }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");

  const existing = await prisma.category.findFirst({
    where: { name: frName },
    select: { id: true },
  });
  if (existing) throw new Error(`La catégorie "${frName}" existe déjà.`);

  const category = await prisma.category.create({
    data: { name: frName, slug: toSlug(frName), pfsCategoryId: pfsCategoryId || null },
    select: { id: true, name: true, subCategories: { select: { id: true, name: true } } },
  });

  const translationData = buildTranslations(names, "categoryId", category.id);
  if (translationData.length > 0) {
    await prisma.categoryTranslation.createMany({
      data: translationData as { categoryId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }

  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  return category;
}

export async function createCompositionQuick(
  names: Record<string, string>,
  pfsCompositionRef?: string | null
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");

  const existing = await prisma.composition.findUnique({
    where: { name: frName },
    select: { id: true },
  });
  if (existing) throw new Error(`La composition "${frName}" existe déjà.`);

  const composition = await prisma.composition.create({
    data: { name: frName, pfsCompositionRef: pfsCompositionRef || null },
    select: { id: true, name: true },
  });

  const translationData = buildTranslations(names, "compositionId", composition.id);
  if (translationData.length > 0) {
    await prisma.compositionTranslation.createMany({
      data: translationData as { compositionId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }

  revalidatePath("/admin/compositions");
  return composition;
}

export async function createSubCategoryQuick(
  names: Record<string, string>,
  categoryId: string
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");
  if (!categoryId) throw new Error("Catégorie parente requise.");

  const existing = await prisma.subCategory.findFirst({
    where: { name: frName, categoryId },
    select: { id: true },
  });
  if (existing) throw new Error(`La sous-catégorie "${frName}" existe déjà dans cette catégorie.`);

  const subCategory = await prisma.subCategory.create({
    data: { name: frName, slug: toSlug(frName), categoryId },
    select: { id: true, name: true },
  });

  const translationData = buildTranslations(names, "subCategoryId", subCategory.id);
  if (translationData.length > 0) {
    await prisma.subCategoryTranslation.createMany({
      data: translationData as { subCategoryId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }

  revalidatePath("/admin/categories");
  revalidatePath("/admin/produits");
  return subCategory;
}

export async function createTagQuick(
  names: Record<string, string>
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");

  const existing = await prisma.tag.findFirst({
    where: { name: frName },
    select: { id: true },
  });
  if (existing) throw new Error(`Le mot-clé "${frName}" existe déjà.`);

  const tag = await prisma.tag.create({
    data: { name: frName },
    select: { id: true, name: true },
  });

  const translationData = buildTranslations(names, "tagId", tag.id);
  if (translationData.length > 0) {
    await prisma.tagTranslation.createMany({
      data: translationData as { tagId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }

  revalidatePath("/admin/produits");
  return tag;
}
