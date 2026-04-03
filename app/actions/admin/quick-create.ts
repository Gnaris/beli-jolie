"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  autoTranslateCategory,
  autoTranslateSubCategory,
  autoTranslateComposition,
  autoTranslateColor,
  autoTranslateTag,
  autoTranslateManufacturingCountry,
  autoTranslateSeason,
} from "@/lib/auto-translate";

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

/** Get locales that were manually filled (non-fr, non-empty) */
function getManualLocales(names: Record<string, string>): string[] {
  return Object.entries(names)
    .filter(([locale, val]) => locale !== "fr" && val?.trim())
    .map(([locale]) => locale);
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
    data: { name: frName, hex: hex || null, patternImage: patternImage || null, pfsColorRef: pfsColorRef?.trim() || null },
    select: { id: true, name: true, hex: true, patternImage: true, pfsColorRef: true },
  });

  const translationData = buildTranslations(names, "colorId", color.id);
  if (translationData.length > 0) {
    await prisma.colorTranslation.createMany({
      data: translationData as { colorId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }
  await autoTranslateColor(color.id, frName, getManualLocales(names));

  revalidatePath("/admin/produits");
  revalidatePath("/admin/produits/nouveau");
  return color;
}

export async function createCategoryQuick(
  names: Record<string, string>,
  pfsCategoryId?: string | null,
  pfsGender?: string | null,
  pfsFamilyId?: string | null,
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
    data: {
      name: frName,
      slug: toSlug(frName),
      pfsCategoryId: pfsCategoryId?.trim() || null,
      pfsGender: pfsGender || null,
      pfsFamilyId: pfsFamilyId || null,
    },
    select: { id: true, name: true, subCategories: { select: { id: true, name: true } } },
  });

  const translationData = buildTranslations(names, "categoryId", category.id);
  if (translationData.length > 0) {
    await prisma.categoryTranslation.createMany({
      data: translationData as { categoryId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }
  await autoTranslateCategory(category.id, frName, getManualLocales(names));

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
    data: { name: frName, pfsCompositionRef: pfsCompositionRef?.trim() || null },
    select: { id: true, name: true },
  });

  const translationData = buildTranslations(names, "compositionId", composition.id);
  if (translationData.length > 0) {
    await prisma.compositionTranslation.createMany({
      data: translationData as { compositionId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }
  await autoTranslateComposition(composition.id, frName, getManualLocales(names));

  revalidatePath("/admin/produits");
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
  await autoTranslateSubCategory(subCategory.id, frName, getManualLocales(names));

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
  await autoTranslateTag(tag.id, frName, getManualLocales(names));

  revalidatePath("/admin/produits");
  return tag;
}

export async function createManufacturingCountryQuick(
  names: Record<string, string>,
  isoCode?: string | null,
  pfsCountryRef?: string | null
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");

  const existing = await prisma.manufacturingCountry.findFirst({
    where: { name: frName },
    select: { id: true },
  });
  if (existing) throw new Error(`Le pays "${frName}" existe déjà.`);

  const country = await prisma.manufacturingCountry.create({
    data: { name: frName, isoCode: isoCode || null, pfsCountryRef: pfsCountryRef?.trim() || null },
    select: { id: true, name: true },
  });

  const translationData = buildTranslations(names, "manufacturingCountryId", country.id);
  if (translationData.length > 0) {
    await prisma.manufacturingCountryTranslation.createMany({
      data: translationData as { manufacturingCountryId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }
  await autoTranslateManufacturingCountry(country.id, frName, getManualLocales(names));

  revalidatePath("/admin/produits");
  return country;
}

export async function createSeasonQuick(
  names: Record<string, string>,
  pfsSeasonRef?: string | string[] | null
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const frName = names["fr"]?.trim();
  if (!frName) throw new Error("Le nom en français est requis.");

  const existing = await prisma.season.findFirst({
    where: { name: frName },
    select: { id: true },
  });
  if (existing) throw new Error(`La saison "${frName}" existe déjà.`);

  // Normalize: accept string or string[] (take first), trim + uppercase
  const ref = (Array.isArray(pfsSeasonRef) ? pfsSeasonRef[0] : pfsSeasonRef)?.trim().toUpperCase() || null;
  const season = await prisma.season.create({
    data: {
      name: frName,
      pfsRef: ref,
    },
    select: { id: true, name: true },
  });

  const translationData = buildTranslations(names, "seasonId", season.id);
  if (translationData.length > 0) {
    await prisma.seasonTranslation.createMany({
      data: translationData as { seasonId: string; locale: string; name: string }[],
      skipDuplicates: true,
    });
  }
  await autoTranslateSeason(season.id, frName, getManualLocales(names));

  revalidatePath("/admin/produits");
  return season;
}
