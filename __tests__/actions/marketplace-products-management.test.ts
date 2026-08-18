/**
 * __tests__/actions/marketplace-products-management.test.ts
 *
 * Vérifie que setMarketplaceProductsManagement écrit la bonne clé SiteConfig
 * pour chaque marketplace, avec la bonne sémantique par défaut (absent = ON).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks - on stub tout ce que la server action importe.
const setSiteConfigMock = vi.fn(async (_key: string, _value: string) => {});
const revalidatePathMock = vi.fn();
const revalidateTagMock = vi.fn();
const getServerSessionMock = vi.fn(async () => ({ user: { role: "ADMIN" } }));

vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: setSiteConfigMock,
  unsetSiteConfig: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { siteConfig: { deleteMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/lib/encryption", () => ({ encryptIfSensitive: (_k: string, v: string) => v }));
vi.mock("@/lib/storage", () => ({ deleteFile: vi.fn(), keyFromDbPath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/health", () => ({ clearAutoMaintenance: vi.fn() }));
vi.mock("@/lib/product-display-shared", () => ({ parseDisplayConfig: () => ({}) }));
vi.mock("@/lib/min-order", () => ({ isMinOrderMode: () => true }));

const { setMarketplaceProductsManagement } = await import("@/app/actions/admin/site-config");

const EXPECTED_KEY: Record<string, string> = {
  pfs: "pfs_products_management_enabled",
  ankorstore: "ankorstore_products_management_enabled",
  efashion: "efashion_products_management_enabled",
  faire: "faire_products_management_enabled",
  microstore: "microstore_products_management_enabled",
};

describe("setMarketplaceProductsManagement", () => {
  beforeEach(() => {
    setSiteConfigMock.mockClear();
    revalidatePathMock.mockClear();
    revalidateTagMock.mockClear();
  });

  for (const marketplace of ["pfs", "ankorstore", "efashion", "faire", "microstore"] as const) {
    it(`écrit ${EXPECTED_KEY[marketplace]} = "false" quand désactivé pour ${marketplace}`, async () => {
      const res = await setMarketplaceProductsManagement(marketplace, false);
      expect(res).toEqual({ success: true });
      expect(setSiteConfigMock).toHaveBeenCalledWith(EXPECTED_KEY[marketplace], "false");
      expect(revalidateTagMock).toHaveBeenCalledWith("site-config", "default");
    });

    it(`écrit ${EXPECTED_KEY[marketplace]} = "true" quand activé pour ${marketplace}`, async () => {
      const res = await setMarketplaceProductsManagement(marketplace, true);
      expect(res).toEqual({ success: true });
      expect(setSiteConfigMock).toHaveBeenCalledWith(EXPECTED_KEY[marketplace], "true");
    });
  }

  it("refuse une marketplace inconnue", async () => {
    // @ts-expect-error - test intentionnel avec valeur invalide
    const res = await setMarketplaceProductsManagement("shopify", true);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/inconnue/i);
    expect(setSiteConfigMock).not.toHaveBeenCalled();
  });
});
