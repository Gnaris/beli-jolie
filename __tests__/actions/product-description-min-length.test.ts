import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma (only what createProduct/updateProduct touch before the description check)
const mockProductFindUnique = vi.fn();
const mockProductFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => mockProductFindUnique(...args),
      findFirst: (...args: unknown[]) => mockProductFindFirst(...args),
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
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/translate", () => ({ invalidateProductTranslations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ notifyRestockAlerts: vi.fn() }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/pfs-api-write", () => ({ pfsDeleteProduct: vi.fn() }));
vi.mock("@/lib/pfs-api", () => ({ pfsCheckReference: vi.fn() }));
vi.mock("@/lib/ankorstore-api-write", () => ({ ankorstoreDeleteProduct: vi.fn() }));
vi.mock("@/lib/ankorstore-api", () => ({ ankorstoreSearchProductsByRef: vi.fn() }));
vi.mock("@/lib/auto-translate", () => ({ autoTranslateProduct: vi.fn(), autoTranslateTag: vi.fn() }));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/r2", () => ({ deleteMultipleFromR2: vi.fn(), r2KeyFromDbPath: vi.fn() }));
vi.mock("@/lib/image-utils", () => ({ getImagePaths: vi.fn() }));

import { createProduct, updateProduct, type ProductInput } from "@/app/actions/admin/products";

function baseInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    reference: "REF123",
    name: "Produit test",
    description: "Description commerciale du produit — 30 caractères.",
    categoryId: "cat-1",
    subCategoryIds: [],
    colors: [
      {
        colorId: "col-1",
        unitPrice: 10,
        weight: 1,
        stock: 5,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        sizeEntries: [{ sizeId: "s-1", quantity: 5 }],
        packColorLines: [],
      },
    ],
    compositions: [],
    similarProductIds: [],
    bundleChildIds: [],
    tagNames: [],
    isBestSeller: false,
    status: "OFFLINE",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    discountPercent: null,
    ...overrides,
  };
}

describe("product description minimum length (30 chars for Ankorstore)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductFindUnique.mockResolvedValue(null);
    mockProductFindFirst.mockResolvedValue(null);
  });

  it("rejects createProduct when description < 30 characters", async () => {
    await expect(
      createProduct(baseInput({ description: "Trop court" }))
    ).rejects.toThrow(/30 caractères/);
  });

  it("rejects updateProduct when description < 30 characters", async () => {
    await expect(
      updateProduct("prod-1", baseInput({ description: "Trop court" }))
    ).rejects.toThrow(/30 caractères/);
  });

  it("allows incomplete products to bypass the 30-char rule", async () => {
    // Incomplete products should not trigger the description length check.
    // We expect failure at a later step (not the description error).
    await expect(
      createProduct(baseInput({ description: "x", isIncomplete: true }))
    ).rejects.not.toThrow(/30 caractères/);
  });
});
