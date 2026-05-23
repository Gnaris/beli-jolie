import { describe, it, expect } from "vitest";
import {
  buildVariantSkus,
  buildSingleVariantSku,
  MAX_SKU_LENGTH,
} from "@/lib/ankorstore-sku";

type V = Parameters<typeof buildSingleVariantSku>[1];

function makeVariant(overrides: Partial<V> = {}): V {
  return {
    id: "00000000-0000-0000-0000-0000abcd1234",
    saleType: "UNIT",
    sku: null,
    color: { id: "c1", name: "Argent" },
    variantSizes: [{ size: { name: "TU" }, quantity: 1 }],
    packLines: [],
    ...overrides,
  };
}

describe("buildSingleVariantSku — cas simples (sous la limite)", () => {
  it("référence courte + couleur courte → SKU inchangé", () => {
    const v = makeVariant({
      color: { id: "c1", name: "Argent" },
      variantSizes: [{ size: { name: "TU" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("F137", v, 0);
    expect(sku).toBe("F137_argent_tu_UNIT_1_abcd1234");
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("garde la structure complète quand tout tient", () => {
    const v = makeVariant({
      color: { id: "c1", name: "Bleu" },
      variantSizes: [{ size: { name: "M" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("BJ-01", v, 2);
    expect(sku).toBe("BJ-01_bleu_m_UNIT_3_abcd1234");
  });

  it("PACK → type PACK dans le SKU", () => {
    const v = makeVariant({
      saleType: "PACK",
      variantSizes: [],
      packLines: [{ sizes: [{ size: { name: "L" }, quantity: 3 }] }],
    });
    const sku = buildSingleVariantSku("REF1", v, 0);
    expect(sku).toContain("_PACK_");
    expect(sku).toContain("_l_");
  });

  it("sans couleur → fallback v{index}", () => {
    const v = makeVariant({ color: null });
    const sku = buildSingleVariantSku("REF1", v, 5);
    expect(sku).toContain("_v5_");
  });

  it("variante sans taille → tu", () => {
    const v = makeVariant({ variantSizes: [] });
    const sku = buildSingleVariantSku("REF1", v, 0);
    expect(sku).toContain("_tu_");
  });
});

describe("buildSingleVariantSku — troncature (au-dessus de la limite)", () => {
  it("référence + couleur + taille longs → SKU tronqué sous 48 chars", () => {
    const v = makeVariant({
      color: { id: "c1", name: "argente fonce paillete" },
      variantSizes: [{ size: { name: "petit modele 38mm" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("BJ-COL-PAILLETE-DORE-2024", v, 0);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("le suffixe d'ID est toujours préservé en fin de SKU (unicité)", () => {
    const v = makeVariant({
      id: "11111111-2222-3333-4444-5555deadbeef",
      color: { id: "c1", name: "une-couleur-vraiment-tres-longue-improbable" },
      variantSizes: [{ size: { name: "taille-vraiment-tres-longue" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("REFERENCE-PRODUIT-TRES-LONGUE-ICI", v, 0);
    expect(sku.endsWith("_deadbeef")).toBe(true);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("le bloc _{type}_{index}_ reste intact même en troncature", () => {
    const v = makeVariant({
      saleType: "PACK",
      color: { id: "c1", name: "couleur-extremement-longue-pour-tronquer" },
      variantSizes: [{ size: { name: "taille-aussi-tres-longue" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("REFERENCE-LONGUE-AUSSI-VOILA", v, 4);
    expect(sku).toContain("_PACK_5_");
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("priorité de coupe : la taille est rognée avant la couleur", () => {
    // Référence + couleur courtes + taille longue : on devrait pouvoir
    // garder la couleur intacte et ne couper que la taille.
    const v = makeVariant({
      color: { id: "c1", name: "argent" },
      variantSizes: [{ size: { name: "tres-grande-taille-longue" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("BJ-REF-2024", v, 0);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku).toContain("_argent_");
  });

  it("la référence est préservée si elle peut tenir avec couleur/taille rognées", () => {
    const v = makeVariant({
      color: { id: "c1", name: "couleur-longue-mais-pas-vitale" },
      variantSizes: [{ size: { name: "taille-longue-aussi" }, quantity: 1 }],
    });
    const sku = buildSingleVariantSku("BJ-REF-2024", v, 0);
    expect(sku.startsWith("BJ-REF-2024_")).toBe(true);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });
});

describe("buildVariantSkus — unicité par variante", () => {
  it("deux variantes du même produit avec des IDs différents → SKU différents (même après troncature)", () => {
    const longRef = "BJ-COLLECTION-PAILLETE-DORE-2024";
    const longColor = "argente-fonce-paillete-special";
    const variants: V[] = [
      makeVariant({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa1111",
        color: { id: "c1", name: longColor },
        variantSizes: [{ size: { name: "petit-modele-38mm" }, quantity: 1 }],
      }),
      makeVariant({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb2222",
        color: { id: "c2", name: longColor },
        variantSizes: [{ size: { name: "petit-modele-38mm" }, quantity: 1 }],
      }),
    ];
    const skus = buildVariantSkus(longRef, variants);
    const sku1 = skus.get(variants[0].id)!;
    const sku2 = skus.get(variants[1].id)!;
    expect(sku1).not.toBe(sku2);
    expect(sku1.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku2.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku1.endsWith("aaaa1111")).toBe(true);
    expect(sku2.endsWith("bbbb2222")).toBe(true);
  });

  it("variante à index 9 → label index = 10 (pas de troncature de l'index)", () => {
    const variants: V[] = Array.from({ length: 10 }, (_, i) =>
      makeVariant({
        id: `00000000-0000-0000-0000-00000000000${i}`,
        color: { id: `c${i}`, name: `couleur${i}` },
      }),
    );
    const skus = buildVariantSkus("REF", variants);
    const last = skus.get(variants[9].id)!;
    expect(last).toContain("_UNIT_10_");
  });

  it("aucun SKU généré ne dépasse MAX_SKU_LENGTH, quelle que soit la longueur des entrées", () => {
    const variants: V[] = [
      makeVariant({
        id: "11111111-1111-1111-1111-111111111111",
        color: { id: "c1", name: "a".repeat(100) },
        variantSizes: [{ size: { name: "b".repeat(100) }, quantity: 1 }],
      }),
    ];
    const skus = buildVariantSkus("R".repeat(100), variants);
    const sku = skus.get(variants[0].id)!;
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku.endsWith("_11111111")).toBe(true);
  });
});
