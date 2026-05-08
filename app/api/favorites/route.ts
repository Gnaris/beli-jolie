import { NextRequest, NextResponse } from "next/server";
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

/**
 * POST /api/favorites — toggle. Endpoint dédié pour éviter l'overhead des
 * Server Actions (re-render automatique de toute la page RSC à chaque clic).
 * Body : { productId: string }.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== "CLIENT" && session.user.role !== "ADMIN")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let productId: string | undefined;
  try {
    const body = await req.json();
    productId = typeof body?.productId === "string" ? body.productId : undefined;
  } catch {
    /* body invalide */
  }
  if (!productId) {
    return NextResponse.json({ error: "productId requis" }, { status: 400 });
  }

  const userId = session.user.id;
  const deleted = await prisma.favorite.deleteMany({
    where: { userId, productId },
  });
  if (deleted.count > 0) {
    return NextResponse.json({ isFavorite: false });
  }

  await prisma.favorite.create({ data: { userId, productId } });
  return NextResponse.json({ isFavorite: true });
}
