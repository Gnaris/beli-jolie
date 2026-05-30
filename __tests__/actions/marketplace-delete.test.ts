import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  pfsDeleteProductSpy,
  ankorstoreKickoffStandaloneDeleteSpy,
  efashionDeleteShootingProductSpy,
  productFindManySpy,
  ankorstoreEnabledSpy,
  efashionEnabledSpy,
} = vi.hoisted(() => ({
  pfsDeleteProductSpy: vi.fn(),
  ankorstoreKickoffStandaloneDeleteSpy: vi.fn(),
  efashionDeleteShootingProductSpy: vi.fn(),
  productFindManySpy: vi.fn(),
  ankorstoreEnabledSpy: vi.fn(),
  efashionEnabledSpy: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/pfs-api-write", () => ({ pfsDeleteProduct: pfsDeleteProductSpy }));
vi.mock("@/lib/ankorstore-delete", () => ({
  ankorstoreKickoffStandaloneDelete: ankorstoreKickoffStandaloneDeleteSpy,
}));
vi.mock("@/lib/efashion-shootings", () => ({
  efashionDeleteShootingProduct: efashionDeleteShootingProductSpy,
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedAnkorstoreEnabled: ankorstoreEnabledSpy,
  getCachedEfashionEnabled: efashionEnabledSpy,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: productFindManySpy,
    },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  deleteProductsOnPfs,
  deleteProductsOnAnkorstore,
  deleteProductsOnEfashion,
} from "@/app/actions/admin/marketplace-delete";

beforeEach(() => {
  vi.clearAllMocks();
  // Par défaut : marketplaces activées (les tests existants comptent là-dessus).
  ankorstoreEnabledSpy.mockResolvedValue(true);
  efashionEnabledSpy.mockResolvedValue(true);
});

describe("deleteProductsOnPfs", () => {
  it("returns ok for each successful deletion", async () => {
    pfsDeleteProductSpy.mockResolvedValue(undefined);

    const results = await deleteProductsOnPfs([
      { pfsProductId: "pfs-1", reference: "REF-1" },
      { pfsProductId: "pfs-2", reference: "REF-2" },
    ]);

    expect(pfsDeleteProductSpy).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { pfsProductId: "pfs-1", reference: "REF-1", status: "ok" },
      { pfsProductId: "pfs-2", reference: "REF-2", status: "ok" },
    ]);
  });

  it("captures errors per-item without throwing the whole batch", async () => {
    pfsDeleteProductSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("PFS down"));

    const results = await deleteProductsOnPfs([
      { pfsProductId: "pfs-1", reference: "REF-1" },
      { pfsProductId: "pfs-2", reference: "REF-2" },
    ]);

    expect(results).toEqual([
      { pfsProductId: "pfs-1", reference: "REF-1", status: "ok" },
      {
        pfsProductId: "pfs-2",
        reference: "REF-2",
        status: "error",
        message: "PFS down",
      },
    ]);
  });

  it("returns an empty array when no items are passed", async () => {
    const results = await deleteProductsOnPfs([]);
    expect(results).toEqual([]);
    expect(pfsDeleteProductSpy).not.toHaveBeenCalled();
  });
});

describe("deleteProductsOnAnkorstore (callback-only)", () => {
  it("kickoff async réussi → status ok avec operationId", async () => {
    productFindManySpy.mockResolvedValue([
      { id: "p-1", ankorsProductId: "ank-1" },
      { id: "p-2", ankorsProductId: "ank-2" },
    ]);
    ankorstoreKickoffStandaloneDeleteSpy
      .mockResolvedValueOnce({ success: true, operationId: "op-1" })
      .mockResolvedValueOnce({ success: true, operationId: "op-2" });

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
      { ankorsProductId: "ank-2", reference: "REF-2" },
    ]);

    expect(ankorstoreKickoffStandaloneDeleteSpy).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { ankorsProductId: "ank-1", reference: "REF-1", status: "ok", operationId: "op-1" },
      { ankorsProductId: "ank-2", reference: "REF-2", status: "ok", operationId: "op-2" },
    ]);
  });

  it("captures errors per-item without throwing the whole batch", async () => {
    productFindManySpy.mockResolvedValue([
      { id: "p-1", ankorsProductId: "ank-1" },
      { id: "p-2", ankorsProductId: "ank-2" },
    ]);
    ankorstoreKickoffStandaloneDeleteSpy
      .mockResolvedValueOnce({ success: false, error: "Ankorstore 500" })
      .mockResolvedValueOnce({ success: true, operationId: "op-2" });

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
      { ankorsProductId: "ank-2", reference: "REF-2" },
    ]);

    expect(results).toEqual([
      {
        ankorsProductId: "ank-1",
        reference: "REF-1",
        status: "error",
        message: "Ankorstore 500",
      },
      { ankorsProductId: "ank-2", reference: "REF-2", status: "ok", operationId: "op-2" },
    ]);
  });

  it("ankorsProductId orphelin (pas de produit local) → status error", async () => {
    productFindManySpy.mockResolvedValue([]); // pas de produit local trouvé

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
    ]);

    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/orphelin/);
    expect(ankorstoreKickoffStandaloneDeleteSpy).not.toHaveBeenCalled();
  });

  it("returns an empty array when no items are passed", async () => {
    const results = await deleteProductsOnAnkorstore([]);
    expect(results).toEqual([]);
    expect(ankorstoreKickoffStandaloneDeleteSpy).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  it("throws when user is not admin", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { role: "CLIENT" },
    });
    await expect(
      deleteProductsOnAnkorstore([
        { ankorsProductId: "ank-1", reference: "REF-1" },
      ]),
    ).rejects.toThrow("Accès non autorisé");
    expect(ankorstoreKickoffStandaloneDeleteSpy).not.toHaveBeenCalled();
  });
});

