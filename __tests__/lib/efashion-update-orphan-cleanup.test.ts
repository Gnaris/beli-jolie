import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock complet — même structure que efashion-update-variants.test.ts pour
// isoler la logique d'update sans toucher au filesystem ni au réseau.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    productColor: {
      update: vi.fn().mockResolvedValue({}),
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
  efashionUpsertProduitStock: vi.fn().mockResolvedValue(true),
  efashionSaveProduitDescription: vi.fn().mockResolvedValue(true),
  efashionSaveProduitCompositions: vi.fn().mockResolvedValue(true),
  efashionTranslateText: vi.fn().mockResolvedValue({ en: "", it: "", es: "", zh: "" }),
  efashionToggleMainProduct: vi.fn(),
  efashionDuplicateWithNewColor: vi.fn(),
  efashionPublishBrouillon: vi.fn().mockResolvedValue(true),
  efashionSoftDeleteProduits: vi.fn().mockResolvedValue(true),
  efashionGetAllUsedColorIdsByMainProduct: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionGetProductPhotos: vi.fn().mockResolvedValue({ photos: [] }),
  efashionDeleteProductPhoto: vi.fn(),
  efashionUploadProductPhotos: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/efashion-pricing", () => ({
  loadEfashionMarkup: vi.fn().mockResolvedValue({ type: "percent", value: 0, rounding: "none" }),
  computeEfashionPrice: vi.fn(({ basePrice }) => basePrice),
}));
vi.mock("@/lib/efashion-api", () => {
  const listProducts = vi.fn();
  return {
    efashionGetMe: vi.fn().mockResolvedValue({ id_vendeur: 2017, nomBoutique: "BJ" }),
    efashionListProducts: listProducts,
    efashionListByReferenceBaseExact: vi.fn(
      async (opts: { idVendeur: number; referenceBase: string; premelFilter?: string }) => {
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
  efashionUpdateProduit,
  efashionUpsertProduitStock,
  efashionSaveProduitDescription,
  efashionSaveProduitCompositions,
  efashionSoftDeleteProduits,
} from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";
import { efashionUploadProductPhotos } from "@/lib/efashion-photos";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const productColorUpdateManyMock = prisma.productColor.updateMany as unknown as ReturnType<typeof vi.fn>;
const colorImagesFindMany = prisma.productColorImage.findMany as unknown as ReturnType<typeof vi.fn>;
const listProductsMock = efashionListProducts as unknown as ReturnType<typeof vi.fn>;
const softDeleteMock = efashionSoftDeleteProduits as unknown as ReturnType<typeof vi.fn>;
const updateProduitMock = efashionUpdateProduit as unknown as ReturnType<typeof vi.fn>;
const upsertStockMock = efashionUpsertProduitStock as unknown as ReturnType<typeof vi.fn>;
const saveDescMock = efashionSaveProduitDescription as unknown as ReturnType<typeof vi.fn>;
const saveCompMock = efashionSaveProduitCompositions as unknown as ReturnType<typeof vi.fn>;
const uploadPhotosMock = efashionUploadProductPhotos as unknown as ReturnType<typeof vi.fn>;

function makeColor(args: {
  id: string;
  colorId: string;
  efashionProductId: number | null;
  isPrimary?: boolean;
  saleType?: "UNIT" | "PACK";
  efashionColorId?: number | null;
  colorName?: string;
}) {
  return {
    id: args.id,
    colorId: args.colorId,
    efashionProductId: args.efashionProductId,
    unitPrice: 10,
    weight: 0.05,
    stock: 5,
    saleType: args.saleType ?? "UNIT",
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
  };
}

describe("efashionUpdateProductInPlace — Bug 1 : nettoyage du efashionProductId après softDelete", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    productColorUpdateManyMock.mockReset();
    productColorUpdateManyMock.mockResolvedValue({ count: 0 });
    colorImagesFindMany.mockReset();
    colorImagesFindMany.mockResolvedValue([]);
    softDeleteMock.mockReset();
    softDeleteMock.mockResolvedValue(true);
    listProductsMock.mockReset();
    updateProduitMock.mockReset();
    updateProduitMock.mockResolvedValue({});
  });

  it("après un softDelete réussi, vide le efashionProductId des ProductColors correspondantes", async () => {
    // Snapshot précédent : 2 couleurs liées (101, 102). État BDD : seule 101 reste.
    // Le code doit appeler softDelete sur 102 ET vider sa colonne efashionProductId.
    findUniqueMock.mockResolvedValue({
      id: "p1",
      reference: "TEST",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "TEST",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
          { efashionProductId: 102, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        // 102 a été retirée de la liste → diff.removed = [102]
      ],
    });
    colorImagesFindMany.mockResolvedValue([
      { colorId: "color-101", path: "m-101.jpg", order: 0 },
    ]);
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" }),
        makeLiveItem({ id_produit: 102, id_couleur: 12, main: false, reference_base: "TEST" }),
      ],
    });

    await efashionUpdateProductInPlace("p1");

    expect(softDeleteMock).toHaveBeenCalledWith([102]);
    expect(productColorUpdateManyMock).toHaveBeenCalledWith({
      where: {
        productId: "p1",
        efashionProductId: { in: [102] },
      },
      data: { efashionProductId: null },
    });
  });

  it("ne touche PAS à la BDD locale si softDelete échoue (l'erreur est propagée)", async () => {
    findUniqueMock.mockResolvedValue({
      id: "p2",
      reference: "TEST",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "TEST",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
          { efashionProductId: 102, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
      ],
    });
    colorImagesFindMany.mockResolvedValue([
      { colorId: "color-101", path: "m-101.jpg", order: 0 },
    ]);
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" }),
        makeLiveItem({ id_produit: 102, id_couleur: 12, main: false, reference_base: "TEST" }),
      ],
    });
    softDeleteMock.mockRejectedValueOnce(new Error("boom"));

    await efashionUpdateProductInPlace("p2");

    // softDelete a planté → on NE doit PAS nettoyer la BDD (sinon on perd
    // l'info que la couleur existait chez eFashion, et on ne pourra plus
    // retry proprement).
    expect(productColorUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("efashionUpdateProductInPlace — Bug 2 : filet « numéro orphelin » actif en forceFullSync", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    productColorUpdateManyMock.mockReset();
    productColorUpdateManyMock.mockResolvedValue({ count: 0 });
    colorImagesFindMany.mockReset();
    colorImagesFindMany.mockResolvedValue([]);
    softDeleteMock.mockReset();
    softDeleteMock.mockResolvedValue(true);
    listProductsMock.mockReset();
    updateProduitMock.mockReset();
    updateProduitMock.mockResolvedValue({});
    upsertStockMock.mockReset();
    upsertStockMock.mockResolvedValue(true);
    saveDescMock.mockReset();
    saveDescMock.mockResolvedValue(true);
    saveCompMock.mockReset();
    saveCompMock.mockResolvedValue(true);
    uploadPhotosMock.mockReset();
    uploadPhotosMock.mockResolvedValue(undefined);
  });

  it("en mode forceFullSync (Rafraîchir), saute un efashionProductId absent du live eFashion", async () => {
    // Reproduit le bug W124/Fuchsia : la BDD a un efashionProductId = 999 sur
    // une couleur, mais 999 a été soft-deleted côté eFashion et n'apparaît
    // plus dans listProducts. Avant le fix, forceFullSync désactivait le
    // filet et on poussait stock/desc/compo/image/updateProduit sur 999 — tout
    // retournait `200 OK` sans rien faire.
    findUniqueMock.mockResolvedValue({
      id: "p1",
      reference: "TEST",
      status: "ONLINE",
      description: "desc",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: null, // forceFullSync simulé par snapshot null
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        makeColor({ id: "pc-999", colorId: "color-999", efashionProductId: 999 }),
      ],
    });
    colorImagesFindMany.mockResolvedValue([
      { colorId: "color-101", path: "m-101.jpg", order: 0 },
      { colorId: "color-999", path: "m-999.jpg", order: 0 },
    ]);
    // Seul 101 existe chez eFashion. 999 = orphelin.
    listProductsMock.mockResolvedValue({
      items: [makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" })],
    });

    const res = await efashionUpdateProductInPlace("p1", { forceFullSync: true });

    expect(res.colorsSkippedCount).toBe(1);
    expect(res.error ?? "").toMatch(/inconnue.*eFashion/i);

    // updateProduit ne doit PAS être appelé pour 999
    const calls999 = updateProduitMock.mock.calls.filter(([c]) => c.id_produit === 999);
    expect(calls999.length).toBe(0);

    // upsertProduitStock ne doit PAS être appelé pour 999
    const stock999 = upsertStockMock.mock.calls.filter(([c]) => c.id_produit === 999);
    expect(stock999.length).toBe(0);

    // saveProduitDescription ne doit PAS être appelé pour 999
    const desc999 = saveDescMock.mock.calls.filter(([c]) => c.id_produit === 999);
    expect(desc999.length).toBe(0);

    // Pas non plus de photo upload sur 999
    const photos999 = uploadPhotosMock.mock.calls.filter(([efId]) => efId === 999);
    expect(photos999.length).toBe(0);
  });

  it("reste désactivé en mode isPostPublishAlignment (toutes les variantes viennent d'être créées par saveMelDraft)", async () => {
    // Cas légitime du flow publish : on appelle updateProductInPlace en fin
    // de publish pour aligner les attributs par couleur. À ce moment-là
    // listProducts peut avoir un léger lag et ne pas encore voir la couleur
    // qu'on vient de créer — il ne faut PAS la filtrer comme orpheline.
    findUniqueMock.mockResolvedValue({
      id: "p2",
      reference: "TEST",
      status: "ONLINE",
      description: "desc",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: null,
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        makeColor({ id: "pc-102", colorId: "color-102", efashionProductId: 102 }),
      ],
    });
    colorImagesFindMany.mockResolvedValue([
      { colorId: "color-101", path: "m-101.jpg", order: 0 },
      { colorId: "color-102", path: "m-102.jpg", order: 0 },
    ]);
    // Liste vide simulant un cache live périmé.
    listProductsMock.mockResolvedValue({ items: [] });

    const res = await efashionUpdateProductInPlace("p2", {
      forceFullSync: true,
      isPostPublishAlignment: true,
    });

    // Aucun skip — toutes les couleurs ont reçu leurs updates malgré liveById vide.
    expect(res.colorsSkippedCount).toBeFalsy();
    const callsFor101 = updateProduitMock.mock.calls.filter(([c]) => c.id_produit === 101);
    const callsFor102 = updateProduitMock.mock.calls.filter(([c]) => c.id_produit === 102);
    expect(callsFor101.length).toBeGreaterThan(0);
    expect(callsFor102.length).toBeGreaterThan(0);
  });
});

