import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  mockProductUpdate,
  pfsRefreshSpy,
  pfsPublishSpy,
  ankorRefreshSpy,
  ankorPublishSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  mockProductUpdate: vi.fn(),
  pfsRefreshSpy: vi.fn(),
  pfsPublishSpy: vi.fn(),
  ankorRefreshSpy: vi.fn(),
  ankorPublishSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/pfs-refresh", () => ({
  pfsRefreshProduct: pfsRefreshSpy,
}));
vi.mock("@/lib/pfs-publish", () => ({
  pfsPublishProduct: pfsPublishSpy,
}));
vi.mock("@/lib/ankorstore-refresh", () => ({
  ankorstoreRefreshProduct: ankorRefreshSpy,
}));
vi.mock("@/lib/ankorstore-publish", () => ({
  ankorstorePublishProduct: ankorPublishSpy,
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
});

describe("publishProductToMarketplaces", () => {
  it("appelle pfsPublishProduct (create) si pfsProductId est null", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: null,
      ankorsProductId: null,
    });
    pfsPublishSpy.mockResolvedValue({
      success: true,
      pfsProductId: "new_pfs",
      archived: false,
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: true,
      ankorstore: false,
    });

    expect(pfsPublishSpy).toHaveBeenCalledOnce();
    expect(pfsRefreshSpy).not.toHaveBeenCalled();
    expect(out.pfs).toEqual({ status: "ok", mode: "create", archived: false });
  });

  it("appelle pfsRefreshProduct (refresh) si pfsProductId est déjà connu", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "ONLINE",
      pfsProductId: "existing_pfs",
      ankorsProductId: null,
    });
    pfsRefreshSpy.mockResolvedValue({
      success: true,
      newPfsProductId: "renewed_pfs",
      archived: false,
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: true,
      ankorstore: false,
    });

    expect(pfsRefreshSpy).toHaveBeenCalledOnce();
    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(out.pfs).toEqual({ status: "ok", mode: "refresh", archived: false });
  });

  it("retombe sur publish si refresh PFS renvoie not_found (ID stale)", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: "stale_pfs",
      ankorsProductId: null,
    });
    pfsRefreshSpy.mockResolvedValue({
      success: false,
      reason: "not_found",
      error: "Produit inexistant sur PFS",
    });
    pfsPublishSpy.mockResolvedValue({
      success: true,
      pfsProductId: "new_pfs",
      archived: false,
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: true,
      ankorstore: false,
    });

    expect(pfsRefreshSpy).toHaveBeenCalledOnce();
    expect(pfsPublishSpy).toHaveBeenCalledOnce();
    // L'ID stale doit avoir été mis à null avant le fallback publish
    expect(mockProductUpdate).toHaveBeenCalledWith({
      where: { id: "p-1" },
      data: { pfsProductId: null },
    });
    expect(out.pfs).toEqual({ status: "ok", mode: "create", archived: false });
  });

  it("appelle ankorstorePublishProduct si ankorsProductId est null", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: null,
      ankorsProductId: null,
    });
    ankorPublishSpy.mockResolvedValue({
      success: true,
      opId: "op_1",
      warning: "Vérifiez sur le dashboard.",
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: false,
      ankorstore: true,
    });

    expect(ankorPublishSpy).toHaveBeenCalledOnce();
    expect(ankorRefreshSpy).not.toHaveBeenCalled();
    expect(out.ankorstore).toEqual({
      status: "ok",
      mode: "create",
      opId: "op_1",
      warning: "Vérifiez sur le dashboard.",
    });
  });

  it("appelle ankorstoreRefreshProduct si ankorsProductId est déjà connu", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "ONLINE",
      pfsProductId: null,
      ankorsProductId: "existing_ankors",
    });
    ankorRefreshSpy.mockResolvedValue({
      success: true,
      opId: "op_2",
      warning: "Vérifiez.",
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: false,
      ankorstore: true,
    });

    expect(ankorRefreshSpy).toHaveBeenCalledOnce();
    expect(ankorPublishSpy).not.toHaveBeenCalled();
    expect(out.ankorstore).toEqual({
      status: "ok",
      mode: "refresh",
      opId: "op_2",
      warning: "Vérifiez.",
    });
  });

  it("renvoie status error si la fonction sous-jacente échoue", async () => {
    mockProductFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "OFFLINE",
      pfsProductId: null,
      ankorsProductId: null,
    });
    pfsPublishSpy.mockResolvedValue({
      success: false,
      error: "API PFS injoignable",
    });

    const out = await publishProductToMarketplaces("p-1", {
      pfs: true,
      ankorstore: false,
    });

    expect(out.pfs).toEqual({ status: "error", message: "API PFS injoignable" });
  });
});