// ─── AUDIT [6] : kill switch — pause = aucune suppression envoyée ──
describe("deleteProductsOnAnkorstore — kill switch", () => {
  it("Ankorstore désactivé : aucune suppression envoyée + status error explicite", async () => {
    ankorstoreEnabledSpy.mockResolvedValue(false);

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
      { ankorsProductId: "ank-2", reference: "REF-2" },
    ]);

    // Aucun appel à Ankorstore ni à Prisma
    expect(ankorstoreKickoffStandaloneDeleteSpy).not.toHaveBeenCalled();
    expect(productFindManySpy).not.toHaveBeenCalled();

    // Chaque item en error avec un message qui mentionne "désactivé"
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe("error");
      expect(r.message).toMatch(/désactivé/i);
    }
  });

  it("Ankorstore activé : comportement normal", async () => {
    ankorstoreEnabledSpy.mockResolvedValue(true);
    productFindManySpy.mockResolvedValue([
      { id: "p-1", ankorsProductId: "ank-1" },
    ]);
    ankorstoreKickoffStandaloneDeleteSpy.mockResolvedValueOnce({
      success: true,
      operationId: "op-1",
    });

    const results = await deleteProductsOnAnkorstore([
      { ankorsProductId: "ank-1", reference: "REF-1" },
    ]);

    expect(ankorstoreKickoffStandaloneDeleteSpy).toHaveBeenCalledOnce();
    expect(results[0].status).toBe("ok");
  });
});

describe("deleteProductsOnEfashion — kill switch", () => {
  it("eFashion désactivé : aucune suppression envoyée", async () => {
    efashionEnabledSpy.mockResolvedValue(false);

    const results = await deleteProductsOnEfashion([
      { efashionProductId: 100, reference: "REF-1" },
      { efashionProductId: 101, reference: "REF-2" },
    ]);

    expect(efashionDeleteShootingProductSpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe("error");
      expect(r.message).toMatch(/désactivé/i);
    }
  });

  it("eFashion activé : comportement normal", async () => {
    efashionEnabledSpy.mockResolvedValue(true);
    efashionDeleteShootingProductSpy.mockResolvedValue(undefined);

    const results = await deleteProductsOnEfashion([
      { efashionProductId: 100, reference: "REF-1" },
    ]);

    expect(efashionDeleteShootingProductSpy).toHaveBeenCalledOnce();
    expect(results[0].status).toBe("ok");
  });
});
