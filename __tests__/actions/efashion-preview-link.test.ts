import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findUniqueMock,
  efashionGetMeMock,
  efashionListProductsMock,
  buildEfashionPhotoUrlMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  efashionGetMeMock: vi.fn().mockResolvedValue({ id_vendeur: 999 }),
  efashionListProductsMock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  buildEfashionPhotoUrlMock: vi.fn(() => "https://efashion.cdn/photo.jpg"),
  getServerSessionMock: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: findUniqueMock },
  },
}));
vi.mock("@/lib/efashion-api", () => ({
  efashionListProducts: efashionListProductsMock,
  efashionGetMe: efashionGetMeMock,
  buildEfashionPhotoUrl: buildEfashionPhotoUrlMock,
}));
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
  manufacturingCountry: { id: "m", name: "Chine", efashionProvenanceId: 2 },
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
    expect(efashionListProductsMock).toHaveBeenCalledTimes(1);
    const callArgs = efashionListProductsMock.mock.calls[0][0];
    expect(callArgs.premelFilter).toBe("tous");
    expect(callArgs.reference).toBe("A11");
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
