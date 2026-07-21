/**
 * Régression « double stock côté eFashion » (2026-07-13).
 *
 * Contexte du bug : quand une couleur BJ était déjà mappée à un id_couleur
 * eFashion (via Color.efashionColorId global) et qu'on la liait à un produit
 * eFashion existant qui utilise un id_couleur différent, la sync post-liaison
 * poussait le stock avec l'id_couleur global BJ — pas celui du produit
 * eFashion existant. Résultat : eFashion créait une 2ᵉ entrée de stock, et le
 * total affiché doublait (ancien + nouveau).
 *
 * Fix : quand le mapping global BJ diffère de l.efashionColorId, on pose
 * ProductColor.efashionColorIdOverride = l.efashionColorId. Comme ça la sync
 * pousse sur le bon id_couleur et la biblio globale reste intacte.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findUniqueMock,
  productUpdateMock,
  txProductColorUpdateManyMock,
  txColorUpdateManyMock,
  colorFindManyMock,
  efashionGetMeMock,
  efashionListProductsMock,
  efashionUpdateProductInPlaceMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  productUpdateMock: vi.fn().mockResolvedValue({}),
  txProductColorUpdateManyMock: vi.fn().mockResolvedValue({}),
  txColorUpdateManyMock: vi.fn().mockResolvedValue({}),
  colorFindManyMock: vi.fn().mockResolvedValue([]),
  efashionGetMeMock: vi.fn().mockResolvedValue({ id_vendeur: 2017 }),
  efashionListProductsMock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  efashionUpdateProductInPlaceMock: vi
    .fn()
    .mockResolvedValue({ success: true, colorsCreatedCount: 0 }),
  getServerSessionMock: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));

// On expose les mocks internes de la transaction pour observer les appels
// updateMany(ProductColor) et updateMany(Color) qui sont faits DANS la
// transaction — c'est là qu'on veut vérifier le champ efashionColorIdOverride.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: findUniqueMock, update: productUpdateMock },
    color: { findMany: colorFindManyMock },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        product: { update: productUpdateMock },
        productColor: { updateMany: txProductColorUpdateManyMock },
        color: { updateMany: txColorUpdateManyMock },
      }),
    ),
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
    efashionListByReferenceBaseExact: (
      opts: Parameters<typeof actual.efashionListByReferenceBaseExact>[0],
    ) =>
      actual.efashionListByReferenceBaseExact({ ...opts, listFn: efashionListProductsMock }),
  };
});
vi.mock("@/lib/efashion-update", () => ({
  efashionUpdateProductInPlace: efashionUpdateProductInPlaceMock,
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <Args extends unknown[], R>(fn: (...args: Args) => R) => fn,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { linkEfashionProductManually } from "@/app/actions/admin/efashion";

/**
 * Produit BJ avec 1 couleur UNIT. Sa Color biblio a déjà un efashionColorId
 * global (78). On va la lier à un produit eFashion dont l'id_couleur diffère
 * pour déclencher l'override.
 */
const productRow = {
  id: "p-1",
  reference: "A2451",
  name: "Test",
  efashionReferenceBase: null,
  category: { id: "c", name: "Bijoux", efashionCategorieId: 1 },
  country: { id: "m", name: "Chine", efashionProvenanceId: 2 },
  season: { id: "s", name: "PE26", efashionCollectionId: 3 },
  compositions: [{ composition: { id: "co", name: "Acier", efashionId: 4 } }],
  colors: [
    {
      id: "pc-dore",
      saleType: "UNIT" as const,
      unitPrice: 10,
      stock: 5,
      efashionProductId: null,
      color: { id: "col-dore", name: "Doré", hex: "#FFD700", patternImage: null, efashionColorId: 78 },
      images: [{ path: "/uploads/a.webp" }],
    },
  ],
};

const efashionSingleLine = {
  id_produit: 100,
  reference: "A2451-DORÉ",
  reference_base: "A2451",
  couleur: "Doré",
  visible: true,
  supprimer: false,
  stock_value: 5,
  nb_photos: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ user: { role: "ADMIN" } });
  efashionGetMeMock.mockResolvedValue({ id_vendeur: 2017 });
  productUpdateMock.mockResolvedValue({});
  txProductColorUpdateManyMock.mockResolvedValue({});
  txColorUpdateManyMock.mockResolvedValue({});
  efashionUpdateProductInPlaceMock.mockResolvedValue({
    success: true,
    colorsCreatedCount: 0,
  });
});

