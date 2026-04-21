import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    productColor: {
      update: (...a: unknown[]) => mockUpdate(...a),
    },
    color: {
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
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
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateColor: vi.fn(),
}));

import { updateProductColorPfsRef } from "@/app/actions/admin/colors";

describe("updateProductColorPfsRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the trimmed reference to the matching ProductColor row", async () => {
    mockUpdate.mockResolvedValue({});
    await updateProductColorPfsRef("pc_123", "  Rouge  ");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "pc_123" },
      data: { pfsColorRef: "Rouge" },
    });
  });

  it("stores null when the reference is empty", async () => {
    mockUpdate.mockResolvedValue({});
    await updateProductColorPfsRef("pc_123", "");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "pc_123" },
      data: { pfsColorRef: null },
    });
  });

  it("stores null when the reference is whitespace only", async () => {
    mockUpdate.mockResolvedValue({});
    await updateProductColorPfsRef("pc_123", "   ");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "pc_123" },
      data: { pfsColorRef: null },
    });
  });

  it("stores null when the reference is null", async () => {
    mockUpdate.mockResolvedValue({});
    await updateProductColorPfsRef("pc_123", null);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "pc_123" },
      data: { pfsColorRef: null },
    });
  });

  it("throws when productColorId is empty", async () => {
    await expect(updateProductColorPfsRef("", "Rouge")).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses non-admin callers", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { role: "CLIENT" },
    });
    await expect(updateProductColorPfsRef("pc_123", "Rouge")).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
