/**
 * Auto-translation service — translates entity names/descriptions automatically
 * when the "auto_translate_enabled" setting is active. Sous le capot, la
 * traduction passe par l'API Paris Fashion Shop (cf. `lib/pfs-translate.ts`).
 *
 * All functions are fire-and-forget safe (catch errors silently) to never block
 * the main entity creation flow.
 */

import { prisma } from "@/lib/prisma";
import { translateTextStrict, type Locale } from "@/lib/translate";
import { translatePhrases, type PfsTranslationLocale } from "@/lib/pfs-translate";
import { AUTO_TRANSLATE_LOCALES } from "@/i18n/locales";

const TARGET_LOCALES: Locale[] = AUTO_TRANSLATE_LOCALES;

/** Check if auto-translate is enabled in SiteConfig */
export async function isAutoTranslateEnabled(): Promise<boolean> {
  const config = await prisma.siteConfig.findFirst({
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
        const val = await translateTextStrict(entity.name, "fr", locale);
        // null = retry exhausted → ne PAS écrire en BDD (l'icône ⚠ restera visible)
        if (val === null) continue;
        if (!val.trim() || val === entity.name) continue;

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
      } catch {
        // Silently ignore per-locale translation failures
      }
    }
  } catch (err) {
    // Silently ignore entity translation failures
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

    // Locales verrouillées par une édition manuelle admin : on NE doit pas les
    // écraser par le mot-à-mot PFS (souvent bancal, ex. "Robe sans manches"
    // → "Dress without sleeves" au lieu de "Sleeveless dress"). Le flag
    // `manualEdit` est posé par le server action produit sur chaque locale
    // effectivement modifiée dans le form.
    const manuallyEditedRows = await prisma.productTranslation.findMany({
      where: { productId, manualEdit: true },
      select: { locale: true },
    });
    const manuallyEdited = new Set(manuallyEditedRows.map((r) => r.locale));

    const localesToTranslate = TARGET_LOCALES.filter(
      (l) => !existingLocales.includes(l) && !manuallyEdited.has(l),
    );
    if (localesToTranslate.length === 0) return;

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const phrases: Record<string, string> = {};
    if (trimmedName) phrases.name = name;
    if (trimmedDesc) phrases.description = description;
    if (Object.keys(phrases).length === 0) return;

    // 1 seul appel PFS pour les 4 langues × 2 textes (name + description).
    const result = await translatePhrases(phrases, { sourceLanguage: "fr" });
    if (!result) return;

    for (const locale of localesToTranslate) {
      const pfsLocale = locale as PfsTranslationLocale;
      const translatedName = phrases.name ? (result.name?.[pfsLocale] ?? "") : "";
      const translatedDesc = phrases.description ? (result.description?.[pfsLocale] ?? "") : "";

      const finalName = translatedName.trim();
      const finalDesc = translatedDesc.trim();

      // Si on a demandé la trad du nom et qu'elle est vide ou identique au FR,
      // on skip la locale (évite de polluer la BDD avec des traductions ratées).
      if (trimmedName && (!finalName || finalName === trimmedName)) continue;
      if (!finalName && !finalDesc) continue;

      await prisma.productTranslation.upsert({
        where: { productId_locale: { productId, locale } },
        update: { name: finalName, description: finalDesc },
        create: { productId, locale, name: finalName, description: finalDesc },
      });
    }
  } catch {
    // Silently ignore product translation failures
  }
}

