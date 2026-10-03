/**
 * duplicateWithNewColor réussit mais publishBrouillon plante : la nouvelle
 * variante doit être marquée `premel="1"` dans l'état interne pour que le
 * heal step du MÊME push la republie via publishBrouillonBulk.
 *
 * Scénario reproducteur (produit Issyma 15223-2, 2026-10-03) :
 *   - Camel pas liée côté eFashion.
 *   - duplicateWithNewColor OK → newEfId posé.
 *   - publishBrouillon jette (ex: 500 serveur eFashion).
 *   - Avant fix : premel laissé à null → heal filtre `=== "1"` saute Camel →
 *     Camel reste bloquée en brouillon = « Hors ligne » côté eFashion pour
 *     toujours.
 *   - Après fix : premel="1" posé → heal republie Camel au même push.
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
    siteConfig: { findFirst: vi.fn().mockResolvedValue(null) },
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
  efashionUpsertProduitStock: vi.fn().mockResolvedValue(true),
  efashionSaveProduitDescription: vi.fn(),
  efashionSaveProduitCompositions: vi.fn(),
  efashionTranslateText: vi.fn(),
  efashionToggleMainProduct: vi.fn(),
  efashionDuplicateWithNewColor: vi.fn(),
  efashionPublishBrouillon: vi.fn(),
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
  efashionUploadProductPhotos: vi.fn().mockResolvedValue(undefined),
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
import {
  efashionDuplicateWithNewColor,
  efashionPublishBrouillon,
  efashionPublishBrouillonBulk,
} from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<
  typeof vi.fn
>;
const productUpdateMock = prisma.product.update as unknown as ReturnType<
  typeof vi.fn
>;
const productColorUpdateMock = prisma.productColor.update as unknown as ReturnType<
  typeof vi.fn
>;
const listProductsMock = efashionListProducts as unknown as ReturnType<
  typeof vi.fn
>;
const duplicateMock = efashionDuplicateWithNewColor as unknown as ReturnType<
  typeof vi.fn
>;
const publishBrouillonMock = efashionPublishBrouillon as unknown as ReturnType<
  typeof vi.fn
>;
const publishBulkMock = efashionPublishBrouillonBulk as unknown as ReturnType<
  typeof vi.fn
>;

function makeLiveItem(args: {
  id_produit: number;
  id_couleur: number;
  main: boolean;
  reference_base: string;
  premel?: string | null;
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
    premel: args.premel ?? "0",
  };
}

const baseProduct = {
  id: "p-15223",
  reference: "15223-2",
  status: "ONLINE",
  description: null,
  dimensionLength: null,
  dimensionWidth: null,
  dimensionHeight: null,
  dimensionDiameter: null,
  dimensionCircumference: null,
  efashionReferenceBase: "15223-2",
  efashionLastSyncSnapshot: null,
  primaryColorId: "color-beige",
  compositions: [],
};

describe("efashionUpdateProductInPlace — publishBrouillon fail → heal rattrape", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    productUpdateMock.mockReset();
    productUpdateMock.mockResolvedValue({});
    productColorUpdateMock.mockReset();
    productColorUpdateMock.mockResolvedValue({});
    listProductsMock.mockReset();
    duplicateMock.mockReset();
    publishBrouillonMock.mockReset();
    publishBulkMock.mockReset();
    publishBulkMock.mockResolvedValue(1);
    (
      prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      { colorId: "color-beige", path: "beige-1.jpg", order: 0 },
      { colorId: "color-camel", path: "camel-1.jpg", order: 0 },
    ]);
  });

  it("rattrape la nouvelle variante en brouillon via le heal step du même push", async () => {
    // Beige liée + main, Camel pas liée (sera créée).
    findUniqueMock.mockResolvedValue({
      ...baseProduct,
      colors: [
        {
          id: "pc-beige",
          colorId: "color-beige",
          efashionProductId: 100,
          unitPrice: 10,
          weight: 0.05,
          stock: 5,
          saleType: "UNIT",
          packQuantity: null,
          disabled: false,
          isPrimary: true,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Beige", efashionColorId: 1 },
        },
        {
          id: "pc-camel",
          colorId: "color-camel",
          efashionProductId: null,
          unitPrice: 10,
          weight: 0.05,
          stock: 5,
          saleType: "UNIT",
          packQuantity: null,
          disabled: false,
          isPrimary: false,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Camel", efashionColorId: 3 },
        },
      ],
    });
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({
          id_produit: 100,
          id_couleur: 1,
          main: true,
          reference_base: "15223-2",
        }),
      ],
    });
    duplicateMock.mockResolvedValue({
      id_produit: 300,
      reference: "15223-2-3",
      main: false,
    });
    // publishBrouillon jette → simulation d'un 500 côté eFashion.
    publishBrouillonMock.mockRejectedValue(new Error("eFashion: 500 Server Error"));

    const result = await efashionUpdateProductInPlace("p-15223");

    // Le heal step doit avoir republié la nouvelle variante (newEfId=300).
    expect(publishBulkMock).toHaveBeenCalledTimes(1);
    const bulkArg = publishBulkMock.mock.calls[0][0];
    expect(bulkArg.idProduits).toContain(300);

    // Le résultat n'est pas forcément un succès (dépend du reste du flow),
    // mais si une erreur est remontée, elle doit mentionner publishBrouillon
    // pour que la cliente sache pourquoi.
    if (!result.success) {
      expect(result.error ?? "").toMatch(/brouillon|Camel/i);
    }
  });
});
