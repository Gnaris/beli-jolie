import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyFaireMarkupWithClamp,
  loadMarketplaceMarkupConfigs,
} from "@/lib/marketplace-pricing";

vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { findMany: vi.fn() } },
}));

describe("applyFaireMarkupWithClamp", () => {
  it("clamp le retail si le markup donne moins que 2× le wholesale", () => {
    // wholesale = base = 10€, retail markup +50% = 15€ → clamp à 2×10 = 20€
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "percent" as const, value: 50, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(10, wholesale, retail);
    expect(r.wholesale).toBe(10);
    expect(r.retail).toBe(20);
  });

  it("garde le retail tel quel si déjà ≥ 2× le wholesale", () => {
    // wholesale = 10€, retail ×3 = 30€ → 30 ≥ 20 → garde 30
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(10, wholesale, retail);
    expect(r.wholesale).toBe(10);
    expect(r.retail).toBe(30);
  });

  it("clamp avec wholesale markupé : base 10€ +20% = 12€ wholesale, retail = exactement 24€ minimum", () => {
    // wholesale = 10 +20% = 12€, retail markup +50% sur base = 15€ → clamp à 24€
    const wholesale = { type: "percent" as const, value: 20, rounding: "none" as const };
    const retail = { type: "percent" as const, value: 50, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(10, wholesale, retail);
    expect(r.wholesale).toBe(12);
    expect(r.retail).toBe(24);
  });

  it("arrondit le clamp au dixième supérieur", () => {
    // wholesale = 4.33€, retail seuil = 8.66€ → ceil dixième = 8.7€
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "percent" as const, value: 0, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(4.33, wholesale, retail);
    expect(r.wholesale).toBe(4.33);
    expect(r.retail).toBe(8.7);
  });

  it("fonctionne avec base 0 (cas dégénéré)", () => {
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(0, wholesale, retail);
    expect(r.wholesale).toBe(0);
    expect(r.retail).toBe(0);
  });
});

describe("loadMarketplaceMarkupConfigs — faire", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne les défauts Faire (wholesale 0%, retail ×2.5 ceil) si rien en BDD", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.siteConfig.findMany).mockResolvedValue([]);
    const cfg = await loadMarketplaceMarkupConfigs();
    expect(cfg.faireWholesale).toEqual({ type: "percent", value: 0, rounding: "none" });
    expect(cfg.faireRetail).toEqual({ type: "multiplier", value: 2.5, rounding: "up" });
  });

  it("lit les clés faire_*_markup_* personnalisées", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.siteConfig.findMany).mockResolvedValue([
      { key: "faire_wholesale_markup_type", value: "percent" },
      { key: "faire_wholesale_markup_value", value: "15" },
      { key: "faire_wholesale_markup_rounding", value: "up" },
      { key: "faire_retail_markup_type", value: "multiplier" },
      { key: "faire_retail_markup_value", value: "3" },
      { key: "faire_retail_markup_rounding", value: "up" },
    ] as never);
    const cfg = await loadMarketplaceMarkupConfigs();
    expect(cfg.faireWholesale).toEqual({ type: "percent", value: 15, rounding: "up" });
    expect(cfg.faireRetail).toEqual({ type: "multiplier", value: 3, rounding: "up" });
  });
});
