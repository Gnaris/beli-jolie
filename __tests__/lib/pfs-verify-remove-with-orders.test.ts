/**
 * `pullRemoveLocalVariant` — suppression locale d'une variante.
 *
 * Règle métier (2026-09-10, révisée) : la cliente veut supprimer la variante
 * côté BJ dans TOUS les cas, y compris quand la couleur a déjà des commandes
 * historiques (Order / PfsOrder / EfashionOrder / AnkorstoreOrder /
 * FaireOrder / OrderchampOrder / MicrostoreOrder). Les commandes conservent
 * leurs snapshots texte (colorLabelFr, productSnapshotName, variantSnapshot)
 * et `ProductColor.productColorId` passe automatiquement à NULL grâce au
 * `onDelete: SetNull` déclaré sur chaque table `*OrderItem`.
 *
 * La désactivation + stock 0 doit rester la responsabilité de chaque
 * marketplace côté distant (via son propre worker de sync) quand sa
 * plateforme refuse la suppression d'une variante commandée — ce n'est plus
 * la responsabilité de la BDD BJ locale.
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

describe("pullRemoveLocalVariant — suppression pure", () => {
  it("supprime la ProductColor et purge le panier (aucune commande historique)", async () => {
    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    expect(txMock.productColor.delete).toHaveBeenCalledWith({ where: { id: "pc-noir" } });
    expect(txMock.productColor.update).not.toHaveBeenCalled();
    expect(txMock.variantSize.updateMany).not.toHaveBeenCalled();
    expect(txMock.cartItem.deleteMany).toHaveBeenCalledWith({ where: { variantId: "pc-noir" } });
  });

  it("supprime AUSSI quand la variante a des commandes historiques (règle 2026-09-10)", async () => {
    // Peu importe l'existence de commandes historiques : la fonction n'appelle
    // plus `orderItem.count` et supprime toujours. Les snapshots texte sur
    // *OrderItem (colorLabelFr, productSnapshotName…) suffisent à préserver
    // l'historique côté facturation / commandes.
    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).toMatch(/retirée/i);
    expect(txMock.productColor.delete).toHaveBeenCalledWith({ where: { id: "pc-noir" } });
    // Pas de fallback "disabled + stock 0" : la variante disparaît vraiment.
    expect(txMock.productColor.update).not.toHaveBeenCalled();
    expect(txMock.variantSize.updateMany).not.toHaveBeenCalled();
    expect(txMock.packColorLineSize.updateMany).not.toHaveBeenCalled();
  });

  it("marque `*SyncRequired` pour les marketplaces liées afin de propager la suppression", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      ...productBase,
      ankorsProductId: "ankor-42",
      efashionReferenceBase: "REF42",
      faireProductId: "faire-42",
    });

    const res = await pullRemoveLocalVariant("prod-1", "BLACK", "UNIT");

    expect(res.ok).toBe(true);
    expect(txMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ankorsSyncRequired: true,
          efashionSyncRequired: true,
          faireSyncRequired: true,
          pfsSyncRequired: false,
        }),
      }),
    );
  });
});
