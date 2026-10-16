import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 10;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, reference: true },
  });
  if (!product) {
    return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
  }

  // Toutes les lignes de commande non annulées pour ce produit
  const items = await prisma.orderItem.findMany({
    where: {
      productRef: product.reference,
      order: { status: { not: "CANCELLED" } },
    },
    select: {
      quantity: true,
      lineTotal: true,
      order: {
        select: {
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              company: true,
            },
          },
        },
      },
    },
  });

  const totalSold = items.reduce((s, it) => s + it.quantity, 0);
  const revenue   = items.reduce((s, it) => s + Number(it.lineTotal), 0);

  // Agrégation par client
  type ClientAgg = {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    totalQty: number;
    totalSpent: number;
    ordersCount: number;
    lastOrderDate: string;
  };
  const byUser = new Map<string, ClientAgg>();
  for (const it of items) {
    const u = it.order.user;
    const existing = byUser.get(u.id);
    const orderDate = it.order.createdAt.toISOString();
    if (existing) {
      existing.totalQty   += it.quantity;
      existing.totalSpent += Number(it.lineTotal);
      existing.ordersCount += 1;
      if (orderDate > existing.lastOrderDate) existing.lastOrderDate = orderDate;
    } else {
      byUser.set(u.id, {
        userId:        u.id,
        email:         u.email,
        firstName:     u.firstName,
        lastName:      u.lastName,
        company:       u.company,
        totalQty:      it.quantity,
        totalSpent:    Number(it.lineTotal),
        ordersCount:   1,
        lastOrderDate: orderDate,
      });
    }
  }

  const allClients = [...byUser.values()].sort((a, b) => b.totalQty - a.totalQty);
  const totalClients = allClients.length;

  // Quantité actuellement dans les paniers actifs (toutes variantes du produit)
  const inCartAgg = await prisma.cartItem.aggregate({
    where: { variant: { productId: id } },
    _sum: { quantity: true },
  });
  const inCart = inCartAgg._sum.quantity ?? 0;

  // ─── Vues produit (authentifiées uniquement — admins exclus côté action) ───
  const now = new Date();
  const startOf7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startOf30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [viewsTotal, views7d, views30d, uniqueViewersRows, lastViewers] = await Promise.all([
    prisma.productView.count({ where: { productId: id } }),
    prisma.productView.count({ where: { productId: id, createdAt: { gte: startOf7d } } }),
    prisma.productView.count({ where: { productId: id, createdAt: { gte: startOf30d } } }),
    prisma.productView.findMany({
      where: { productId: id, userId: { not: null } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.productView.findMany({
      where: { productId: id, userId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            email: true,
          },
        },
      },
    }),
  ]);
  const viewsUnique = uniqueViewersRows.length;
  const recentViewers = lastViewers
    .filter((v) => v.user)
    .map((v) => ({
      userId: v.user!.id,
      firstName: v.user!.firstName,
      lastName: v.user!.lastName,
      company: v.user!.company,
      email: v.user!.email,
      viewedAt: v.createdAt.toISOString(),
    }));

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalClients / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const clients = allClients.slice(start, start + PAGE_SIZE);

  return NextResponse.json({
    totalSold,
    inCart,
    revenue,
    totalClients,
    viewsTotal,
    viewsUnique,
    views7d,
    views30d,
    recentViewers,
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages,
    clients,
  });
}
