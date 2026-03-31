import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { akCountProducts } from "@/lib/ankorstore-api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const [akCount, bjCount] = await Promise.all([
      akCountProducts().catch(() => ({ count: 0, hasMore: false })),
      prisma.product.count({ where: { akProductId: { not: null } } }),
    ]);

    return NextResponse.json({
      akCount: akCount.count,
      akHasMore: akCount.hasMore,
      bjSyncedCount: bjCount,
    });
  } catch {
    return NextResponse.json({ akCount: 0, akHasMore: false, bjSyncedCount: 0 });
  }
}
