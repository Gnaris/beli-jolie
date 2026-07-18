/**
 * Heal : les couleurs déjà liées mais restées en `premel="1"` (brouillon) chez
 * eFashion doivent être re-publiées automatiquement au prochain sync via
 * `publishBrouillonBulk`, sans que l'admin ait besoin d'intervenir.
 *
 * Scénario reproducteur (A2098A/Vert, 2026-07-17) :
 *   1. Un ancien push avait fait `duplicateWithNewColor` OK →
 *      `ProductColor.efashionProductId` posé.
 *   2. L'upload photo a raté (ENOENT — race worker images) → exception,
 *      `publishBrouillon` sauté.
 *   3. Les syncs suivants ignorent le bloc addColor (couleur « déjà liée »)
 *      → la fiche reste invisible côté catalogue acheteurs à vie.
 *
 * Ce test vérifie que le heal step rattrape les brouillons oubliés.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn() },
    productColor: {
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
    color: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionUpdateProduit: vi.fn().mockResolvedValue({
    id_produit: "0",
    reference: "",
    id_collection: null,
    id_categorie: null,
    prix: "0",
    poids: 0,
    vendu_par: "couleurs",
    visible: true,
    id_pack: null,
  }),
  efashionUpsertProduitStock: vi.fn(),
  efashionSaveProduitDescription: vi.fn(),
  efashionSaveProduitCompositions: vi.fn(),
  efashionTranslateText: vi.fn(),
  efashionToggleMainProduct: vi.fn(),
  efashionDuplicateWithNewColor: vi.fn(),
  efashionPublishBrouillon: vi.fn().mockResolvedValue(true),
  efashionPublishBrouillonBulk: vi.fn().mockResolvedValue(1),
  efashionSoftDeleteProduits: vi.fn().mockResolvedValue(true),
  efashionGetAllUsedColorIdsByMainProduct: vi.fn().mockResolvedValue([]),
  efashionGetProduitCaracteristiqueIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/efashion-shootings", () => ({
  efashionPutShootingProduct: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionGetProductPhotos: vi.fn().mockResolvedValue({ photos: [] }),
  efashionDeleteProductPhoto: vi.fn(),
  efashionUploadProductPhotos: vi.fn(),
}));
vi.mock("@/lib/efashion-pricing", () => ({
  loadEfashionMarkup: vi.fn().mockResolvedValue({
    type: "percent",
    value: 0,
    rounding: "none",
  }),
  computeEfashionPrice: vi.fn(({ basePrice }) => basePrice),
}));
vi.mock("@/lib/efashion-api", () => {
  const listProducts = vi.fn();
  return {
    efashionGetMe: vi
      .fn()
      .mockResolvedValue({ id_vendeur: 2017, nomBoutique: "BJ" }),
    efashionListProducts: listProducts,
    efashionListByReferenceBaseExact: vi.fn(
      async (opts: {
        idVendeur: number;
        referenceBase: string;
        premelFilter?: string;
      }) => {
        const r = await listProducts({
          idVendeur: opts.idVendeur,
          take: 50,
          skip: 0,
          reference: opts.referenceBase,
          premelFilter: opts.premelFilter ?? "tous",
        });
        const needle = opts.referenceBase.toLowerCase().trim();
        return (r?.items ?? []).filter(
          (it: { reference_base?: string | null }) =>
            (it.reference_base ?? "").toLowerCase().trim() === needle,
        );
      },
    ),
  };
});

import { prisma } from "@/lib/prisma";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import { efashionPublishBrouillonBulk } from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";

const findUniqueMock =
  prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const productUpdateMock =
  prisma.product.update as unknown as ReturnType<typeof vi.fn>;
const productColorUpdateMock =
  prisma.productColor.update as unknown as ReturnType<typeof vi.fn>;
const publishBulkMock = efashionPublishBrouillonBulk as unknown as ReturnType<
  typeof vi.fn
>;
const listProductsMock = efashionListProducts as unknown as ReturnType<
  typeof vi.fn
>;

function makeLinkedColor(args: {
  id: string;
  colorId: string;
  efashionProductId: number | null;
  isPrimary?: boolean;
  colorName?: string;
  efashionColorId?: number;
}) {
  return {
    id: args.id,
    colorId: args.colorId,
    efashionProductId: args.efashionProductId,
    unitPrice: 10,
    weight: 0.05,
    stock: 5,
    saleType: "UNIT" as const,
    packQuantity: null,
    disabled: false,
    isPrimary: args.isPrimary ?? false,
    variantSizes: [{ quantity: 1, size: { name: "TU" } }],
    color: {
      name: args.colorName ?? "X",
      efashionColorId: args.efashionColorId ?? 1,
    },
  };
}

function makeLiveItem(args: {
  id_produit: number;
  id_couleur: number;
  main: boolean;
  reference_base: string;
  premel: string | null;
}) {
  return {
    id_produit: args.id_produit,
    id_couleur: args.id_couleur,
    reference: `${args.reference_base}-${args.id_couleur}`,
    reference_base: args.reference_base,
    id_collection: 3,
    id_categorie: 160102,
    id_provenance: 1,
    id_declinaison: 11096,
    id_pack: null,
    vendu_par: "couleurs",
    id_vendeur_marque: 3228,
    main: args.main,
    couleur: "X",
    nb_photos: 1,
    visible: true,
    poids: 0.05,
    prix: "10",
    supprimer: false,
    premel: args.premel,
  };
}

function installAutoColorImagesMock() {
  (
    prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>
  ).mockImplementation(async () => {
    const lastCall = findUniqueMock.mock.results.at(-1);
    if (!lastCall) return [];
    const product = await lastCall.value;
    if (!product?.colors) return [];
    const ids = new Set<string>();
    for (const c of product.colors) if (c.colorId) ids.add(c.colorId);
    return [...ids].map((cid, i) => ({
      colorId: cid,
      path: `m-${cid}.jpg`,
      order: i,
    }));
  });
}

const baseProduct = {
  id: "p-heal",
  reference: "A2098A",
  status: "ONLINE",
  description: null,
  dimensionLength: null,
  dimensionWidth: null,
  dimensionHeight: null,
  dimensionDiameter: null,
  dimensionCircumference: null,
  efashionReferenceBase: "A2098A",
  efashionLastSyncSnapshot: null,
  primaryColorId: "color-blanc",
  compositions: [],
};

describe("efashionUpdateProductInPlace — heal brouillons oubliés", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    installAutoColorImagesMock();
    productUpdateMock.mockReset();
    productUpdateMock.mockResolvedValue({});
    productColorUpdateMock.mockReset();
    productColorUpdateMock.mockResolvedValue({});
    publishBulkMock.mockReset();
    publishBulkMock.mockResolvedValue(1);
    listProductsMock.mockReset();
  });

  it("appelle publishBrouillonBulk sur les couleurs liées restées en premel='1'", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseProduct,
      colors: [
        makeLinkedColor({
          id: "pc-blanc",
          colorId: "color-blanc",
          efashionProductId: 3175873,
          isPrimary: true,
          colorName: "Blanc",
          efashionColorId: 16,
        }),
        makeLinkedColor({
          id: "pc-vert",
          colorId: "color-vert",
          efashionProductId: 3759227,
          colorName: "Vert",
          efashionColorId: 10,
        }),
      ],
    });
    // Blanc = en ligne, Vert = brouillon oublié → heal doit publier 3759227.
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({
          id_produit: 3175873,
          id_couleur: 16,
          main: true,
          reference_base: "A2098A",
          premel: "0",
        }),
        makeLiveItem({
          id_produit: 3759227,
          id_couleur: 10,
          main: false,
          reference_base: "A2098A",
          premel: "1",
        }),
      ],
    });

    await efashionUpdateProductInPlace("p-heal");

    expect(publishBulkMock).toHaveBeenCalledTimes(1);
    expect(publishBulkMock.mock.calls[0][0]).toEqual({
      idProduits: [3759227],
      idVendeur: 2017,
    });
  });

  it("n'appelle pas publishBrouillonBulk quand toutes les couleurs sont déjà en premel='0'", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseProduct,
      colors: [
        makeLinkedColor({
          id: "pc-blanc",
          colorId: "color-blanc",
          efashionProductId: 3175873,
          isPrimary: true,
          colorName: "Blanc",
          efashionColorId: 16,
        }),
        makeLinkedColor({
          id: "pc-vert",
          colorId: "color-vert",
          efashionProductId: 3759227,
          colorName: "Vert",
          efashionColorId: 10,
        }),
      ],
    });
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({
          id_produit: 3175873,
          id_couleur: 16,
          main: true,
          reference_base: "A2098A",
          premel: "0",
        }),
        makeLiveItem({
          id_produit: 3759227,
          id_couleur: 10,
          main: false,
          reference_base: "A2098A",
          premel: "0",
        }),
      ],
    });

    await efashionUpdateProductInPlace("p-heal");

    expect(publishBulkMock).not.toHaveBeenCalled();
  });

  it("groupe tous les IDs brouillon en un seul appel publishBrouillonBulk", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseProduct,
      colors: [
        makeLinkedColor({
          id: "pc-blanc",
          colorId: "color-blanc",
          efashionProductId: 3175873,
          isPrimary: true,
          colorName: "Blanc",
          efashionColorId: 16,
        }),
        makeLinkedColor({
          id: "pc-vert",
          colorId: "color-vert",
          efashionProductId: 3759227,
          colorName: "Vert",
          efashionColorId: 10,
        }),
        makeLinkedColor({
          id: "pc-bleu",
          colorId: "color-bleu",
          efashionProductId: 3175874,
          colorName: "Bleu",
          efashionColorId: 3,
        }),
      ],
    });
    // Vert + Bleu tous les deux en brouillon.
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({
          id_produit: 3175873,
          id_couleur: 16,
          main: true,
          reference_base: "A2098A",
          premel: "0",
        }),
        makeLiveItem({
          id_produit: 3759227,
          id_couleur: 10,
          main: false,
          reference_base: "A2098A",
          premel: "1",
        }),
        makeLiveItem({
          id_produit: 3175874,
          id_couleur: 3,
          main: false,
          reference_base: "A2098A",
          premel: "1",
        }),
      ],
    });
    publishBulkMock.mockResolvedValue(2);

    await efashionUpdateProductInPlace("p-heal");

    expect(publishBulkMock).toHaveBeenCalledTimes(1);
    const call = publishBulkMock.mock.calls[0][0];
    expect(call.idVendeur).toBe(2017);
    expect(new Set(call.idProduits)).toEqual(new Set([3759227, 3175874]));
  });

  it("ne casse pas le flow si publishBrouillonBulk plante (best-effort)", async () => {
    findUniqueMock.mockResolvedValue({
      ...baseProduct,
      colors: [
        makeLinkedColor({
          id: "pc-blanc",
          colorId: "color-blanc",
          efashionProductId: 3175873,
          isPrimary: true,
          colorName: "Blanc",
          efashionColorId: 16,
        }),
        makeLinkedColor({
          id: "pc-vert",
          colorId: "color-vert",
          efashionProductId: 3759227,
          colorName: "Vert",
          efashionColorId: 10,
        }),
      ],
    });
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({
          id_produit: 3175873,
          id_couleur: 16,
          main: true,
          reference_base: "A2098A",
          premel: "0",
        }),
        makeLiveItem({
          id_produit: 3759227,
          id_couleur: 10,
          main: false,
          reference_base: "A2098A",
          premel: "1",
        }),
      ],
    });
    publishBulkMock.mockRejectedValueOnce(new Error("eFashion 500"));

    // Ne doit pas throw — heal est best-effort, l'exception est catchée.
    await expect(
      efashionUpdateProductInPlace("p-heal"),
    ).resolves.toBeDefined();
    expect(publishBulkMock).toHaveBeenCalledTimes(1);
  });
});
