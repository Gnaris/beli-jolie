/**
 * Vérifie la validation asymétrique de `linkEfashionProductManually` :
 *   - Les BJ orphans (couleurs locales sans correspondance eFashion) sont
 *     AUTORISÉES : elles seront créées automatiquement par la sync post-liaison
 *     (cf. lib/efashion-update.ts > auto-création via duplicateWithNewColor).
 *   - Les eFashion orphans (lignes chez eux sans correspondance chez nous)
 *     RESTENT BLOQUANTES : l'admin doit les résoudre avant de lier.
 *
 * Régression à protéger : avant ce changement, le moindre orphan d'un côté
 * comme de l'autre bloquait la liaison. La cliente devait donc créer manuellement
 * chez eFashion les couleurs en plus côté BJ — ce qui était fastidieux.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findUniqueMock,
  productUpdateMock,
  productColorUpdateManyMock,
  colorUpdateManyMock,
  colorFindManyMock,
  transactionMock,
  efashionGetMeMock,
  efashionListProductsMock,
  efashionUpdateProductInPlaceMock,
  getServerSessionMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  productUpdateMock: vi.fn().mockResolvedValue({}),
  productColorUpdateManyMock: vi.fn().mockResolvedValue({}),
  colorUpdateManyMock: vi.fn().mockResolvedValue({}),
  // Nécessaire depuis 2026-07-13 : linkEfashionProductManually précharge le
  // mapping global BJ (Color.efashionColorId) pour décider s'il doit poser
  // ProductColor.efashionColorIdOverride (fix du double stock côté eFashion).
  colorFindManyMock: vi.fn().mockResolvedValue([]),
  transactionMock: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      product: { update: vi.fn().mockResolvedValue({}) },
      productColor: { updateMany: vi.fn().mockResolvedValue({}) },
      color: { updateMany: vi.fn().mockResolvedValue({}) },
    }),
  ),
  efashionGetMeMock: vi.fn().mockResolvedValue({ id_vendeur: 2017 }),
  efashionListProductsMock: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  efashionUpdateProductInPlaceMock: vi
    .fn()
    .mockResolvedValue({ success: true, colorsCreatedCount: 0 }),
  getServerSessionMock: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: findUniqueMock, update: productUpdateMock },
    productColor: { updateMany: productColorUpdateManyMock },
    color: { updateMany: colorUpdateManyMock, findMany: colorFindManyMock },
    $transaction: transactionMock,
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
// Fix double stock 2026-08-06 : `linkEfashionProductManually` appelle en fin
// de flow `cleanupOrphanEfashionStocks` pour nettoyer les lignes stock
// fantômes avant la sync. On no-op le helper — sa logique est testée
// séparément dans __tests__/lib/efashion-orphan-stocks.test.ts.
vi.mock("@/lib/efashion-orphan-stocks", () => ({
  cleanupOrphanEfashionStocks: vi
    .fn()
    .mockResolvedValue({ plans: [], deletedCount: 0, failedCount: 0 }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  // `unstable_cache` est utilisé par lib/cached-data.ts (importé en cascade) :
  // on renvoie un passthrough qui exécute juste la fonction.
  unstable_cache: <Args extends unknown[], R>(fn: (...args: Args) => R) => fn,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { linkEfashionProductManually } from "@/app/actions/admin/efashion";

/**
 * Squelette de produit BJ avec 3 couleurs UNIT toutes mappées (efashionColorId
 * renseigné dans la bibliothèque Color). Utilisé pour les 2 scénarios.
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
    {
      id: "pc-argent",
      saleType: "UNIT" as const,
      unitPrice: 10,
      stock: 5,
      efashionProductId: null,
      color: { id: "col-argent", name: "Argent", hex: "#C0C0C0", patternImage: null, efashionColorId: 22 },
      images: [{ path: "/uploads/b.webp" }],
    },
    {
      id: "pc-rose",
      saleType: "UNIT" as const,
      unitPrice: 10,
      stock: 5,
      efashionProductId: null,
      color: { id: "col-rose", name: "Rose", hex: "#FFC0CB", patternImage: null, efashionColorId: 33 },
      images: [{ path: "/uploads/c.webp" }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue({ user: { role: "ADMIN" } });
  efashionGetMeMock.mockResolvedValue({ id_vendeur: 2017 });
  productUpdateMock.mockResolvedValue({});
  productColorUpdateManyMock.mockResolvedValue({});
  colorUpdateManyMock.mockResolvedValue({});
  efashionUpdateProductInPlaceMock.mockResolvedValue({
    success: true,
    colorsCreatedCount: 0,
  });
});

describe("linkEfashionProductManually — validation asymétrique", () => {
  it("autorise la liaison quand BJ a plus de couleurs qu'eFashion (orphans BJ → auto-création)", async () => {
    // BJ : 3 couleurs (Doré, Argent, Rose). eFashion : 2 lignes (Doré, Argent).
    // L'admin lie Doré et Argent → Rose reste « orpheline BJ ».
    findUniqueMock.mockResolvedValue(productRow);
    efashionListProductsMock.mockResolvedValueOnce({
      items: [
        {
          id_produit: 100,
          reference: "A2451-DORÉ",
          reference_base: "A2451",
          id_couleur: 78,
          couleur: "Doré",
          visible: true,
          supprimer: false,
          stock_value: 5,
          nb_photos: 1,
        },
        {
          id_produit: 200,
          reference: "A2451-ARGENT",
          reference_base: "A2451",
          id_couleur: 22,
          couleur: "Argent",
          visible: true,
          supprimer: false,
          stock_value: 5,
          nb_photos: 1,
        },
      ],
      total: 2,
    });
    // Simule 1 création auto remontée par la sync post-liaison.
    efashionUpdateProductInPlaceMock.mockResolvedValue({
      success: true,
      colorsCreatedCount: 1,
    });

    const res = await linkEfashionProductManually("p-1", "A2451", [
      { localColorId: "col-dore", efashionProductId: 100, efashionColorId: 78 },
      { localColorId: "col-argent", efashionProductId: 200, efashionColorId: 22 },
      // Rose volontairement non listée → orpheline BJ
    ]);

    expect(res.success).toBe(true);
    expect(res.linked).toBe(2);
    // Le compteur de création auto est bien remonté à l'UI pour le toast.
    expect(res.autoCreatedOnEfashion).toBe(1);
    // La sync post-liaison a bien été appelée avec forceFullSync :
    // c'est ELLE qui crée Rose côté eFashion via duplicateWithNewColor.
    expect(efashionUpdateProductInPlaceMock).toHaveBeenCalledWith("p-1", {
      forceFullSync: true,
    });
  });

  it("refuse la liaison quand eFashion a plus de couleurs que BJ (orphans eFashion bloquants)", async () => {
    // BJ : 1 couleur UNIT (Doré). eFashion : 2 lignes (Doré + Argent).
    // L'admin tente de lier juste Doré → Argent reste orpheline côté eFashion.
    findUniqueMock.mockResolvedValue({
      ...productRow,
      colors: [productRow.colors[0]], // que Doré
    });
    efashionListProductsMock.mockResolvedValueOnce({
      items: [
        {
          id_produit: 100,
          reference: "A2451-DORÉ",
          reference_base: "A2451",
          id_couleur: 78,
          couleur: "Doré",
          visible: true,
          supprimer: false,
          stock_value: 5,
          nb_photos: 1,
        },
        {
          id_produit: 200,
          reference: "A2451-ARGENT",
          reference_base: "A2451",
          id_couleur: 22,
          couleur: "Argent",
          visible: true,
          supprimer: false,
          stock_value: 5,
          nb_photos: 1,
        },
      ],
      total: 2,
    });

    const res = await linkEfashionProductManually("p-1", "A2451", [
      { localColorId: "col-dore", efashionProductId: 100, efashionColorId: 78 },
    ]);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sans équivalent chez vous/i);
    expect(res.error).toMatch(/Argent/i);
    // La sync post-liaison ne doit PAS avoir été lancée puisque la liaison a échoué.
    expect(efashionUpdateProductInPlaceMock).not.toHaveBeenCalled();
  });
});
