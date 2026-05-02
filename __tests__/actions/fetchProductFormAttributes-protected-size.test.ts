import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSizeUpsert = vi.fn();
const mockSizeFindMany = vi.fn();
const mockCategoryFindMany = vi.fn();
const mockColorFindMany = vi.fn();
const mockCompositionFindMany = vi.fn();
const mockTagFindMany = vi.fn();
const mockCountryFindMany = vi.fn();
const mockSeasonFindMany = vi.fn();
const mockGetPfsAnnexes = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    size: {
      upsert: (...a: unknown[]) => mockSizeUpsert(...a),
      findMany: (...a: unknown[]) => mockSizeFindMany(...a),
    },
    category: { findMany: (...a: unknown[]) => mockCategoryFindMany(...a) },
    color: { findMany: (...a: unknown[]) => mockColorFindMany(...a) },
    composition: { findMany: (...a: unknown[]) => mockCompositionFindMany(...a) },
    tag: { findMany: (...a: unknown[]) => mockTagFindMany(...a) },
    manufacturingCountry: { findMany: (...a: unknown[]) => mockCountryFindMany(...a) },
    season: { findMany: (...a: unknown[]) => mockSeasonFindMany(...a) },
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
import { PROTECTED_SIZE_NAME, PROTECTED_SIZE_VIRTUAL_ID } from "@/lib/protected-sizes";

describe("fetchProductFormAttributes — taille unique virtuelle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryFindMany.mockResolvedValue([]);
    mockColorFindMany.mockResolvedValue([]);
    mockCompositionFindMany.mockResolvedValue([]);
    mockTagFindMany.mockResolvedValue([]);
    mockCountryFindMany.mockResolvedValue([]);
    mockSeasonFindMany.mockResolvedValue([]);
    mockGetPfsAnnexes.mockResolvedValue(null);
  });

  it("ne crée jamais la taille unique en base lors du chargement du formulaire", async () => {
    mockSizeFindMany.mockResolvedValue([]);

    await fetchProductFormAttributes();

    expect(mockSizeUpsert).not.toHaveBeenCalled();
  });

  it("injecte une entrée virtuelle « Taille unique » quand absente en base", async () => {
    mockSizeFindMany.mockResolvedValue([
      { id: "s1", name: "M" },
      { id: "s2", name: "L" },
    ]);

    const result = await fetchProductFormAttributes();

    expect(result.sizes[0]).toEqual({
      id: PROTECTED_SIZE_VIRTUAL_ID,
      name: PROTECTED_SIZE_NAME,
    });
    expect(result.sizes).toHaveLength(3);
  });

  it("retourne la vraie ligne sans dédoublon quand la taille est déjà en base", async () => {
    mockSizeFindMany.mockResolvedValue([
      { id: "real-tu", name: PROTECTED_SIZE_NAME },
      { id: "s1", name: "M" },
    ]);

    const result = await fetchProductFormAttributes();

    expect(result.sizes).toEqual([
      { id: "real-tu", name: PROTECTED_SIZE_NAME },
      { id: "s1", name: "M" },
    ]);
    expect(result.sizes.find((s) => s.id === PROTECTED_SIZE_VIRTUAL_ID)).toBeUndefined();
  });
});
