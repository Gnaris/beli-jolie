/**
 * Tests unitaires de la validation amont de `bulkUpdateProductAttributes`.
 *
 * Ne touchent pas à la BDD : tous les appels Prisma sont mockés. On vérifie
 * uniquement les règles de validation qui s'exécutent AVANT le findMany
 * principal (args vide, aucun champ, somme % != 100, % hors bornes).
 *
 * Les tests d'intégration DB-backed couvrant le comportement complet vivent
 * dans `__tests__/integration/product-bulk-attributes.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks externes ──────────────────────────────────────────────
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "u", role: "ADMIN", status: "APPROVED", email: "a@b.c" },
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));
vi.mock("@/lib/pfs-api-write", () => ({ pfsUpdateStatus: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  
  notifyOrderStatusChange: vi.fn(),
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/translate", () => ({ invalidateProductTranslations: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Prisma : on contrôle finement ce que chaque modèle renvoie.
const prismaMock: any = {
  category: { findUnique: vi.fn() },
  subCategory: { findMany: vi.fn() },
  hsCode: { findUnique: vi.fn() },
  manufacturingCountry: { findUnique: vi.fn() },
  season: { findUnique: vi.fn() },
  composition: { findMany: vi.fn() },
  product: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  productComposition: {
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};
prismaMock.$transaction = vi.fn(async (fn: any) => fn(prismaMock));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// On importe APRÈS les mocks pour que la fonction utilise prismaMock
const { bulkUpdateProductAttributes } = await import("@/app/actions/admin/products");

beforeEach(() => {
  for (const m of Object.values(prismaMock)) {
    if (typeof m === "object" && m !== null) {
      for (const fn of Object.values(m)) {
        if (typeof fn === "function" && "mockReset" in fn) {
          (fn as any).mockReset();
        }
      }
    }
  }
});

describe("bulkUpdateProductAttributes — validation amont", () => {
  it("rejette quand productIds est vide", async () => {
    await expect(bulkUpdateProductAttributes([], { isBestSeller: true })).rejects.toThrow(
      /Aucun produit/,
    );
  });

  it("rejette quand productIds dépasse 1000", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`);
    await expect(bulkUpdateProductAttributes(ids, { isBestSeller: true })).rejects.toThrow(
      /1000/,
    );
  });

  it("rejette quand aucun champ n'est fourni", async () => {
    await expect(bulkUpdateProductAttributes(["p1"], {})).rejects.toThrow(/Aucune modification/);
  });

  it("rejette une composition dont la somme n'est pas 100%", async () => {
    prismaMock.composition.findMany.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);
    await expect(
      bulkUpdateProductAttributes(["p1"], {
        compositions: [
          { compositionId: "c1", percentage: 50 },
          { compositionId: "c2", percentage: 30 },
        ],
      }),
    ).rejects.toThrow(/100%/);
  });

  it("passe `important: true` seul sans poser aucun drapeau syncRequired", async () => {
    // Produit déjà publié sur toutes les marketplaces — l'appelant ne modifie
    // que `important`, donc les drapeaux syncRequired doivent rester inertes.
    prismaMock.product.findMany.mockResolvedValueOnce([
      {
        id: "p1",
        reference: "REF1",
        categoryId: "cat1",
        pfsProductId: "pfs-1",
        ankorsProductId: "ankors-1",
        efashionReferenceBase: "efashion-1",
        faireProductId: "faire-1",
      },
    ]);
    const r = await bulkUpdateProductAttributes(["p1"], { important: true });
    expect(r.updated).toBe(1);
    expect(prismaMock.product.update).toHaveBeenCalledTimes(1);
    const callArgs = prismaMock.product.update.mock.calls[0][0];
    expect(callArgs.data.important).toBe(true);
    expect(callArgs.data.pfsSyncRequired).toBeUndefined();
    expect(callArgs.data.ankorsSyncRequired).toBeUndefined();
    expect(callArgs.data.efashionSyncRequired).toBeUndefined();
    expect(callArgs.data.faireSyncRequired).toBeUndefined();
  });

  it("`important` combiné avec un autre champ pose bien les drapeaux syncRequired", async () => {
    prismaMock.category.findUnique.mockResolvedValueOnce({ id: "catA" });
    prismaMock.product.findMany.mockResolvedValueOnce([
      {
        id: "p1",
        reference: "REF1",
        categoryId: "catB",
        pfsProductId: "pfs-1",
        ankorsProductId: null,
        efashionReferenceBase: null,
        faireProductId: null,
      },
    ]);
    await bulkUpdateProductAttributes(["p1"], {
      important: true,
      categoryId: "catA",
    });
    const callArgs = prismaMock.product.update.mock.calls[0][0];
    expect(callArgs.data.important).toBe(true);
    expect(callArgs.data.categoryId).toBe("catA");
    // Seule PFS est liée sur ce produit → seul son drapeau doit être posé.
    expect(callArgs.data.pfsSyncRequired).toBe(true);
    expect(callArgs.data.ankorsSyncRequired).toBeUndefined();
  });

  it("accepte une composition vide (= efface la composition)", async () => {
    prismaMock.product.findMany.mockResolvedValueOnce([
      { id: "p1", reference: "REF1", categoryId: "cat1" },
    ]);
    const r = await bulkUpdateProductAttributes(["p1"], { compositions: [] });
    expect(r.updated).toBe(1);
    expect(prismaMock.productComposition.deleteMany).toHaveBeenCalledWith({
      where: { productId: "p1" },
    });
    // Aucun createMany car liste vide
    expect(prismaMock.productComposition.createMany).not.toHaveBeenCalled();
  });

  it("rejette un pourcentage négatif ou > 100", async () => {
    // Mock composition.findMany pour que la validation FK passe et qu'on
    // atteigne la vérif de bornes (somme = 100 pour ne pas se faire bloquer avant).
    prismaMock.composition.findMany.mockResolvedValueOnce([{ id: "c1" }, { id: "c2" }]);
    await expect(
      bulkUpdateProductAttributes(["p1"], {
        compositions: [
          { compositionId: "c1", percentage: 200 },
          { compositionId: "c2", percentage: -100 },
        ],
      }),
    ).rejects.toThrow(/entre 0 et 100/);
  });

  it("vérifie l'existence de la catégorie avant tout traitement", async () => {
    prismaMock.category.findUnique.mockResolvedValueOnce(null);
    await expect(
      bulkUpdateProductAttributes(["p1"], { categoryId: "fake" }),
    ).rejects.toThrow(/catégorie/);
    expect(prismaMock.product.findMany).not.toHaveBeenCalled();
  });

  it("rejette une sous-catégorie d'une autre catégorie quand categoryId est fourni", async () => {
    prismaMock.category.findUnique.mockResolvedValueOnce({ id: "catA" });
    prismaMock.subCategory.findMany.mockResolvedValueOnce([
      { id: "sub1", categoryId: "catB" }, // mauvaise catégorie
    ]);
    await expect(
      bulkUpdateProductAttributes(["p1"], {
        categoryId: "catA",
        subCategoryIds: ["sub1"],
      }),
    ).rejects.toThrow(/n'appartient pas/);
  });
});
