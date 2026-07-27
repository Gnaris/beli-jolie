import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findUniqueMock,
  productColorImageFindManyMock,
  efashionGetMeMock,
  efashionListProductsMock,
  buildEfashionPhotoUrlMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  productColorImageFindManyMock: vi.fn().mockResolvedValue([]),
  efashionGetMeMock: vi.fn().mockResolvedValue({ id_vendeur: 999 }),
  efashionListProductsMock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  buildEfashionPhotoUrlMock: vi.fn(() => "https://efashion.cdn/photo.jpg"),
  getServerSessionMock: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: findUniqueMock },
    productColorImage: { findMany: productColorImageFindManyMock },
  },
}));
vi.mock("@/lib/efashion-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/efashion-api")>(
    "@/lib/efashion-api",
  );
  return {
    ...actual,
    efashionListProducts: efashionListProductsMock,
    efashionGetMe: efashionGetMeMock,
    buildEfashionPhotoUrl: buildEfashionPhotoUrlMock,
    // On exécute le VRAI helper paginé, mais on lui injecte le mock comme listFn.
    // Comme ça les tests qui vérifient la pagination (skip += PAGE_SIZE, etc.)
    // restent valides : ils observent les vrais appels à efashionListProductsMock
    // produits par la pagination interne du helper.
    efashionListByReferenceBaseExact: (opts: Parameters<typeof actual.efashionListByReferenceBaseExact>[0]) =>
      actual.efashionListByReferenceBaseExact({ ...opts, listFn: efashionListProductsMock }),
  };
});
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/efashion-link-match", () => ({
  normalizeColorName: (s: string) => s.toLowerCase().trim(),
}));

import { previewEfashionMatchByReference } from "@/app/actions/admin/efashion";

const baseProductRow = {
  id: "p-1",
  reference: "A11",
  name: "Test Bouclesoreilles",
  efashionReferenceBase: null,
  category: { id: "c", name: "Bijoux", efashionCategorieId: 1 },
  country: { id: "m", name: "Chine", efashionProvenanceId: 2 },
  season: { id: "s", name: "PE26", efashionCollectionId: 3 },
  compositions: [{ composition: { id: "co", name: "Acier", efashionId: 4 } }],
  colors: [
    {
      id: "pc-1",
      saleType: "UNIT" as const,
      unitPrice: 10,
      stock: 5,
      efashionProductId: null,
      color: {
        id: "col-1",
        name: "Doré",
        hex: "#FFD700",
        patternImage: null,
        efashionColorId: 7,
      },
      images: [{ path: "/uploads/test.webp" }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ user: { role: "ADMIN" } });
  efashionGetMeMock.mockResolvedValue({ id_vendeur: 999 });
  efashionListProductsMock.mockResolvedValue({ items: [], total: 0 });
});

describe("previewEfashionMatchByReference", () => {
  it("cherche chez eFashion dans TOUS les statuts (en_ligne + brouillon + supprimés), pas uniquement les produits en ligne", async () => {
    findUniqueMock.mockResolvedValueOnce(baseProductRow);

    const res = await previewEfashionMatchByReference("p-1", "A11");

    expect(res.success).toBe(true);
    expect(efashionListProductsMock).toHaveBeenCalled();
    const callArgs = efashionListProductsMock.mock.calls[0][0];
    expect(callArgs.premelFilter).toBe("tous");
    expect(callArgs.reference).toBe("A11");
  });

  it("pagine jusqu'à trouver les produits dont reference_base === needle, même au-delà des premiers chunks", async () => {
    findUniqueMock.mockResolvedValueOnce(baseProductRow);

    // Page 0 : 174 résultats partiels (A1100, A1101...) — aucun ref_base exact.
    // Reproduit le comportement réel d'eFashion (renvoie plus que take=50).
    const partials = Array.from({ length: 174 }, (_, i) => ({
      id_produit: 1000 + i,
      reference: `A11${i.toString().padStart(2, "0")}-DORÉ`,
      reference_base: `A11${i.toString().padStart(2, "0")}`,
      id_couleur: 78,
      couleur: "Doré",
      visible: true,
      supprimer: false,
      stock_value: 5,
      nb_photos: 1,
    }));
    const partials2 = Array.from({ length: 127 }, (_, i) => ({
      id_produit: 2000 + i,
      reference: `A11${(i + 174).toString().padStart(3, "X")}-DORÉ`,
      reference_base: `A11${(i + 174).toString().padStart(3, "X")}`,
      id_couleur: 78,
      couleur: "Doré",
      visible: true,
      supprimer: false,
      stock_value: 5,
      nb_photos: 1,
    }));
    // Page 2 : contient enfin A11 exact (ce que vise l'utilisatrice).
    const exact = [
      {
        id_produit: 2418489,
        reference: "A11-ARGENT",
        reference_base: "A11",
        id_couleur: 22,
        couleur: "Argent",
        visible: true,
        supprimer: false,
        stock_value: 50,
        nb_photos: 1,
      },
    ];
    efashionListProductsMock
      .mockResolvedValueOnce({ items: partials, total: 122 })
      .mockResolvedValueOnce({ items: partials2, total: 122 })
      .mockResolvedValueOnce({ items: exact, total: 122 })
      .mockResolvedValueOnce({ items: [], total: 122 });

    const res = await previewEfashionMatchByReference("p-1", "A11");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.candidates).toHaveLength(1);
    expect(res.data.candidates[0].efashionProductId).toBe(2418489);
    // Skip doit incrémenter de PAGE_SIZE strict, pas de items.length.
    const calls = efashionListProductsMock.mock.calls;
    expect(calls[0][0].skip).toBe(0);
    expect(calls[1][0].skip).toBe(50);
    expect(calls[2][0].skip).toBe(100);
  });

  it("arrête la pagination dès qu'une page revient vide", async () => {
    findUniqueMock.mockResolvedValueOnce(baseProductRow);
    efashionListProductsMock.mockResolvedValueOnce({ items: [], total: 0 });

    const res = await previewEfashionMatchByReference("p-1", "A11");

    expect(res.success).toBe(true);
    expect(efashionListProductsMock).toHaveBeenCalledTimes(1);
  });

  it("ramène un candidat en brouillon dans les résultats (visible=false)", async () => {
    findUniqueMock.mockResolvedValueOnce(baseProductRow);
    efashionListProductsMock.mockResolvedValueOnce({
      items: [
        {
          id_produit: 42,
          reference: "A11",
          reference_base: "A11",
          id_couleur: 7,
          couleur: "Doré",
          visible: false, // brouillon = non visible
          supprimer: false,
          stock_value: 0,
          nb_photos: 0,
        },
      ],
      total: 1,
    });

    const res = await previewEfashionMatchByReference("p-1", "A11");

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.candidates).toHaveLength(1);
    expect(res.data.candidates[0].efashionProductId).toBe(42);
    expect(res.data.candidates[0].visible).toBe(false);
  });
});
