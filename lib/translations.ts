import { DEFAULT_LOCALE } from "@/i18n/locales";

type TranslationRecord = { locale: string; name: string };

/**
 * Le nom dans la locale par défaut (fr) est stocké dans la colonne principale
 * (`Category.name`, `SubCategory.name`, etc.) et n'est PAS dupliqué dans la
 * table `*Translation`. Cet helper reconstitue une map complète {locale: name}
 * pour l'UI, en seedant la locale par défaut depuis le nom de base — sauf si
 * un enregistrement de traduction explicite pour cette locale existe déjà, qui
 * a alors priorité.
 */
export function buildTranslationsMap(
  baseName: string,
  records: TranslationRecord[],
): Record<string, string> {
  const map: Record<string, string> = { [DEFAULT_LOCALE]: baseName };
  for (const r of records) map[r.locale] = r.name;
  return map;
}
