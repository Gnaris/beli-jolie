import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    sizeCategoryLink: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// Mock auth
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

// Mock revalidation
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { assignSizeToCategory } from "@/app/actions/admin/sizes";

describe("assignSizeToCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a SizeCategoryLink when none exists", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: "link-1", sizeId: "size-1", categoryId: "cat-1" });

    await assignSizeToCategory("size-1", "cat-1");

    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { sizeId_categoryId: { sizeId: "size-1", categoryId: "cat-1" } },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: { sizeId: "size-1", categoryId: "cat-1" },
    });
  });

  it("does nothing when link already exists", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing-link" });

    await assignSizeToCategory("size-1", "cat-1");

    expect(mockFindUnique).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
