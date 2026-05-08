import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn() },
    orderItem: { findMany: vi.fn() },
    cartItem: { aggregate: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { GET } from "@/app/api/admin/products/[id]/stats/route";

function makeReq(qs = "") {
  return new Request(`http://test/api/admin/products/p1/stats${qs ? `?${qs}` : ""}`) as unknown as import("next/server").NextRequest;
}

const params = (id: string) => Promise.resolve({ id });

describe("GET /api/admin/products/[id]/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin", role: "ADMIN" },
    } as never);
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ id: "p1", reference: "REF-1" } as never);
    vi.mocked(prisma.cartItem.aggregate).mockResolvedValue({ _sum: { quantity: 0 } } as never);
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue([] as never);
  });

  it("refuse les non-admins", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u", role: "CLIENT" } } as never);
    const res = await GET(makeReq(), { params: params("p1") });
    expect((res as unknown as Response).status).toBe(401);
  });

  it("404 si produit introuvable", async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null as never);
    const res = await GET(makeReq(), { params: params("p1") });
    expect((res as unknown as Response).status).toBe(404);
  });

  it("agrège totalSold, revenue, totalClients et trie clients par totalQty décroissant", async () => {
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue([
      { quantity: 2, lineTotal: 20, order: { createdAt: new Date("2026-01-01"), user: { id: "u1", email: "a@b", firstName: "A", lastName: "B", company: "Co A" } } },
      { quantity: 5, lineTotal: 50, order: { createdAt: new Date("2026-02-01"), user: { id: "u2", email: "c@d", firstName: "C", lastName: "D", company: "Co C" } } },
      { quantity: 1, lineTotal: 10, order: { createdAt: new Date("2026-03-01"), user: { id: "u1", email: "a@b", firstName: "A", lastName: "B", company: "Co A" } } },
    ] as never);
    vi.mocked(prisma.cartItem.aggregate).mockResolvedValue({ _sum: { quantity: 4 } } as never);

    const res = await GET(makeReq(), { params: params("p1") });
    const body = await (res as unknown as Response).json();

    expect(body.totalSold).toBe(8);
    expect(body.revenue).toBeCloseTo(80);
    expect(body.totalClients).toBe(2);
    expect(body.inCart).toBe(4);
    expect(body.clients[0].userId).toBe("u2"); // 5 > 3
    expect(body.clients[0].totalQty).toBe(5);
    expect(body.clients[0].ordersCount).toBe(1);
    expect(body.clients[1].userId).toBe("u1"); // 2 + 1 = 3
    expect(body.clients[1].totalQty).toBe(3);
    expect(body.clients[1].ordersCount).toBe(2);
    expect(body.clients[1].lastOrderDate).toBe("2026-03-01T00:00:00.000Z");
  });

  it("filtre les commandes annulées via where.order.status", async () => {
    await GET(makeReq(), { params: params("p1") });
    const arg = vi.mocked(prisma.orderItem.findMany).mock.calls[0][0] as { where: { order: { status: { not: string } } } };
    expect(arg.where.order.status.not).toBe("CANCELLED");
  });

  it("pagine les clients par 10 et expose totalPages", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      quantity: 25 - i,
      lineTotal: (25 - i) * 5,
      order: {
        createdAt: new Date(2026, 0, i + 1),
        user: { id: `u${i}`, email: `${i}@x`, firstName: `F${i}`, lastName: `L${i}`, company: `C${i}` },
      },
    }));
    vi.mocked(prisma.orderItem.findMany).mockResolvedValue(items as never);

    const res1 = await GET(makeReq("page=1"), { params: params("p1") });
    const body1 = await (res1 as unknown as Response).json();
    expect(body1.clients).toHaveLength(10);
    expect(body1.totalPages).toBe(3);
    expect(body1.totalClients).toBe(25);
    expect(body1.page).toBe(1);

    const res3 = await GET(makeReq("page=3"), { params: params("p1") });
    const body3 = await (res3 as unknown as Response).json();
    expect(body3.clients).toHaveLength(5);
    expect(body3.page).toBe(3);
  });
});
