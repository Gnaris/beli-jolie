/**
 * Faire — désactivation d'une variante via `lifecycle_state: UNPUBLISHED`.
 *
 * Depuis 2026-08-26 : le stock envoyé à Faire suit le vrai stock BDD, même
 * quand la variante est `disabled`. Le masquage passe par un PATCH ciblé
 * `lifecycle_state: UNPUBLISHED` sur la variante (le champ est marqué
 * "Read-only" dans l'OpenAPI officielle mais l'endpoint l'accepte — vérifié
 * en réel sur A2251(2) / po_6xk62rpezy le 2026-08-26).
 */

import { describe, it, expect } from "vitest";
import { lifecycleFromDisabled } from "@/lib/faire-variant-lifecycle";
import { buildFaireProductPayload, type FairePublishContext } from "@/lib/faire-publish";
import type { MarkupConfig } from "@/lib/marketplace-pricing";

describe("lifecycleFromDisabled", () => {
  it("disabled=true → UNPUBLISHED", () => {
    expect(lifecycleFromDisabled(true)).toBe("UNPUBLISHED");
  });
  it("disabled=false → PUBLISHED", () => {
    expect(lifecycleFromDisabled(false)).toBe("PUBLISHED");
  });
});

const wholesale: MarkupConfig = { type: "percent", value: 0, rounding: "none" };
const retail: MarkupConfig = { type: "multiplier", value: 2.5, rounding: "none" };
const ctx: FairePublishContext = {
  taxonomyTypeId: "tt_test",
  tariffCode: "7117.19.00",
  countryAlpha2: "CN",
  description: "Bracelet test",
  countryUsedFallback: false,
};

function makeProduct(colors: Array<{ id: string; stock: number; disabled: boolean; colorId: string; colorName: string }>) {
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

describe("Faire — payload : disabled ne touche PAS le stock envoyé", () => {
  it("variante disabled=true avec stock 42 → available_quantity=42 (stock réel préservé)", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct([
        { id: "v-or", stock: 42, disabled: true, colorId: "c-or", colorName: "Or" },
      ]),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    expect(variants[0].payload.available_quantity).toBe(42);
    expect(variants[0].disabled).toBe(true);
  });

  it("variante disabled=false stock 3 → available_quantity=3 disabled=false", () => {
    const { variants } = buildFaireProductPayload(
      makeProduct([
        { id: "v-ar", stock: 3, disabled: false, colorId: "c-ar", colorName: "Argent" },
      ]),
      ctx,
      wholesale,
      retail,
      "PUBLISHED",
    );
    expect(variants[0].payload.available_quantity).toBe(3);
    expect(variants[0].disabled).toBe(false);
  });

  it("produit ARCHIVED → available_quantity=0 même sur variantes actives", () => {
    const product = makeProduct([
      { id: "v-or", stock: 42, disabled: false, colorId: "c-or", colorName: "Or" },
    ]);
    product.status = "ARCHIVED" as typeof product.status;
    const { variants } = buildFaireProductPayload(product, ctx, wholesale, retail, "PUBLISHED");
    expect(variants[0].payload.available_quantity).toBe(0);
  });
});
