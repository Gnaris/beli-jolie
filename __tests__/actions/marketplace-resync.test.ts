import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindUnique,
  pfsUpdateInPlaceSpy,
  mockGetSession,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  pfsUpdateInPlaceSpy: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: (...a: unknown[]) => mockFindUnique(...a) },
  },
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/pfs-update", () => ({
  pfsUpdateProductInPlace: pfsUpdateInPlaceSpy,
}));
vi.mock("@/lib/platform-config", () => ({
  isMarketplaceInMaintenance: vi.fn().mockResolvedValue(false),
  getMarketplaceMaintenance: vi.fn().mockResolvedValue({
    pfs: false,
    ankorstore: false,
    efashion: false,
    faire: false,
  }),
  marketplaceMaintenanceMessage: (mp: string) => `${mp} en maintenance`,
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { resyncProductOnPfs } from "@/app/actions/admin/marketplace-resync";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { role: "ADMIN" } });
});

describe("resyncProductOnPfs", () => {
  it("rejette si l'utilisateur n'est pas admin", async () => {
    mockGetSession.mockResolvedValue({ user: { role: "CLIENT" } });
    await expect(resyncProductOnPfs("p-1")).rejects.toThrow("Accès non autorisé");
  });

  it("retourne une erreur si le produit n'a pas de pfsProductId", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "ONLINE",
      pfsProductId: null,
    });
    const out = await resyncProductOnPfs("p-1");
    expect(out.pfs).toEqual({
      status: "error",
      message: expect.stringContaining("non publié"),
    });
    expect(pfsUpdateInPlaceSpy).not.toHaveBeenCalled();
  });

  it("appelle pfsUpdateProductInPlace avec forceFullSync=true", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "ONLINE",
      pfsProductId: "PFS-1",
    });
    pfsUpdateInPlaceSpy.mockResolvedValue({ success: true, archived: false });

    const out = await resyncProductOnPfs("p-1");

    expect(pfsUpdateInPlaceSpy).toHaveBeenCalledWith(
      "p-1",
      undefined,
      { skipRevalidation: true, forceFullSync: true },
    );
    expect(out.pfs).toEqual({ status: "ok", mode: "update", archived: false });
  });

  it("retourne l'erreur si la sync échoue (pas de fallback publish)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "p-1",
      reference: "REF-1",
      name: "T",
      status: "ONLINE",
      pfsProductId: "PFS-1",
    });
    pfsUpdateInPlaceSpy.mockResolvedValue({ success: false, error: "PFS down" });

    const out = await resyncProductOnPfs("p-1");

    expect(out.pfs).toEqual({ status: "error", message: "PFS down" });
  });
});
