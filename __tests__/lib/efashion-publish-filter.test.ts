import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke toutes les dépendances pour isoler la logique de filtrage UNIT.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn() },
    productColor: { update: vi.fn() },
    productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/efashion-shootings", () => ({
  efashionSaveMelDraft: vi.fn(),
  efashionSaveMelChoice: vi.fn(),
  efashionCheckReferencesExist: vi.fn(),
}));
vi.mock("@/lib/efashion-photos", () => ({
  efashionUploadProductPhotos: vi.fn(),
}));
vi.mock("@/lib/efashion-pricing", () => ({
  loadEfashionMarkup: vi.fn().mockResolvedValue({ type: "percent", value: 0, rounding: "none" }),
  computeEfashionPrice: vi.fn(({ basePrice }) => basePrice),
}));
vi.mock("@/lib/efashion-declinaison-matcher", () => ({
  resolveEfashionDeclinaison: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { efashionPublishProduct } from "@/lib/efashion-publish";
import { resolveEfashionDeclinaison } from "@/lib/efashion-declinaison-matcher";
import { efashionCheckReferencesExist } from "@/lib/efashion-shootings";

const findUniqueMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const declMock = resolveEfashionDeclinaison as unknown as ReturnType<typeof vi.fn>;
const checkRefMock = efashionCheckReferencesExist as unknown as ReturnType<typeof vi.fn>;

function makeColor(saleType: "UNIT" | "PACK") {
  return {
    id: `pc-${saleType}-${Math.random()}`,
    efashionProductId: null,
    unitPrice: 10,
    weight: 0.1,
    stock: 5,
    saleType,
    packQuantity: saleType === "PACK" ? 12 : null,
    isPrimary: true,
    disabled: false,
    color: { id: "color-1", name: "Doré", efashionColorId: 78 },
    variantSizes: [
      { quantity: 1, size: { id: "size-1", name: "TU" } },
    ],
    images: [],
  };
}

describe("efashionPublishProduct — filtrage UNIT", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    declMock.mockReset();
    checkRefMock.mockReset();
    // Par défaut, la résolution de déclinaison retourne une erreur pour qu'on
    // s'arrête tôt après le filtre UNIT — c'est suffisant pour ce qu'on teste.
    declMock.mockResolvedValue({ success: false, error: "decl-fake-fail" });
    checkRefMock.mockResolvedValue({ results: [] });
  });

  it("refuse la publication quand toutes les variantes sont PACK", async () => {
    findUniqueMock.mockResolvedValue({
      id: "p1",
      reference: "TEST",
      name: "Produit Pack",
      description: null,
      status: "ONLINE",
      efashionReferenceBase: null,
      category: { id: "c1", name: "Cat", efashionCategorieId: 160102 },
      manufacturingCountry: { id: "ct1", name: "Chine", efashionProvenanceId: 1 },
      season: { id: "s1", name: "PE26", efashionCollectionId: 3 },
      compositions: [
        { percentage: 100, composition: { id: "co1", name: "Métal", efashionId: 60 } },
      ],
      colors: [makeColor("PACK"), makeColor("PACK")],
      translations: [],
    });

    const res = await efashionPublishProduct("p1");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Aucune variante à l'unité/i);
  });

  it("ne refuse pas quand au moins une variante UNIT existe (mix UNIT+PACK)", async () => {
    findUniqueMock.mockResolvedValue({
      id: "p2",
      reference: "TEST2",
      name: "Produit Mix",
      description: null,
      status: "ONLINE",
      efashionReferenceBase: null,
      category: { id: "c1", name: "Cat", efashionCategorieId: 160102 },
      manufacturingCountry: { id: "ct1", name: "Chine", efashionProvenanceId: 1 },
      season: { id: "s1", name: "PE26", efashionCollectionId: 3 },
      compositions: [
        { percentage: 100, composition: { id: "co1", name: "Métal", efashionId: 60 } },
      ],
      colors: [makeColor("UNIT"), makeColor("PACK")],
      translations: [],
    });

    // Le filtrage doit laisser passer la validation UNIT. On va se planter plus
    // loin dans le flux (les mocks renvoient undefined) mais ce n'est pas le
    // sujet de ce test : on vérifie juste qu'on dépasse le filtre.
    const res = await efashionPublishProduct("p2");
    // Si on dépasse le filtre, on tombe sur une autre erreur (pas l'erreur "UNIT").
    if (!res.success) {
      expect(res.error).not.toMatch(/Aucune variante à l'unité/i);
    }
  });

  it("refuse quand le produit n'a aucune couleur", async () => {
    findUniqueMock.mockResolvedValue({
      id: "p3",
      reference: "EMPTY",
      name: "Vide",
      description: null,
      status: "ONLINE",
      efashionReferenceBase: null,
      category: { id: "c1", name: "Cat", efashionCategorieId: 160102 },
      manufacturingCountry: { id: "ct1", name: "Chine", efashionProvenanceId: 1 },
      season: { id: "s1", name: "PE26", efashionCollectionId: 3 },
      compositions: [],
      colors: [],
      translations: [],
    });

    const res = await efashionPublishProduct("p3");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/aucune couleur/i);
  });
});
