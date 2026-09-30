/**
 * Fige la règle produit du 2026-10-01 : une couleur BJ non désactivée sur un
 * produit ONLINE reste visible côté eFashion même quand son stock est à 0.
 *
 * Contexte : avant, `visible = ONLINE && !disabled && stock>0`. La cliente a
 * demandé qu'une couleur en rupture reste affichée aux acheteuses eFashion
 * (comme sur BJ où la pastille apparaît grisée « rupture »), donc `visible`
 * ne dépend plus que du statut produit + du flag `disabled` local.
 *
 * Cas typique reproduit : Issyma produit 4537 (Gilet léopard), variante
 * Fuchsia — couleur principale, activée, stock 0 → doit partir avec
 * `visible=true`.
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
        { colorId: "col-fuchsia", path: "/uploads/issyma/produits/4537/4537-fuchsia-1.webp", order: 0 },
        { colorId: "col-gris", path: "/uploads/issyma/produits/4537/4537-gris-1.webp", order: 0 },
      ]),
    },
    color: { findMany: vi.fn() },
    siteConfig: { findFirst: vi.fn().mockResolvedValue(null) },
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
    efashionGetMe: vi.fn().mockResolvedValue({ id_vendeur: 2017, nomBoutique: "Issyma" }),
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

describe("efashionUpdateProductInPlace — stock 0 ne masque plus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProduitMock.mockResolvedValue({});

    findUniqueMock.mockResolvedValue({
      id: "p-4537",
      reference: "4537",
      name: "Gilet léopard",
      description: "Gilet oversize",
      status: "ONLINE",
      efashionReferenceBase: "4537",
      efashionLastSyncSnapshot: null, // forceFullSync implicite (snapshot vide)
      primaryColorId: "col-fuchsia",
      length: null,
      width: null,
      height: null,
      compositions: [],
      colors: [
        {
          id: "pc-fuchsia",
          colorId: "col-fuchsia",
          efashionProductId: 3906555,
          unitPrice: 16.8,
          weight: 0.5,
          stock: 0, // ← stock zéro, mais activée
          saleType: "UNIT" as const,
          packQuantity: null,
          disabled: false,
          isPrimary: true,
          variantSizes: [{ quantity: 1, size: { name: "Taille unique" } }],
          color: { name: "Fuchsia", efashionColorId: 92 },
        },
        {
          id: "pc-gris",
          colorId: "col-gris",
          efashionProductId: 3906556,
          unitPrice: 16.8,
          weight: 0.5,
          stock: 297,
          saleType: "UNIT" as const,
          packQuantity: null,
          disabled: false,
          isPrimary: false,
          variantSizes: [{ quantity: 1, size: { name: "Taille unique" } }],
          color: { name: "Gris", efashionColorId: 43 },
        },
      ],
    });

    colorFindManyMock.mockResolvedValue([
      { id: "col-fuchsia", efashionColorId: 92 },
      { id: "col-gris", efashionColorId: 43 },
    ]);

    listProductsMock.mockResolvedValue({
      items: [
        {
          id_produit: 3906555,
          reference: "4537-FUCHSIA",
          reference_base: "4537",
          id_collection: 3,
          id_categorie: 160105,
          id_provenance: 1,
          id_declinaison: 13334,
          id_pack: 12744,
          vendu_par: "couleurs",
          id_vendeur_marque: 3228,
          id_couleur: 92,
          main: true,
          visible: false, // état live actuel : hors ligne (à corriger)
          stock_value: 0,
          nb_photos: 2,
          premel: "1",
        },
        {
          id_produit: 3906556,
          reference: "4537-GRIS",
          reference_base: "4537",
          id_collection: 3,
          id_categorie: 160105,
          id_provenance: 1,
          id_declinaison: 13334,
          id_pack: 12744,
          vendu_par: "couleurs",
          id_vendeur_marque: 3228,
          id_couleur: 43,
          main: false,
          visible: true,
          stock_value: 297,
          nb_photos: 1,
          premel: "1",
        },
      ],
      total: 2,
    });
  });

  it("envoie visible=true pour la variante activée à stock 0", async () => {
    const res = await efashionUpdateProductInPlace("p-4537", { forceFullSync: true });
    expect(res.success).toBe(true);

    const fuchsiaCall = updateProduitMock.mock.calls.find(
      (c) => c[0]?.id_produit === 3906555,
    );
    expect(fuchsiaCall).toBeDefined();
    expect(fuchsiaCall![0].visible).toBe(true);
  });
});
