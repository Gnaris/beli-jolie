import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyFaireMarkupWithClamp,
  loadMarketplaceMarkupConfigs,
} from "@/lib/marketplace-pricing";

vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { findMany: vi.fn() } },
}));

describe("applyFaireMarkupWithClamp", () => {
  // Convention métier (confirmée juillet 2026, bug U02) : le markup retail
  // s'applique sur le PRIX DE GROS déjà majoré, pas sur le basePrice BJ.
  // Aligné sur ce que fait déjà Ankorstore.

  it("clamp le retail si le markup donne moins que 2× le wholesale", () => {
    // wholesale = base = 10€, retail +50% sur wholesale = 15€ → clamp à 2×10 = 20€
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "percent" as const, value: 50, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(10, wholesale, retail);
    expect(r.wholesale).toBe(10);
    expect(r.retail).toBe(20);
  });

  it("garde le retail tel quel si déjà ≥ 2× le wholesale", () => {
    // wholesale = 10€, retail ×3 sur wholesale = 30€ → 30 ≥ 20 → garde 30
    const wholesale = { type: "percent" as const, value: 0, rounding: "none" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(10, wholesale, retail);
    expect(r.wholesale).toBe(10);
    expect(r.retail).toBe(30);
  });

  it("retail s'applique sur le wholesale majoré (pas sur le basePrice)", () => {
    // base 10€ · wholesale +20% = 12€ · retail +50% sur wholesale = 18€
    // → 18 < 24 (2×12) → clamp à 24€
    const wholesale = { type: "percent" as const, value: 20, rounding: "none" as const };
    const retail = { type: "percent" as const, value: 50, rounding: "none" as const };
    const r = applyFaireMarkupWithClamp(10, wholesale, retail);
    expect(r.wholesale).toBe(12);
    expect(r.retail).toBe(24);
  });

  it("arrondit le clamp au dixième supérieur", () => {
    // wholesale = 4.33€, retail = 4.33€ (markup 0), clamp minRetail = 8.66€
    // → ceil dixième = 8.7€
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

  it("bug U02 (juillet 2026) : retail calculé sur le WHOLESALE, sans dérapage IEEE-754", () => {
    // Cas prod U02 : base 4,20 € · wholesale +20 % arrondi haut = 5,10 €
    // · retail ×3 sur wholesale arrondi haut = 15,30 € (et non 12,60 € ni
    // 12,70 € — les 2 valeurs foireuses observées avant les fixes).
    // Sans la normalisation en centimes avant l'arrondi, on aurait aussi
    // eu 5,10 × 3 = 15,300000000000001 → ceil = 15,40 €.
    const wholesale = { type: "percent" as const, value: 20, rounding: "up" as const };
    const retail = { type: "multiplier" as const, value: 3, rounding: "up" as const };
    const r = applyFaireMarkupWithClamp(4.2, wholesale, retail);
    expect(r.wholesale).toBe(5.1);
    expect(r.retail).toBe(15.3);
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
