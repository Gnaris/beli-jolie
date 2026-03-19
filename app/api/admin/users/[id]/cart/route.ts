import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/users/[id]/cart
 * Returns the full cart contents for a given user (admin only).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id: userId } = await params;

  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  reference: true,
                  name: true,
                  colorImages: {
                    select: { path: true, colorId: true, order: true },
                    orderBy: { order: "asc" },
                  },
                },
              },
              color: { select: { id: true, name: true, hex: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!cart) {
    return NextResponse.json({ items: [] });
  }

  const items = cart.items.map((item) => {
    const v = item.variant;
    const image = v.product.colorImages.find((img) => img.colorId === v.color.id);

    // Compute price
    let unitPrice = v.unitPrice;
    if (v.discountType === "PERCENT" && v.discountValue) {
      unitPrice = unitPrice * (1 - v.discountValue / 100);
    } else if (v.discountType === "AMOUNT" && v.discountValue) {
      unitPrice = unitPrice - v.discountValue;
    }
    const lineTotal =
      v.saleType === "PACK" && v.packQuantity
        ? unitPrice * v.packQuantity * item.quantity
        : unitPrice * item.quantity;

    return {
      id: item.id,
      quantity: item.quantity,
      product: {
        id: v.product.id,
        reference: v.product.reference,
        name: v.product.name,
      },
      variant: {
        saleType: v.saleType,
        packQuantity: v.packQuantity,
        unitPrice: v.unitPrice,
        discountType: v.discountType,
        discountValue: v.discountValue,
        stock: v.stock,
        size: v.size,
      },
      color: {
        name: v.color.name,
        hex: v.color.hex,
      },
      image: image?.path ?? null,
      lineTotal: Math.round(lineTotal * 100) / 100,
    };
  });

  const total = items.reduce((sum, i) => sum + i.lineTotal, 0);

  return NextResponse.json({
    items,
    total: Math.round(total * 100) / 100,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
  });
}
