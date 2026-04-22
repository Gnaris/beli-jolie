import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ discount: null });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      discountType: true, discountValue: true, discountMode: true,
      discountMinAmount: true, discountMinQuantity: true,
      freeShipping: true, shippingDiscountType: true, shippingDiscountValue: true,
    },
  });

  if (!user) return NextResponse.json({ discount: null });

  const hasProductDiscount = !!user.discountType && user.discountValue != null;
  const hasShippingDiscount = !!user.shippingDiscountType || user.freeShipping;

  if (!hasProductDiscount && !hasShippingDiscount) {
    return NextResponse.json({ discount: null });
  }

  return NextResponse.json({
    discount: {
      discountType: user.discountType,
      discountValue: user.discountValue != null ? Number(user.discountValue) : null,
      discountMode: user.discountMode ?? "PERMANENT",
      discountMinAmount: user.discountMinAmount != null ? Number(user.discountMinAmount) : null,
      discountMinQuantity: user.discountMinQuantity,
      freeShipping: user.freeShipping,
      shippingDiscountType: user.shippingDiscountType,
      shippingDiscountValue: user.shippingDiscountValue != null ? Number(user.shippingDiscountValue) : null,
    },
  });
}
