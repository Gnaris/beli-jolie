/**
 * Auto-translation service — translates entity names/descriptions automatically
 * when the "auto_translate_enabled" setting is active and a DeepL key is configured.
 *
 * All functions are fire-and-forget safe (catch errors silently) to never block
 * the main entity creation flow.
 */

import { prisma } from "@/lib/prisma";
import { translateToAllLocales, translateText, type Locale } from "@/lib/translate";

const TARGET_LOCALES: Locale[] = ["en", "ar", "zh", "de", "es", "it"];

/** Check if auto-translate is enabled in SiteConfig */
export async function isAutoTranslateEnabled(): Promise<boolean> {
  const config = await prisma.siteConfig.findUnique({
    where: { key: "auto_translate_enabled" },
  });
  return config?.value === "true";
}

// ── Entity auto-translate (fire-and-forget) ──────────────────────────────────

type EntityTranslator = {
  table: string;
  idField: string;
  id: string;
  name: string;
};

async function autoTranslateEntity(entity: EntityTranslator) {
  try {
    const enabled = await isAutoTranslateEnabled();
    if (!enabled) return;

    const translations = await translateToAllLocales(entity.name);
    if (!translations || Object.keys(translations).length === 0) return;

    for (const locale of TARGET_LOCALES) {
      const val = translations[locale]?.trim();
      if (!val) continue;

      switch (entity.table) {
        case "color":
          await prisma.colorTranslation.upsert({
            where: { colorId_locale: { colorId: entity.id, locale } },
            update: { name: val },
            create: { colorId: entity.id, locale, name: val },
          });
          break;
        case "composition":
          await prisma.compositionTranslation.upsert({
            where: { compositionId_locale: { compositionId: entity.id, locale } },
            update: { name: val },
            create: { compositionId: entity.id, locale, name: val },
          });
          break;
        case "category":
          await prisma.categoryTranslation.upsert({
            where: { categoryId_locale: { categoryId: entity.id, locale } },
            update: { name: val },
            create: { categoryId: entity.id, locale, name: val },
          });
          break;
        case "subcategory":
          await prisma.subCategoryTranslation.upsert({
            where: { subCategoryId_locale: { subCategoryId: entity.id, locale } },
            update: { name: val },
            create: { subCategoryId: entity.id, locale, name: val },
          });
          break;
        case "collection":
          await prisma.collectionTranslation.upsert({
            where: { collectionId_locale: { collectionId: entity.id, locale } },
            update: { name: val },
            create: { collectionId: entity.id, locale, name: val },
          });
          break;
        case "manufacturing-country":
          await prisma.manufacturingCountryTranslation.upsert({
            where: { manufacturingCountryId_locale: { manufacturingCountryId: entity.id, locale } },
            update: { name: val },
            create: { manufacturingCountryId: entity.id, locale, name: val },
          });
          break;
        case "season":
          await prisma.seasonTranslation.upsert({
            where: { seasonId_locale: { seasonId: entity.id, locale } },
            update: { name: val },
            create: { seasonId: entity.id, locale, name: val },
          });
          break;
        case "tag":
          await prisma.tagTranslation.upsert({
            where: { tagId_locale: { tagId: entity.id, locale } },
            update: { name: val },
            create: { tagId: entity.id, locale, name: val },
          });
          break;
      }
    }
  } catch {
    // Silent — never block entity creation
  }
}

// ── Public helpers (fire-and-forget) ─────────────────────────────────────────

export function autoTranslateColor(id: string, name: string) {
  autoTranslateEntity({ table: "color", idField: "colorId", id, name }).catch(() => {});
}

export function autoTranslateComposition(id: string, name: string) {
  autoTranslateEntity({ table: "composition", idField: "compositionId", id, name }).catch(() => {});
}

export function autoTranslateCategory(id: string, name: string) {
  autoTranslateEntity({ table: "category", idField: "categoryId", id, name }).catch(() => {});
}

export function autoTranslateSubCategory(id: string, name: string) {
  autoTranslateEntity({ table: "subcategory", idField: "subCategoryId", id, name }).catch(() => {});
}

export function autoTranslateCollection(id: string, name: string) {
  autoTranslateEntity({ table: "collection", idField: "collectionId", id, name }).catch(() => {});
}

export function autoTranslateManufacturingCountry(id: string, name: string) {
  autoTranslateEntity({ table: "manufacturing-country", idField: "manufacturingCountryId", id, name }).catch(() => {});
}

export function autoTranslateSeason(id: string, name: string) {
  autoTranslateEntity({ table: "season", idField: "seasonId", id, name }).catch(() => {});
}

export function autoTranslateTag(id: string, name: string) {
  // Only translate if no translations exist yet (tags are upserted, may already have translations)
  _autoTranslateTagIfNew(id, name).catch(() => {});
}

async function _autoTranslateTagIfNew(id: string, name: string) {
  const existing = await prisma.tagTranslation.count({ where: { tagId: id } });
  if (existing > 0) return;
  await autoTranslateEntity({ table: "tag", idField: "tagId", id, name });
}

/**
 * Auto-translate product name + description.
 * Only translates locales NOT already provided in existingTranslations.
 */
export function autoTranslateProduct(
  productId: string,
  name: string,
  description: string,
  existingLocales: string[] = []
) {
  _autoTranslateProduct(productId, name, description, existingLocales).catch(() => {});
}

async function _autoTranslateProduct(
  productId: string,
  name: string,
  description: string,
  existingLocales: string[]
) {
  try {
    const enabled = await isAutoTranslateEnabled();
    if (!enabled) return;

    const localesToTranslate = TARGET_LOCALES.filter((l) => !existingLocales.includes(l));
    if (localesToTranslate.length === 0) return;

    for (const locale of localesToTranslate) {
      const [translatedName, translatedDesc] = await Promise.all([
        name.trim() ? translateText(name, "fr", locale) : Promise.resolve(""),
        description.trim() ? translateText(description, "fr", locale) : Promise.resolve(""),
      ]);

      if (translatedName.trim() || translatedDesc.trim()) {
        await prisma.productTranslation.upsert({
          where: { productId_locale: { productId, locale } },
          update: { name: translatedName, description: translatedDesc },
          create: { productId, locale, name: translatedName, description: translatedDesc },
        });
      }
    }
  } catch {
    // Silent
  }
}
