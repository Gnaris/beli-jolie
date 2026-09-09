/**
 * `pullRemoveLocalVariant` — comportement quand la variante a des commandes
 * historiques.
 *
 * Règle métier (2026-09-09) : si la couleur qu'on veut retirer chez nous a
 * déjà été commandée (Order / PfsOrder / EfashionOrder / AnkorstoreOrder),
 * on ne PEUT pas la supprimer sans casser la traçabilité comptable. On
 * bascule sur un fallback qui :
 *   - passe la variante à `disabled = true` (invisible côté client)
 *   - met `ProductColor.stock = 0`
 *   - met toutes les `VariantSize.quantity = 0`
 *   - met toutes les `PackColorLineSize.quantity = 0` si PACK
 *   - retire les CartItem qui la référencent
 *   - ne touche PAS aux autres variantes du même produit
 * Le résultat est `ok: true` (ce n'est pas une erreur), avec un message qui
 * précise le mode appliqué pour la modale d'audit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    variantSize: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    packColorLine: { findMany: vi.fn().mockResolvedValue([]) },
    packColorLineSize: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    productColor: {
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    product: { update: vi.fn().mockResolvedValue({}) },
  };
  return {
    txMock: tx,
    prismaMock: {
      product: { findUnique: vi.fn() },
      orderItem: { count: vi.fn() },
      pfsOrderItem: { count: vi.fn() },
      efashionOrderItem: { count: vi.fn() },
      ankorstoreOrderItem: { count: vi.fn() },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/pfs-api", () => ({
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsCreateVariants: vi.fn(),
  pfsDeleteVariant: vi.fn(),
  pfsUploadImage: vi.fn(),
  pfsGetColors: vi.fn().mockResolvedValue([
    { reference: "BLACK", labels: { fr: "Noir" } },
    { reference: "BEIGE", labels: { fr: "Beige" } },
  ]),
}));
vi.mock("@/lib/marketplace-pricing", () => ({
  loadMarketplaceMarkupConfigs: vi.fn(),
  applyMarketplaceMarkup: vi.fn(),
}));
vi.mock("@/lib/pfs-verify", () => ({ detectPfsDuplicate: vi.fn() }));
vi.mock("@/lib/pfs-import", () => ({
  resolveVariant: vi.fn(),
  downloadAllVariantImagesToBuffers: vi.fn(),
}));
vi.mock("@/lib/pfs-import-price-markup", () => ({
  loadPfsImportPriceMarkup: vi.fn(),
  applyImportMarkupToUnitPrice: vi.fn(),
}));
vi.mock("@/lib/image-processor", () => ({ processProductImage: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  productImageDir: vi.fn(),
  productImageBaseName: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi.fn().mockResolvedValue({ id: "t1", slug: "issyma" }),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));

import { pullRemoveLocalVariant } from "@/lib/pfs-verify-variant-ops";

const productBase = {
  id: "prod-1",
  reference: "15219",
  ankorsProductId: null,
  efashionReferenceBase: null,
  faireProductId: null,
  colors: [
    {
      id: "pc-noir",
      saleType: "UNIT",
      colorId: "c-noir",
      color: { name: "Noir", pfsColorRef: "BLACK" },
      pfsColorRefOverride: null,
    },
    {
      id: "pc-beige",
      saleType: "UNIT",
      colorId: "c-beige",
      color: { name: "Beige", pfsColorRef: "BEIGE" },
      pfsColorRefOverride: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.product.findUnique.mockResolvedValue(productBase);
  prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock));
});

describe("pullRemoveLocalVariant — sans commande historique", () => {
  it("supprime purement la ProductColor (comportement historique)", async () => {
    prismaMock.orderItem.count.mockResolvedValue(0);
    prismaMock.pfsOrderItem.count.mockResolvedValue(0);
    prismaMock.efashionOrderItem.count.mockResolvedValue(0);
    prismaMock.ankorstoreOrderItem.count.mockResolvedValue(0);

    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    expect(txMock.productColor.delete).toHaveBeenCalledWith({ where: { id: "pc-noir" } });
    expect(txMock.productColor.update).not.toHaveBeenCalled();
    expect(txMock.variantSize.updateMany).not.toHaveBeenCalled();
    expect(txMock.cartItem.deleteMany).toHaveBeenCalledWith({ where: { variantId: "pc-noir" } });
  });
});

describe("pullRemoveLocalVariant — avec commandes historiques", () => {
  it("désactive la variante et met stock + tailles à 0 (fallback)", async () => {
    prismaMock.orderItem.count.mockResolvedValue(0);
    prismaMock.pfsOrderItem.count.mockResolvedValue(0);
    prismaMock.efashionOrderItem.count.mockResolvedValue(2);
    prismaMock.ankorstoreOrderItem.count.mockResolvedValue(0);
    txMock.packColorLine.findMany.mockResolvedValue([]);

    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).toMatch(/désactivée/i);
    expect(txMock.productColor.delete).not.toHaveBeenCalled();
    expect(txMock.productColor.update).toHaveBeenCalledWith({
      where: { id: "pc-noir" },
      data: { disabled: true, stock: 0 },
    });
    expect(txMock.variantSize.updateMany).toHaveBeenCalledWith({
      where: { productColorId: "pc-noir" },
      data: { quantity: 0 },
    });
    expect(txMock.cartItem.deleteMany).toHaveBeenCalledWith({ where: { variantId: "pc-noir" } });
    // Aucune autre variante ne doit être touchée : les mocks ci-dessus ne
    // reçoivent que "pc-noir" et jamais "pc-beige".
    for (const call of txMock.productColor.update.mock.calls) {
      expect(call[0].where.id).toBe("pc-noir");
    }
  });

  it("met aussi PackColorLineSize à 0 pour un PACK multi-couleurs", async () => {
    prismaMock.orderItem.count.mockResolvedValue(1);
    prismaMock.pfsOrderItem.count.mockResolvedValue(0);
    prismaMock.efashionOrderItem.count.mockResolvedValue(0);
    prismaMock.ankorstoreOrderItem.count.mockResolvedValue(0);
    txMock.packColorLine.findMany.mockResolvedValue([{ id: "pl-1" }, { id: "pl-2" }]);

    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    expect(txMock.packColorLineSize.updateMany).toHaveBeenCalledWith({
      where: { packColorLineId: { in: ["pl-1", "pl-2"] } },
      data: { quantity: 0 },
    });
  });

  it("compte le total quand plusieurs marketplaces référencent la variante", async () => {
    prismaMock.orderItem.count.mockResolvedValue(1);
    prismaMock.pfsOrderItem.count.mockResolvedValue(2);
    prismaMock.efashionOrderItem.count.mockResolvedValue(3);
    prismaMock.ankorstoreOrderItem.count.mockResolvedValue(0);

    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).toMatch(/6 commandes historiques/);
  });
});
