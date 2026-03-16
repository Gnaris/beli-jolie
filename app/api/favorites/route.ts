import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== "CLIENT" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ ids: [] });
  }

  const favorites = await prisma.favorite.findMany({
    where: { userId: session.user.id },
    select: { productId: true },
  });

  return NextResponse.json({ ids: favorites.map((f) => f.productId) });
}
