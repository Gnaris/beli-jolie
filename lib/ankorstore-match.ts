/**
 * Ankorstore Product Matching Engine
 *
 * Extracts product references from Ankorstore products and matches them
 * against local BJ products. Also performs variant-level matching
 * based on SKU color parts and BJ color names.
 */

import type { AnkorstoreProduct, AnkorstoreVariant } from "@/lib/ankorstore-api";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type MatchStatus = "matched" | "ambiguous" | "unmatched";

export interface VariantMatchPair {
  ankorstoreVariant: AnkorstoreVariant;
  bjColorId: string | null;
  bjColorName: string | null;
  confidence: "exact" | "fuzzy" | "none";
}

export interface MatchResult {
  ankorstoreProduct: AnkorstoreProduct;
  status: MatchStatus;
  extractedRef: string | null;
  bjProductIds: string[]; // 0 = unmatched, 1 = matched, 2+ = ambiguous
  bjProductNames: string[];
  variantMatches: VariantMatchPair[];
}

export interface MatchReport {
  matched: number;
  ambiguous: number;
  unmatched: number;
  total: number;
  results: MatchResult[];
}

// Minimal BJ product shape needed for matching
export interface BjProductForMatch {
  id: string;
  name: string;
  reference: string;
  colors: { id: string; name: string }[];
}

// ─────────────────────────────────────────────
// Reference extraction
// ─────────────────────────────────────────────

/**
 * Extract a product reference from an Ankorstore product.
 *
 * Cascade:
 * 1. First variant SKU → split on "_" → take first segment
 * 2. Product name → split on " - " → take last segment
 * 3. Description → regex for "Référence : {ref}"
 */
export function extractReference(product: AnkorstoreProduct): string | null {
  // 1. From first variant SKU
  if (product.variants.length > 0) {
    const firstSku = product.variants[0].sku;
    if (firstSku) {
      const segment = firstSku.split("_")[0].trim();
      if (segment.length >= 2) {
        return segment;
      }
    }
  }

  // 2. From product name (last segment after " - ")
  if (product.name.includes(" - ")) {
    const parts = product.name.split(" - ");
    const lastPart = parts[parts.length - 1].trim();
    if (lastPart.length >= 2) {
      return lastPart;
    }
  }

  // 3. From description via regex
  if (product.description) {
    const match = product.description.match(
      /[Rr][ée]f[ée]rence\s*:\s*([A-Za-z0-9\-_.]+)/
    );
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// Color normalization for variant matching
// ─────────────────────────────────────────────

/**
 * Normalize a color name for comparison:
 * lowercase, remove accents, trim, collapse whitespace.
 */
function normalizeColor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the color part from an Ankorstore variant SKU.
 * Assumes format: REF_COLOR or REF_COLOR_SIZE.
 * Returns the color segment or the variant name as fallback.
 */
function extractSkuColorPart(variant: AnkorstoreVariant): string {
  if (variant.sku) {
    const parts = variant.sku.split("_");
    if (parts.length >= 2) {
      return parts[1];
    }
  }
  // Fallback: use variant name
  return variant.name;
}

// ─────────────────────────────────────────────
// Variant matching within a matched product
// ─────────────────────────────────────────────

function matchVariants(
  ankorstoreVariants: AnkorstoreVariant[],
  bjColors: { id: string; name: string }[]
): VariantMatchPair[] {
  const normalizedBj = bjColors.map((c) => ({
    ...c,
    normalized: normalizeColor(c.name),
  }));

  return ankorstoreVariants.map((variant) => {
    const colorPart = extractSkuColorPart(variant);
    const normalizedAk = normalizeColor(colorPart);

    // Exact match
    const exact = normalizedBj.find((c) => c.normalized === normalizedAk);
    if (exact) {
      return {
        ankorstoreVariant: variant,
        bjColorId: exact.id,
        bjColorName: exact.name,
        confidence: "exact" as const,
      };
    }

    // Fuzzy match: one contains the other
    const fuzzy = normalizedBj.find(
      (c) =>
        c.normalized.includes(normalizedAk) ||
        normalizedAk.includes(c.normalized)
    );
    if (fuzzy) {
      return {
        ankorstoreVariant: variant,
        bjColorId: fuzzy.id,
        bjColorName: fuzzy.name,
        confidence: "fuzzy" as const,
      };
    }

    return {
      ankorstoreVariant: variant,
      bjColorId: null,
      bjColorName: null,
      confidence: "none" as const,
    };
  });
}

// ─────────────────────────────────────────────
// Main auto-matching
// ─────────────────────────────────────────────

/**
 * Run automatic matching between Ankorstore products and BJ products.
 *
 * For each Ankorstore product:
 * 1. Extract reference
 * 2. Look up in BJ by reference (case-insensitive)
 * 3. If exactly 1 match → matched; 2+ → ambiguous; 0 → unmatched
 * 4. For matched products, also match variants by color
 */
export function runAutoMatch(
  ankorstoreProducts: AnkorstoreProduct[],
  bjProducts: BjProductForMatch[]
): MatchReport {
  // Build a lookup map: lowercase reference → BJ products[]
  const refMap = new Map<string, BjProductForMatch[]>();
  for (const bj of bjProducts) {
    const key = bj.reference.toLowerCase().trim();
    if (!key) continue;
    const existing = refMap.get(key) ?? [];
    existing.push(bj);
    refMap.set(key, existing);
  }

  const results: MatchResult[] = [];
  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const akProduct of ankorstoreProducts) {
    const ref = extractReference(akProduct);
    const refLower = ref?.toLowerCase().trim() ?? "";
    const bjMatches = refLower ? (refMap.get(refLower) ?? []) : [];

    let status: MatchStatus;
    let variantMatches: VariantMatchPair[] = [];

    if (bjMatches.length === 1) {
      status = "matched";
      matched++;
      variantMatches = matchVariants(akProduct.variants, bjMatches[0].colors);
    } else if (bjMatches.length > 1) {
      status = "ambiguous";
      ambiguous++;
    } else {
      status = "unmatched";
      unmatched++;
    }

    results.push({
      ankorstoreProduct: akProduct,
      status,
      extractedRef: ref,
      bjProductIds: bjMatches.map((b) => b.id),
      bjProductNames: bjMatches.map((b) => b.name),
      variantMatches,
    });
  }

  logger.info("[Ankorstore] Auto-match complete", {
    total: ankorstoreProducts.length,
    matched,
    ambiguous,
    unmatched,
  });

  return { matched, ambiguous, unmatched, total: ankorstoreProducts.length, results };
}