describe("linkEfashionProductManually — override id_couleur (fix double stock)", () => {
  it("pose ProductColor.efashionColorIdOverride quand mapping global ≠ id_couleur eFashion", async () => {
    // Color.efashionColorId global = 78, mais le produit eFashion existant
    // utilise id_couleur = 999. Sans override, le stock serait poussé sur 78
    // → nouvelle entrée orpheline côté eFashion → total = 5 (ancien) + 5 (BJ).
    findUniqueMock.mockResolvedValue(productRow);
    colorFindManyMock.mockResolvedValue([{ id: "col-dore", efashionColorId: 78 }]);
    efashionListProductsMock.mockResolvedValueOnce({
      items: [{ ...efashionSingleLine, id_couleur: 999 }],
      total: 1,
    });

    const res = await linkEfashionProductManually("p-1", "A2451", [
      { localColorId: "col-dore", efashionProductId: 100, efashionColorId: 999 },
    ]);

    expect(res.success).toBe(true);

    // L'appel « pose l'efashionProductId sur la ProductColor UNIT » (le 2ᵉ
    // updateMany : le 1ᵉʳ est le reset de tous les efashionProductId/override
    // du produit avant de repartir propre).
    const posedCall = txProductColorUpdateManyMock.mock.calls.find(
      (c) =>
        c[0]?.where?.colorId === "col-dore" &&
        c[0]?.where?.saleType === "UNIT",
    );
    expect(posedCall).toBeDefined();
    expect(posedCall![0].data).toMatchObject({
      efashionProductId: 100,
      efashionColorIdOverride: 999, // ← le fix
    });
  });

  it("ne pose PAS d'override quand mapping global == id_couleur eFashion", async () => {
    // Color.efashionColorId global = 78 et le produit eFashion utilise aussi 78.
    // Pas de risque de double stock, donc pas d'override à poser.
    findUniqueMock.mockResolvedValue(productRow);
    colorFindManyMock.mockResolvedValue([{ id: "col-dore", efashionColorId: 78 }]);
    efashionListProductsMock.mockResolvedValueOnce({
      items: [{ ...efashionSingleLine, id_couleur: 78 }],
      total: 1,
    });

    const res = await linkEfashionProductManually("p-1", "A2451", [
      { localColorId: "col-dore", efashionProductId: 100, efashionColorId: 78 },
    ]);

    expect(res.success).toBe(true);

    const posedCall = txProductColorUpdateManyMock.mock.calls.find(
      (c) =>
        c[0]?.where?.colorId === "col-dore" &&
        c[0]?.where?.saleType === "UNIT",
    );
    expect(posedCall).toBeDefined();
    expect(posedCall![0].data).toMatchObject({
      efashionProductId: 100,
      efashionColorIdOverride: null,
    });
  });

  it("efface les overrides précédents à chaque nouvelle liaison (reset propre)", async () => {
    // Le premier updateMany de la transaction reset TOUS les efashionProductId
    // ET tous les efashionColorIdOverride du produit — sinon on trainerait un
    // override obsolète d'une liaison antérieure.
    findUniqueMock.mockResolvedValue(productRow);
    colorFindManyMock.mockResolvedValue([{ id: "col-dore", efashionColorId: 78 }]);
    efashionListProductsMock.mockResolvedValueOnce({
      items: [{ ...efashionSingleLine, id_couleur: 78 }],
      total: 1,
    });

    await linkEfashionProductManually("p-1", "A2451", [
      { localColorId: "col-dore", efashionProductId: 100, efashionColorId: 78 },
    ]);

    // Le tout premier updateMany doit être le reset global (where: productId).
    const resetCall = txProductColorUpdateManyMock.mock.calls.find(
      (c) =>
        c[0]?.where?.productId === "p-1" && !("colorId" in (c[0]?.where ?? {})),
    );
    expect(resetCall).toBeDefined();
    expect(resetCall![0].data).toMatchObject({
      efashionProductId: null,
      efashionColorIdOverride: null,
    });
  });
});
