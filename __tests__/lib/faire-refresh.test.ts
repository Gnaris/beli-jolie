/**
 * Refresh Faire : la nouvelle fiche doit être créée dans le bon lifecycle.
 *
 * Régression 2026-06-27 : le refresh hardcodait `lifecycleState: "DRAFT"`,
 * ce qui faisait basculer silencieusement les produits ONLINE en brouillon
 * côté Faire après chaque refresh (invisibles aux acheteurs). On vérifie ici
 * que le lifecycle suit le statut du produit (ONLINE → PUBLISHED, autre →
 * DRAFT en défense).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const prismaMock: any = {
  product: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const faireFetchMock = vi.fn();
vi.mock("@/lib/faire-api", () => ({ faireFetch: faireFetchMock }));

const fairePublishProductMock = vi.fn();
vi.mock("@/lib/faire-publish", () => ({
  fairePublishProduct: fairePublishProductMock,
}));

const faireHardDeleteProductMock = vi.fn();
vi.mock("@/lib/faire-delete", () => ({
  faireHardDeleteProduct: faireHardDeleteProductMock,
}));

const { faireRefreshProduct } = await import("@/lib/faire-refresh");

beforeEach(() => {
  prismaMock.product.findUnique.mockReset();
  prismaMock.product.update.mockReset();
  prismaMock.product.update.mockResolvedValue({});
  faireFetchMock.mockReset();
  faireFetchMock.mockResolvedValue({ ok: true, status: 200 });
  fairePublishProductMock.mockReset();
  faireHardDeleteProductMock.mockReset();
  faireHardDeleteProductMock.mockResolvedValue({ success: true });
});

function metaOnline(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p-1",
    name: "Bracelet doré",
    reference: "REF-1",
    status: "ONLINE",
    faireProductId: "p_OLD",
    colors: [{ id: "v-1", faireVariantId: "po_OLD" }],
    ...overrides,
  };
}

describe("faireRefreshProduct — lifecycle de la nouvelle fiche", () => {
  it("refuse si le produit n'existe pas", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(null);
    const res = await faireRefreshProduct("missing");
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/introuvable/i);
    expect(fairePublishProductMock).not.toHaveBeenCalled();
  });

  it("refuse si le produit n'a pas de faireProductId (utiliser publish)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(
      metaOnline({ faireProductId: null }),
    );
    const res = await faireRefreshProduct("p-1");
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/publish/i);
    expect(fairePublishProductMock).not.toHaveBeenCalled();
  });

  it("ONLINE → republie en PUBLISHED (régression : ne pas laisser en DRAFT)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(metaOnline());
    fairePublishProductMock.mockResolvedValueOnce({
      success: true,
      faireProductId: "p_NEW",
      variantMap: [],
    });
    const res = await faireRefreshProduct("p-1");
    expect(res.success).toBe(true);
    expect(fairePublishProductMock).toHaveBeenCalledWith("p-1", {
      lifecycleState: "PUBLISHED",
    });
    expect(faireHardDeleteProductMock).toHaveBeenCalledWith("p_OLD");
  });

  it("statut imprévu (défense en profondeur) → retombe sur DRAFT pour ne pas publier par accident", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(
      metaOnline({ status: "SYNCING" }),
    );
    fairePublishProductMock.mockResolvedValueOnce({
      success: true,
      faireProductId: "p_NEW",
      variantMap: [],
    });
    await faireRefreshProduct("p-1");
    expect(fairePublishProductMock).toHaveBeenCalledWith("p-1", {
      lifecycleState: "DRAFT",
    });
  });

  it("rollback nom + faireProductId si la republication échoue", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(metaOnline());
    fairePublishProductMock.mockResolvedValueOnce({
      success: false,
      error: "Faire a refusé la création (HTTP 400) : champ invalide",
    });

    const res = await faireRefreshProduct("p-1");
    expect(res.success).toBe(false);

    // Premier update : on met le tempName + faireProductId=null.
    // Deuxième update : rollback → name original + faireProductId original.
    expect(prismaMock.product.update).toHaveBeenCalledTimes(2);
    const rollbackCall = prismaMock.product.update.mock.calls[1][0];
    expect(rollbackCall.data.name).toBe("Bracelet doré");
    expect(rollbackCall.data.faireProductId).toBe("p_OLD");
    // L'ancien produit ne doit PAS être supprimé chez Faire en cas d'échec.
    expect(faireHardDeleteProductMock).not.toHaveBeenCalled();
  });
});
