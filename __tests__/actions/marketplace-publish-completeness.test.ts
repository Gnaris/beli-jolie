import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  pfsUpdateInPlaceSpy,
  pfsPublishSpy,
  ankorstoreKickoffPublishSpy,
  ankorstoreKickoffUpdateSpy,
  fairePublishSpy,
  faireUpdateSpy,
  checkProductCompleteSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  pfsUpdateInPlaceSpy: vi.fn(),
  pfsPublishSpy: vi.fn(),
  ankorstoreKickoffPublishSpy: vi.fn(),
  ankorstoreKickoffUpdateSpy: vi.fn(),
  fairePublishSpy: vi.fn(),
  faireUpdateSpy: vi.fn(),
  checkProductCompleteSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: vi.fn(),
    },
    productColor: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/pfs-update", () => ({ pfsUpdateProductInPlace: pfsUpdateInPlaceSpy }));
vi.mock("@/lib/pfs-publish", () => ({ pfsPublishProduct: pfsPublishSpy }));
vi.mock("@/lib/ankorstore-publish", () => ({
  ankorstoreKickoffPublish: ankorstoreKickoffPublishSpy,
}));
vi.mock("@/lib/ankorstore-update", () => ({
  ankorstoreKickoffUpdate: ankorstoreKickoffUpdateSpy,
}));
vi.mock("@/lib/faire-publish", () => ({ fairePublishProduct: fairePublishSpy }));
vi.mock("@/lib/faire-update", () => ({ faireUpdateProduct: faireUpdateSpy }));

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsEnabled: vi.fn().mockResolvedValue(true),
  getCachedAnkorstoreEnabled: vi.fn().mockResolvedValue(true),
  getCachedFaireEnabled: vi.fn().mockResolvedValue(true),
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

vi.mock("@/lib/product-publishability-check", () => ({
  checkProductComplete: checkProductCompleteSpy,
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
  mockProductFindUnique.mockResolvedValue({
    id: "p-1",
    reference: "REF-1",
    name: "Produit test",
    status: "OFFLINE",
    pfsProductId: null,
    ankorsProductId: null,
    faireProductId: null,
  });
});

describe("Garde-fou complétude marketplace-publish", () => {
  it("bloque tous les marketplaces demandés si la fiche est incomplète (création)", async () => {
    checkProductCompleteSpy.mockResolvedValue({
      eligible: false,
      reasons: ["Composition manquante", "Description trop courte"],
      message:
        "Produit incomplet : Composition manquante · Description trop courte. Complétez la fiche avant de la pousser sur les marketplaces.",
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: true,
      ankorstore: true,
      faire: true,
    });

    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(pfsUpdateInPlaceSpy).not.toHaveBeenCalled();
    expect(ankorstoreKickoffPublishSpy).not.toHaveBeenCalled();
    expect(ankorstoreKickoffUpdateSpy).not.toHaveBeenCalled();
    expect(fairePublishSpy).not.toHaveBeenCalled();
    expect(faireUpdateSpy).not.toHaveBeenCalled();

    expect(out.pfs).toEqual({
      status: "error",
      message: expect.stringContaining("Produit incomplet"),
    });
    expect(out.ankorstore).toEqual({
      status: "error",
      message: expect.stringContaining("Produit incomplet"),
    });
    expect(out.faire).toEqual({
      status: "error",
      message: expect.stringContaining("Produit incomplet"),
    });
  });

  it("bloque aussi la MISE À JOUR d'un produit déjà lié si la fiche devient incomplète", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "Produit test",
      status: "ONLINE",
      pfsProductId: "existing_pfs",
      ankorsProductId: "existing_ankors",
      faireProductId: "existing_faire",
    });
    checkProductCompleteSpy.mockResolvedValue({
      eligible: false,
      reasons: ["Poids invalide sur variante"],
      message: "Produit incomplet : Poids invalide sur variante.",
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: true,
      ankorstore: true,
      faire: true,
    });

    expect(pfsUpdateInPlaceSpy).not.toHaveBeenCalled();
    expect(ankorstoreKickoffUpdateSpy).not.toHaveBeenCalled();
    expect(faireUpdateSpy).not.toHaveBeenCalled();

    expect(out.pfs).toMatchObject({ status: "error" });
    expect(out.ankorstore).toMatchObject({ status: "error" });
    expect(out.faire).toMatchObject({ status: "error" });
  });

  it("ne bloque que les marketplaces demandés (pas ceux non demandés)", async () => {
    checkProductCompleteSpy.mockResolvedValue({
      eligible: false,
      reasons: ["Catégorie manquante"],
      message: "Produit incomplet : Catégorie manquante.",
    });

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(out.pfs).toMatchObject({ status: "error" });
    expect(out.ankorstore).toBeUndefined();
    expect(out.faire).toBeUndefined();
  });

  it("laisse passer normalement si le produit est complet", async () => {
    checkProductCompleteSpy.mockResolvedValue({
      eligible: true,
      reasons: [],
      message: "",
    });
    pfsPublishSpy.mockResolvedValue({ success: true, pfsProductId: "new_pfs", archived: false });

    const out = await publishProductToMarketplaces("p-1", { pfs: true });

    expect(checkProductCompleteSpy).toHaveBeenCalledWith("p-1");
    expect(pfsPublishSpy).toHaveBeenCalledOnce();
    expect(out.pfs).toEqual({ status: "ok", mode: "create", archived: false });
  });
});
