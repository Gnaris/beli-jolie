import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAnkorstorePackedPrice, toCents, loadAnkorstorePricingConfig } from "@/lib/ankorstore-pricing";

vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { findMany: vi.fn() } },
}));

describe("getAnkorstorePackedPrice", () => {
  it("UNIT — applique le markup directement", () => {
    expect(getAnkorstorePackedPrice(10, null, "UNIT", { type: "percent", value: 50, rounding: "none" })).toBe(15);
  });

  it("PACK — markup sur prix unitaire puis × quantité", () => {
    // Pack de 6 à 60€ total = 10€/u → +50% = 15€/u → ×6 = 90€
    expect(getAnkorstorePackedPrice(60, 6, "PACK", { type: "percent", value: 50, rounding: "none" })).toBe(90);
  });

  it("PACK avec arrondi up — arrondit le prix unitaire avant multiplication", () => {
    // 60€ ÷ 6 = 10€ → +33% = 13.30€ → arrondi up = 14€ → ×6 = 84€
    expect(getAnkorstorePackedPrice(60, 6, "PACK", { type: "percent", value: 33, rounding: "up" })).toBe(84);
  });

  it("packQuantity null/0 → traité comme 1", () => {
    expect(getAnkorstorePackedPrice(10, null, "PACK", { type: "fixed", value: 2, rounding: "none" })).toBe(12);
    expect(getAnkorstorePackedPrice(10, 0, "PACK", { type: "fixed", value: 2, rounding: "none" })).toBe(12);
  });
});

describe("toCents", () => {
  it("convertit euros vers centimes", () => {
    expect(toCents(15)).toBe(1500);
    expect(toCents(15.45)).toBe(1545);
    expect(toCents(15.456)).toBe(1546); // arrondi
  });
});

describe("loadAnkorstorePricingConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne les valeurs par défaut si rien en BDD", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.siteConfig.findMany).mockResolvedValue([]);
    const cfg = await loadAnkorstorePricingConfig();
    expect(cfg.wholesale).toEqual({ type: "percent", value: 0, rounding: "none" });
    expect(cfg.retail).toEqual({ type: "percent", value: 0, rounding: "none" });
    expect(cfg.vatRate).toBe(20);
  });

  it("lit les clés existantes", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.siteConfig.findMany).mockResolvedValue([
      { key: "ankorstore_wholesale_markup_type", value: "percent" },
      { key: "ankorstore_wholesale_markup_value", value: "30" },
      { key: "ankorstore_wholesale_markup_rounding", value: "up" },
      { key: "ankorstore_default_vat_rate", value: "5.5" },
    ] as never);
    const cfg = await loadAnkorstorePricingConfig();
    expect(cfg.wholesale).toEqual({ type: "percent", value: 30, rounding: "up" });
    expect(cfg.vatRate).toBe(5.5);
  });
});
