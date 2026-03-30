/**
 * Auto-translation service — translates entity names/descriptions automatically
 * when the "auto_translate_enabled" setting is active and a DeepL key is configured.
 *
 * All functions are fire-and-forget safe (catch errors silently) to never block
 * the main entity creation flow.
 */

import { prisma } from "@/lib/prisma";
import { translateText, type Locale } from "@/lib/translate";

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
  /** Locales already provided manually — skip these */
  skipLocales?: string[];
};

async function autoTranslateEntity(entity: EntityTranslator) {
  try {
    const enabled = await isAutoTranslateEnabled();
    if (!enabled) return;

    const localesToTranslate = entity.skipLocales?.length
      ? TARGET_LOCALES.filter((l) => !entity.skipLocales!.includes(l))
      : TARGET_LOCALES;
    if (localesToTranslate.length === 0) return;

    // Translate each locale individually (graceful degradation on quota)
    for (const locale of localesToTranslate) {
      try {
        const val = await translateText(entity.name, "fr", locale);
        if (!val?.trim() || val === entity.name) continue;

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
        console.log(`[AutoTranslate] ${entity.table} "${entity.name}" → ${locale}: "${val}"`);
      } catch (err) {
        console.warn(`[AutoTranslate] Failed ${entity.table} "${entity.name}" → ${locale}:`, err);
      }
    }
  } catch (err) {
    console.warn(`[AutoTranslate] Failed for ${entity.table} "${entity.name}":`, err);
  }
}

// ── Public helpers (await-safe, errors silenced) ─────────────────────────────

export function autoTranslateColor(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "color", idField: "colorId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateComposition(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "composition", idField: "compositionId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateCategory(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "category", idField: "categoryId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateSubCategory(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "subcategory", idField: "subCategoryId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateCollection(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "collection", idField: "collectionId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateManufacturingCountry(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "manufacturing-country", idField: "manufacturingCountryId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateSeason(id: string, name: string, skipLocales?: string[]) {
  return autoTranslateEntity({ table: "season", idField: "seasonId", id, name, skipLocales }).catch(() => {});
}

export function autoTranslateTag(id: string, name: string, skipLocales?: string[]) {
  return _autoTranslateTagIfNew(id, name, skipLocales).catch(() => {});
}

async function _autoTranslateTagIfNew(id: string, name: string, skipLocales?: string[]) {
  const existing = await prisma.tagTranslation.count({ where: { tagId: id } });
  if (existing > 0) return;
  await autoTranslateEntity({ table: "tag", idField: "tagId", id, name, skipLocales });
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
        console.log(`[AutoTranslate] Product "${name}" → ${locale}: "${translatedName}"`);
      }
    }
  } catch (err) {
    console.warn(`[AutoTranslate] Failed for product "${name}":`, err);
  }
}
