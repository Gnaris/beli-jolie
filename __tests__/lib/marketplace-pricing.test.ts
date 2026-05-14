import { describe, it, expect } from "vitest";
import { applyMarketplaceMarkup, type MarkupConfig } from "@/lib/marketplace-pricing";

describe("applyMarketplaceMarkup", () => {
  // ─── No markup ────────────────────────────────────────────────────────────
  it("returns base price when markup value is 0", () => {
    const config: MarkupConfig = { type: "percent", value: 0, rounding: "up" };
    expect(applyMarketplaceMarkup(4.50, config)).toBe(4.50);
  });

  // ─── Percent markup ───────────────────────────────────────────────────────
  it("applies percent markup correctly (rounding=none)", () => {
    const config: MarkupConfig = { type: "percent", value: 10, rounding: "none" };
    expect(applyMarketplaceMarkup(10, config)).toBe(11);
  });

  // ─── Fixed markup ─────────────────────────────────────────────────────────
  it("applies fixed markup correctly (rounding=none)", () => {
    const config: MarkupConfig = { type: "fixed", value: 2, rounding: "none" };
    expect(applyMarketplaceMarkup(4.50, config)).toBe(6.50);
  });

  // ─── Multiplier markup ────────────────────────────────────────────────────
  it("applies multiplier markup correctly (rounding=none)", () => {
    const config: MarkupConfig = { type: "multiplier", value: 3, rounding: "none" };
    expect(applyMarketplaceMarkup(4.2, config)).toBe(12.60);
  });

  // ─── Rounding: none (keeps 2 decimal places) ─────────────────────────────
  it("rounds to 2 decimal places with rounding=none", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "none" };
    // 4.495 * 1.11 = 4.98945 → 4.99
    expect(applyMarketplaceMarkup(4.495, config)).toBe(4.99);
  });

  // ─── Rounding: up (rounds to next 0.10€) ──────────────────────────────────
  it("user case A405: +20% sur 4.20€ → 5.04€ → arrondi au dixième sup = 5.10€", () => {
    const config: MarkupConfig = { type: "percent", value: 20, rounding: "up" };
    expect(applyMarketplaceMarkup(4.2, config)).toBe(5.10);
  });

  it("rounds up to next 0.10€ (4.96 → 5.00 reste 5.00)", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "up" };
    // 4.50 * 1.11 = 4.995 → ceil(49.95)/10 = 50/10 = 5.00
    expect(applyMarketplaceMarkup(4.50, config)).toBe(5.00);
  });

  it("rounds up tiny fractions to next 0.10€ (5.01 → 5.10)", () => {
    const config: MarkupConfig = { type: "fixed", value: 0.01, rounding: "up" };
    // 5 + 0.01 = 5.01 → ceil(50.1)/10 = 51/10 = 5.10
    expect(applyMarketplaceMarkup(5, config)).toBe(5.10);
  });

  it("does not bump up when already on a 0.10€ step", () => {
    const config: MarkupConfig = { type: "percent", value: 100, rounding: "up" };
    // 5 * 2 = 10.00 → ceil(100)/10 = 10
    expect(applyMarketplaceMarkup(5, config)).toBe(10);
  });

  // ─── Rounding: down (rounds to lower 0.10€) ───────────────────────────────
  it("rounds down to lower 0.10€ (4.96 → 4.90)", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "down" };
    // 4.47 * 1.11 ≈ 4.9617 → floor(49.617)/10 = 49/10 = 4.90
    expect(applyMarketplaceMarkup(4.47, config)).toBe(4.90);
  });

  it("rounds down when just below next 0.10€ step (4.99 → 4.90)", () => {
    const config: MarkupConfig = { type: "fixed", value: 0.99, rounding: "down" };
    // 4 + 0.99 = 4.99 → floor(49.9)/10 = 49/10 = 4.90
    expect(applyMarketplaceMarkup(4, config)).toBe(4.90);
  });

  it("does not bump down when already on a 0.10€ step", () => {
    const config: MarkupConfig = { type: "percent", value: 100, rounding: "down" };
    // 5 * 2 = 10.00 → floor(100)/10 = 10
    expect(applyMarketplaceMarkup(5, config)).toBe(10);
  });
});
