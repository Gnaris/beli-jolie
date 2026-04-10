/**
 * E2E helper: delete a test product.
 * Only available in development.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  // Delete product and related data
  await prisma.product.delete({ where: { id: productId } }).catch(() => {});

  return NextResponse.json({ success: true });
}
