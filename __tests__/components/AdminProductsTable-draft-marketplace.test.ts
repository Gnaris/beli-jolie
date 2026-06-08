import { describe, it, expect } from "vitest";
import { shouldShowDraftMarketplaceNotice } from "@/components/admin/products/AdminProductsTable";

const base = {
  isIncomplete: false,
  pfsProductId: null as string | null,
  ankorsProductId: null as string | null,
  efashionLinked: false,
};

describe("shouldShowDraftMarketplaceNotice — message brouillon dans la colonne Marketplaces", () => {
  it("affiche le message pour un brouillon non lié à aucune marketplace", () => {
    expect(shouldShowDraftMarketplaceNotice({ ...base, isIncomplete: true })).toBe(true);
  });

  it("n'affiche pas le message si la fiche est complète", () => {
    expect(shouldShowDraftMarketplaceNotice({ ...base, isIncomplete: false })).toBe(false);
  });

  it("n'affiche pas le message si le brouillon est déjà publié sur PFS", () => {
    expect(
      shouldShowDraftMarketplaceNotice({ ...base, isIncomplete: true, pfsProductId: "pfs-123" }),
    ).toBe(false);
  });

  it("n'affiche pas le message si le brouillon est déjà publié sur Ankorstore", () => {
    expect(
      shouldShowDraftMarketplaceNotice({ ...base, isIncomplete: true, ankorsProductId: "ak-456" }),
    ).toBe(false);
  });

  it("n'affiche pas le message si le brouillon est déjà lié à eFashion", () => {
    expect(
      shouldShowDraftMarketplaceNotice({ ...base, isIncomplete: true, efashionLinked: true }),
    ).toBe(false);
  });
});
