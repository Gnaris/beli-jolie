import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAnkorstorePackedPrice,
  getAnkorstoreChainedRetailPrice,
  toCents,
  loadAnkorstorePricingConfig,
} from "@/lib/ankorstore-pricing";

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

  it("PACK avec arrondi up — arrondit le prix unitaire au dixième avant multiplication", () => {
    // 60€ ÷ 6 = 10€ → +33% = 13.30€ → arrondi sup 0.10€ = 13.30 → ×6 = 79.80€
    expect(getAnkorstorePackedPrice(60, 6, "PACK", { type: "percent", value: 33, rounding: "up" })).toBe(79.80);
  });

  it("packQuantity null/0 → traité comme 1", () => {
    expect(getAnkorstorePackedPrice(10, null, "PACK", { type: "fixed", value: 2, rounding: "none" })).toBe(12);
    expect(getAnkorstorePackedPrice(10, 0, "PACK", { type: "fixed", value: 2, rounding: "none" })).toBe(12);
  });
});

describe("getAnkorstoreChainedRetailPrice (chaîne wholesale → retail)", () => {
  it("UNIT — cas A405 : 4.20€ +20% arr. sup → 5.10€ ×3 = 15.30€", () => {
    const wholesale = { type: "percent" as const, value: 20, rounding: "up" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "up" as const };
    // 4.20 +20% = 5.04 → ceil dixième = 5.10
    // 5.10 ×3 = 15.30 → déjà sur dixième = 15.30
    expect(getAnkorstoreChainedRetailPrice(4.2, null, "UNIT", wholesale, retail)).toBe(15.30);
  });

  it("UNIT — retail seul (pas de wholesale) calcule sur prix de base", () => {
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "none" as const };
    // wholesale value=0 → applyMarkup retourne basePrice direct
    // 4.20 ×3 = 12.60
    expect(getAnkorstoreChainedRetailPrice(4.2, null, "UNIT", wholesale, retail)).toBe(12.60);
  });

  it("UNIT — wholesale fixed + retail percent enchaînés", () => {
    const wholesale = { type: "fixed" as const, value: 1, rounding: "none" as const };
    const retail = { type: "percent" as const, value: 50, rounding: "none" as const };
    // 10 + 1 = 11 (wholesale)
    // 11 + 50% = 16.50 (retail)
    expect(getAnkorstoreChainedRetailPrice(10, null, "UNIT", wholesale, retail)).toBe(16.50);
  });

  it("PACK — chaîne wholesale → retail au prix unitaire puis × quantité", () => {
    const wholesale = { type: "percent" as const, value: 20, rounding: "up" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "up" as const };
    // Pack de 6 à 25.20€ total = 4.20€/u
    // 4.20 +20% = 5.04 → ceil dixième = 5.10 (wholesale unitaire)
    // 5.10 ×3 = 15.30 → ceil dixième = 15.30 (retail unitaire)
    // 15.30 × 6 = 91.80
    expect(getAnkorstoreChainedRetailPrice(25.2, 6, "PACK", wholesale, retail)).toBe(91.80);
  });

  it("PACK — packQuantity null/0 traité comme 1", () => {
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "multiplier" as const, value: 2, rounding: "none" as const };
    expect(getAnkorstoreChainedRetailPrice(10, null, "PACK", wholesale, retail)).toBe(20);
    expect(getAnkorstoreChainedRetailPrice(10, 0, "PACK", wholesale, retail)).toBe(20);
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
