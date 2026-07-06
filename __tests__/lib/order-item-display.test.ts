import { describe, it, expect } from "vitest";
import { filterOrderItemsByQuery, type OrderItemSearchable } from "@/lib/order-item-display";

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
