import { describe, it, expect } from "vitest";
import {
  MAX_ORDERCHAMP_SKU_LENGTH,
  buildOrderchampVariantSkus,
  buildSingleOrderchampSku,
} from "@/lib/orderchamp-sku";

describe("orderchamp-sku", () => {
  it("génère un SKU déterministe {ref}_{couleur}_{UNIT|PACK}_{idSuffix}", () => {
    const sku = buildSingleOrderchampSku(
      "A1720",
      { id: "abcdef1234567890", saleType: "UNIT", color: { id: "c1", name: "Or" } },
      0,
    );
    expect(sku).toBe("a1720_or_UNIT_34567890");
  });

  it("inclut la taille quand fournie explicitement", () => {
    const sku = buildSingleOrderchampSku(
      "A1720",
      { id: "abcdef1234567890", saleType: "UNIT", color: { id: "c1", name: "Or" }, sizeName: "52" },
      0,
    );
    expect(sku).toBe("a1720_or_52_UNIT_34567890");
  });

  it("distingue UNIT et PACK dans le suffixe", () => {
    const unit = buildSingleOrderchampSku(
      "A1720",
      { id: "abcdef1234567890", saleType: "UNIT", color: { id: "c1", name: "Or" } },
      0,
    );
    const pack = buildSingleOrderchampSku(
      "A1720",
      { id: "abcdef1234567890", saleType: "PACK", color: { id: "c1", name: "Or" } },
      0,
    );
    expect(unit).toContain("_UNIT_");
    expect(pack).toContain("_PACK_");
  });

  it("slug retire les accents et lowercase", () => {
    const sku = buildSingleOrderchampSku(
      "A1720",
      { id: "abcdef1234567890", saleType: "UNIT", color: { id: "c1", name: "Rose gold" } },
      0,
    );
    expect(sku.startsWith("a1720_rose-gold_")).toBe(true);
  });

  it("respecte la limite de 60 caractères en rognant taille → couleur → ref", () => {
    const longRef = "REFERENCE-TRES-LONGUE-AVEC-BEAUCOUP-DE-CHIFFRES-999999";
    const sku = buildSingleOrderchampSku(
      longRef,
      {
        id: "abcdef1234567890",
        saleType: "PACK",
        color: { id: "c1", name: "Couleur super longue avec espaces" },
        sizeName: "Taille moyenne intermédiaire",
      },
      0,
    );
    expect(sku.length).toBeLessThanOrEqual(MAX_ORDERCHAMP_SKU_LENGTH);
    expect(sku).toContain("_PACK_34567890"); // suffixe préservé
  });

  it("gère plusieurs variantes en Map bjVariantId → SKU", () => {
    const variants = [
      { id: "v1abcdef11111111", saleType: "UNIT" as const, color: { id: "c1", name: "Or" } },
      { id: "v2abcdef22222222", saleType: "UNIT" as const, color: { id: "c2", name: "Argenté" } },
    ];
    const map = buildOrderchampVariantSkus("A1720", variants);
    expect(map.size).toBe(2);
    expect(map.get("v1abcdef11111111")).toBe("a1720_or_UNIT_11111111");
    expect(map.get("v2abcdef22222222")).toBe("a1720_argente_UNIT_22222222");
  });

  it("utilise un fallback v{index} quand la couleur est manquante", () => {
    const sku = buildSingleOrderchampSku(
      "A1720",
      { id: "abcdef1234567890", saleType: "UNIT", color: null },
      3,
    );
    expect(sku).toContain("v3");
  });
});
