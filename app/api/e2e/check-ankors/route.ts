/**
 * E2E helper: check if a product has been linked to Ankorstore.
 * Only available in development.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { ankorsProductId: true, ankorsMatchedAt: true },
  });

  return NextResponse.json({
    ankorsProductId: product?.ankorsProductId ?? null,
    ankorsMatchedAt: product?.ankorsMatchedAt ?? null,
  });
}
