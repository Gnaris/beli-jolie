/**
 * Bascule main eFashion : garantit que les non-main sont pré-rattachées au
 * futur main AVANT que l'ancien main soit démouvoir — sinon elles deviennent
 * orphelines pendant la fenêtre « sans main » et eFashion les ré-affiche dans
 * un groupe séparé.
 *
 * Scénario reproducteur (produit Issyma 15223-2, 2026-10-03) :
 *   - Avant : Beige (main eFashion), BF (non-main liée à Beige, désactivée),
 *     Camel (primaire BJ mais pas liée côté eFashion).
 *   - Admin active Camel + save.
 *   - duplicateWithNewColor crée Camel dans le groupe de Beige.
 *   - Bascule main : Beige → main:false, Camel → main:true.
 *   - Entre les 2 appels, BF reste pointée vers Beige (= plus main) → eFashion
 *     la ré-affiche dans un groupe séparé.
 *
 * Fix : pré-pousser `id_couleur_liee = Camel` sur BF AVANT la bascule.
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
  efashionUpdateProduit,
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
const updateProduitMock = efashionUpdateProduit as unknown as ReturnType<
  typeof vi.fn
>;

function makeLiveItem(args: {
  id_produit: number;
  id_couleur: number;
  main: boolean;
  reference_base: string;
  premel?: string | null;
  visible?: boolean;
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
    visible: args.visible ?? true,
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
  primaryColorId: "color-camel",
  compositions: [],
};

describe("efashionUpdateProductInPlace — pré-rattachement non-main avant bascule main", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    productUpdateMock.mockReset();
    productUpdateMock.mockResolvedValue({});
    productColorUpdateMock.mockReset();
    productColorUpdateMock.mockResolvedValue({});
    listProductsMock.mockReset();
    duplicateMock.mockReset();
    updateProduitMock.mockClear();
    // Mock des images pour que colorsToCreate inclue Camel.
    (
      prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      { colorId: "color-camel", path: "camel-1.jpg", order: 0 },
      { colorId: "color-beige", path: "beige-1.jpg", order: 0 },
      { colorId: "color-bf", path: "bf-1.jpg", order: 0 },
    ]);
  });

  it("pré-rattache BF (non-main liée à Beige) vers Camel AVANT de démouvoir Beige", async () => {
    // Setup : Beige main liée (efashionId=100), BF non-main liée (efId=200,
    // visible=false car désactivée), Camel primaire BJ pas liée (sera créée
    // par duplicate, newEfId=300).
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
          isPrimary: false,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Beige", efashionColorId: 1 },
        },
        {
          id: "pc-bf",
          colorId: "color-bf",
          efashionProductId: 200,
          unitPrice: 10,
          weight: 0.05,
          stock: 0,
          saleType: "UNIT",
          packQuantity: null,
          disabled: false,
          isPrimary: false,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Brun Foncé", efashionColorId: 2 },
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
          isPrimary: true,
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
        makeLiveItem({
          id_produit: 200,
          id_couleur: 2,
          main: false,
          reference_base: "15223-2",
        }),
      ],
    });
    duplicateMock.mockResolvedValue({
      id_produit: 300,
      reference: "15223-2-3",
      main: false,
    });

    await efashionUpdateProductInPlace("p-15223");

    // Collecte toutes les séquences d'appels updateProduit dans l'ordre.
    const calls = updateProduitMock.mock.calls.map((c) => c[0]);

    // 1. On doit trouver un appel pré-rattachement : BF (200) → Camel (300),
    //    main:false. Cet appel doit survenir AVANT l'appel qui démouvoir
    //    Beige (100).
    const prerattachBfIdx = calls.findIndex(
      (c) =>
        c.id_produit === 200 &&
        c.id_couleur_liee === 300 &&
        c.main === false,
    );
    const demoteBeigeIdx = calls.findIndex(
      (c) =>
        c.id_produit === 100 &&
        c.id_couleur_liee === 300 &&
        c.main === false,
    );
    const promoteCamelIdx = calls.findIndex(
      (c) =>
        c.id_produit === 300 &&
        c.id_couleur_liee === 300 &&
        c.main === true,
    );

    expect(prerattachBfIdx).toBeGreaterThanOrEqual(0);
    expect(demoteBeigeIdx).toBeGreaterThanOrEqual(0);
    expect(promoteCamelIdx).toBeGreaterThanOrEqual(0);
    // Pré-rattachement BF arrive AVANT démotion Beige.
    expect(prerattachBfIdx).toBeLessThan(demoteBeigeIdx);
    // Démotion Beige arrive AVANT promotion Camel.
    expect(demoteBeigeIdx).toBeLessThan(promoteCamelIdx);
  });
});
