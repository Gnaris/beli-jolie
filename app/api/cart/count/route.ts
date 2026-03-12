import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ count: 0 });

  const cart = await prisma.cart.findUnique({
    where: { userId: session.user.id },
    include: { items: { select: { quantity: true } } },
  });

  const count = cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
  return NextResponse.json({ count });
}
