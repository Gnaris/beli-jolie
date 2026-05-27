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
  it("référence courte + couleur courte → {ref}_{couleur}_{idSuffix}", () => {
    const v = makeVariant({
      color: { id: "c1", name: "Argent" },
    });
    const sku = buildSingleVariantSku("F137", v, 0);
    expect(sku).toBe("F137_argent_abcd1234");
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("garde la structure complète quand tout tient", () => {
    const v = makeVariant({
      color: { id: "c1", name: "Bleu" },
    });
    const sku = buildSingleVariantSku("BJ-01", v, 2);
    expect(sku).toBe("BJ-01_bleu_abcd1234");
  });

  it("couleur avec espaces → slugifiée en tirets", () => {
    const v = makeVariant({
      color: { id: "c1", name: "Bleu Marine" },
    });
    const sku = buildSingleVariantSku("REF1", v, 0);
    expect(sku).toBe("REF1_bleu-marine_abcd1234");
  });

  it("sans couleur → fallback v{index}", () => {
    const v = makeVariant({ color: null });
    const sku = buildSingleVariantSku("REF1", v, 5);
    expect(sku).toBe("REF1_v5_abcd1234");
  });

  it("le SKU ne contient plus la taille ni le type ni l'index", () => {
    const v = makeVariant({
      saleType: "PACK",
      color: { id: "c1", name: "Rouge" },
      variantSizes: [],
      packLines: [{ sizes: [{ size: { name: "L" }, quantity: 3 }] }],
    });
    const sku = buildSingleVariantSku("REF1", v, 0);
    expect(sku).not.toContain("_PACK_");
    expect(sku).not.toContain("_UNIT_");
    expect(sku).not.toContain("_l_");
    expect(sku).toBe("REF1_rouge_abcd1234");
  });
});

describe("buildSingleVariantSku — troncature (au-dessus de la limite)", () => {
  it("référence + couleur longs → SKU tronqué sous 48 chars", () => {
    const v = makeVariant({
      color: { id: "c1", name: "argente fonce paillete special" },
    });
    const sku = buildSingleVariantSku("BJ-COL-PAILLETE-DORE-2024", v, 0);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("le suffixe d'ID est toujours préservé en fin de SKU (unicité)", () => {
    const v = makeVariant({
      id: "11111111-2222-3333-4444-5555deadbeef",
      color: { id: "c1", name: "une-couleur-vraiment-tres-longue-improbable" },
    });
    const sku = buildSingleVariantSku("REFERENCE-PRODUIT-TRES-LONGUE-ICI", v, 0);
    expect(sku.endsWith("_deadbeef")).toBe(true);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
  });

  it("priorité de coupe : la couleur est rognée avant la référence", () => {
    const v = makeVariant({
      color: { id: "c1", name: "couleur-vraiment-extremement-longue-pour-tronquer" },
    });
    const sku = buildSingleVariantSku("BJ-REF-2024", v, 0);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku.startsWith("BJ-REF-2024_")).toBe(true);
    expect(sku.endsWith("_abcd1234")).toBe(true);
  });

  it("référence très longue + couleur courte → la référence est rognée", () => {
    const v = makeVariant({
      color: { id: "c1", name: "or" },
    });
    const sku = buildSingleVariantSku("REFERENCE-VRAIMENT-EXTREMEMENT-LONGUE-ICI", v, 0);
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku).toContain("_or_");
    expect(sku.endsWith("_abcd1234")).toBe(true);
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
      }),
      makeVariant({
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb2222",
        color: { id: "c2", name: longColor },
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

  it("aucun SKU généré ne dépasse MAX_SKU_LENGTH, quelle que soit la longueur des entrées", () => {
    const variants: V[] = [
      makeVariant({
        id: "11111111-1111-1111-1111-111111111111",
        color: { id: "c1", name: "a".repeat(100) },
      }),
    ];
    const skus = buildVariantSkus("R".repeat(100), variants);
    const sku = skus.get(variants[0].id)!;
    expect(sku.length).toBeLessThanOrEqual(MAX_SKU_LENGTH);
    expect(sku.endsWith("_11111111")).toBe(true);
  });
});
