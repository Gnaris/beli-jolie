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
    page: safePage,
    pageSize: PAGE_SIZE,
    totalPages,
    clients,
  });
}
