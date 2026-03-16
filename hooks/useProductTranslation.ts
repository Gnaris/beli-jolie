"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";
import { translateProduct, translateCategoryName } from "@/lib/product-translations";

/**
 * Hook to translate product-related text (names, descriptions, categories)
 * from French to the current locale.
 *
 * 100% client-side, 100% free — uses dictionary-based translation
 * optimized for jewelry terminology.
 *
 * Usage:
 *   const { tp, tc } = useProductTranslation();
 *   <span>{tp(product.name)}</span>
 *   <span>{tc(category.name)}</span>
 */
export function useProductTranslation() {
  const locale = useLocale();

  const tp = useCallback(
    (text: string | null | undefined) => translateProduct(text, locale),
    [locale]
  );

  const tc = useCallback(
    (name: string | null | undefined) => translateCategoryName(name, locale),
    [locale]
  );

  return { tp, tc, locale };
}
