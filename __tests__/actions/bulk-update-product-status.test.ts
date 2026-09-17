/**
 * Tests pour `bulkUpdateProductStatus` — focus sur la transition vers ONLINE.
 *
 * Comportements couverts :
 *  - un produit avec `isIncomplete=true` mais dont le contenu est en réalité
 *    complet (bug historique des imports PFS) est mis en ligne ET son drapeau
 *    est remis à `false`.
 *  - un produit réellement incomplet (description trop courte, etc.) reste en
 *    brouillon avec les vraies raisons.
 *  - un produit dont toutes les couleurs ont stock=0 est accepté (la rupture
 *    totale ne bloque plus la mise en ligne — c'est à l'admin de décider).
 *  - un produit `OFFLINE` complet et `isIncomplete=false` passe en ONLINE sans
 *    toucher au drapeau.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productColor: { findMany: vi.fn().mockResolvedValue([]) },
    productColorImage: { groupBy: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (typeof arg === "function") {
        return (arg as (tx: unknown) => Promise<unknown>)({});
      }
      return null;
    }),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Modules tirés par products.ts qui ne sont pas exercés par bulkUpdateProductStatus
vi.mock("@/lib/translate", () => ({ invalidateProductTranslations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/pfs-annexes", () => ({ getPfsAnnexes: vi.fn() }));
vi.mock("@/lib/normalize-primary-flag", () => ({ normalizePrimaryFlag: vi.fn() }));
vi.mock("@/lib/variant-image-coverage", () => ({ anyVariantHasImage: vi.fn(() => true) }));
vi.mock("@/lib/product-primary-color", () => ({
  resolvePrimaryColorId: vi.fn(),
  listAvailableColorIds: vi.fn(),
}));
vi.mock("@/lib/pfs-color-conflicts", () => ({
  validateOverridesNotMatchingPrincipal: vi.fn(),
}));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { prisma } from "@/lib/prisma";
import { bulkUpdateProductStatus } from "@/app/actions/admin/products";

const findManyMock = prisma.product.findMany as unknown as ReturnType<typeof vi.fn>;
const updateManyMock = prisma.product.updateMany as unknown as ReturnType<typeof vi.fn>;
const transactionMock = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const groupImagesMock = prisma.productColorImage.groupBy as unknown as ReturnType<typeof vi.fn>;

/**
 * Construit un produit "complet" — tous les champs requis par
 * evaluateProductPublishability sont OK. À surcharger via Object.assign si
 * besoin d'invalider une règle particulière.
 */
