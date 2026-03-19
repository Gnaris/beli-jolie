import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/restock-alert
 * Toggle restock alert subscription for a product color variant.
 * Body: { productId, productColorId }
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const { productId, productColorId } = await request.json();
  if (!productId || !productColorId) {
    return NextResponse.json({ error: "Paramètres manquants." }, { status: 400 });
  }

  // Check if alert already exists
  const existing = await prisma.restockAlert.findUnique({
    where: {
      userId_productId_productColorId: {
        userId: session.user.id,
        productId,
        productColorId,
      },
    },
  });

  if (existing) {
    // Unsubscribe
    await prisma.restockAlert.delete({ where: { id: existing.id } });
    return NextResponse.json({ subscribed: false });
  }

  // Subscribe
  await prisma.restockAlert.create({
    data: {
      userId: session.user.id,
      productId,
      productColorId,
    },
  });

  return NextResponse.json({ subscribed: true });
}

/**
 * GET /api/restock-alert?productId=xxx&productColorId=yyy
 * Check if current user is subscribed.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ subscribed: false });
  }

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("productId");
  const productColorId = searchParams.get("productColorId");

  if (!productId || !productColorId) {
    return NextResponse.json({ subscribed: false });
  }

  const existing = await prisma.restockAlert.findUnique({
    where: {
      userId_productId_productColorId: {
        userId: session.user.id,
        productId,
        productColorId,
      },
    },
  });

  return NextResponse.json({ subscribed: !!existing });
}
