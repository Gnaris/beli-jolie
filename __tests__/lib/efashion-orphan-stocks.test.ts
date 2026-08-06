/**
 * Régression « double stock côté eFashion » — helper de nettoyage.
 *
 * Vérifie que `cleanupOrphanEfashionStocks` détecte et supprime les lignes
 * stock dont l'`id_couleur` ne matche pas celui du produit eFashion, tout
 * en préservant les lignes cohérentes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  productFindFirstMock,
  productColorFindManyMock,
  efashionGetMeMock,
  efashionListByRefBaseMock,
  efashionListProduitStocksMock,
  efashionRemoveProduitStockMock,
} = vi.hoisted(() => ({
  productFindFirstMock: vi.fn(),
  productColorFindManyMock: vi.fn(),
  efashionGetMeMock: vi.fn().mockResolvedValue({ id_vendeur: 1934 }),
  efashionListByRefBaseMock: vi.fn(),
  efashionListProduitStocksMock: vi.fn(),
  efashionRemoveProduitStockMock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findFirst: productFindFirstMock },
    productColor: { findMany: productColorFindManyMock },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/efashion-api", () => ({
  efashionGetMe: efashionGetMeMock,
  efashionListByReferenceBaseExact: efashionListByRefBaseMock,
  efashionListProduitStocks: efashionListProduitStocksMock,
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionRemoveProduitStock: efashionRemoveProduitStockMock,
}));

import { cleanupOrphanEfashionStocks } from "@/lib/efashion-orphan-stocks";

const PRODUCT_ID = "cms3rdg2903yd112ghvo5pjxw";
const REF_BASE = "10319";

beforeEach(() => {
  productFindFirstMock.mockReset();
  productColorFindManyMock.mockReset();
  efashionListByRefBaseMock.mockReset();
  efashionListProduitStocksMock.mockReset();
  efashionRemoveProduitStockMock.mockClear();
  efashionRemoveProduitStockMock.mockResolvedValue(true);
});

describe("cleanupOrphanEfashionStocks", () => {
  it("retourne un résultat vide si le produit n'est pas lié à eFashion", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: null });

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, true);

    expect(res.plans).toEqual([]);
    expect(res.deletedCount).toBe(0);
    expect(efashionGetMeMock).not.toHaveBeenCalled();
    expect(efashionRemoveProduitStockMock).not.toHaveBeenCalled();
  });

  it("retourne un résultat vide si aucune ProductColor UNIT n'est liée à eFashion", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: REF_BASE });
    productColorFindManyMock.mockResolvedValue([]);

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, true);

    expect(res.plans).toEqual([]);
    expect(efashionGetMeMock).not.toHaveBeenCalled();
  });

  it("détecte une ligne stock orpheline mais ne la supprime pas en dry-run (apply=false)", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: REF_BASE });
    productColorFindManyMock.mockResolvedValue([
      { efashionProductId: 3696140, color: { name: "Brun foncé" } },
    ]);
    efashionListByRefBaseMock.mockResolvedValue([
      { id_produit: 3696140, id_couleur: 19 },
    ]);
    efashionListProduitStocksMock.mockResolvedValue([
      { id_produit_stock: 1806542, id_produit: 3696140, id_couleur: 1653, value: 292, taille: "Taille unique" },
      { id_produit_stock: 1865330, id_produit: 3696140, id_couleur: 19, value: 270, taille: "Taille unique" },
    ]);

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, false);

    expect(res.plans).toHaveLength(1);
    expect(res.plans[0].colorName).toBe("Brun foncé");
    expect(res.plans[0].efActualColorId).toBe(19);
    expect(res.plans[0].orphanLines).toHaveLength(1);
    expect(res.plans[0].orphanLines[0].id_produit_stock).toBe(1806542);
    expect(res.deletedCount).toBe(0);
    expect(efashionRemoveProduitStockMock).not.toHaveBeenCalled();
  });

  it("supprime la ligne orpheline en mode apply=true et conserve la bonne", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: REF_BASE });
    productColorFindManyMock.mockResolvedValue([
      { efashionProductId: 3696140, color: { name: "Brun foncé" } },
      { efashionProductId: 3696148, color: { name: "Jaune Clair" } },
    ]);
    efashionListByRefBaseMock.mockResolvedValue([
      { id_produit: 3696140, id_couleur: 19 },
      { id_produit: 3696148, id_couleur: 12 },
    ]);
    efashionListProduitStocksMock.mockImplementation(async (efProductId: number) => {
      if (efProductId === 3696140) {
        return [
          { id_produit_stock: 1806542, id_produit: 3696140, id_couleur: 1653, value: 292, taille: "Taille unique" },
          { id_produit_stock: 1865330, id_produit: 3696140, id_couleur: 19, value: 270, taille: "Taille unique" },
        ];
      }
      if (efProductId === 3696148) {
        return [
          { id_produit_stock: 1806544, id_produit: 3696148, id_couleur: 1298, value: 300, taille: "Taille unique" },
          { id_produit_stock: 1865331, id_produit: 3696148, id_couleur: 12, value: 298, taille: "Taille unique" },
        ];
      }
      return [];
    });

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, true);

    expect(res.plans).toHaveLength(2);
    expect(res.deletedCount).toBe(2);
    expect(res.failedCount).toBe(0);
    expect(efashionRemoveProduitStockMock).toHaveBeenCalledTimes(2);
    expect(efashionRemoveProduitStockMock).toHaveBeenCalledWith(1806542);
    expect(efashionRemoveProduitStockMock).toHaveBeenCalledWith(1806544);
    expect(efashionRemoveProduitStockMock).not.toHaveBeenCalledWith(1865330);
    expect(efashionRemoveProduitStockMock).not.toHaveBeenCalledWith(1865331);
  });

  it("ne supprime rien si toutes les lignes stock ont le bon id_couleur", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: REF_BASE });
    productColorFindManyMock.mockResolvedValue([
      { efashionProductId: 3696142, color: { name: "Noir" } },
    ]);
    efashionListByRefBaseMock.mockResolvedValue([
      { id_produit: 3696142, id_couleur: 5 },
    ]);
    efashionListProduitStocksMock.mockResolvedValue([
      { id_produit_stock: 1806539, id_produit: 3696142, id_couleur: 5, value: 264, taille: "Taille unique" },
    ]);

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, true);

    expect(res.plans).toEqual([]);
    expect(res.deletedCount).toBe(0);
    expect(efashionRemoveProduitStockMock).not.toHaveBeenCalled();
  });

  it("comptabilise les échecs sans stopper le nettoyage des autres lignes (best-effort)", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: REF_BASE });
    productColorFindManyMock.mockResolvedValue([
      { efashionProductId: 3696140, color: { name: "Brun foncé" } },
      { efashionProductId: 3696148, color: { name: "Jaune Clair" } },
    ]);
    efashionListByRefBaseMock.mockResolvedValue([
      { id_produit: 3696140, id_couleur: 19 },
      { id_produit: 3696148, id_couleur: 12 },
    ]);
    efashionListProduitStocksMock.mockImplementation(async (efProductId: number) => {
      if (efProductId === 3696140) {
        return [
          { id_produit_stock: 1806542, id_produit: 3696140, id_couleur: 1653, value: 292, taille: "Taille unique" },
        ];
      }
      return [
        { id_produit_stock: 1806544, id_produit: 3696148, id_couleur: 1298, value: 300, taille: "Taille unique" },
      ];
    });
    efashionRemoveProduitStockMock.mockImplementation(async (id: number) => {
      if (id === 1806542) throw new Error("network KO");
      return true;
    });

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, true);

    expect(res.plans).toHaveLength(2);
    expect(res.deletedCount).toBe(1);
    expect(res.failedCount).toBe(1);
    expect(efashionRemoveProduitStockMock).toHaveBeenCalledTimes(2);
  });

  it("saute silencieusement une ProductColor dont l'efProductId n'existe plus côté eFashion", async () => {
    productFindFirstMock.mockResolvedValue({ id: PRODUCT_ID, efashionReferenceBase: REF_BASE });
    productColorFindManyMock.mockResolvedValue([
      { efashionProductId: 9999999, color: { name: "Ancienne" } },
      { efashionProductId: 3696142, color: { name: "Noir" } },
    ]);
    efashionListByRefBaseMock.mockResolvedValue([
      { id_produit: 3696142, id_couleur: 5 },
    ]);
    efashionListProduitStocksMock.mockResolvedValue([
      { id_produit_stock: 1806539, id_produit: 3696142, id_couleur: 5, value: 264, taille: "Taille unique" },
    ]);

    const res = await cleanupOrphanEfashionStocks(PRODUCT_ID, true);

    expect(res.plans).toEqual([]);
    expect(res.deletedCount).toBe(0);
    // efashionListProduitStocks ne doit être appelé que pour l'efProductId valide (3696142)
    expect(efashionListProduitStocksMock).toHaveBeenCalledTimes(1);
    expect(efashionListProduitStocksMock).toHaveBeenCalledWith(3696142);
  });
});
