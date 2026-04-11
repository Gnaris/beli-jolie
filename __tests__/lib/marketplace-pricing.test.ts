import { describe, it, expect } from "vitest";
import { applyMarketplaceMarkup, type MarkupConfig } from "@/lib/marketplace-pricing";

describe("applyMarketplaceMarkup", () => {
  // ─── No markup ────────────────────────────────────────────────────────────
  it("returns base price when markup value is 0", () => {
    const config: MarkupConfig = { type: "percent", value: 0, rounding: "up" };
    expect(applyMarketplaceMarkup(4.50, config)).toBe(4.50);
  });

  // ─── Percent markup ───────────────────────────────────────────────────────
  it("applies percent markup correctly", () => {
    const config: MarkupConfig = { type: "percent", value: 10, rounding: "none" };
    expect(applyMarketplaceMarkup(10, config)).toBe(11);
  });

  // ─── Fixed markup ─────────────────────────────────────────────────────────
  it("applies fixed markup correctly", () => {
    const config: MarkupConfig = { type: "fixed", value: 2, rounding: "none" };
    expect(applyMarketplaceMarkup(4.50, config)).toBe(6.50);
  });

  // ─── Rounding: none (keeps 2 decimal places) ─────────────────────────────
  it("rounds to 2 decimal places with rounding=none", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "none" };
    // 4.495 * 1.11 = 4.98945 → 4.99
    expect(applyMarketplaceMarkup(4.495, config)).toBe(4.99);
  });

  // ─── Rounding: up (rounds to next euro) ───────────────────────────────────
  it("rounds up to next euro (4.96 → 5)", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "up" };
    // 4.468... * 1.11 ≈ 4.96 → ceil → 5
    expect(applyMarketplaceMarkup(4.47, config)).toBe(5);
  });

  it("rounds up to next euro (4.01 → 5)", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "up" };
    // 4.50 * 1.11 = 4.995 → ceil → 5
    expect(applyMarketplaceMarkup(4.50, config)).toBe(5);
  });

  it("does not round up when already an integer", () => {
    const config: MarkupConfig = { type: "percent", value: 100, rounding: "up" };
    // 5 * 2 = 10 → ceil → 10
    expect(applyMarketplaceMarkup(5, config)).toBe(10);
  });

  it("rounds up small fractions to next euro", () => {
    const config: MarkupConfig = { type: "fixed", value: 0.01, rounding: "up" };
    // 5 + 0.01 = 5.01 → ceil → 6
    expect(applyMarketplaceMarkup(5, config)).toBe(6);
  });

  // ─── Rounding: down (rounds to lower euro) ────────────────────────────────
  it("rounds down to lower euro (4.96 → 4)", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "down" };
    // 4.47 * 1.11 ≈ 4.9617 → floor → 4
    expect(applyMarketplaceMarkup(4.47, config)).toBe(4);
  });

  it("rounds down when just below next euro (4.99 → 4)", () => {
    const config: MarkupConfig = { type: "fixed", value: 0.99, rounding: "down" };
    // 4 + 0.99 = 4.99 → floor → 4
    expect(applyMarketplaceMarkup(4, config)).toBe(4);
  });

  it("does not round down when already an integer", () => {
    const config: MarkupConfig = { type: "percent", value: 100, rounding: "down" };
    // 5 * 2 = 10 → floor → 10
    expect(applyMarketplaceMarkup(5, config)).toBe(10);
  });

  // ─── User's exact reported case: +11% gives ~4.96 → should be 5, not 4.99 ─
  it("user case: 11% markup on ~4.47 rounds up to 5, not 4.99", () => {
    const config: MarkupConfig = { type: "percent", value: 11, rounding: "up" };
    // Trying various base prices that produce ~4.96 after 11%
    const result = applyMarketplaceMarkup(4.47, config);
    expect(result).toBe(5);
    expect(result).not.toBe(4.99);
  });
});
