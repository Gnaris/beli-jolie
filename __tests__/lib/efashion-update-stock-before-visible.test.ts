/**
 * Vérifie l'ordre crucial des appels dans `efashionUpdateProductInPlace` :
 *   saveProduitStocks  →  description/compositions  →  photos  →  updateProduit
 *
 * Cause racine du bug observé sur F137 le 2026-05-30 :
 *   - Lors de la purge photos (delete avant ré-upload), eFashion force
 *     `visible=false` côté serveur (logique back « produit sans photo =
 *     caché »). L'upload qui suit ne le remet pas à true.
 *   - Si on pose `visible=true` AVANT la sync photos (ancien ordre), il est
 *     écrasé par la purge → le Resync laissait les fiches invisibles malgré
 *     les bonnes réponses HTTP.
 *   - Solution : `updateProduit` (visible/prix/poids) doit venir EN DERNIER,
 *     pour avoir le dernier mot face aux effets de bord des autres appels.
 *
 * Le test vérifie l'ordre relatif via un compteur d'appels partagé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    productColor: { update: vi.fn().mockResolvedValue({}) },
    productColorImage: {
      findMany: vi.fn().mockResolvedValue([
        { colorId: "col-argent", path: "/uploads/produits/f137/f137-argent-1.webp", order: 0 },
        { colorId: "col-dore", path: "/uploads/produits/f137/f137-doré-1.webp", order: 0 },
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
  efashionSaveProduitStocks: vi.fn().mockResolvedValue(true),
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
  efashionUploadProductPhotos: vi.fn().mockResolvedValue({ success: true, photos: [], nbPhotos: 1 }),
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
import {
  efashionUpdateProduit,
  efashionSaveProduitStocks,
} from "@/lib/efashion-api-write";
import { efashionUploadProductPhotos } from "@/lib/efashion-photos";
import { efashionListProducts } from "@/lib/efashion-api";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const colorFindManyMock = prisma.color.findMany as unknown as ReturnType<typeof vi.fn>;
const updateProduitMock = efashionUpdateProduit as unknown as ReturnType<typeof vi.fn>;
const saveStocksMock = efashionSaveProduitStocks as unknown as ReturnType<typeof vi.fn>;
const uploadPhotosMock = efashionUploadProductPhotos as unknown as ReturnType<typeof vi.fn>;
const listProductsMock = efashionListProducts as unknown as ReturnType<typeof vi.fn>;

describe("efashionUpdateProductInPlace — ordre des appels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProduitMock.mockResolvedValue({});
    saveStocksMock.mockResolvedValue(true);
    uploadPhotosMock.mockResolvedValue({ success: true, photos: [], nbPhotos: 1 });

    findUniqueMock.mockResolvedValue({
      id: "p-f137",
      reference: "F137",
      name: "Bague",
      description: "Acier inox",
      status: "ONLINE",
      efashionReferenceBase: "F137",
      efashionLastSyncSnapshot: null,
      primaryColorId: "col-argent",
      length: null,
      width: null,
      height: null,
      compositions: [],
      // Au moins 1 image par couleur → la sync photos sera déclenchée et on
      // pourra observer son ordre vs updateProduit.
      colors: [
        {
          id: "pc-argent",
          colorId: "col-argent",
          efashionProductId: 2457306,
          unitPrice: 2.8,
          weight: 0.03,
          stock: 1000,
          saleType: "UNIT" as const,
          packQuantity: null,
          disabled: false,
          isPrimary: true,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Argent", efashionColorId: 22 },
        },
        {
          id: "pc-dore",
          colorId: "col-dore",
          efashionProductId: 2457307,
          unitPrice: 2.8,
          weight: 0.03,
          stock: 1000,
          saleType: "UNIT" as const,
          packQuantity: null,
          disabled: false,
          isPrimary: false,
          variantSizes: [{ quantity: 1, size: { name: "TU" } }],
          color: { name: "Doré", efashionColorId: 78 },
        },
      ],
    });

    colorFindManyMock.mockResolvedValue([
      { id: "col-argent", efashionColorId: 22 },
      { id: "col-dore", efashionColorId: 78 },
    ]);

    // Simule l'état live eFashion : Argent stock=0 (buggé), Doré stock=1000
    listProductsMock.mockResolvedValue({
      items: [
        {
          id_produit: 2457306,
          reference: "F137-ARGENT",
          reference_base: "F137",
          id_collection: 3,
          id_categorie: 160101,
          id_provenance: 1,
          id_declinaison: 13334,
          id_pack: 12744,
          vendu_par: "couleurs",
          id_vendeur_marque: 3228,
          id_couleur: 22,
          main: true,
          stock_value: 0,
        },
        {
          id_produit: 2457307,
          reference: "F137-DORÉ",
          reference_base: "F137",
          id_collection: 3,
          id_categorie: 160101,
          id_provenance: 1,
          id_declinaison: 13334,
          id_pack: 12744,
          vendu_par: "couleurs",
          id_vendeur_marque: 3228,
          id_couleur: 78,
          main: false,
          stock_value: 1000,
        },
      ],
      total: 2,
    });
  });

  it("envoie saveProduitStocks puis sync photos puis updateProduit, dans CET ORDRE (sinon eFashion écrase visible=true)", async () => {
    const callOrder: string[] = [];
    saveStocksMock.mockImplementation(async () => {
      callOrder.push("saveStocks");
      return true;
    });
    uploadPhotosMock.mockImplementation(async () => {
      callOrder.push("uploadPhotos");
      return { success: true, photos: [], nbPhotos: 1 };
    });
    updateProduitMock.mockImplementation(async () => {
      callOrder.push("updateProduit");
      return {};
    });

    const res = await efashionUpdateProductInPlace("p-f137", { forceFullSync: true });
    expect(res.success).toBe(true);

    // Sanité : tous les appels ont bien eu lieu.
    expect(saveStocksMock).toHaveBeenCalled();
    expect(uploadPhotosMock).toHaveBeenCalled();
    expect(updateProduitMock).toHaveBeenCalled();

    // 1. saveStocks toujours AVANT updateProduit final.
    const lastStockIdx = callOrder.lastIndexOf("saveStocks");
    const lastUpdateIdx = callOrder.lastIndexOf("updateProduit");
    expect(lastStockIdx).toBeLessThan(lastUpdateIdx);

    // 2. uploadPhotos toujours AVANT le DERNIER updateProduit.
    // C'est le cœur du fix F137 : si updateProduit (visible=true) part avant
    // la purge photos, eFashion force visible=false après. On veut donc
    // qu'au moins un updateProduit suive tous les uploadPhotos.
    const lastUploadIdx = callOrder.lastIndexOf("uploadPhotos");
    expect(lastUploadIdx).toBeLessThan(lastUpdateIdx);
  });
});
