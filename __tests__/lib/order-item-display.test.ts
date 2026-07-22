import { describe, it, expect } from "vitest";
import {
  filterOrderItemsByQuery,
  applyOrderSummaryFilters,
  listOrderSummaryCategories,
  type OrderItemSearchable,
  type OrderItemForSummary,
} from "@/lib/order-item-display";

const items: OrderItemSearchable[] = [
  { productRef: "BR-JO-DOR-BL-1250", productName: "Bracelet doré fantaisie", colorName: "Doré" },
  { productRef: "ZC22B-BLE-1450", productName: "Collier perles bleu", colorName: "Bleu" },
  { productRef: "A2187-BRN-0850", productName: "Bracelet cuir tressé brun", colorName: "Brun" },
];

describe("filterOrderItemsByQuery", () => {
  it("retourne tous les articles si la requête est vide ou blanche", () => {
    expect(filterOrderItemsByQuery(items, "")).toHaveLength(3);
    expect(filterOrderItemsByQuery(items, "   ")).toHaveLength(3);
  });

  it("filtre par référence (préfixe ou fragment)", () => {
    expect(filterOrderItemsByQuery(items, "BR-JO")).toEqual([items[0]]);
    expect(filterOrderItemsByQuery(items, "1450")).toEqual([items[1]]);
  });

  it("filtre par nom de produit (insensible à la casse)", () => {
    expect(filterOrderItemsByQuery(items, "COLLIER")).toEqual([items[1]]);
    expect(filterOrderItemsByQuery(items, "brun")).toEqual([items[2]]);
  });

  it("filtre par couleur", () => {
    expect(filterOrderItemsByQuery(items, "doré")).toEqual([items[0]]);
    expect(filterOrderItemsByQuery(items, "bleu")).toEqual([items[1]]);
  });

  it("retourne une liste vide quand aucun article ne matche", () => {
    expect(filterOrderItemsByQuery(items, "inexistant")).toEqual([]);
  });

  it("gère plusieurs matchs sur un même mot (ex : « bracelet »)", () => {
    const result = filterOrderItemsByQuery(items, "bracelet");
    expect(result).toHaveLength(2);
    expect(result).toContain(items[0]);
    expect(result).toContain(items[2]);
  });
});

const summaryItems: OrderItemForSummary[] = [
  {
    productRef: "BR-JO-DOR-BL-1250",
    productName: "Bracelet doré",
    colorName: "Doré",
    saleType: "UNIT",
    quantity: 5,
    packQty: null,
  },
  {
    productRef: "COL-PER-BLE-1450",
    productName: "Collier perles bleu",
    colorName: "Bleu",
    saleType: "PACK",
    quantity: 3,
    packQty: 6, // = 18 unités
  },
  {
    productRef: "BR-CU-BRN-0850",
    productName: "Bracelet cuir brun",
    colorName: "Brun",
    saleType: "UNIT",
    quantity: 12,
    packQty: null,
  },
  {
    productRef: "BAG-ARG-1200",
    productName: "Bague argentée",
    colorName: "Argenté",
    saleType: "UNIT",
    quantity: 8,
    packQty: null,
  },
];

const categoryByRef: Record<string, string> = {
  "BR-JO-DOR-BL-1250": "Bracelet",
  "COL-PER-BLE-1450": "Collier",
  "BR-CU-BRN-0850": "Bracelet",
  // BAG-ARG-1200 sans catégorie (produit supprimé)
};

describe("listOrderSummaryCategories", () => {
  it("retourne les catégories connues triées alphabétiquement", () => {
    expect(listOrderSummaryCategories(summaryItems, categoryByRef)).toEqual(["Bracelet", "Collier"]);
  });

  it("ignore les articles dont la ref n'a pas de catégorie", () => {
    const cats = listOrderSummaryCategories(summaryItems, categoryByRef);
    expect(cats).not.toContain("");
    expect(cats).not.toContain(undefined);
  });

  it("liste vide si aucun article", () => {
    expect(listOrderSummaryCategories([], categoryByRef)).toEqual([]);
  });
});

describe("applyOrderSummaryFilters", () => {
  it("sans filtre ni tri, retourne l'ordre d'origine", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "", sort: "none" },
      categoryByRef,
    );
    expect(out).toEqual(summaryItems);
  });

  it("filtre par catégorie", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "Bracelet", sort: "none" },
      categoryByRef,
    );
    expect(out.map((i) => i.productRef)).toEqual(["BR-JO-DOR-BL-1250", "BR-CU-BRN-0850"]);
  });

  it("catégorie inconnue → liste vide", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "Inconnu", sort: "none" },
      categoryByRef,
    );
    expect(out).toEqual([]);
  });

  it("trie les références A → Z", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "", sort: "ref_asc" },
      categoryByRef,
    );
    expect(out.map((i) => i.productRef)).toEqual([
      "BAG-ARG-1200",
      "BR-CU-BRN-0850",
      "BR-JO-DOR-BL-1250",
      "COL-PER-BLE-1450",
    ]);
  });

  it("trie les références Z → A", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "", sort: "ref_desc" },
      categoryByRef,
    );
    expect(out.map((i) => i.productRef)).toEqual([
      "COL-PER-BLE-1450",
      "BR-JO-DOR-BL-1250",
      "BR-CU-BRN-0850",
      "BAG-ARG-1200",
    ]);
  });

  it("trie par quantité croissante (utilise le total unités, PACK compris)", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "", sort: "qty_asc" },
      categoryByRef,
    );
    // BR-JO-DOR = 5, BAG-ARG = 8, BR-CU = 12, COL-PER = 3×6 = 18
    expect(out.map((i) => i.productRef)).toEqual([
      "BR-JO-DOR-BL-1250",
      "BAG-ARG-1200",
      "BR-CU-BRN-0850",
      "COL-PER-BLE-1450",
    ]);
  });

  it("trie par quantité décroissante", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "", sort: "qty_desc" },
      categoryByRef,
    );
    expect(out.map((i) => i.productRef)).toEqual([
      "COL-PER-BLE-1450",
      "BR-CU-BRN-0850",
      "BAG-ARG-1200",
      "BR-JO-DOR-BL-1250",
    ]);
  });

  it("combine catégorie + tri", () => {
    const out = applyOrderSummaryFilters(
      summaryItems,
      { category: "Bracelet", sort: "qty_desc" },
      categoryByRef,
    );
    expect(out.map((i) => i.productRef)).toEqual(["BR-CU-BRN-0850", "BR-JO-DOR-BL-1250"]);
  });

  it("ne mute pas la liste d'origine", () => {
    const copy = [...summaryItems];
    applyOrderSummaryFilters(summaryItems, { category: "", sort: "ref_asc" }, categoryByRef);
    expect(summaryItems).toEqual(copy);
  });
});