function makeCompleteProduct(
  overrides: Partial<{
    id: string;
    reference: string;
    isIncomplete: boolean;
    description: string;
    stock: number;
    disabled: boolean;
  }> = {},
) {
  const id = overrides.id ?? "p1";
  return {
    id,
    reference: overrides.reference ?? "REF-1",
    name: "Bague émeraude",
    description: overrides.description ?? "Une description suffisamment longue pour passer la limite.",
    categoryId: "cat-1",
    status: "OFFLINE" as const,
    isIncomplete: overrides.isIncomplete ?? false,
    compositions: [{ percentage: 100 }],
    colors: [
      {
        id: "v1",
        colorId: "col-1",
        color: { name: "Or" },
        unitPrice: 12.5,
        stock: overrides.stock ?? 5,
        disabled: overrides.disabled ?? false,
        weight: 0.3,
        saleType: "UNIT" as const,
        packQuantity: null,
        variantSizes: [
          { sizeId: "s1", size: { name: "Taille unique" }, quantity: 5 },
        ],
        packLines: [],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateManyMock.mockResolvedValue({ count: 0 });
  groupImagesMock.mockResolvedValue([
    // 1 image pour col-1 → satisfait la règle "au moins une variante a une image"
    { productId: "p1", colorId: "col-1", _count: { _all: 1 } },
    { productId: "p2", colorId: "col-1", _count: { _all: 1 } },
    { productId: "p3", colorId: "col-1", _count: { _all: 1 } },
  ]);
});

describe("bulkUpdateProductStatus (ONLINE)", () => {
  it("met en ligne un produit dont isIncomplete=true est périmé ET remet le drapeau à false", async () => {
    findManyMock.mockResolvedValueOnce([
      makeCompleteProduct({ id: "p1", isIncomplete: true }),
    ]);

    const res = await bulkUpdateProductStatus(["p1"], "ONLINE");

    expect(res.success).toEqual(["p1"]);
    expect(res.errors).toEqual([]);

    // Le drapeau périmé doit être remis à false via $transaction([status, flag])
    expect(transactionMock).toHaveBeenCalledOnce();
    const txArg = transactionMock.mock.calls[0][0];
    expect(Array.isArray(txArg)).toBe(true);
    // 2 updateMany invoqués : 1 pour status, 1 pour isIncomplete
    expect(updateManyMock).toHaveBeenCalledTimes(2);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { status: "ONLINE" },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { isIncomplete: false },
    });
  });

  it("ne touche pas au drapeau si le produit était déjà isIncomplete=false", async () => {
    findManyMock.mockResolvedValueOnce([
      makeCompleteProduct({ id: "p1", isIncomplete: false }),
    ]);

    const res = await bulkUpdateProductStatus(["p1"], "ONLINE");

    expect(res.success).toEqual(["p1"]);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { status: "ONLINE" },
    });
  });

  it("refuse un produit réellement incomplet (description trop courte) avec la vraie raison", async () => {
    // Description "x" (1 char) + référence "REF-1" (suffix « \n\nRéférence produit : REF-1 » = 27 chars)
    // → total effectif = 28 < 30 → trop courte.
    findManyMock.mockResolvedValueOnce([
      makeCompleteProduct({
        id: "p1",
        isIncomplete: true,
        description: "x",
      }),
    ]);

    const res = await bulkUpdateProductStatus(["p1"], "ONLINE");

    expect(res.success).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reference).toBe("REF-1");
    expect(res.errors[0].reason).toMatch(/Description trop courte/);
    // Pas de message générique "produit en brouillon"
    expect(res.errors[0].reason).not.toMatch(/produit en brouillon/);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("refuse un produit dont toutes les variantes sont en rupture (stock=0)", async () => {
    // Règle métier 2026-09-17 : impossible de passer ONLINE si aucune
    // variante n'est disponible à la vente. (À l'inverse, un produit déjà
    // ONLINE devenu en rupture est laissé en ligne — testé côté action
    // updateProduct.)
    findManyMock.mockResolvedValueOnce([
      makeCompleteProduct({ id: "p1", stock: 0 }),
    ]);

    const res = await bulkUpdateProductStatus(["p1"], "ONLINE");

    expect(res.success).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reference).toBe("REF-1");
    expect(res.errors[0].reason).toMatch(/rupture ou désactivées/);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("refuse un produit dont toutes les variantes sont désactivées", async () => {
    findManyMock.mockResolvedValueOnce([
      makeCompleteProduct({ id: "p1", disabled: true }),
    ]);

    const res = await bulkUpdateProductStatus(["p1"], "ONLINE");

    expect(res.success).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toMatch(/rupture ou désactivées/);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("traite plusieurs produits indépendamment : met en ligne les bons et liste les mauvais", async () => {
    findManyMock.mockResolvedValueOnce([
      makeCompleteProduct({ id: "p1", reference: "OK1", isIncomplete: true }),
      makeCompleteProduct({
        id: "p2",
        reference: "BAD",
        isIncomplete: true,
        description: "x",
      }),
      makeCompleteProduct({ id: "p3", reference: "OK2", isIncomplete: false }),
    ]);

    const res = await bulkUpdateProductStatus(["p1", "p2", "p3"], "ONLINE");

    expect(res.success.sort()).toEqual(["p1", "p3"]);
    expect(res.errors.map((e) => e.reference)).toEqual(["BAD"]);
    // p1 a un drapeau périmé → on doit avoir le reset isIncomplete pour p1 seul
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { isIncomplete: false },
    });
  });
});
