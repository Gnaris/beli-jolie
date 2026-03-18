"use client";

import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef } from "react";
import { translateProduct } from "@/lib/product-translations";

// Module-level cache so we only fetch once per locale per browser session
const dbCache: Record<string, Record<string, string>> = {};
const fetchPromises: Record<string, Promise<Record<string, string>>> = {};

async function fetchEntityTranslations(locale: string): Promise<Record<string, string>> {
  if (dbCache[locale]) return dbCache[locale];
  if (!fetchPromises[locale]) {
    fetchPromises[locale] = fetch(`/api/translations/entities?locale=${locale}`)
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        dbCache[locale] = data;
        return data;
      })
      .catch(() => {
        delete fetchPromises[locale]; // allow retry on error
        return {};
      });
  }
  return fetchPromises[locale];
}

/**
 * Hook to translate product-related text (names, descriptions, categories)
 * from French to the current locale.
 *
 * `tp(text)`  — translate product name / description (dictionary-based)
 * `tc(name)`  — translate entity name (DB translations first, dictionary fallback)
 *
 * Usage:
 *   const { tp, tc } = useProductTranslation();
 *   <span>{tp(product.name)}</span>
 *   <span>{tc(category.name)}</span>
 */
export function useProductTranslation() {
  const locale = useLocale();
  const translationsRef = useRef<Record<string, string>>(dbCache[locale] ?? {});

  useEffect(() => {
    if (locale === "fr") return;
    fetchEntityTranslations(locale).then((data) => {
      translationsRef.current = data;
    });
  }, [locale]);

  const tp = useCallback(
    (text: string | null | undefined) => translateProduct(text, locale),
    [locale]
  );

  const tc = useCallback(
    (name: string | null | undefined): string => {
      if (!name) return "";
      if (locale === "fr") return name;
      // DB translation takes priority
      const dbResult = translationsRef.current[name.toLowerCase()];
      if (dbResult) return dbResult;
      // Fallback to dictionary-based translation
      return translateProduct(name, locale);
    },
    [locale]
  );

  return { tp, tc, locale };
}
