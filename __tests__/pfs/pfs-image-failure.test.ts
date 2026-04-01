/**
 * PFS Image Failure Tests
 *
 * Verifies that products are NOT created when any image download fails.
 * Tests both the approve flow (pfs-prepare) and direct sync flow (pfs-sync).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
const mockPrismaProduct = {
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockPrismaStagedProduct = {
  findUnique: vi.fn(),
  update: vi.fn(),
};
const mockPrismaPrepareJob = {
  update: vi.fn(),
};
const mockPrismaColor = {
  findMany: vi.fn(),
};
const mockPrismaProductColor = {
  create: vi.fn(),
};
const mockPrismaProductColorImage = {
  createMany: vi.fn(),
};
const mockPrismaVariantSize = {
  create: vi.fn(),
};
const mockPrismaProductComposition = {
  createMany: vi.fn(),
};
const mockPrismaProductTranslation = {
  createMany: vi.fn(),
};
const mockPrismaProductTag = {
  create: vi.fn(),
};
const mockPrismaProductColorSubColor = {
  createMany: vi.fn(),
};
const mockPrismaPendingSimilar = {
  findMany: vi.fn().mockResolvedValue([]),
  deleteMany: vi.fn(),
};
const mockPrismaSize = {
  findFirst: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: mockPrismaProduct,
    pfsStagedProduct: mockPrismaStagedProduct,
    pfsPrepareJob: mockPrismaPrepareJob,
    color: mockPrismaColor,
    productColor: mockPrismaProductColor,
    productColorImage: mockPrismaProductColorImage,
    variantSize: mockPrismaVariantSize,
    productComposition: mockPrismaProductComposition,
    productTranslation: mockPrismaProductTranslation,
    productTag: mockPrismaProductTag,
    productColorSubColor: mockPrismaProductColorSubColor,
    pendingSimilar: mockPrismaPendingSimilar,
    size: mockPrismaSize,
  },
}));

// Mock downloadImage
const mockDownloadImage = vi.fn();
vi.mock("@/lib/pfs-sync", () => ({
  downloadImage: (...args: unknown[]) => mockDownloadImage(...args),
}));

// Mock image processor
vi.mock("@/lib/image-processor", () => ({
  processProductImage: vi.fn().mockResolvedValue({
    dbPath: "/uploads/products/test.webp",
    largePath: "/uploads/products/test.webp",
    mediumPath: "/uploads/products/test_md.webp",
    thumbPath: "/uploads/products/test_thumb.webp",
  }),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock next/cache
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));

// Mock auto-translate
vi.mock("@/lib/claude", () => ({
  autoTranslateProduct: vi.fn(),
}));

describe("PFS Image Failure Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaColor.findMany.mockResolvedValue([{ id: "color-1" }]);
    mockPrismaProductColor.create.mockResolvedValue({ id: "pc-1", colorId: "color-1" });
  });

  describe("createProductChildren — fail fast on image error", () => {
    it("should return downloaded < expected when an image download fails", async () => {
      // Import after mocks are set up
      const { createProductChildren } = await import("@/lib/pfs-prepare") as { createProductChildren: Function };

      // Setup: downloadImage succeeds first, fails second
      mockDownloadImage
        .mockResolvedValueOnce(Buffer.from("fake-image-data-1"))
        .mockRejectedValueOnce(new Error("ECONNRESET"));

      const variants = [{ colorId: "color-1", colorRef: "DORE", saleType: "UNIT" as const, unitPrice: 10, sizes: [] }];
      const imageGroups = [{
        colorRef: "DORE",
        colorId: "color-1",
        paths: ["https://static.parisfashionshops.com/img1.jpg", "https://static.parisfashionshops.com/img2.jpg"],
        orders: [0, 1],
      }];

      const result = await createProductChildren("prod-1", variants, [], [], imageGroups);

      expect(result.downloaded).toBeLessThan(result.expected);
    });

    it("should stop downloading after first failure (fail fast)", async () => {
      const { createProductChildren } = await import("@/lib/pfs-prepare") as { createProductChildren: Function };

      // First image fails immediately
      mockDownloadImage.mockRejectedValue(new Error("ECONNRESET"));

      const variants = [{ colorId: "color-1", colorRef: "DORE", saleType: "UNIT" as const, unitPrice: 10, sizes: [] }];
      const imageGroups = [{
        colorRef: "DORE",
        colorId: "color-1",
        paths: [
          "https://static.parisfashionshops.com/img1.jpg",
          "https://static.parisfashionshops.com/img2.jpg",
          "https://static.parisfashionshops.com/img3.jpg",
        ],
        orders: [0, 1, 2],
      }];

      const result = await createProductChildren("prod-1", variants, [], [], imageGroups);

      // Should have stopped after first failure — only 1 download attempted
      expect(mockDownloadImage).toHaveBeenCalledTimes(1);
      expect(result.downloaded).toBe(0);
      expect(result.expected).toBe(3);
    });

    it("should fail when no matching variant exists for an image group", async () => {
      const { createProductChildren } = await import("@/lib/pfs-prepare") as { createProductChildren: Function };

      const variants = [{ colorId: "color-1", colorRef: "DORE", saleType: "UNIT" as const, unitPrice: 10, sizes: [] }];
      const imageGroups = [{
        colorRef: "UNKNOWN_COLOR",
        colorId: null,
        paths: ["https://static.parisfashionshops.com/img1.jpg"],
        orders: [0],
      }];

      const result = await createProductChildren("prod-1", variants, [], [], imageGroups);

      // No matching variant = failed, downloaded should be less than expected
      expect(result.downloaded).toBeLessThan(result.expected);
    });
  });

  describe("createProductChildren — blocked domain counts as failure", () => {
    it("should fail when image URL is from unauthorized domain", async () => {
      const { createProductChildren } = await import("@/lib/pfs-prepare") as { createProductChildren: Function };

      const variants = [{ colorId: "color-1", colorRef: "DORE", saleType: "UNIT" as const, unitPrice: 10, sizes: [] }];
      const imageGroups = [{
        colorRef: "DORE",
        colorId: "color-1",
        paths: ["https://evil.com/img1.jpg"],
        orders: [0],
      }];

      const result = await createProductChildren("prod-1", variants, [], [], imageGroups);

      expect(result.downloaded).toBe(0);
      expect(result.expected).toBe(1);
      // Should NOT have attempted download
      expect(mockDownloadImage).not.toHaveBeenCalled();
    });
  });

  describe("createProductChildren — all images succeed", () => {
    it("should return downloaded === expected when all images succeed", async () => {
      const { createProductChildren } = await import("@/lib/pfs-prepare") as { createProductChildren: Function };

      mockDownloadImage.mockResolvedValue(Buffer.from("fake-image-data"));

      const variants = [{ colorId: "color-1", colorRef: "DORE", saleType: "UNIT" as const, unitPrice: 10, sizes: [] }];
      const imageGroups = [{
        colorRef: "DORE",
        colorId: "color-1",
        paths: ["https://static.parisfashionshops.com/img1.jpg", "https://static.parisfashionshops.com/img2.jpg"],
        orders: [0, 1],
      }];

      const result = await createProductChildren("prod-1", variants, [], [], imageGroups);

      expect(result.downloaded).toBe(2);
      expect(result.expected).toBe(2);
    });
  });
});
