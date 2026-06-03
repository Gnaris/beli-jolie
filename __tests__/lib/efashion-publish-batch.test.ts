/**
 * Tests unitaires pour la publication groupée eFashion.
 *
 * Focus : on vérifie que les productIds renvoyés par save-mel-draft sont
 * correctement distribués aux produits BJ dans l'ordre d'envoi.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn() },
    productColor: { update: vi.fn() },
    productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === "function") {
        const tx = {
          product: { update: vi.fn() },
          productColor: { update: vi.fn() },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      }
      return null;
    }),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/efashion-shootings", () => ({
  efashionSaveMelDraft: vi.fn(),
  efashionSaveMelChoice: vi.fn(),
  efashionCheckReferencesExist: vi.fn().mockResolvedValue({ results: [] }),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionUploadProductPhotos: vi.fn(),
}));
vi.mock("@/lib/efashion-pricing", () => ({
  loadEfashionMarkup: vi.fn().mockResolvedValue({ type: "percent", value: 0, rounding: "none" }),
  computeEfashionPrice: vi.fn(({ basePrice }) => basePrice),
}));
vi.mock("@/lib/efashion-declinaison-matcher", () => ({
  resolveEfashionDeclinaison: vi
    .fn()
    .mockResolvedValue({ success: true, match: { declinaisonId: 11096 } }),
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionPublishBrouillonBulk: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/efashion-api", () => ({
  efashionGetMe: vi.fn().mockResolvedValue({ id_vendeur: 2017 }),
}));
vi.mock("@/lib/efashion-update", () => ({
  efashionUpdateProductInPlace: vi.fn().mockResolvedValue({ success: true }),
}));

import { prisma } from "@/lib/prisma";
import { efashionPublishProductsBatch } from "@/lib/efashion-publish-batch";
import {
  efashionSaveMelDraft,
  efashionSaveMelChoice,
} from "@/lib/efashion-shootings";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const saveDraftMock = efashionSaveMelDraft as unknown as ReturnType<typeof vi.fn>;
const saveChoiceMock = efashionSaveMelChoice as unknown as ReturnType<typeof vi.fn>;

function makeProduct(
  productId: string,
  reference: string,
  colorCount: number,
): unknown {
  const colors = Array.from({ length: colorCount }, (_, i) => ({
    id: `${productId}-pc-${i}`,
    unitPrice: 10,
    weight: 0.1,
    stock: 10,
    saleType: "UNIT",
    packQuantity: null,
    isPrimary: i === 0,
    color: {
      id: `${productId}-c-${i}`,
      name: `Color${i}`,
      efashionColorId: 100 + i,
    },
    variantSizes: [{ size: { name: "TU" } }],
  }));
  return {
    id: productId,
    reference,
    name: `Produit ${productId}`,
    description: "desc",
    status: "ONLINE",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    category: { name: "Bague", efashionCategorieId: 160102 },
    manufacturingCountry: { name: "Chine", efashionProvenanceId: 1 },
    season: { name: "Toutes", efashionCollectionId: 3 },
    compositions: [{ percentage: 100, composition: { name: "Acier", efashionId: 60 } }],
    colors,
    translations: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("efashionPublishProductsBatch", () => {
  it("ne fait qu'1 appel save-mel-draft et 1 appel save-mel-choice pour N produits", async () => {
    findUniqueMock
      .mockResolvedValueOnce(makeProduct("p1", "REF1", 2))
      .mockResolvedValueOnce(makeProduct("p2", "REF2", 3));
    saveDraftMock.mockResolvedValueOnce({
      success: true,
      productIds: [1001, 1002, 2001, 2002, 2003],
    });
    saveChoiceMock.mockResolvedValueOnce({ success: true, shootings: [] });

    const res = await efashionPublishProductsBatch(["p1", "p2"]);

    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    expect(saveChoiceMock).toHaveBeenCalledTimes(1);
    // 1 référence par produit envoyée dans le même tableau
    expect(saveDraftMock.mock.calls[0][0].references).toHaveLength(2);
    expect(res.success).toBe(true);
  });

  it("distribue les productIds dans l'ordre d'envoi (ref1_col1, ref1_col2, ref2_col1...)", async () => {
    findUniqueMock
      .mockResolvedValueOnce(makeProduct("p1", "REF1", 2))
      .mockResolvedValueOnce(makeProduct("p2", "REF2", 3));
    saveDraftMock.mockResolvedValueOnce({
      success: true,
      productIds: [1001, 1002, 2001, 2002, 2003],
    });
    saveChoiceMock.mockResolvedValueOnce({ success: true, shootings: [] });

    const res = await efashionPublishProductsBatch(["p1", "p2"]);

    const p1Result = res.results.find((r) => r.productId === "p1");
    const p2Result = res.results.find((r) => r.productId === "p2");
    expect(p1Result?.efashionProductIds).toEqual([1001, 1002]);
    expect(p2Result?.efashionProductIds).toEqual([2001, 2002, 2003]);
  });

  it("rejette les produits avec mappings manquants sans bloquer les autres", async () => {
    const badProduct = makeProduct("bad", "REFBAD", 1) as { category: { efashionCategorieId: number | null } };
    badProduct.category.efashionCategorieId = null;
    findUniqueMock
      .mockResolvedValueOnce(badProduct)
      .mockResolvedValueOnce(makeProduct("p2", "REF2", 1));
    saveDraftMock.mockResolvedValueOnce({ success: true, productIds: [3001] });
    saveChoiceMock.mockResolvedValueOnce({ success: true, shootings: [] });

    const res = await efashionPublishProductsBatch(["bad", "p2"]);

    const badResult = res.results.find((r) => r.productId === "bad");
    const p2Result = res.results.find((r) => r.productId === "p2");
    expect(badResult?.success).toBe(false);
    expect(p2Result?.success).toBe(true);
    // save-mel-draft n'envoie qu'1 référence (celle qui passe)
    expect(saveDraftMock.mock.calls[0][0].references).toHaveLength(1);
  });
});
