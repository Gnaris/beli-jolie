"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé");
  }
}

type EntityType = "color" | "composition" | "tag" | "category" | "subcategory" | "collection" | "manufacturing-country" | "season";

interface BatchItem {
  id: string;
  translations: Record<string, string>;
}

/**
 * Batch-update translations for multiple entities of the same type.
 * Called after the client translates via DeepL and has the results.
 */
export async function batchUpdateTranslations(
  entityType: EntityType,
  items: BatchItem[]
) {
  await requireAdmin();

  const locales = ["en", "ar", "zh", "de", "es", "it"];

  for (const item of items) {
    for (const locale of locales) {
      const val = item.translations[locale]?.trim();
      if (!val) continue;

      switch (entityType) {
        case "color":
          await prisma.colorTranslation.upsert({
            where: { colorId_locale: { colorId: item.id, locale } },
            update: { name: val },
            create: { colorId: item.id, locale, name: val },
          });
          break;
        case "composition":
          await prisma.compositionTranslation.upsert({
            where: { compositionId_locale: { compositionId: item.id, locale } },
            update: { name: val },
            create: { compositionId: item.id, locale, name: val },
          });
          break;
        case "tag":
          await prisma.tagTranslation.upsert({
            where: { tagId_locale: { tagId: item.id, locale } },
            update: { name: val },
            create: { tagId: item.id, locale, name: val },
          });
          break;
        case "category":
          await prisma.categoryTranslation.upsert({
            where: { categoryId_locale: { categoryId: item.id, locale } },
            update: { name: val },
            create: { categoryId: item.id, locale, name: val },
          });
          break;
        case "subcategory":
          await prisma.subCategoryTranslation.upsert({
            where: { subCategoryId_locale: { subCategoryId: item.id, locale } },
            update: { name: val },
            create: { subCategoryId: item.id, locale, name: val },
          });
          break;
        case "collection":
          await prisma.collectionTranslation.upsert({
            where: { collectionId_locale: { collectionId: item.id, locale } },
            update: { name: val },
            create: { collectionId: item.id, locale, name: val },
          });
          break;
        case "manufacturing-country":
          await prisma.manufacturingCountryTranslation.upsert({
            where: { manufacturingCountryId_locale: { manufacturingCountryId: item.id, locale } },
            update: { name: val },
            create: { manufacturingCountryId: item.id, locale, name: val },
          });
          break;
        case "season":
          await prisma.seasonTranslation.upsert({
            where: { seasonId_locale: { seasonId: item.id, locale } },
            update: { name: val },
            create: { seasonId: item.id, locale, name: val },
          });
          break;
      }
    }
  }

  // Revalidate relevant paths
  switch (entityType) {
    case "color":
      revalidatePath("/admin/couleurs");
      revalidateTag("colors", "default");
      break;
    case "composition":
      revalidatePath("/admin/compositions");
      revalidateTag("compositions", "default");
      break;
    case "tag":
      revalidatePath("/admin/mots-cles");
      revalidatePath("/produits");
      break;
    case "category":
    case "subcategory":
      revalidatePath("/admin/categories");
      revalidateTag("categories", "default");
      break;
    case "collection":
      revalidatePath("/admin/collections");
      revalidateTag("collections", "default");
      break;
    case "manufacturing-country":
      revalidatePath("/admin/pays");
      revalidateTag("manufacturing-countries", "default");
      break;
    case "season":
      revalidatePath("/admin/saisons");
      revalidateTag("seasons", "default");
      break;
  }
}
