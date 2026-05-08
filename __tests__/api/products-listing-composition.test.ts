import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/cached-data", () => ({
  getCachedSiteConfig: vi.fn().mockResolvedValue({ value: "true" }),
}));
vi.mock("@/lib/product-display", () => ({
  parseDisplayConfig: vi.fn().mockReturnValue({ catalogMode: "default", sections: [] }),
  getOrderedProductIds: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: vi.fn(), count: vi.fn() },
    productColorImage: { findMany: vi.fn() },
    orderItem: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { GET } from "@/app/api/products/route";

function makeReq(qs: string) {
  return new Request(`http://test/api/products?${qs}`) as unknown as import("next/server").NextRequest;
}

describe("GET /api/products — filtre composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productColorImage.findMany).mockResolvedValue([] as never);
  });

  it("ajoute la clause compositions.some quand composition=… est passé", async () => {
    await GET(makeReq("composition=comp-123"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.compositions).toEqual({ some: { compositionId: "comp-123" } });
  });

  it("n'ajoute PAS de clause compositions quand le param est vide", async () => {
    await GET(makeReq(""));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.compositions).toBeUndefined();
  });

  it("combine composition avec category sans s'écraser", async () => {
    await GET(makeReq("composition=comp-1&cat=cat-9"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where.categoryId).toBe("cat-9");
    expect(arg.where.compositions).toEqual({ some: { compositionId: "comp-1" } });
  });
});
