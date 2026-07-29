/**
 * Test pour updateFaireMadeInExcluded.
 *
 * Bug retrouvé en prod (2026-07-29) : après avoir coché « Chine » dans la
 * liste « Masquer Made in pour certains pays » et enregistré, le badge orange
 * « Synchro nécessaire » n'apparaissait pas dans le tableau produits ni dans
 * la fiche produit, alors que `faireSyncRequired` était bien posé en base sur
 * les 2079 produits Faire liés Made in CN.
 *
 * Cause : le server action ne faisait `revalidatePath` que sur
 * `/admin/parametres`. Le tableau et la fiche produit lisent Product.faireSyncRequired
 * directement en BDD (pas via unstable_cache tagué "products"), donc
 * `revalidateTag("products")` ne suffit pas — il faut invalider explicitement
 * le segment layout `/admin/produits` (couvre le tableau + toutes les fiches).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSiteConfigFindFirst = vi.fn();
const mockProductUpdateMany = vi.fn();
const mockSetSiteConfig = vi.fn().mockResolvedValue(undefined);
const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findFirst: (...a: unknown[]) => mockSiteConfigFindFirst(...a),
    },
    product: {
      updateMany: (...a: unknown[]) => mockProductUpdateMany(...a),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a),
  revalidateTag: (...a: unknown[]) => mockRevalidateTag(...a),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/health", () => ({ clearAutoMaintenance: vi.fn() }));
vi.mock("@/lib/product-display", () => ({}));
vi.mock("@/lib/product-display-shared", () => ({ parseDisplayConfig: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ encryptIfSensitive: vi.fn((_, v) => v) }));
vi.mock("@/lib/marketplace-pricing", () => ({}));
vi.mock("@/lib/storage", () => ({
  deleteFile: vi.fn(),
  keyFromDbPath: vi.fn(),
}));
vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: (...a: unknown[]) => mockSetSiteConfig(...a),
}));

import { updateFaireMadeInExcluded } from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateFaireMadeInExcluded", () => {
  it("pose faireSyncRequired=true sur les produits liés Faire du pays coché (première coche)", async () => {
    mockSiteConfigFindFirst.mockResolvedValue(null); // liste jamais sauvegardée
    mockProductUpdateMany.mockResolvedValue({ count: 2079 });

    const result = await updateFaireMadeInExcluded(["CN"]);

    expect(result.success).toBe(true);
    expect(result.markedForSync).toBe(2079);
    expect(mockSetSiteConfig).toHaveBeenCalledWith(
      "faire_made_in_excluded_isocodes",
      JSON.stringify(["CN"]),
    );
    expect(mockProductUpdateMany).toHaveBeenCalledWith({
      where: {
        faireProductId: { not: null },
        countryIsoCode: { in: ["CN"] },
      },
      data: { faireSyncRequired: true },
    });
  });

  it("invalide /admin/produits en layout quand des produits sont marqués (badge orange visible)", async () => {
    mockSiteConfigFindFirst.mockResolvedValue(null);
    mockProductUpdateMany.mockResolvedValue({ count: 2079 });

    await updateFaireMadeInExcluded(["CN"]);

    // Sans cette invalidation, le tableau /admin/produits et la fiche produit
    // restent en cache RSC et le badge orange « Synchro nécessaire » ne s'affiche
    // pas malgré le drapeau posé en base.
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/produits", "layout");
    expect(mockRevalidateTag).toHaveBeenCalledWith("products", "default");
  });

  it("ne pose PAS de flag ni n'invalide /admin/produits si la liste n'a pas changé", async () => {
    mockSiteConfigFindFirst.mockResolvedValue({ value: JSON.stringify(["CN"]) });
    mockProductUpdateMany.mockResolvedValue({ count: 0 });

    const result = await updateFaireMadeInExcluded(["CN"]);

    expect(result.success).toBe(true);
    expect(result.markedForSync).toBe(0);
    expect(mockProductUpdateMany).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalledWith("/admin/produits", "layout");
  });

  it("marque à la fois les pays ajoutés ET les pays retirés (diff symétrique)", async () => {
    mockSiteConfigFindFirst.mockResolvedValue({ value: JSON.stringify(["CN"]) });
    mockProductUpdateMany.mockResolvedValue({ count: 5 });

    await updateFaireMadeInExcluded(["FR"]); // CN retiré, FR ajouté

    expect(mockProductUpdateMany).toHaveBeenCalledWith({
      where: {
        faireProductId: { not: null },
        countryIsoCode: { in: expect.arrayContaining(["CN", "FR"]) },
      },
      data: { faireSyncRequired: true },
    });
  });
});
