import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSizeFindMany = vi.fn();
const mockCategoryFindMany = vi.fn();
const mockColorFindMany = vi.fn();
const mockCompositionFindMany = vi.fn();
const mockTagFindMany = vi.fn();
const mockCountryFindMany = vi.fn();
const mockSeasonFindMany = vi.fn();
const mockProductFindMany = vi.fn();
const mockGetPfsAnnexes = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    size: {
      upsert: vi.fn(),
      findMany: (...a: unknown[]) => mockSizeFindMany(...a),
    },
    category: { findMany: (...a: unknown[]) => mockCategoryFindMany(...a) },
    color: { findMany: (...a: unknown[]) => mockColorFindMany(...a) },
    composition: { findMany: (...a: unknown[]) => mockCompositionFindMany(...a) },
    tag: { findMany: (...a: unknown[]) => mockTagFindMany(...a) },
    manufacturingCountry: { findMany: (...a: unknown[]) => mockCountryFindMany(...a) },
    season: { findMany: (...a: unknown[]) => mockSeasonFindMany(...a) },
    product: { findMany: (...a: unknown[]) => mockProductFindMany(...a) },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/pfs-annexes", () => ({
  getPfsAnnexes: (...a: unknown[]) => mockGetPfsAnnexes(...a),
}));
vi.mock("@/lib/translate", () => ({ invalidateProductTranslations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyRestockAlerts: vi.fn() }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/storage", () => ({ deleteFiles: vi.fn(), keyFromDbPath: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));
vi.mock("@/lib/normalize-primary-flag", () => ({ normalizePrimaryFlag: vi.fn() }));
vi.mock("@/lib/variant-image-coverage", () => ({ findMissingImageCoverage: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fetchProductFormAttributes } from "@/app/actions/admin/products";

describe("fetchProductFormAttributes — raccourcis Code SH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindMany.mockResolvedValue([]);
    mockColorFindMany.mockResolvedValue([]);
    mockCompositionFindMany.mockResolvedValue([]);
    mockTagFindMany.mockResolvedValue([]);
    mockCountryFindMany.mockResolvedValue([]);
    mockSeasonFindMany.mockResolvedValue([]);
    mockSizeFindMany.mockResolvedValue([]);
    mockGetPfsAnnexes.mockResolvedValue(null);
  });

  it("retourne un tableau vide quand aucun produit n'a de code SH", async () => {
    mockProductFindMany.mockResolvedValue([]);

    const result = await fetchProductFormAttributes();

    expect(result.hsCodes).toEqual([]);
  });

  it("regroupe les doublons et compte les utilisations par code", async () => {
    mockProductFindMany.mockResolvedValue([
      { hsCode: "7117190000" },
      { hsCode: "7117190000" },
      { hsCode: "7117190000" },
      { hsCode: "6204620000" },
    ]);

    const result = await fetchProductFormAttributes();

    expect(result.hsCodes).toEqual([
      { code: "7117190000", count: 3 },
      { code: "6204620000", count: 1 },
    ]);
  });

  it("trie par fréquence décroissante puis par code croissant", async () => {
    mockProductFindMany.mockResolvedValue([
      { hsCode: "9999999999" },
      { hsCode: "1111111111" },
      { hsCode: "5555555555" },
      { hsCode: "1111111111" },
      { hsCode: "5555555555" },
    ]);

    const result = await fetchProductFormAttributes();

    // 1111 et 5555 ont chacun 2 occurrences → tri alpha asc entre eux,
    // 9999 a 1 occurrence → en dernier.
    expect(result.hsCodes).toEqual([
      { code: "1111111111", count: 2 },
      { code: "5555555555", count: 2 },
      { code: "9999999999", count: 1 },
    ]);
  });

  it("ignore les codes vides ou espaces seulement", async () => {
    mockProductFindMany.mockResolvedValue([
      { hsCode: "7117190000" },
      { hsCode: "" },
      { hsCode: "   " },
    ]);

    const result = await fetchProductFormAttributes();

    expect(result.hsCodes).toEqual([{ code: "7117190000", count: 1 }]);
  });

  it("ne retourne que les produits dont le code SH n'est pas null (filtre côté Prisma)", async () => {
    mockProductFindMany.mockResolvedValue([{ hsCode: "7117190000" }]);

    await fetchProductFormAttributes();

    expect(mockProductFindMany).toHaveBeenCalledWith({
      where: { hsCode: { not: null } },
      select: { hsCode: true },
    });
  });
});
