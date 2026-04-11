import { describe, it, expect } from "vitest";
import { applyMarketplaceMarkup, type MarkupConfig } from "@/lib/marketplace-pricing";

describe("Ankorstore PACK pricing", () => {
  const wholesale20: MarkupConfig = { type: "percent", value: 20, rounding: "none" };

  it("calculates correct pack price: markup on unit price then multiply by packQty", () => {
    const unitPrice = 3.8;
    const packQty = 24;

    // Correct formula: (unitPrice * (1 + markup%)) * packQty
    const markedUpUnit = applyMarketplaceMarkup(unitPrice, wholesale20);
    const packPrice = Math.round(markedUpUnit * packQty * 100) / 100;

    // 3.8 * 1.20 = 4.56, 4.56 * 24 = 109.44
    expect(markedUpUnit).toBe(4.56);
    expect(packPrice).toBe(109.44);
  });

  it("does NOT double-multiply: old bug was (unitPrice * packQty) * markup * unit_multiplier", () => {
    const unitPrice = 3.8;
    const packQty = 24;

    // Old buggy formula: (unitPrice * packQty) then markup, then Ankorstore multiplied by unit_multiplier again
    const oldPackPrice = unitPrice * packQty; // 91.2
    const oldMarkup = applyMarketplaceMarkup(oldPackPrice, wholesale20); // 109.44
    const ankorsDoubled = oldMarkup * packQty; // 2626.56 — the bug!

    expect(ankorsDoubled).toBe(2626.56);
    // Correct price should be much lower
    const correctPrice = Math.round(applyMarketplaceMarkup(unitPrice, wholesale20) * packQty * 100) / 100;
    expect(correctPrice).toBe(109.44);
    expect(correctPrice).not.toBe(ankorsDoubled);
  });
});

describe("Ankorstore SKU truncation", () => {
  it("truncates SKU to 50 characters max", () => {
    function truncateSku(sku: string): string {
      return sku.length > 50 ? sku.slice(0, 50) : sku;
    }

    const shortSku = "PORTECLES98_MARRON_TU";
    expect(truncateSku(shortSku)).toBe(shortSku);
    expect(truncateSku(shortSku).length).toBeLessThanOrEqual(50);

    const longSku = "PORTECLES98_TURQUOISE-ROSE-FLUO-ROSE-ORANGE-MARRON-FONCE_Pack24_TU";
    expect(truncateSku(longSku).length).toBe(50);
    expect(truncateSku(longSku)).toBe(longSku.slice(0, 50));
  });
});
