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

describe("GET /api/products — prise en compte de la locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productColorImage.findMany).mockResolvedValue([] as never);
  });

  it("inclut translations pour locale=en", async () => {
    await GET(makeReq("locale=en"));
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          translations: expect.objectContaining({
            where: { locale: "en" },
            select: { name: true },
            take: 1,
          }),
        }),
      }),
    );
  });

  it("n'inclut PAS translations pour locale=fr (gain de perf)", async () => {
    await GET(makeReq("locale=fr"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect(arg).toBeTruthy();
    expect((arg as { include: Record<string, unknown> }).include.translations).toBeUndefined();
  });

  it("ignore une locale invalide et retombe sur fr", async () => {
    await GET(makeReq("locale=zz"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0];
    expect((arg as { include: Record<string, unknown> }).include.translations).toBeUndefined();
  });

  it("remplace product.name par la traduction quand elle existe", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      {
        id: "p1",
        name: "Bracelet doré",
        reference: "BR-001",
        primaryColorId: null,
        category: { name: "Bracelets" },
        subCategories: [],
        tags: [],
        colors: [],
        translations: [{ name: "Gold bracelet" }],
      },
    ] as never);

    const res = await GET(makeReq("locale=en"));
    const body = await (res as unknown as Response).json();
    expect(body.products[0].name).toBe("Gold bracelet");
  });

  it("garde le nom FR si aucune traduction n'est en base", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      {
        id: "p1",
        name: "Bracelet doré",
        reference: "BR-001",
        primaryColorId: null,
        category: { name: "Bracelets" },
        subCategories: [],
        tags: [],
        colors: [],
        translations: [],
      },
    ] as never);

    const res = await GET(makeReq("locale=en"));
    const body = await (res as unknown as Response).json();
    expect(body.products[0].name).toBe("Bracelet doré");
  });
});
