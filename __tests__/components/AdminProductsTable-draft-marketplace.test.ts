import { describe, it, expect } from "vitest";
import {
  shouldShowDraftMarketplaceNotice,
  computeSelectedDraftIds,
} from "@/components/admin/products/AdminProductsTable";

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

describe("computeSelectedDraftIds — bouton bulk « Publier brouillons »", () => {
  // Bug PT19 : sur T166E (produit complet mis Hors ligne par l'admin), le bouton
  // « Publier brouillons » s'affichait à tort car le filtre ne testait que
  // status === "OFFLINE". Un vrai brouillon = OFFLINE + isIncomplete = true.
  const mk = (
    id: string,
    status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING",
    isIncomplete: boolean,
  ) => ({ id, status, isIncomplete });

  it("garde les produits OFFLINE ET incomplets (vrais brouillons)", () => {
    const products = [
      mk("draft-1", "OFFLINE", true),
      mk("draft-2", "OFFLINE", true),
    ];
    const selected = new Set(["draft-1", "draft-2"]);
    expect(computeSelectedDraftIds(products, selected).sort()).toEqual(["draft-1", "draft-2"]);
  });

  it("exclut les produits OFFLINE mais complets (T166E : hors ligne temporaire)", () => {
    const products = [
      mk("T166E", "OFFLINE", false), // fiche complète simplement retirée du site
      mk("draft-1", "OFFLINE", true),
    ];
    const selected = new Set(["T166E", "draft-1"]);
    expect(computeSelectedDraftIds(products, selected)).toEqual(["draft-1"]);
  });

  it("exclut les produits ONLINE, ARCHIVED et SYNCING même s'ils sont incomplets", () => {
    const products = [
      mk("online", "ONLINE", true),   // improbable en prod, testé par prudence
      mk("archived", "ARCHIVED", true),
      mk("syncing", "SYNCING", true),
      mk("draft", "OFFLINE", true),
    ];
    const selected = new Set(["online", "archived", "syncing", "draft"]);
    expect(computeSelectedDraftIds(products, selected)).toEqual(["draft"]);
  });

  it("ignore les produits non sélectionnés", () => {
    const products = [
      mk("draft-selected", "OFFLINE", true),
      mk("draft-unselected", "OFFLINE", true),
    ];
    const selected = new Set(["draft-selected"]);
    expect(computeSelectedDraftIds(products, selected)).toEqual(["draft-selected"]);
  });

  it("retourne un tableau vide si aucun produit sélectionné n'est un brouillon", () => {
    const products = [
      mk("T166E", "OFFLINE", false),
      mk("prod-online", "ONLINE", false),
    ];
    const selected = new Set(["T166E", "prod-online"]);
    expect(computeSelectedDraftIds(products, selected)).toEqual([]);
  });
});
