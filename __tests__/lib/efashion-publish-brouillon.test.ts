/**
 * Vérifie que efashionPublishProduct appelle bien efashionPublishBrouillon
 * à la fin pour sortir les couleurs du statut "brouillon" — sinon les fiches
 * restent invisibles côté catalogue acheteurs eFashion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn() },
    productColor: { update: vi.fn() },
    productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        product: { update: vi.fn().mockResolvedValue({}) },
        productColor: { update: vi.fn().mockResolvedValue({}) },
      }),
    ),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/efashion-shootings", () => ({
  efashionSaveMelDraft: vi.fn().mockResolvedValue({
    success: true,
    productIds: [3001, 3002],
  }),
  efashionSaveMelChoice: vi.fn().mockResolvedValue({}),
  efashionCheckReferencesExist: vi.fn().mockResolvedValue({ results: [] }),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionUploadProductPhotos: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/efashion-pricing", () => ({
  loadEfashionMarkup: vi.fn().mockResolvedValue({ type: "percent", value: 0, rounding: "none" }),
  computeEfashionPrice: vi.fn(({ basePrice }) => basePrice),
}));
vi.mock("@/lib/efashion-declinaison-matcher", () => ({
  resolveEfashionDeclinaison: vi.fn().mockResolvedValue({
    success: true,
    match: { declinaisonId: 11096, sizes: ["TU"] },
  }),
}));
vi.mock("@/lib/efashion-update", () => ({
  efashionUpdateProductInPlace: vi.fn().mockResolvedValue({
    success: true,
    variantsUpdated: 2,
    stockMutationsCount: 2,
  }),
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionPublishBrouillonBulk: vi.fn().mockResolvedValue(2),
}));
vi.mock("@/lib/efashion-api", () => ({
  efashionGetMe: vi.fn().mockResolvedValue({ id_vendeur: 2017 }),
}));

import { prisma } from "@/lib/prisma";
import { efashionPublishProduct } from "@/lib/efashion-publish";
import { efashionPublishBrouillonBulk } from "@/lib/efashion-api-write";
import { efashionGetMe } from "@/lib/efashion-api";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const publishBulkMock = efashionPublishBrouillonBulk as unknown as ReturnType<typeof vi.fn>;
const getMeMock = efashionGetMe as unknown as ReturnType<typeof vi.fn>;

function makeUnitColor(idSuffix = "1") {
  return {
    id: `pc-${idSuffix}`,
    efashionProductId: null,
    unitPrice: 10,
    weight: 0.1,
    stock: 5,
    saleType: "UNIT" as const,
    packQuantity: null,
    isPrimary: idSuffix === "1",
    disabled: false,
    color: { id: `color-${idSuffix}`, name: `Couleur ${idSuffix}`, efashionColorId: 78 },
    variantSizes: [
      { quantity: 1, size: { id: "size-1", name: "TU" } },
    ],
    images: [],
  };
}

function makeProduct(overrides: Partial<{ status: string; colors: ReturnType<typeof makeUnitColor>[] }> = {}) {
  return {
    id: "prod-1",
    reference: "EFZEFQ",
    name: "Test produit",
    description: "Une description",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    status: overrides.status ?? "ONLINE",
    efashionReferenceBase: null,
    category: { id: "c1", name: "Pendentif", efashionCategorieId: 160102 },
    manufacturingCountry: { id: "ct1", name: "Chine", efashionProvenanceId: 1 },
    season: { id: "s1", name: "PE26", efashionCollectionId: 3 },
    compositions: [
      { percentage: 100, composition: { id: "co1", name: "Métal", efashionId: 60 } },
    ],
    colors: overrides.colors ?? [makeUnitColor("1"), makeUnitColor("2")],
    translations: [],
  };
}

/**
 * Auto-mock de productColorImage.findMany : génère 1 image par color.id du
 * dernier findUnique pour que `filterVariantsByColorIdSet` (cf.
 * lib/efashion-publish.ts) ne rejette pas toutes les variantes.
 */
function installAutoColorImagesMock() {
  (prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const lastCall = findUniqueMock.mock.results.at(-1);
    if (!lastCall) return [];
    const product = await lastCall.value;
    if (!product?.colors) return [];
    const ids = new Set<string>();
    for (const c of product.colors) {
      const cid = c.colorId ?? c.color?.id;
      if (cid) ids.add(cid);
    }
    return [...ids].map((cid, i) => ({ colorId: cid, path: `m-${cid}.jpg`, order: i }));
  });
}

describe("efashionPublishProduct — sortie automatique du brouillon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishBulkMock.mockResolvedValue(2);
    getMeMock.mockResolvedValue({ id_vendeur: 2017 });
    installAutoColorImagesMock();
  });

  it("appelle publishBrouillonBulk avec toutes les couleurs en un seul appel (status ONLINE)", async () => {
    findUniqueMock.mockResolvedValue(makeProduct({ status: "ONLINE" }));

    const res = await efashionPublishProduct("prod-1");

    expect(res.success).toBe(true);
    expect(publishBulkMock).toHaveBeenCalledTimes(1);
    expect(publishBulkMock).toHaveBeenCalledWith({
      idProduits: [3001, 3002],
      idVendeur: 2017,
    });
  });

  it("NE PUBLIE PAS quand le statut local est OFFLINE", async () => {
    findUniqueMock.mockResolvedValue(makeProduct({ status: "OFFLINE" }));

    const res = await efashionPublishProduct("prod-1");

    expect(res.success).toBe(true);
    expect(publishBulkMock).not.toHaveBeenCalled();
  });

  it("NE PUBLIE PAS quand le statut local est ARCHIVED", async () => {
    findUniqueMock.mockResolvedValue(makeProduct({ status: "ARCHIVED" }));

    const res = await efashionPublishProduct("prod-1");

    expect(res.success).toBe(true);
    expect(publishBulkMock).not.toHaveBeenCalled();
  });

  it("continue le publish global même si publishBrouillonBulk échoue (non bloquant)", async () => {
    findUniqueMock.mockResolvedValue(makeProduct({ status: "ONLINE" }));
    publishBulkMock.mockRejectedValue(new Error("eFashion down"));

    const res = await efashionPublishProduct("prod-1");

    expect(res.success).toBe(true);
    if (res.success) expect(res.productIds).toEqual([3001, 3002]);
  });

  it("continue le publish global même si efashionGetMe échoue (non bloquant)", async () => {
    findUniqueMock.mockResolvedValue(makeProduct({ status: "ONLINE" }));
    getMeMock.mockRejectedValue(new Error("session expired"));

    const res = await efashionPublishProduct("prod-1");

    expect(res.success).toBe(true);
    expect(publishBulkMock).not.toHaveBeenCalled();
  });
});
