import { describe, it, expect } from "vitest";
import {
  buildLoadMoreQuery,
  getLoadMoreUiState,
} from "@/components/produits/products-load-more";

describe("buildLoadMoreQuery — URL des appels « Voir plus »", () => {
  it("inclut uniquement les filtres renseignés + page + locale", () => {
    const qs = buildLoadMoreQuery(
      { q: "robe", cat: "cat-1", color: "red,blue" },
      3,
      "fr",
    );
    const params = new URLSearchParams(qs);
    expect(params.get("q")).toBe("robe");
    expect(params.get("cat")).toBe("cat-1");
    expect(params.get("color")).toBe("red,blue");
    expect(params.get("page")).toBe("3");
    expect(params.get("locale")).toBe("fr");
    expect(params.get("subcat")).toBeNull();
    expect(params.get("collection")).toBeNull();
    expect(params.get("promo")).toBeNull();
  });

  it("retombe sur uniquement page (+ locale) si aucun filtre", () => {
    const qs = buildLoadMoreQuery({}, 2, "en");
    const params = new URLSearchParams(qs);
    expect(params.get("page")).toBe("2");
    expect(params.get("locale")).toBe("en");
    expect([...params.keys()].sort()).toEqual(["locale", "page"]);
  });

  it("propage tous les filtres avancés (compositions, prix, ordres, etc.)", () => {
    const qs = buildLoadMoreQuery(
      {
        composition: "comp-1",
        bestseller: "1",
        new: "1",
        promo: "1",
        ordered: "1",
        notOrdered: "",
        hideOos: "1",
        minPrice: "10",
        maxPrice: "50",
        tag: "tag-1",
      },
      5,
      "fr",
    );
    const params = new URLSearchParams(qs);
    expect(params.get("composition")).toBe("comp-1");
    expect(params.get("bestseller")).toBe("1");
    expect(params.get("new")).toBe("1");
    expect(params.get("promo")).toBe("1");
    expect(params.get("ordered")).toBe("1");
    expect(params.get("notOrdered")).toBeNull();
    expect(params.get("hideOos")).toBe("1");
    expect(params.get("minPrice")).toBe("10");
    expect(params.get("maxPrice")).toBe("50");
    expect(params.get("tag")).toBe("tag-1");
    expect(params.get("page")).toBe("5");
  });

  it("ne pose pas la locale si chaîne vide", () => {
    const qs = buildLoadMoreQuery({ q: "x" }, 2, "");
    const params = new URLSearchParams(qs);
    expect(params.get("locale")).toBeNull();
    expect(params.get("q")).toBe("x");
    expect(params.get("page")).toBe("2");
  });
});

describe("getLoadMoreUiState — affichage bouton/message/erreur", () => {
  it("affiche le bouton « Voir plus » quand hasMore=true et pas d'erreur", () => {
    const ui = getLoadMoreUiState({ hasMore: true, loadError: null, productCount: 20 });
    expect(ui.showLoadMoreButton).toBe(true);
    expect(ui.showAllShownMessage).toBe(false);
    expect(ui.showErrorBlock).toBe(false);
  });

  it("masque le bouton et affiche le message « tous affichés » quand hasMore=false", () => {
    const ui = getLoadMoreUiState({ hasMore: false, loadError: null, productCount: 12 });
    expect(ui.showLoadMoreButton).toBe(false);
    expect(ui.showAllShownMessage).toBe(true);
    expect(ui.showErrorBlock).toBe(false);
  });

  it("masque le message « tous affichés » si la liste est vide", () => {
    const ui = getLoadMoreUiState({ hasMore: false, loadError: null, productCount: 0 });
    expect(ui.showAllShownMessage).toBe(false);
  });

  it("masque le bouton et affiche le bloc erreur quand le chargement précédent a échoué", () => {
    const ui = getLoadMoreUiState({
      hasMore: true,
      loadError: "Impossible de charger plus de produits.",
      productCount: 20,
    });
    expect(ui.showLoadMoreButton).toBe(false);
    expect(ui.showErrorBlock).toBe(true);
  });
});
