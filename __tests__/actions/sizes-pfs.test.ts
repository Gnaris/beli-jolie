import { describe, it, expect, vi, beforeEach } from "vitest";

// Prisma mocks
const mockSizeFindUnique = vi.fn();
const mockSizeFindFirst = vi.fn();
const mockSizeCreate = vi.fn();
const mockSizeUpdate = vi.fn();
const mockSizeDelete = vi.fn();
const mockSizeAggregate = vi.fn();
const mockSizeFindMany = vi.fn();
const mockVariantSizeCount = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    size: {
      findUnique: (...a: unknown[]) => mockSizeFindUnique(...a),
      findFirst: (...a: unknown[]) => mockSizeFindFirst(...a),
      create: (...a: unknown[]) => mockSizeCreate(...a),
      update: (...a: unknown[]) => mockSizeUpdate(...a),
      delete: (...a: unknown[]) => mockSizeDelete(...a),
      aggregate: (...a: unknown[]) => mockSizeAggregate(...a),
      findMany: (...a: unknown[]) => mockSizeFindMany(...a),
    },
    variantSize: {
      count: (...a: unknown[]) => mockVariantSizeCount(...a),
    },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
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

import { createSize, deleteSize, setSizePfsMapping, updateSize } from "@/app/actions/admin/sizes";

describe("sizes actions — independent of categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSizeAggregate.mockResolvedValue({ _max: { position: 4 } });
  });

  describe("createSize", () => {
    it("creates a size when a PFS ref is provided", async () => {
      mockSizeFindUnique.mockResolvedValue(null);
      mockSizeCreate.mockResolvedValue({ id: "s1", name: "M", pfsSizeRef: "M_EU" });

      const result = await createSize("M", "M_EU");

      expect(mockSizeCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: "M", pfsSizeRef: "M_EU" }),
      }));
      const calledWith = mockSizeCreate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(calledWith.data.categories).toBeUndefined();
      expect(result).toEqual({ id: "s1", name: "M", pfsSizeRef: "M_EU" });
    });

    it("throws when the PFS ref is missing", async () => {
      await expect(createSize("L", "")).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockSizeCreate).not.toHaveBeenCalled();
    });

    it("throws when the PFS ref is only whitespace", async () => {
      await expect(createSize("XL", "   ")).rejects.toThrow(/Paris Fashion Shop/);
      expect(mockSizeCreate).not.toHaveBeenCalled();
    });

    it("returns the existing size when the name is already taken", async () => {
      mockSizeFindUnique.mockResolvedValue({ id: "existing", name: "M", pfsSizeRef: "A" });

      const result = await createSize("M", "M_EU");

      expect(mockSizeCreate).not.toHaveBeenCalled();
      expect(result).toEqual({ id: "existing", name: "M", pfsSizeRef: "A" });
    });

    it("throws when the name is empty", async () => {
      await expect(createSize("   ", "foo")).rejects.toThrow(/Le nom est requis/);
    });
  });

  describe("setSizePfsMapping", () => {
    beforeEach(() => {
      mockSizeFindUnique.mockResolvedValue({ id: "s1", name: "M" });
    });

    it("sets the PFS ref on a size", async () => {
      mockSizeUpdate.mockResolvedValue({ pfsSizeRef: "T36" });

      const result = await setSizePfsMapping("s1", "T36");

      expect(mockSizeUpdate).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: { pfsSizeRef: "T36" },
        select: { pfsSizeRef: true },
      });
      expect(result).toEqual({ pfsSizeRef: "T36" });
    });

    it("clears the PFS ref when null is passed", async () => {
      mockSizeUpdate.mockResolvedValue({ pfsSizeRef: null });

      const result = await setSizePfsMapping("s1", null);

      expect(mockSizeUpdate).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: { pfsSizeRef: null },
        select: { pfsSizeRef: true },
      });
      expect(result).toEqual({ pfsSizeRef: null });
    });

    it("normalises whitespace-only strings to null", async () => {
      mockSizeUpdate.mockResolvedValue({ pfsSizeRef: null });

      await setSizePfsMapping("s1", "   ");

      expect(mockSizeUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: { pfsSizeRef: null },
      }));
    });

    it("rejects PFS ref change on « Taille unique »", async () => {
      mockSizeFindUnique.mockResolvedValue({ id: "s-tu", name: "Taille unique" });

      await expect(setSizePfsMapping("s-tu", "OTHER_REF")).rejects.toThrow(/protégée/);
      expect(mockSizeUpdate).not.toHaveBeenCalled();
    });
  });

  describe("updateSize", () => {
    beforeEach(() => {
      mockSizeFindUnique.mockResolvedValue({ id: "s1", name: "M" });
      mockSizeFindFirst.mockResolvedValue(null);
      mockSizeUpdate.mockResolvedValue({ id: "s1" });
    });

    it("updates only the name when pfsSizeRef is omitted", async () => {
      await updateSize("s1", "M");

      expect(mockSizeUpdate).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: { name: "M" },
      });
    });

    it("updates pfsSizeRef when explicitly passed", async () => {
      await updateSize("s1", "M", "NEW_REF");

      expect(mockSizeUpdate).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: { name: "M", pfsSizeRef: "NEW_REF" },
      });
    });

    it("rejects when the new name is already taken by another size", async () => {
      mockSizeFindFirst.mockResolvedValue({ id: "other" });

      await expect(updateSize("s1", "Duplicate")).rejects.toThrow(/existe déjà/);
    });

    it("rejects update of « Taille unique »", async () => {
      mockSizeFindUnique.mockResolvedValue({ id: "s-tu", name: "Taille unique" });

      await expect(updateSize("s-tu", "Autre nom")).rejects.toThrow(/protégée/);
      expect(mockSizeUpdate).not.toHaveBeenCalled();
    });
  });

  describe("deleteSize — protected name", () => {
    beforeEach(() => {
      mockVariantSizeCount.mockResolvedValue(0);
    });

    it("rejects deletion of « Taille unique »", async () => {
      mockSizeFindUnique.mockResolvedValue({ id: "s-tu", name: "Taille unique" });

      await expect(deleteSize("s-tu")).rejects.toThrow(/protégée/);
      expect(mockSizeDelete).not.toHaveBeenCalled();
    });

    it("allows deletion of any other size", async () => {
      mockSizeFindUnique.mockResolvedValue({ id: "s1", name: "M" });
      mockSizeDelete.mockResolvedValue({});

      await deleteSize("s1");

      expect(mockSizeDelete).toHaveBeenCalledWith({ where: { id: "s1" } });
    });
  });
});
