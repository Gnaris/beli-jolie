import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ discount: null });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { discountType: true, discountValue: true, freeShipping: true },
  });

  if (!user?.discountType || !user.discountValue) {
    return NextResponse.json({ discount: null });
  }

  return NextResponse.json({
    discount: {
      discountType: user.discountType,
      discountValue: user.discountValue,
      freeShipping: user.freeShipping,
    },
  });
}
