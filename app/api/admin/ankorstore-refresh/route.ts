import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ankorstoreRefreshProduct } from "@/lib/ankorstore-refresh";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json();
  let { productId } = body as { productId?: string; reference?: string };
  const { reference } = body as { reference?: string };

  // Allow lookup by reference
  if (!productId && reference) {
    const product = await prisma.product.findFirst({
      where: { reference },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json({ error: `Produit avec référence "${reference}" introuvable` }, { status: 404 });
    }
    productId = product.id;
  }

  if (!productId) {
    return NextResponse.json({ error: "productId ou reference requis" }, { status: 400 });
  }

  const result = await ankorstoreRefreshProduct(productId, (progress) => {
    logger.info(`[Ankorstore Refresh API] ${progress.step}`);
  });

  return NextResponse.json(result);
}
