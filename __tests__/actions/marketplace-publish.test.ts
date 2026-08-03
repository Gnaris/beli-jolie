import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  mockProductUpdate,
  mockProductColorUpdateMany,
  pfsUpdateInPlaceSpy,
  pfsPublishSpy,
  getCachedPfsEnabledSpy,
  getCachedAnkorstoreEnabledSpy,
  getCachedFaireEnabledSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockProductColorUpdateMany: vi.fn(),
  pfsUpdateInPlaceSpy: vi.fn(),
  pfsPublishSpy: vi.fn(),
  getCachedPfsEnabledSpy: vi.fn().mockResolvedValue(true),
  getCachedAnkorstoreEnabledSpy: vi.fn().mockResolvedValue(true),
  getCachedFaireEnabledSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    productColor: {
      updateMany: (...a: unknown[]) => mockProductColorUpdateMany(...a),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/pfs-update", () => ({
  pfsUpdateProductInPlace: pfsUpdateInPlaceSpy,
}));
vi.mock("@/lib/pfs-publish", () => ({
  pfsPublishProduct: pfsPublishSpy,
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsEnabled: getCachedPfsEnabledSpy,
  getCachedAnkorstoreEnabled: getCachedAnkorstoreEnabledSpy,
  getCachedFaireEnabled: getCachedFaireEnabledSpy,
}));
vi.mock("@/lib/marketplace-enabled", () => ({
  filterOptionsByEnabled: (opts: Record<string, unknown>) => ({ filtered: opts, skipped: [] }),
  getProductMarketplaceEnabled: vi.fn().mockResolvedValue({
    pfs: true,
    ankorstore: true,
    efashion: true,
    faire: true,
  }),
  marketplaceDisabledMessage: (mp: string) => `${mp} désactivé`,
}));

vi.mock("@/lib/platform-config", () => ({
  getMarketplaceMaintenance: vi.fn().mockResolvedValue({
    pfs: false,
    ankorstore: false,
    efashion: false,
    faire: false,
  }),
  marketplaceMaintenanceMessage: (mp: string) => `${mp} en maintenance`,
}));

vi.mock("@/lib/product-publishability-check", () => ({
  // Les tests existants valident le dispatch après validation. La garde de
  // complétude est testée séparément dans marketplace-publish-completeness.test.ts.
  checkProductComplete: vi.fn().mockResolvedValue({ eligible: true, reasons: [], message: "" }),
}));

vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { publishProductToMarketplaces } from "@/app/actions/admin/marketplace-publish";

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPfsEnabledSpy.mockResolvedValue(true);
  getCachedAnkorstoreEnabledSpy.mockResolvedValue(true);
  getCachedFaireEnabledSpy.mockResolvedValue(true);
});

describe("publishProductToMarketplaces", () => {
  it("appelle pfsPublishProduct (create) si pfsProductId est null", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: null,
    });
    pfsPublishSpy.mockResolvedValue({
      success: true,
      pfsProductId: "new_pfs",
      archived: false,
    });

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(pfsPublishSpy).toHaveBeenCalledOnce();
    expect(pfsUpdateInPlaceSpy).not.toHaveBeenCalled();
    expect(out.pfs).toEqual({ status: "ok", mode: "create", archived: false });
  });

  it("appelle pfsUpdateProductInPlace (update) si pfsProductId est déjà connu", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "ONLINE",
      pfsProductId: "existing_pfs",
    });
    pfsUpdateInPlaceSpy.mockResolvedValue({
      success: true,
      archived: false,
    });

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(pfsUpdateInPlaceSpy).toHaveBeenCalledOnce();
    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(out.pfs).toEqual({ status: "ok", mode: "update", archived: false });
  });

  it("NE recrée PAS le produit si l'update PFS échoue (garde-fou anti-doublon)", async () => {
    // Régression A264 (03/08/2026) : un update aborted → fallback catastrophique
    // qui reset pfsProductId + retente un create → PFS refuse « Référence non
    // valide » → lien perdu en base, fiche encore présente côté PFS. Depuis, on
    // ne recrée JAMAIS après un update échoué, quel que soit le motif.
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: "existing_pfs",
    });
    pfsUpdateInPlaceSpy.mockResolvedValue({
      success: false,
      error: "This operation was aborted",
    });

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(pfsUpdateInPlaceSpy).toHaveBeenCalledOnce();
    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockProductColorUpdateMany).not.toHaveBeenCalled();
    expect(out.pfs?.status).toBe("error");
    if (out.pfs?.status === "error") {
      expect(out.pfs.message).toContain("This operation was aborted");
      expect(out.pfs.message).toContain("Aucun produit n'a été recréé");
    }
  });

  it("renvoie status error si la fonction sous-jacente échoue", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: null,
    });
    pfsPublishSpy.mockResolvedValue({
      success: false,
      error: "API PFS injoignable",
    });

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(out.pfs).toEqual({ status: "error", message: "API PFS injoignable" });
  });

  it("kill switch PFS OFF (Paramètres) : n'appelle NI publish NI update, remonte error 'désactivée'", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: null,
    });
    getCachedPfsEnabledSpy.mockResolvedValue(false);

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(pfsUpdateInPlaceSpy).not.toHaveBeenCalled();
    expect(out.pfs).toEqual({
      status: "error",
      message: "Sync Paris Fashion Shop désactivée dans Paramètres.",
    });
  });
});
