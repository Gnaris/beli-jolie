/**
 * Vérifie que `getCachedAdminWarnings` remonte bien les compteurs affichés
 * dans la barre de navigation admin :
 *   - pendingOrdersCount (Commandes)
 *   - pendingUsersCount  (Clients — inscriptions non traitées)
 *   - openClaimsCount    (Service Client — SAV ouverts)
 *
 * Ces trois compteurs alimentent le petit rond bleu affiché à côté du
 * libellé de menu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>) => fn,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (_k: string) => "global" }),
}));

const mockPrisma = vi.hoisted(() => ({
  product: { count: vi.fn() },
  color: { count: vi.fn() },
  composition: { count: vi.fn() },
  tag: { count: vi.fn() },
  category: { count: vi.fn() },
  subCategory: { count: vi.fn() },
  order: { count: vi.fn() },
  user: { count: vi.fn() },
  claim: { count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/encryption", () => ({ decryptIfSensitive: (_k: string, v: string) => v }));
vi.mock("@/lib/pfs-api-write", () => ({ pfsGetColors: async () => [] }));
vi.mock("@/lib/marketplace-excel/pfs-taxonomy", () => ({ PFS_COLORS: [] }));
vi.mock("@/lib/marketplace-excel/pfs-color-hex", () => ({ hexForPfsColor: () => null }));
vi.mock("@/lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
vi.mock("@/i18n/locales", () => ({ NON_DEFAULT_LOCALES: [] }));

import { getCachedAdminWarnings } from "@/lib/cached-data";

describe("getCachedAdminWarnings — compteurs navigation admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.color.count.mockResolvedValue(0);
    mockPrisma.composition.count.mockResolvedValue(0);
    mockPrisma.tag.count.mockResolvedValue(0);
    mockPrisma.category.count.mockResolvedValue(0);
    mockPrisma.subCategory.count.mockResolvedValue(0);
    mockPrisma.order.count.mockResolvedValue(0);
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.claim.count.mockResolvedValue(0);
  });

  it("remonte pendingUsersCount depuis prisma.user.count(status=PENDING, role=CLIENT)", async () => {
    mockPrisma.user.count.mockResolvedValueOnce(4);

    const res = await getCachedAdminWarnings();

    expect(res.pendingUsersCount).toBe(4);
    expect(mockPrisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "CLIENT", status: "PENDING" }),
      }),
    );
  });

  it("remonte openClaimsCount depuis prisma.claim.count(status=OPEN)", async () => {
    mockPrisma.claim.count.mockResolvedValueOnce(2);

    const res = await getCachedAdminWarnings();

    expect(res.openClaimsCount).toBe(2);
    expect(mockPrisma.claim.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "OPEN" }),
      }),
    );
  });

  it("remonte 0 pour chaque compteur si aucune ligne en base", async () => {
    const res = await getCachedAdminWarnings();

    expect(res.pendingOrdersCount).toBe(0);
    expect(res.pendingUsersCount).toBe(0);
    expect(res.openClaimsCount).toBe(0);
  });
});
