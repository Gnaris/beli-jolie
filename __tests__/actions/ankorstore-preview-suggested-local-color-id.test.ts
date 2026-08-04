/**
 * Régression : previewAnkorstoreProductForLinking devait renvoyer `suggestedLocalColorId`
 * sous forme de `ProductColor.id`, pas de `Color.id` (bibliothèque). Sinon la modale de
 * liaison affichait la colonne Ankorstore vide (mapping[productColorId] introuvable)
 * mais marquait toutes les variantes "À déplacer" dans le déroulant — impossible d'agir.
 * Cf. Screenshot bug 2026-08-04 (product A99 = Blanc/Noir/Vert, dropdown "Déplacer" partout).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "u", role: "ADMIN", status: "APPROVED" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi
    .fn()
    .mockResolvedValue({ id: "tenant-1", slug: "bj", name: "BJ" }),
}));

const prismaMock: any = {
  product: { findUnique: vi.fn() },
  productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const ankorApiMock = { ankorstoreGetProduct: vi.fn() };
vi.mock("@/lib/ankorstore-api", () => ankorApiMock);

// autoLinkAnkorstoreVariants + kickoff : pas utilisés dans preview, on stub par sécurité.
vi.mock("@/lib/ankorstore-variant-link", () => ({
  autoLinkAnkorstoreVariants: vi.fn(),
}));
vi.mock("@/lib/ankorstore-update", () => ({
  ankorstoreKickoffUpdate: vi.fn(),
}));

const { previewAnkorstoreProductForLinking } = await import(
  "@/app/actions/admin/ankorstore"
);

beforeEach(() => {
  prismaMock.product.findUnique.mockReset();
  prismaMock.productColorImage.findMany.mockResolvedValue([]);
  ankorApiMock.ankorstoreGetProduct.mockReset();
});

describe("previewAnkorstoreProductForLinking — suggestedLocalColorId = productColorId", () => {
  it("renvoie un productColorId (pas un colorId bibliothèque) matchable côté modale", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: "prod-a99",
      name: "A99",
      reference: "A99",
      colors: [
        {
          id: "pc-blanc",
          colorId: "color-blanc",
          sku: "A99_BLANC",
          weight: 0.02,
          unitPrice: 5,
          stock: 1000,
          ankorsVariantId: null,
          color: { name: "Blanc", hex: "#ffffff", patternImage: null },
          variantSizes: [{ size: { name: "Taille unique" } }],
          images: [],
        },
        {
          id: "pc-noir",
          colorId: "color-noir",
          sku: "A99_NOIR",
          weight: 0.02,
          unitPrice: 5,
          stock: 996,
          ankorsVariantId: null,
          color: { name: "Noir", hex: "#000000", patternImage: null },
          variantSizes: [{ size: { name: "Taille unique" } }],
          images: [],
        },
        {
          id: "pc-vert",
          colorId: "color-vert",
          sku: "A99_VERT",
          weight: 0.02,
          unitPrice: 5,
          stock: 999,
          ankorsVariantId: null,
          color: { name: "Vert", hex: "#00ff00", patternImage: null },
          variantSizes: [{ size: { name: "Taille unique" } }],
          images: [],
        },
      ],
    });

    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ak-a99",
      name: "Produit A99",
      description: "",
      images: [],
      variants: [
        {
          id: "ak-var-noir",
          sku: "A99_NOIR_UNIT_1",
          name: "Noir",
          options: [{ name: "color", value: "Noir" }],
          wholesalePrice: 600,
          retailPrice: 1500,
          stockQuantity: 996,
          images: [],
        },
        {
          id: "ak-var-blanc",
          sku: "A99_BLANC_UNIT_2",
          name: "Blanc",
          options: [{ name: "color", value: "Blanc" }],
          wholesalePrice: 600,
          retailPrice: 1500,
          stockQuantity: 1000,
          images: [],
        },
        {
          id: "ak-var-vert",
          sku: "A99_VERT_UNIT_3",
          name: "Vert",
          options: [{ name: "color", value: "Vert" }],
          wholesalePrice: 600,
          retailPrice: 1500,
          stockQuantity: 999,
          images: [],
        },
      ],
      shape_properties: { weight: { amount: 0.02 } },
    });

    const res = await previewAnkorstoreProductForLinking("prod-a99", "ak-a99");
    if (!res.success) throw new Error(res.error);

    const productColorIds = new Set(
      res.data.localColors.map((c) => c.productColorId),
    );

    for (const v of res.data.variants) {
      expect(v.suggestedLocalColorId).not.toBeNull();
      // Chaque suggestion doit désigner une ProductColor existante du produit BJ,
      // sinon la modale ne peut ni pré-remplir la colonne, ni détecter la
      // "collision" côté déroulant.
      expect(productColorIds.has(v.suggestedLocalColorId as string)).toBe(true);
    }

    const byAkId = new Map(
      res.data.variants.map((v) => [v.ankorstoreVariantId, v.suggestedLocalColorId]),
    );
    expect(byAkId.get("ak-var-blanc")).toBe("pc-blanc");
    expect(byAkId.get("ak-var-noir")).toBe("pc-noir");
    expect(byAkId.get("ak-var-vert")).toBe("pc-vert");
  });
});
