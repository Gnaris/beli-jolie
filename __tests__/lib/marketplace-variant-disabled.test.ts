/**
 * Une variante `disabled` doit être neutralisée sur les 3 marketplaces qui,
 * historiquement, ignoraient ce flag :
 *   - PFS       → `is_active: false` (vrai flag natif partenaire)
 *   - Ankorstore → `stockQuantity: 0` (pas de vrai "désactiver" côté API)
 *   - Faire      → `available_quantity: 0` + `active: false`
 *
 * Le stock BDD reste intact ; réactiver la variante repousse le vrai stock
 * (couvert par les cas "réactivation" ci-dessous).
 *
 * Régression : jusqu'au patch 2026-07-27, seule eFashion consommait `disabled`.
 * Une variante désactivée sur BJ restait donc visible et achetable sur les
 * 3 autres marketplaces tant qu'elle avait du stock (bug F58).
 */

import { describe, it, expect } from "vitest";
import { getEffectiveStockForAnkorstore } from "@/lib/ankorstore-publish";
import { pfsComputeVariantIsActive as pfsIsActive } from "@/lib/pfs-publish";
import { buildFaireProductPayload, type FairePublishContext } from "@/lib/faire-publish";
import type { MarkupConfig } from "@/lib/marketplace-pricing";

describe("PFS — pfsComputeVariantIsActive", () => {
  it("variante avec stock > 0 mais disabled=true → is_active=false", () => {
    expect(pfsIsActive({ stock: 10, disabled: true }, true)).toBe(false);
    expect(pfsIsActive({ stock: 10, disabled: true }, false)).toBe(false);
  });

  it("variante avec stock > 0 et disabled=false → is_active=true", () => {
    expect(pfsIsActive({ stock: 10, disabled: false }, true)).toBe(true);
  });

  it("réactivation : disabled repasse à false → is_active suit le stock", () => {
    expect(pfsIsActive({ stock: 5, disabled: false }, true)).toBe(true);
    expect(pfsIsActive({ stock: 0, disabled: false }, true)).toBe(false);
  });

  it("deactivateOnZeroStock=false : stock=0 seul ne désactive pas", () => {
    expect(pfsIsActive({ stock: 0, disabled: false }, false)).toBe(true);
    expect(pfsIsActive({ stock: 0, disabled: true }, false)).toBe(false);
  });
});

describe("Ankorstore — getEffectiveStockForAnkorstore", () => {
  it("variante avec stock > 0 mais disabled=true → 0", () => {
    expect(getEffectiveStockForAnkorstore({ stock: 42, disabled: true }, "ONLINE")).toBe(0);
  });

  it("variante active sur produit ONLINE → vrai stock", () => {
    expect(getEffectiveStockForAnkorstore({ stock: 42, disabled: false }, "ONLINE")).toBe(42);
  });

  it("produit ARCHIVED ou OFFLINE → 0 même si variante active (comportement conservé)", () => {
    expect(getEffectiveStockForAnkorstore({ stock: 42, disabled: false }, "ARCHIVED")).toBe(0);
    expect(getEffectiveStockForAnkorstore({ stock: 42, disabled: false }, "OFFLINE")).toBe(0);
  });

  it("réactivation : disabled repasse à false → vrai stock repart chez AS", () => {
    const stock = getEffectiveStockForAnkorstore({ stock: 42, disabled: false }, "ONLINE");
    expect(stock).toBe(42);
  });
});

// ─────────────────────────────────────────────
// Faire — test via le payload complet (helpers privés)
// ─────────────────────────────────────────────

const wholesale: MarkupConfig = { type: "percent", value: 0, rounding: "none" };
const retail: MarkupConfig = { type: "multiplier", value: 2.5, rounding: "none" };

const ctx: FairePublishContext = {
  taxonomyTypeId: "tt_test",
  tariffCode: "7117.19.00",
  countryAlpha2: "CN",
  description: "Bracelet test",
  countryUsedFallback: false,
};

function makeFaireProduct(colors: Array<{ id: string; stock: number; disabled: boolean; colorId: string; colorName: string }>) {
  return {
    id: "p1",
    reference: "F58",
    name: "Bracelet test",
    description: "Bracelet acier",
    status: "ONLINE",
    primaryColorId: colors[0]?.colorId ?? null,
    hsCode: { code: "7117.19.00" },
    category: { id: "cat", name: "Bracelet", faireTaxonomyId: "tt_test" },
    colors: colors.map((c) => ({
      id: c.id,
      faireVariantId: null,
      unitPrice: 10,
      weight: 0.02,
      stock: c.stock,
      isPrimary: c.id === colors[0]?.id,
      disabled: c.disabled,
      saleType: "UNIT" as const,
      packQuantity: null,
      colorId: c.colorId,
      color: { id: c.colorId, name: c.colorName },
      variantSizes: [],
      packLines: [],
    })),
    colorImages: colors.map((c) => ({
      path: `/uploads/produits/F58/${c.colorId}-1.webp`,
      order: 0,
      colorId: c.colorId,
    })),
    compositions: [{ percentage: 100, composition: { name: "Acier" } }],
    countryIsoCode: "CN",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    sizeDetailsTu: null,
  } as Parameters<typeof buildFaireProductPayload>[0];
}

describe("Faire — buildFaireProductPayload + variante disabled", () => {
  it("variante disabled=true avec stock 10 → available_quantity=0 et active=false", () => {
    const { variants } = buildFaireProductPayload(
      makeFaireProduct([
        { id: "v-or", stock: 10, disabled: true, colorId: "c-or", colorName: "Or" },
        { id: "v-ar", stock: 3, disabled: false, colorId: "c-ar", colorName: "Argent" },
      ]),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const or = variants.find((v) => v.bjVariantId === "v-or");
    const ar = variants.find((v) => v.bjVariantId === "v-ar");
    expect(or?.payload.available_quantity).toBe(0);
    expect(or?.payload.active).toBe(false);
    // Variante active à côté : inchangée.
    expect(ar?.payload.available_quantity).toBe(3);
    expect(ar?.payload.active).toBe(true);
  });

  it("réactivation : disabled repasse à false → available_quantity et active repartent", () => {
    const { variants } = buildFaireProductPayload(
      makeFaireProduct([
        { id: "v-or", stock: 10, disabled: false, colorId: "c-or", colorName: "Or" },
      ]),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    const or = variants[0];
    expect(or.payload.available_quantity).toBe(10);
    expect(or.payload.active).toBe(true);
  });
});
