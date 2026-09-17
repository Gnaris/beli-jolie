import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  pfsDeleteProductSpy,
  ankorstoreKickoffStandaloneDeleteSpy,
  efashionDeleteShootingProductSpy,
  faireHardDeleteProductSpy,
  productFindManySpy,
  productUpdateManySpy,
  ankorstoreEnabledSpy,
  efashionEnabledSpy,
  faireEnabledSpy,
} = vi.hoisted(() => ({
  pfsDeleteProductSpy: vi.fn(),
  ankorstoreKickoffStandaloneDeleteSpy: vi.fn(),
  efashionDeleteShootingProductSpy: vi.fn(),
  faireHardDeleteProductSpy: vi.fn(),
  productFindManySpy: vi.fn(),
  productUpdateManySpy: vi.fn(),
  ankorstoreEnabledSpy: vi.fn(),
  efashionEnabledSpy: vi.fn(),
  faireEnabledSpy: vi.fn(),
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
vi.mock("@/lib/faire-delete", () => ({
  faireHardDeleteProduct: faireHardDeleteProductSpy,
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedAnkorstoreEnabled: ankorstoreEnabledSpy,
  getCachedEfashionEnabled: efashionEnabledSpy,
  getCachedFaireEnabled: faireEnabledSpy,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: productFindManySpy,
      updateMany: productUpdateManySpy,
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
  deleteProductsOnFaire,
} from "@/app/actions/admin/marketplace-delete";

beforeEach(() => {
  vi.clearAllMocks();
  // Par défaut : marketplaces activées (les tests existants comptent là-dessus).
  ankorstoreEnabledSpy.mockResolvedValue(true);
  efashionEnabledSpy.mockResolvedValue(true);
  faireEnabledSpy.mockResolvedValue(true);
  // updateMany retourne un compteur — par défaut, ne fait rien.
  productUpdateManySpy.mockResolvedValue({ count: 1 });
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

describe("deleteProductsOnEfashion", () => {
  it("eFashion désactivé (kill switch) : aucune suppression envoyée", async () => {
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

  it("softDeleteProduits=true → status ok", async () => {
    efashionEnabledSpy.mockResolvedValue(true);
    efashionDeleteShootingProductSpy.mockResolvedValue({ success: true });

    const results = await deleteProductsOnEfashion([
      { efashionProductId: 100, reference: "REF-1" },
    ]);

    expect(efashionDeleteShootingProductSpy).toHaveBeenCalledOnce();
    expect(efashionDeleteShootingProductSpy).toHaveBeenCalledWith(100);
    expect(results[0].status).toBe("ok");
  });

  // Anti-régression PC6 (2026-09-17) : eFashion peut répondre HTTP 200 avec
  // `success:false` (produit encore lié à un shooting, ID périmé, etc.).
  // L'ancien code faisait juste `await` sans lire ce booléen et marquait la
  // suppression comme réussie — la fiche restait en ligne côté eFashion sans
  // aucune alerte à la cliente. Maintenant on doit remonter l'erreur pour
  // que la modale affiche le toast rouge "Suppression eFashion partielle".
  it("softDeleteProduits=false → status error avec le message reçu", async () => {
    efashionEnabledSpy.mockResolvedValue(true);
    efashionDeleteShootingProductSpy.mockResolvedValue({
      success: false,
      message: "eFashion a refusé la suppression (softDeleteProduits=false).",
    });

    const results = await deleteProductsOnEfashion([
      { efashionProductId: 100, reference: "REF-1" },
    ]);

    expect(results[0]).toEqual({
      efashionProductId: 100,
      reference: "REF-1",
      status: "error",
      message: "eFashion a refusé la suppression (softDeleteProduits=false).",
    });
  });

  it("throw réseau → status error, batch continue", async () => {
    efashionEnabledSpy.mockResolvedValue(true);
    efashionDeleteShootingProductSpy
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ success: true });

    const results = await deleteProductsOnEfashion([
      { efashionProductId: 100, reference: "REF-1" },
      { efashionProductId: 101, reference: "REF-2" },
    ]);

    expect(results).toEqual([
      { efashionProductId: 100, reference: "REF-1", status: "error", message: "network down" },
      { efashionProductId: 101, reference: "REF-2", status: "ok" },
    ]);
  });
});

describe("deleteProductsOnFaire", () => {
  it("DELETE Faire OK → status ok pour chaque item + cleanup mappings locaux", async () => {
    faireHardDeleteProductSpy
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    const results = await deleteProductsOnFaire([
      { faireProductId: "p_one", reference: "REF-1" },
      { faireProductId: "p_two", reference: "REF-2" },
    ]);

    expect(faireHardDeleteProductSpy).toHaveBeenCalledTimes(2);
    expect(faireHardDeleteProductSpy).toHaveBeenNthCalledWith(1, "p_one");
    expect(faireHardDeleteProductSpy).toHaveBeenNthCalledWith(2, "p_two");
    expect(productUpdateManySpy).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("Faire renvoie 404 → status ok avec alreadyGone:true (idempotent)", async () => {
    faireHardDeleteProductSpy.mockResolvedValue({ success: true, alreadyGone: true });

    const results = await deleteProductsOnFaire([
      { faireProductId: "p_gone", reference: "REF-GONE" },
    ]);

    expect(results[0].status).toBe("ok");
    expect(results[0].alreadyGone).toBe(true);
  });

  it("Faire renvoie une erreur API → status error avec message", async () => {
    faireHardDeleteProductSpy.mockResolvedValue({ success: false, error: "HTTP 500" });

    const results = await deleteProductsOnFaire([
      { faireProductId: "p_kaboom", reference: "REF-X" },
    ]);

    expect(results[0]).toEqual({
      faireProductId: "p_kaboom",
      reference: "REF-X",
      status: "error",
      message: "HTTP 500",
    });
    // Pas de cleanup quand l'API a refusé : on garde le mapping local pour
    // que l'admin puisse retenter.
    expect(productUpdateManySpy).not.toHaveBeenCalled();
  });

  it("Faire throw → status error capturé, batch continue", async () => {
    faireHardDeleteProductSpy
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ success: true });

    const results = await deleteProductsOnFaire([
      { faireProductId: "p_a", reference: "REF-A" },
      { faireProductId: "p_b", reference: "REF-B" },
    ]);

    expect(results).toEqual([
      { faireProductId: "p_a", reference: "REF-A", status: "error", message: "network down" },
      { faireProductId: "p_b", reference: "REF-B", status: "ok", alreadyGone: undefined },
    ]);
  });

  it("Faire désactivé (kill switch) : aucune suppression envoyée", async () => {
    faireEnabledSpy.mockResolvedValue(false);

    const results = await deleteProductsOnFaire([
      { faireProductId: "p_one", reference: "REF-1" },
      { faireProductId: "p_two", reference: "REF-2" },
    ]);

    expect(faireHardDeleteProductSpy).not.toHaveBeenCalled();
    expect(productUpdateManySpy).not.toHaveBeenCalled();
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe("error");
      expect(r.message).toMatch(/désactivé/i);
    }
  });

  it("liste vide → tableau vide, aucune API touchée", async () => {
    const results = await deleteProductsOnFaire([]);
    expect(results).toEqual([]);
    expect(faireHardDeleteProductSpy).not.toHaveBeenCalled();
  });

  it("rejette les non-admins", async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { role: "CLIENT" },
    });
    await expect(
      deleteProductsOnFaire([{ faireProductId: "p_one", reference: "REF-1" }]),
    ).rejects.toThrow("Accès non autorisé");
    expect(faireHardDeleteProductSpy).not.toHaveBeenCalled();
  });
});
