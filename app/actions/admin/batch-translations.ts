"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { translateText, type Locale } from "@/lib/translate";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Non autorisé");
  }
}

type EntityType = "color" | "composition" | "tag" | "category" | "subcategory" | "collection" | "season";

interface BatchItem {
  id: string;
  translations: Record<string, string>;
}

/** Construit une opération upsert pour une traduction d'entité donnée. */
function buildTranslationUpsert(entityType: EntityType, id: string, locale: string, name: string): Prisma.PrismaPromise<unknown> {
  switch (entityType) {
    case "color":
      return prisma.colorTranslation.upsert({
        where: { colorId_locale: { colorId: id, locale } },
        update: { name },
        create: { colorId: id, locale, name },
      });
    case "composition":
      return prisma.compositionTranslation.upsert({
        where: { compositionId_locale: { compositionId: id, locale } },
        update: { name },
        create: { compositionId: id, locale, name },
      });
    case "tag":
      return prisma.tagTranslation.upsert({
        where: { tagId_locale: { tagId: id, locale } },
        update: { name },
        create: { tagId: id, locale, name },
      });
    case "category":
      return prisma.categoryTranslation.upsert({
        where: { categoryId_locale: { categoryId: id, locale } },
        update: { name },
        create: { categoryId: id, locale, name },
      });
    case "subcategory":
      return prisma.subCategoryTranslation.upsert({
        where: { subCategoryId_locale: { subCategoryId: id, locale } },
        update: { name },
        create: { subCategoryId: id, locale, name },
      });
    case "collection":
      return prisma.collectionTranslation.upsert({
        where: { collectionId_locale: { collectionId: id, locale } },
        update: { name },
        create: { collectionId: id, locale, name },
      });
    case "season":
      return prisma.seasonTranslation.upsert({
        where: { seasonId_locale: { seasonId: id, locale } },
        update: { name },
        create: { seasonId: id, locale, name },
      });
  }
}

/**
 * Batch-update translations for multiple entities of the same type.
 * Called after the client translates via DeepL and has the results.
 *
 * Optimisation : au lieu de N × 7 upserts séquentiels (ex: 50 items = 350 aller-retours DB),
 * on regroupe tout dans un seul `$transaction` pour un round-trip unique.
 */
export async function batchUpdateTranslations(
  entityType: EntityType,
  items: BatchItem[]
) {
  await requireAdmin();

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const item of items) {
    for (const locale of NON_DEFAULT_LOCALES) {
      const val = item.translations[locale]?.trim();
      if (!val) continue;
      ops.push(buildTranslationUpsert(entityType, item.id, locale, val));
    }
  }

  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }

  // Revalidate relevant paths
  switch (entityType) {
    case "color":
      revalidatePath("/admin/produits");
      revalidateTag("colors", "default");
      break;
    case "composition":
      revalidatePath("/admin/produits");
      revalidateTag("compositions", "default");
      break;
    case "tag":
      revalidatePath("/admin/produits");
      revalidatePath("/produits");
      break;
    case "category":
    case "subcategory":
      revalidatePath("/admin/produits");
      revalidateTag("categories", "default");
      break;
    case "collection":
      revalidatePath("/admin/collections");
      revalidateTag("collections", "default");
      break;
    case "season":
      revalidatePath("/admin/produits");
      revalidateTag("seasons", "default");
      break;
  }
}

/**
 * Batch-translate products: saves translated names (from client)
 * AND translates+saves descriptions server-side.
 *
 * Optimisation : preload de toutes les descriptions en 1 findMany (au lieu
 * de N findUnique dans une boucle) + regroupement des upserts finaux dans
 * un `$transaction`. Les appels réseau `translateText` restent séquentiels
 * pour respecter le rate-limit de l'API de traduction.
 */
export async function batchTranslateProducts(
  items: { id: string; translations: Record<string, string> }[]
) {
  await requireAdmin();

  const TARGET_LOCALES: Locale[] = NON_DEFAULT_LOCALES;

  if (items.length === 0) return;

  // 1) Preload toutes les descriptions en une seule requête.
  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.id) } },
    select: { id: true, description: true },
  });
  const descByProductId = new Map(products.map((p) => [p.id, p.description]));

  // 2) Traduire séquentiellement (rate-limit API) et collecter les upserts.
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const item of items) {
    const description = descByProductId.get(item.id) ?? null;

    for (const locale of TARGET_LOCALES) {
      const translatedName = item.translations[locale]?.trim();
      if (!translatedName) continue;

      let translatedDesc = "";
      if (description?.trim()) {
        try {
          translatedDesc = await translateText(description, "fr", locale as Locale);
        } catch {
          // Silent — save name even if description fails
        }
      }

      ops.push(prisma.productTranslation.upsert({
        where: { productId_locale: { productId: item.id, locale } },
        update: { name: translatedName, description: translatedDesc },
        create: { productId: item.id, locale, name: translatedName, description: translatedDesc },
      }));
    }
  }

  // 3) Un seul aller-retour DB pour tous les upserts.
  if (ops.length > 0) {
    await prisma.$transaction(ops);
  }

  revalidatePath("/admin/produits");
  revalidatePath("/produits");
}
