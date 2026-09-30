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

// Filtre "Nouveautés" (?new=1) — historique :
// - Bug 09/2026 initial : orderBy `lastRefreshedAt DESC` faisait remonter des
//   vieux produits refresh devant les vraies créations récentes.
// - Fix 09/2026 : orderBy `createdAt DESC` seul → mais reléguait les produits
//   rafraîchis récemment en fin de liste (page 2/3) même quand ils étaient
//   plus récents que certaines créations affichées en tête.
// - Fix 10/2026 : tri par max(createdAt, lastRefreshedAt) DESC en mémoire —
//   Prisma ne sait pas exprimer GREATEST(...) DESC en `orderBy`, on récupère
//   les IDs matchant puis on trie côté JS avant de re-fetcher la page.
describe("GET /api/products — orderBy filtre nouveautés (?new=1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1", role: "CLIENT", status: "APPROVED" },
    } as never);
    vi.mocked(prisma.productColorImage.findMany).mockResolvedValue([] as never);
  });

  it("trie par max(createdAt, lastRefreshedAt) DESC quand ?new=1 (tri en mémoire)", async () => {
    const now = Date.now();
    const day = 86_400_000;
    // 1er appel = récupération des IDs + dates pour trier
    // 2e appel = fetch complet avec includes des IDs paginés
    vi.mocked(prisma.product.findMany)
      .mockResolvedValueOnce([
        { id: "A", createdAt: new Date(now - 40 * day), lastRefreshedAt: new Date(now - 3 * day) },
        { id: "B", createdAt: new Date(now - 5 * day), lastRefreshedAt: null },
        { id: "C", createdAt: new Date(now - 10 * day), lastRefreshedAt: new Date(now - 20 * day) },
      ] as never)
      .mockResolvedValueOnce([] as never);

    await GET(makeReq("new=1"));

    // 2e appel : findMany({ where: { id: { in: [...] } } }) avec l'ordre
    // attendu — max = 3j (A), 5j (B), 10j (C).
    const secondCall = vi.mocked(prisma.product.findMany).mock.calls[1][0] as {
      where: { id: { in: string[] } };
    };
    expect(secondCall.where.id.in).toEqual(["A", "B", "C"]);
  });

  it("ne trie PAS via Prisma orderBy par lastRefreshedAt quand ?new=1", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    await GET(makeReq("new=1"));
    for (const call of vi.mocked(prisma.product.findMany).mock.calls) {
      const arg = call[0] as { orderBy?: unknown };
      // Garde-fou : on ne réintroduit jamais lastRefreshedAt en tête du tri
      // Prisma (le tri correct passe par max() en mémoire).
      expect(JSON.stringify(arg.orderBy ?? {})).not.toContain("lastRefreshedAt");
    }
  });

  it("garde createdAt DESC comme tri par défaut (sans ?new)", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
    await GET(makeReq(""));
    const arg = vi.mocked(prisma.product.findMany).mock.calls[0][0] as {
      orderBy: unknown;
    };
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("garde le WHERE OR sur createdAt/lastRefreshedAt (le filtre inclut toujours les refresh)", async () => {
    vi.mocked(prisma.product.findMany).mockResolvedValue([] as never);
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
