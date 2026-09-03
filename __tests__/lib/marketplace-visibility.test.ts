import { describe, it, expect } from "vitest";
import { isMarketplaceLinked } from "@/lib/marketplace-visibility";

describe("isMarketplaceLinked", () => {
  it("PFS : lié dès que pfsProductId est posé", () => {
    expect(isMarketplaceLinked({ pfsProductId: "42" }, "pfs")).toBe(true);
    expect(isMarketplaceLinked({ pfsProductId: null }, "pfs")).toBe(false);
    expect(isMarketplaceLinked({}, "pfs")).toBe(false);
  });

  it("Ankorstore : lié dès que ankorsProductId est posé", () => {
    expect(isMarketplaceLinked({ ankorsProductId: "ank-1" }, "ankorstore")).toBe(true);
    expect(isMarketplaceLinked({ ankorsProductId: null }, "ankorstore")).toBe(false);
  });

  it("Faire : lié dès que faireProductId est posé", () => {
    expect(isMarketplaceLinked({ faireProductId: "faire-1" }, "faire")).toBe(true);
    expect(isMarketplaceLinked({}, "faire")).toBe(false);
  });

  it("Orderchamp : lié dès que orderchampProductId est posé", () => {
    expect(isMarketplaceLinked({ orderchampProductId: "oc-1" }, "orderchamp")).toBe(true);
    expect(isMarketplaceLinked({}, "orderchamp")).toBe(false);
  });

  it("eFashion : lié si au moins une couleur a efashionProductId", () => {
    expect(
      isMarketplaceLinked(
        { colors: [{ efashionProductId: null }, { efashionProductId: "ef-1" }] },
        "efashion",
      ),
    ).toBe(true);
    expect(
      isMarketplaceLinked(
        { colors: [{ efashionProductId: null }, { efashionProductId: null }] },
        "efashion",
      ),
    ).toBe(false);
    expect(isMarketplaceLinked({ colors: [] }, "efashion")).toBe(false);
    expect(isMarketplaceLinked({}, "efashion")).toBe(false);
  });

  it("Microstore : lié dès que microstoreLastPushedAt est posé (jamais orderchampProductId etc.)", () => {
    // L'API native Microstore populate `microstoreLastPushedAt` +
    // `microstoreProductId` au premier push — on utilise le premier comme
    // signal de « déjà lié » (aligné sur le badge MC de la fiche).
    expect(
      isMarketplaceLinked(
        { microstoreLastPushedAt: new Date("2026-09-01") },
        "microstore",
      ),
    ).toBe(true);
    expect(
      isMarketplaceLinked({ microstoreLastPushedAt: "2026-09-01T10:00:00Z" }, "microstore"),
    ).toBe(true);
    expect(isMarketplaceLinked({ microstoreLastPushedAt: null }, "microstore")).toBe(false);
    expect(isMarketplaceLinked({}, "microstore")).toBe(false);
  });

  it("un produit vierge n'est lié à aucune marketplace", () => {
    const empty = {};
    expect(isMarketplaceLinked(empty, "pfs")).toBe(false);
    expect(isMarketplaceLinked(empty, "ankorstore")).toBe(false);
    expect(isMarketplaceLinked(empty, "efashion")).toBe(false);
    expect(isMarketplaceLinked(empty, "faire")).toBe(false);
    expect(isMarketplaceLinked(empty, "orderchamp")).toBe(false);
    expect(isMarketplaceLinked(empty, "microstore")).toBe(false);
  });
});
