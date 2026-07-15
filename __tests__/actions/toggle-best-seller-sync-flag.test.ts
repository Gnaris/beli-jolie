/**
 * Test pour toggleBestSeller (bug 5).
 *
 * Quand on bascule l'étoile Best Seller depuis la liste des produits, on doit
 * poser le drapeau `pfsSyncRequired = true` si le produit est déjà publié
 * sur PFS. Sans ça, l'étoile ne serait jamais renvoyée à PFS (seule l'étoile
 * modifiée depuis la fiche produit passerait par le flow de sync).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProductFindUnique = vi.fn();
const mockProductUpdate = vi.fn().mockResolvedValue({});

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
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/translate", () => ({
  invalidateProductTranslations: vi.fn(),
  translateTextStrict: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notifyRestockAlerts: vi.fn() }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  deleteFiles: vi.fn(),
  keyFromDbPath: vi.fn((s: string) => s),
  productImageDir: vi.fn(),
  renameProductFolder: vi.fn(),
  deleteDirectory: vi.fn(),
}));
vi.mock("@/lib/image-utils", () => ({
  getImagePaths: vi.fn(() => ({ large: "l", medium: "m", thumb: "t" })),
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsGetGenders: vi.fn().mockResolvedValue([]),
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
  pfsGetCategories: vi.fn().mockResolvedValue([]),
  pfsGetColors: vi.fn().mockResolvedValue([]),
  pfsGetCompositions: vi.fn().mockResolvedValue([]),
  pfsGetCountries: vi.fn().mockResolvedValue([]),
  pfsGetSizes: vi.fn().mockResolvedValue([]),
  pfsGetCollections: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/pfs-api", () => ({ pfsCheckReference: vi.fn() }));
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreDeleteProduct: vi.fn(),
}));

import { toggleBestSeller } from "@/app/actions/admin/products";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toggleBestSeller (bug 5)", () => {
  it("pose pfsSyncRequired=true si le produit est déjà publié sur PFS", async () => {
    mockProductFindUnique.mockResolvedValue({
      isBestSeller: false,
      pfsProductId: "pfs-123",
      ankorsProductId: null,
      efashionReferenceBase: null,
      faireProductId: null,
    });

    const result = await toggleBestSeller("prod-1", true);

    expect(result.success).toBe(true);
    expect(mockProductUpdate).toHaveBeenCalledWith({
      where: { id: "prod-1" },
      data: { isBestSeller: true, pfsSyncRequired: true },
    });
  });

  it("ne pose PAS pfsSyncRequired si le produit n'est pas publié sur PFS", async () => {
    mockProductFindUnique.mockResolvedValue({
      isBestSeller: false,
      pfsProductId: null,
      ankorsProductId: "ank-abc",
      efashionReferenceBase: null,
      faireProductId: null,
    });

    const result = await toggleBestSeller("prod-2", true);

    expect(result.success).toBe(true);
    expect(mockProductUpdate).toHaveBeenCalledWith({
      where: { id: "prod-2" },
      data: { isBestSeller: true },
    });
  });

  it("no-op si l'étoile est déjà dans l'état demandé (pas d'update)", async () => {
    mockProductFindUnique.mockResolvedValue({
      isBestSeller: true,
      pfsProductId: "pfs-123",
      ankorsProductId: null,
      efashionReferenceBase: null,
      faireProductId: null,
    });

    const result = await toggleBestSeller("prod-3", true);

    expect(result.success).toBe(true);
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });
});
