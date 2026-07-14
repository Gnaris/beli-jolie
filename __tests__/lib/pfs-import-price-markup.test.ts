import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  loadPfsImportPriceMarkup,
  applyImportMarkupToUnitPrice,
} from "@/lib/pfs-import-price-markup";

const findManyMock = prisma.siteConfig.findMany as unknown as ReturnType<typeof vi.fn>;

describe("loadPfsImportPriceMarkup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne un no-op par défaut quand aucune clé n'existe", async () => {
    findManyMock.mockResolvedValue([]);
    const cfg = await loadPfsImportPriceMarkup();
    expect(cfg).toEqual({ type: "percent", value: 0, rounding: "none" });
  });

  it("lit correctement type/value/rounding depuis SiteConfig", async () => {
    findManyMock.mockResolvedValue([
      { key: "pfs_import_price_markup_type", value: "percent" },
      { key: "pfs_import_price_markup_value", value: "-20" },
      { key: "pfs_import_price_markup_rounding", value: "down" },
    ]);
    const cfg = await loadPfsImportPriceMarkup();
    expect(cfg).toEqual({ type: "percent", value: -20, rounding: "down" });
  });

  it("valeur non numérique → retombe sur 0", async () => {
    findManyMock.mockResolvedValue([
      { key: "pfs_import_price_markup_value", value: "not-a-number" },
    ]);
    const cfg = await loadPfsImportPriceMarkup();
    expect(cfg.value).toBe(0);
  });
});

describe("applyImportMarkupToUnitPrice", () => {
  it("UNIT : 10 € × (-20 %) arrondi none → 8 €", () => {
    expect(
      applyImportMarkupToUnitPrice(10, null, {
        type: "percent",
        value: -20,
        rounding: "none",
      })
    ).toBe(8);
  });

  it("PACK 10 pièces : total 100 € × (-20 %) → total 80 € (markup sur unitaire)", () => {
    expect(
      applyImportMarkupToUnitPrice(100, 10, {
        type: "percent",
        value: -20,
        rounding: "none",
      })
    ).toBe(80);
  });

  it("no-op (value 0) : prix inchangé UNIT et PACK", () => {
    expect(
      applyImportMarkupToUnitPrice(10, null, {
        type: "percent",
        value: 0,
        rounding: "none",
      })
    ).toBe(10);
    expect(
      applyImportMarkupToUnitPrice(100, 10, {
        type: "percent",
        value: 0,
        rounding: "none",
      })
    ).toBe(100);
  });

  it("PACK 10 pièces : arrondi ↑ appliqué sur unitaire puis ×qty", () => {
    // 10 € unitaire × 0.803 = 8,03 € → arrondi ↑ = 8,10 € → ×10 = 81,00 €
    const config = { type: "percent" as const, value: -19.7, rounding: "up" as const };
    expect(applyImportMarkupToUnitPrice(100, 10, config)).toBeCloseTo(81, 2);
  });

  it("packQuantity 1 traité comme UNIT (pas de division)", () => {
    expect(
      applyImportMarkupToUnitPrice(10, 1, {
        type: "percent",
        value: -20,
        rounding: "none",
      })
    ).toBe(8);
  });
});
