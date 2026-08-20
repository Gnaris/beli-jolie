import { describe, it, expect } from "vitest";
import {
  getOrderchampWholesalePrice,
  getOrderchampChainedRetailPrice,
} from "@/lib/orderchamp-pricing";
import type { MarkupConfig } from "@/lib/marketplace-pricing";

const wholesale: MarkupConfig = { type: "multiplier", value: 1.2, rounding: "up" };
const retail: MarkupConfig = { type: "multiplier", value: 3, rounding: "up" };
const noMarkup: MarkupConfig = { type: "percent", value: 0, rounding: "none" };

describe("orderchamp-pricing", () => {
  it("applique le markup wholesale sur un UNIT", () => {
    // 4.20 × 1.2 = 5.04 → arrondi supérieur au dixième = 5.10
    const wp = getOrderchampWholesalePrice(4.2, null, "UNIT", wholesale);
    expect(wp).toBe(5.1);
  });

  it("chaîne retail sur wholesale déjà majoré (IEEE-754 safe)", () => {
    // wholesale = 5.10 (arrondi ci-dessus)
    // retail = 5.10 × 3 = 15.30 → arrondi supérieur au dixième = 15.30 pile
    // (test principal contre le bug IEEE-754 : 5.1 * 3 = 15.299999...)
    const rp = getOrderchampChainedRetailPrice(4.2, null, "UNIT", wholesale, retail);
    expect(rp).toBeGreaterThanOrEqual(15.3);
    expect(rp).toBeLessThan(15.5);
  });

  it("PACK : markup sur prix unitaire, arrondi, ×qty", () => {
    // total 12€ / qty 3 = 4€ unitaire → ×1.2 = 4.80 → ×3 = 14.40
    const wp = getOrderchampWholesalePrice(12, 3, "PACK", wholesale);
    expect(wp).toBe(14.4);
  });

  it("sans markup, retourne le basePrice tel quel", () => {
    expect(getOrderchampWholesalePrice(4.2, null, "UNIT", noMarkup)).toBe(4.2);
    expect(getOrderchampChainedRetailPrice(4.2, null, "UNIT", noMarkup, noMarkup)).toBe(4.2);
  });

  it("PACK retail : chaînage au niveau unitaire puis × qty", () => {
    // 12€ / 3 = 4€ → wholesale 4.80 → retail 14.40 → × 3 = 43.20
    const rp = getOrderchampChainedRetailPrice(12, 3, "PACK", wholesale, retail);
    expect(rp).toBeCloseTo(43.2, 2);
  });
});
