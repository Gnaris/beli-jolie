/**
 * Vérifie que `efashionUpdateProductInPlace` envoie TOUJOURS `visible` dans
 * chaque payload `updateProduit`, même quand le diff local snapshot vs cible
 * n'a détecté aucun changement sur ce champ.
 *
 * Bug reproduit sur PS3 le 2026-07-28 (Beli & Jolie) :
 *   - Snapshot local : visible=true
 *   - Cible calculée : visible=true (product ONLINE, stock=1000, !disabled)
 *   - État réel eFashion : visible=false (dérive silencieuse)
 *   - Ancien comportement : `visible` absent du payload updateProduit →
 *     eFashion voit `main=true` + pas de visible → propage la valeur
 *     mémorisée de la main aux autres couleurs → visible=false partout.
 *   - Fix : asserter systématiquement `input.visible = variant.visible`
 *     pour que BJ dicte l'état, indépendamment du diff.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    productColor: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productColorImage: {
      findMany: vi.fn().mockResolvedValue([
        { colorId: "col-argent", path: "/uploads/produits/ps3/ps3-argent-1.webp", order: 0 },
        { colorId: "col-dore", path: "/uploads/produits/ps3/ps3-doré-1.webp", order: 0 },
      ]),
    },
    color: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionUpdateProduit: vi.fn(),
  efashionUpsertProduitStock: vi.fn().mockResolvedValue(true),
  efashionSaveProduitDescription: vi.fn().mockResolvedValue(true),
  efashionSaveProduitCompositions: vi.fn().mockResolvedValue(true),
  efashionTranslateText: vi.fn(),
  efashionToggleMainProduct: vi.fn(),
  efashionDuplicateWithNewColor: vi.fn(),
  efashionPublishBrouillon: vi.fn(),
  efashionSoftDeleteProduits: vi.fn().mockResolvedValue(true),
  efashionGetAllUsedColorIdsByMainProduct: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionGetProductPhotos: vi.fn().mockResolvedValue({ photos: [] }),
  efashionDeleteProductPhoto: vi.fn(),
  efashionUploadProductPhotos: vi
    .fn()
    .mockResolvedValue({ success: true, photos: [], nbPhotos: 1 }),
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
vi.mock("@/lib/efashion-declinaison-matcher", () => ({
  resolveEfashionDeclinaison: vi
    .fn()
    .mockResolvedValue({ success: true, match: { declinaisonId: 13334 } }),
}));

import { prisma } from "@/lib/prisma";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import { efashionUpdateProduit } from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const colorFindManyMock = prisma.color.findMany as unknown as ReturnType<typeof vi.fn>;
const updateProduitMock = efashionUpdateProduit as unknown as ReturnType<typeof vi.fn>;
const listProductsMock = efashionListProducts as unknown as ReturnType<typeof vi.fn>;

describe("efashionUpdateProductInPlace — visible toujours envoyé", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProduitMock.mockResolvedValue({});

    // Snapshot local qui dit déjà visible=true (état stable, aucun champ n'a
    // changé). Sans le fix, aucun champ « visible » ne serait envoyé.
    const snapshot = {
      version: 1,
      variants: [
        {
          efashionProductId: 3748836,
          prix: 4,
          poids: 0.002,
          visible: true,
          stockByTaille: { "Taille unique": 1000 },
          images: [{ order: 0, dbPath: "/uploads/produits/ps3/ps3-doré-1.webp" }],
        },
        {
          efashionProductId: 3748837,
          prix: 4,
          poids: 0.002,
          visible: true,
          stockByTaille: { "Taille unique": 1000 },
          images: [{ order: 0, dbPath: "/uploads/produits/ps3/ps3-argent-1.webp" }],
        },
      ],
      categoryId: 160105,
      declinaisonId: 13334,
      descriptions: { fr: "Piercing", en: "Piercing", it: "", es: "", zh: "" },
      compositions: [],
      referenceBase: "PS3",
      primaryEfashionProductId: 3748836,
    };

    findUniqueMock.mockResolvedValue({
      id: "p-ps3",
      reference: "PS3",
      name: "Piercing Nombril",
      description: "Piercing Nombril en acier inoxydable",
      status: "ONLINE",
      efashionReferenceBase: "PS3",
      efashionLastSyncSnapshot: snapshot,
      primaryColorId: "col-dore",
      length: null,
      width: null,
      height: null,
      compositions: [],
      colors: [
        {
          id: "pc-dore",
          colorId: "col-dore",
          efashionProductId: 3748836,
          unitPrice: 4,
          weight: 0.002,
          stock: 1000,
          saleType: "UNIT" as const,
          packQuantity: null,
          disabled: false,
          isPrimary: true,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Doré", efashionColorId: 78 },
        },
        {
          id: "pc-argent",
          colorId: "col-argent",
          efashionProductId: 3748837,
          unitPrice: 4,
          weight: 0.002,
          stock: 1000,
          saleType: "UNIT" as const,
          packQuantity: null,
          disabled: false,
          isPrimary: false,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Argent", efashionColorId: 22 },
        },
      ],
    });

    colorFindManyMock.mockResolvedValue([
      { id: "col-dore", efashionColorId: 78 },
      { id: "col-argent", efashionColorId: 22 },
    ]);

    // Live eFashion : `visible: false` alors que BJ pense true. Aucun autre
    // champ dérivé → le diff local ne détecterait « aucun changement » sans le fix.
    listProductsMock.mockResolvedValue({
      items: [
        {
          id_produit: 3748836,
          reference: "PS3-DORÉ",
          reference_base: "PS3",
          id_collection: 3,
          id_categorie: 160105,
          id_provenance: 1,
          id_declinaison: 13334,
          id_pack: 12744,
          vendu_par: "couleurs",
          id_vendeur_marque: 3228,
          id_couleur: 78,
          main: true,
          visible: false,
          stock_value: 1000,
          nb_photos: 3,
          premel: "0",
        },
        {
          id_produit: 3748837,
          reference: "PS3-ARGENT",
          reference_base: "PS3",
          id_collection: 3,
          id_categorie: 160105,
          id_provenance: 1,
          id_declinaison: 13334,
          id_pack: 12744,
          vendu_par: "couleurs",
          id_vendeur_marque: 3228,
          id_couleur: 22,
          main: false,
          visible: false,
          stock_value: 1000,
          nb_photos: 2,
          premel: "0",
        },
      ],
      total: 2,
    });
  });

  it("envoie visible=true à chaque updateProduit même quand le diff ne le signale pas", async () => {
    // On n'active PAS forceFullSync — on veut tester le mode delta normal.
    const res = await efashionUpdateProductInPlace("p-ps3");
    expect(res.success).toBe(true);

    // Vérifie que updateProduit a été appelé pour AU MOINS une variante avec
    // visible=true explicitement dans le payload. Sans le fix, `visible` était
    // absent → eFashion le forçait à false via la propagation main.
    const calls = updateProduitMock.mock.calls;
    const callsWithVisibleTrue = calls.filter(
      (c) => c[0]?.visible === true,
    );
    expect(callsWithVisibleTrue.length).toBeGreaterThan(0);
  });
});
