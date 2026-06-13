import { describe, it, expect } from "vitest";
import {
  buildFaireVariantSkus,
  buildSingleFaireSku,
  MAX_FAIRE_SKU_LENGTH,
} from "@/lib/faire-sku";

describe("buildFaireVariantSkus", () => {
  it("génère un SKU déterministe basé sur ref + couleur + saleType + idSuffix", () => {
    const variants = [
      {
        id: "v1234567890abcdef",
        saleType: "UNIT" as const,
        color: { id: "c1", name: "Or" },
      },
    ];
    const map = buildFaireVariantSkus("BJ001", variants);
    expect(map.get("v1234567890abcdef")).toBe("bj001_or_UNIT_90abcdef");
  });

  it("différencie UNIT et PACK dans le SKU", () => {
    const variants = [
      { id: "v_aaaaaaaa", saleType: "UNIT" as const, color: { id: "c1", name: "Or" } },
      { id: "v_bbbbbbbb", saleType: "PACK" as const, color: { id: "c1", name: "Or" } },
    ];
    const map = buildFaireVariantSkus("BJ001", variants);
    expect(map.get("v_aaaaaaaa")?.includes("_UNIT_")).toBe(true);
    expect(map.get("v_bbbbbbbb")?.includes("_PACK_")).toBe(true);
  });

  it("retourne le même SKU pour la même variante (déterministe)", () => {
    const variants = [
      { id: "vAA11223344", saleType: "UNIT" as const, color: { id: "c1", name: "Argent" } },
    ];
    const a = buildFaireVariantSkus("REF", variants).get("vAA11223344");
    const b = buildFaireVariantSkus("REF", variants).get("vAA11223344");
    expect(a).toBe(b);
  });

  it("rogne la couleur d'abord pour rester sous MAX_FAIRE_SKU_LENGTH", () => {
    const longColor = "tres-tres-longue-couleur-imaginaire-improbable";
    const variants = [
      {
        id: "vXXyyZZ12",
        saleType: "UNIT" as const,
        color: { id: "c1", name: longColor },
      },
    ];
    const sku = buildFaireVariantSkus("BJ0123", variants).get("vXXyyZZ12")!;
    expect(sku.length).toBeLessThanOrEqual(MAX_FAIRE_SKU_LENGTH);
    // Le suffixe = 8 derniers chars de l'ID = "XXyyZZ12" (qui se compose
    // exactement comme la fin de l'id de la variante).
    expect(sku.endsWith("_UNIT_XXyyZZ12")).toBe(true);
  });

  it("fallback sur v{index} quand la couleur est nulle", () => {
    const variants = [
      { id: "v_xxxxxxxx", saleType: "UNIT" as const, color: null },
    ];
    const sku = buildFaireVariantSkus("BJ001", variants).get("v_xxxxxxxx")!;
    expect(sku).toMatch(/_v0_UNIT_/);
  });

  it("retire les caractères non alphanumériques de la couleur", () => {
    const variants = [
      { id: "v_zzzzzzzz", saleType: "UNIT" as const, color: { id: "c1", name: "Bleu/Or!" } },
    ];
    const sku = buildFaireVariantSkus("BJ001", variants).get("v_zzzzzzzz")!;
    // bleu et or doivent rester, le / et ! sont retirés
    expect(sku).toMatch(/bleuor/);
  });

  it("buildSingleFaireSku produit le même résultat que la version batch pour 1 variante", () => {
    const variant = {
      id: "vZZZ12345",
      saleType: "UNIT" as const,
      color: { id: "c1", name: "Rouge" },
    };
    const batch = buildFaireVariantSkus("BJ001", [variant]).get("vZZZ12345");
    const single = buildSingleFaireSku("BJ001", variant, 0);
    expect(single).toBe(batch);
  });
});
