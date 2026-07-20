import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProductFindUnique,
  pfsRefreshSpy,
  getCachedPfsEnabledSpy,
  getCachedAnkorstoreEnabledSpy,
  getCachedFaireEnabledSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  pfsRefreshSpy: vi.fn(),
  getCachedPfsEnabledSpy: vi.fn().mockResolvedValue(true),
  getCachedAnkorstoreEnabledSpy: vi.fn().mockResolvedValue(true),
  getCachedFaireEnabledSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: vi.fn(),
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

vi.mock("@/lib/refresh-eligibility", () => ({
  getRefreshIneligibilityReason: vi.fn().mockReturnValue(null),
  labelForIneligibility: vi.fn().mockReturnValue(""),
}));

vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { refreshProductOnMarketplaces } from "@/app/actions/admin/marketplace-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPfsEnabledSpy.mockResolvedValue(true);
  getCachedAnkorstoreEnabledSpy.mockResolvedValue(true);
  getCachedFaireEnabledSpy.mockResolvedValue(true);
  mockProductFindUnique.mockResolvedValue({
    id: "p-1",
    reference: "REF-1",
    name: "T",
    status: "ONLINE",
    isIncomplete: false,
    locked: false,
    pfsProductId: "PFS-1",
  });
});

describe("refreshProductOnMarketplaces — kill switch PFS", () => {
  it("appelle pfsRefreshProduct quand PFS globalement activé", async () => {
    pfsRefreshSpy.mockResolvedValue({ success: true, archived: false });

    const out = await refreshProductOnMarketplaces("p-1", { local: false, pfs: true });

    expect(pfsRefreshSpy).toHaveBeenCalledOnce();
    expect(out.pfs).toEqual({ status: "ok", archived: false });
  });

  it("skip pfsRefreshProduct quand PFS globalement désactivé (Paramètres OFF)", async () => {
    getCachedPfsEnabledSpy.mockResolvedValue(false);

    const out = await refreshProductOnMarketplaces("p-1", { local: false, pfs: true });

    expect(pfsRefreshSpy).not.toHaveBeenCalled();
    expect(out.pfs).toEqual({
      status: "error",
      message: "Sync Paris Fashion Shop désactivée dans Paramètres.",
    });
  });

  it("laisse passer le local bump même quand PFS désactivé", async () => {
    getCachedPfsEnabledSpy.mockResolvedValue(false);

    const out = await refreshProductOnMarketplaces("p-1", { local: true, pfs: false });

    // Le local bump n'est pas gardé par le kill switch PFS (seul le push PFS l'est).
    expect(pfsRefreshSpy).not.toHaveBeenCalled();
    expect(out.local).toEqual({ status: "ok" });
    expect(out.pfs).toBeUndefined();
  });
});
