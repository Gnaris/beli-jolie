/**
 * Vérifie que `efashionUpdateProductInPlace` détecte l'ajout d'une nouvelle
 * taille BJ et bascule la déclinaison eFashion (« moule de tailles ») du
 * groupe AVANT de pousser les stocks — sinon le stock de la nouvelle taille
 * tomberait dans le vide côté eFashion.
 *
 * Scénario reproduit : produit HSHDF qui avait 1 variante en « Taille unique »
 * (TU) et à qui on ajoute une 2ᵉ variante en « XL ». La déclinaison côté
 * eFashion couvre uniquement TU → on doit la basculer vers une déclinaison
 * qui couvre {TU, XL}.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  efashionUploadProductPhotos: vi.fn(),
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
    efashionListByReferenceBaseExact: vi.fn(async (opts: { idVendeur: number; referenceBase: string; premelFilter?: string }) => {
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
    }),
  };
});
vi.mock("@/lib/efashion-declinaison-matcher", () => ({
  resolveEfashionDeclinaison: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import {
  efashionUpdateProduit,
  efashionUpsertProduitStock,
} from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";
import { resolveEfashionDeclinaison } from "@/lib/efashion-declinaison-matcher";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const updateProduitMock = efashionUpdateProduit as unknown as ReturnType<typeof vi.fn>;
const saveStocksMock = efashionUpsertProduitStock as unknown as ReturnType<typeof vi.fn>;
const listProductsMock = efashionListProducts as unknown as ReturnType<typeof vi.fn>;
const resolveDeclMock = resolveEfashionDeclinaison as unknown as ReturnType<typeof vi.fn>;

function makeLinkedColor(args: {
  id: string;
  colorId: string;
  efashionProductId: number;
  sizeName: string;
  stock?: number;
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
    stock: args.stock ?? 5,
    saleType: "UNIT" as const,
    packQuantity: null,
    disabled: false,
    isPrimary: args.isPrimary ?? false,
    variantSizes: [{ quantity: 1, size: { name: args.sizeName } }],
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
  id_declinaison: number;
}) {
  return {
    id_produit: args.id_produit,
    id_couleur: args.id_couleur,
    reference: `${args.reference_base}-${args.id_couleur}`,
    reference_base: args.reference_base,
    id_collection: 3,
    id_categorie: 160102,
    id_provenance: 1,
    id_declinaison: args.id_declinaison,
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

/**
 * Auto-mock de productColorImage.findMany : dérive 1 image par colorId du
 * dernier findUnique. Sans ça, `filterVariantsByColorIdSet` exclut toutes
 * les variantes des tests (cf. lib/efashion-update.ts).
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

describe("efashionUpdateProductInPlace — bascule de la déclinaison eFashion", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    installAutoColorImagesMock();
    updateProduitMock.mockReset();
    updateProduitMock.mockResolvedValue({
      id_produit: "0",
      reference: "",
      id_collection: null,
      id_categorie: null,
      prix: "0",
      poids: 0,
      vendu_par: "couleurs",
      visible: true,
      id_pack: null,
    });
    saveStocksMock.mockClear();
    listProductsMock.mockReset();
    resolveDeclMock.mockReset();
    // Couleur trouvée → on peut pousser le stock par taille avec id_couleur connu.
    (prisma.color.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "color-101", efashionColorId: 11 },
      { id: "color-xl", efashionColorId: 12 },
    ]);
  });

  it("résout une nouvelle déclinaison et la pousse à chaque couleur liée AVANT le push des stocks", async () => {
    // Snapshot précédent : 1 seule variante (101 = TU). Pas de declinaisonId
    // dans le snapshot (legacy ou produit qui n'avait qu'une taille).
    findUniqueMock.mockResolvedValue({
      id: "p-hshdf",
      reference: "HSHDF",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "HSHDF",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "HSHDF",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
        declinaisonId: 11096, // « Taille unique » côté eFashion
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({
          id: "pc-101",
          colorId: "color-101",
          efashionProductId: 101,
          sizeName: "TU",
          isPrimary: true,
          efashionColorId: 11,
        }),
        // Nouvelle variante ajoutée par l'admin : XL.
        makeLinkedColor({
          id: "pc-xl",
          colorId: "color-xl",
          efashionProductId: 200,
          sizeName: "XL",
          efashionColorId: 12,
        }),
      ],
    });
    // Les 2 variantes existent côté eFashion mais pointent toutes sur la
    // déclinaison « TU » uniquement (11096).
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "HSHDF", id_declinaison: 11096 }),
        makeLiveItem({ id_produit: 200, id_couleur: 12, main: false, reference_base: "HSHDF", id_declinaison: 11096 }),
      ],
    });
    // La résolution renvoie une nouvelle déclinaison qui couvre TU + XL.
    resolveDeclMock.mockResolvedValue({
      success: true,
      createdNew: false,
      match: {
        declinaisonId: 22222,
        declinaisonTitre: "BJ auto (TU,XL)",
        fieldByBjSize: { TU: "d1_FR", XL: "d2_FR" },
        exactMatch: true,
      },
    });

    const res = await efashionUpdateProductInPlace("p-hshdf");

    expect(res.success).toBe(true);
    expect(res.declinaisonUpdatedCount).toBe(2);

    // Vérifie qu'updateProduit a bien été appelé avec id_declinaison=22222
    // pour CHAQUE couleur liée (101 et 200).
    const declCalls = updateProduitMock.mock.calls
      .map(([c]) => c)
      .filter((c) => c.id_declinaison === 22222);
    expect(declCalls.length).toBeGreaterThanOrEqual(2);
    const efIdsBumped = new Set(declCalls.map((c) => c.id_produit));
    expect(efIdsBumped.has(101)).toBe(true);
    expect(efIdsBumped.has(200)).toBe(true);

    // Vérifie l'ordre : les appels updateProduit(id_declinaison=22222) doivent
    // précéder les appels saveProduitStocks pour la même variante (sinon eFashion
    // refuse le stock sur la taille qui n'existe pas encore dans le moule).
    const declOrders = updateProduitMock.mock.calls
      .map((_, idx) => ({
        idx,
        call: updateProduitMock.mock.calls[idx][0],
        order: updateProduitMock.mock.invocationCallOrder[idx],
      }))
      .filter(({ call }) => call.id_declinaison === 22222);
    const stockOrders = saveStocksMock.mock.invocationCallOrder;
    if (stockOrders.length > 0) {
      const earliestDecl = Math.min(...declOrders.map((d) => d.order));
      const earliestStock = Math.min(...stockOrders);
      expect(earliestDecl).toBeLessThan(earliestStock);
    }

    // resolveEfashionDeclinaison a bien été appelé avec l'union des tailles BJ.
    expect(resolveDeclMock).toHaveBeenCalledTimes(1);
    const [bjSizes] = resolveDeclMock.mock.calls[0];
    expect(new Set(bjSizes)).toEqual(new Set(["TU", "XL"]));
  });

  it("ne re-pousse PAS la déclinaison si elle est déjà à jour côté live (idempotent)", async () => {
    // Snapshot legacy (sans declinaisonId) + tailles inchangées. resolve va
    // renvoyer la valeur 11096 (la même que celle vue côté live) → aucun
    // updateProduit avec id_declinaison ne doit partir.
    findUniqueMock.mockResolvedValue({
      id: "p-iso",
      reference: "ISO",
      status: "ONLINE",
      description: null,
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      efashionReferenceBase: "ISO",
      efashionLastSyncSnapshot: {
        version: 1,
        referenceBase: "ISO",
        variants: [
          { efashionProductId: 101, visible: true, prix: 10, poids: 0.05, stockByTaille: { TU: 5 } },
        ],
        descriptions: { fr: "", en: "", it: "", es: "", zh: "" },
        compositions: [],
        primaryEfashionProductId: 101,
        // pas de declinaisonId → snapshot legacy
      },
      primaryColorId: "color-101",
      compositions: [],
      colors: [
        makeLinkedColor({
          id: "pc-101",
          colorId: "color-101",
          efashionProductId: 101,
          sizeName: "TU",
          isPrimary: true,
          efashionColorId: 11,
        }),
      ],
    });
    listProductsMock.mockResolvedValue({
      items: [
        makeLiveItem({ id_produit: 101, id_couleur: 11, main: true, reference_base: "ISO", id_declinaison: 11096 }),
      ],
    });
    resolveDeclMock.mockResolvedValue({
      success: true,
      createdNew: false,
      match: {
        declinaisonId: 11096,
        declinaisonTitre: "Taille unique",
        fieldByBjSize: { TU: "d1_FR" },
        exactMatch: true,
      },
    });

    const res = await efashionUpdateProductInPlace("p-iso");

    expect(res.success).toBe(true);
    // Aucune bascule effective (live déjà sur 11096).
    expect(res.declinaisonUpdatedCount ?? 0).toBe(0);
    // Aucune update avec id_declinaison ne doit avoir été émise pour bascule.
    const declOnlyCalls = updateProduitMock.mock.calls
      .map(([c]) => c)
      .filter((c) => c.id_declinaison === 11096 && c.prix === undefined);
    expect(declOnlyCalls.length).toBe(0);
  });
});