describe("efashionUpdateProductInPlace — Bug 3 : pas de softDelete agressif sur perte temporaire d'images", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    productColorUpdateManyMock.mockReset();
    productColorUpdateManyMock.mockResolvedValue({ count: 0 });
    colorImagesFindMany.mockReset();
    softDeleteMock.mockReset();
    softDeleteMock.mockResolvedValue(true);
    listProductsMock.mockReset();
    updateProduitMock.mockReset();
    updateProduitMock.mockResolvedValue({});
    uploadPhotosMock.mockReset();
    uploadPhotosMock.mockResolvedValue(undefined);
  });

  it("ne softDelete PAS une variante déjà liée à eFashion qui a temporairement perdu ses images locales", async () => {
    // Reproduit le 25/06/2026 : la Fuchsia (efashionProductId 3705725, déjà liée)
    // perd ses images locales (job image en attente). Avant le fix, le filtre
    // colorIdsHavingImages la retirait de unitColors → diff.removed = [3705725]
    // → softDelete chez eFashion + orphelin laissé en BDD.
    findUniqueMock.mockResolvedValue({
      id: "p1",
      reference: "W124",
      status: "ONLINE",
      description: "desc",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "W124",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "W124",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
          {
            efashionProductId: 3705725,
            visible: true,
            prix: 10,
            poids: 0.05,
            stockByTaille: { TU: 5 },
            images: [{ dbPath: "fuchsia-1.jpg", order: 0 }],
          },
        ],
        descriptions: { fr: "desc", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        makeColor({
          id: "pc-fuchsia",
          colorId: "color-fuchsia",
          efashionProductId: 3705725,
          colorName: "Fuchsia",
          efashionColorId: 17,
        }),
      ],
    });
    // ⚠️ Seule 101 a une image locale — Fuchsia (color-fuchsia) n'en a pas.
    // Avant le fix, c'est ce qui déclenchait le softDelete agressif.
    colorImagesFindMany.mockResolvedValue([
      { colorId: "color-101", path: "m-101.jpg", order: 0 },
    ]);
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "W124" }),
        makeLiveItem({ id_produit: 3705725, id_couleur: 17, main: false, reference_base: "W124" }),
      ],
    });

    await efashionUpdateProductInPlace("p1");

    // softDelete ne doit PAS être appelé sur Fuchsia : elle est déjà liée et
    // n'a perdu ses images que temporairement.
    expect(softDeleteMock).not.toHaveBeenCalled();
  });

  it("ne crée PAS de nouvelle couleur eFashion sans image locale (auto-create reste filtré sur les images)", async () => {
    // Symétrique du test précédent : si une nouvelle couleur locale est ajoutée
    // SANS image, elle doit rester non créée chez eFashion (sinon on publie
    // une fiche vide — observé W124/Fuchsia 10/06/2026 : photosCount:0).
    const duplicateMock = (
      await import("@/lib/efashion-api-write")
    ).efashionDuplicateWithNewColor as unknown as ReturnType<typeof vi.fn>;
    duplicateMock.mockReset();
    duplicateMock.mockResolvedValue({ id_produit: 9999, reference: "TEST-NEW", main: false });

    findUniqueMock.mockResolvedValue({
      id: "p2",
      reference: "TEST",
      status: "ONLINE",
      description: "desc",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "TEST",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "TEST",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "desc", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeColor({ id: "pc-101", colorId: "color-101", efashionProductId: 101, isPrimary: true }),
        // Nouvelle couleur SANS image locale
        makeColor({
          id: "pc-new",
          colorId: "color-new",
          efashionProductId: null,
          colorName: "Doré",
          efashionColorId: 78,
        }),
      ],
    });
    colorImagesFindMany.mockResolvedValue([
      { colorId: "color-101", path: "m-101.jpg", order: 0 },
      // pas d'image pour color-new
    ]);
    listProductsMock.mockResolvedValue({
      items: [makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "TEST" })],
    });

    await efashionUpdateProductInPlace("p2");

    // duplicateWithNewColor ne doit PAS être appelé pour la couleur sans image.
    expect(duplicateMock).not.toHaveBeenCalled();
  });
});
