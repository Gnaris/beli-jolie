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

// Bug 09/2026 — le filtre "Nouveautés" (?new=1) triait par `lastRefreshedAt DESC`
// en priorité, ce qui remontait des vieux produits refresh récemment devant les
// vraies créations récentes. Ce test garde le orderBy sur `createdAt DESC`
// seul, cohérent avec l'intuition métier "nouveautés = récents".
describe("GET /api/products — orderBy filtre nouveautés (?new=1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productColorImage.findMany).mockResolvedValue([] as never);
  });

  it("trie par createdAt DESC seul quand ?new=1", async () => {
    await GET(makeReq("new=1"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: unknown;
    };
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("ne trie PAS par lastRefreshedAt quand ?new=1", async () => {
    await GET(makeReq("new=1"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: unknown;
    };
    // Garde-fou explicite : jamais lastRefreshedAt en tête du tri.
    expect(JSON.stringify(arg.orderBy)).not.toContain("lastRefreshedAt");
  });

  it("garde createdAt DESC comme tri par défaut (sans ?new)", async () => {
    await GET(makeReq(""));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: unknown;
    };
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("garde le WHERE OR sur createdAt/lastRefreshedAt (le filtre inclut toujours les refresh)", async () => {
    await GET(makeReq("new=1"));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      where: { OR?: Array<Record<string, unknown>> };
    };
    // Le WHERE conserve le OR pour que les produits refresh restent visibles
    // dans le filtre — on modifie uniquement le tri.
    const or = arg.where.OR ?? [];
    const keys = or.flatMap((c) => Object.keys(c));
    expect(keys).toContain("createdAt");
    expect(keys).toContain("lastRefreshedAt");
  });
});
