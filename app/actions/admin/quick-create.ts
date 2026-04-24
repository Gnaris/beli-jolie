"use server";

/**
 * Quick-create server actions — create categories, subcategories, colors, etc.
 * on the fly from the admin UI. The PFS/Ankorstore mapping parameters are now
 * accepted but ignored, since marketplaces are populated via manual Excel upload.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

function titleCase(name: string): string {
  return name.trim();
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "x";
}

export async function createCategoryQuick(
  translations: Record<string, string>,
  pfsGender?: string | null,
  pfsFamilyName?: string | null,
  pfsCategoryName?: string | null,
  pfsCategoryId?: string | null,
): Promise<{ id: string; name: string; subCategories: { id: string; name: string }[] }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const gender = pfsGender?.trim() || null;
  const familyName = pfsFamilyName?.trim() || null;
  if (!gender || !familyName) {
    throw new Error("Le genre et la famille Paris Fashion Shop sont obligatoires.");
  }
  const slug = slugify(name);
  const created = await prisma.category.create({
    data: {
      name,
      slug,
      pfsGender: gender,
      pfsFamilyName: familyName,
      pfsCategoryName: pfsCategoryName?.trim() || null,
      pfsCategoryId: pfsCategoryId?.trim() || null,
    },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.categoryTranslation.upsert({
      where: { categoryId_locale: { categoryId: created.id, locale } },
      create: { categoryId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
  return { id: created.id, name: created.name, subCategories: [] };
}

export async function createSubCategoryQuick(
  translations: Record<string, string>,
  categoryId: string,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const slug = slugify(name);
  const created = await prisma.subCategory.create({
    data: { name, slug, categoryId },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.subCategoryTranslation.upsert({
      where: { subCategoryId_locale: { subCategoryId: created.id, locale } },
      create: { subCategoryId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidatePath("/admin/produits");
  revalidateTag("categories", "default");
  return { id: created.id, name: created.name };
}

export async function createColorQuick(
  translations: Record<string, string>,
  hex: string | null | undefined,
  patternImage: string | null | undefined,
  pfsColorRef?: string | null,
): Promise<{ id: string; name: string; hex: string | null; patternImage: string | null }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const normalizedRef = pfsColorRef?.trim() || null;
  if (!normalizedRef) {
    throw new Error("La correspondance Paris Fashion Shop est obligatoire.");
  }
  const created = await prisma.color.create({
    data: { name, hex: hex ?? null, patternImage: patternImage ?? null, pfsColorRef: normalizedRef },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.colorTranslation.upsert({
      where: { colorId_locale: { colorId: created.id, locale } },
      create: { colorId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidateTag("colors", "default");
  return { id: created.id, name: created.name, hex: created.hex, patternImage: created.patternImage };
}

export async function createCompositionQuick(
  translations: Record<string, string>,
  pfsCompositionRef?: string | null,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const created = await prisma.composition.create({ data: { name, pfsCompositionRef: pfsCompositionRef ?? null } });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.compositionTranslation.upsert({
      where: { compositionId_locale: { compositionId: created.id, locale } },
      create: { compositionId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidateTag("compositions", "default");
  return { id: created.id, name: created.name };
}

export async function createManufacturingCountryQuick(
  translations: Record<string, string>,
  isoCode?: string | null,
  pfsCountryRef?: string | null,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const normalizedRef = pfsCountryRef?.trim() || null;
  if (!normalizedRef) {
    throw new Error("La correspondance Paris Fashion Shop est obligatoire.");
  }
  const normalizedIso = isoCode?.trim().toUpperCase() || null;
  if (!normalizedIso) {
    throw new Error("Le code ISO du pays (2 lettres) est obligatoire.");
  }
  if (!/^[A-Z]{2}$/.test(normalizedIso)) {
    throw new Error("Le code ISO doit être composé de 2 lettres (ex: FR, CN, TR).");
  }
  const isoConflict = await prisma.manufacturingCountry.findFirst({
    where: { isoCode: normalizedIso },
    select: { name: true },
  });
  if (isoConflict) {
    throw new Error(`Ce code ISO est déjà utilisé par le pays « ${isoConflict.name} ».`);
  }
  const created = await prisma.manufacturingCountry.create({
    data: { name, isoCode: normalizedIso, pfsCountryRef: normalizedRef },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.manufacturingCountryTranslation.upsert({
      where: { manufacturingCountryId_locale: { manufacturingCountryId: created.id, locale } },
      create: { manufacturingCountryId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidateTag("manufacturing-countries", "default");
  return { id: created.id, name: created.name };
}

export async function createSeasonQuick(
  translations: Record<string, string>,
  pfsRef?: string | null,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = titleCase(translations["fr"] ?? Object.values(translations)[0] ?? "");
  if (!name) throw new Error("Le nom (FR) est requis.");
  const normalizedRef = pfsRef?.trim().toUpperCase() || null;
  if (!normalizedRef) {
    throw new Error("La correspondance Paris Fashion Shop est obligatoire.");
  }
  const created = await prisma.season.create({
    data: { name, pfsRef: normalizedRef },
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.seasonTranslation.upsert({
      where: { seasonId_locale: { seasonId: created.id, locale } },
      create: { seasonId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidateTag("seasons", "default");
  return { id: created.id, name: created.name };
}

export async function createTagQuick(
  translations: Record<string, string>,
): Promise<{ id: string; name: string }> {
  await requireAdmin();
  const name = (translations["fr"] ?? Object.values(translations)[0] ?? "").trim().toLowerCase();
  if (!name) throw new Error("Le nom (FR) est requis.");
  const created = await prisma.tag.upsert({
    where: { name },
    create: { name },
    update: {},
  });
  for (const [locale, value] of Object.entries(translations)) {
    if (locale === "fr" || !value.trim()) continue;
    await prisma.tagTranslation.upsert({
      where: { tagId_locale: { tagId: created.id, locale } },
      create: { tagId: created.id, locale, name: value.trim() },
      update: { name: value.trim() },
    });
  }
  revalidateTag("tags", "default");
  return { id: created.id, name: created.name };
}
