"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkStockAvailability } from "@/lib/stock";
import { revalidatePath } from "next/cache";

export async function reorderFromOrder(orderId: string, mode: "replace" | "merge") {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "CLIENT" || session.user.status !== "APPROVED") {
    return { success: false, error: "Acces non autorise." };
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: session.user.id },
    include: { items: true },
  });

  if (!order) return { success: false, error: "Commande introuvable." };

  let cart = await prisma.cart.findUnique({ where: { userId: session.user.id } });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId: session.user.id } });
  }

  if (mode === "replace") {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  const warnings: string[] = [];
  let addedCount = 0;

  for (const item of order.items) {
    let variantId: string | null = null;

    if (item.variantSnapshot) {
      try {
        const snapshot = JSON.parse(item.variantSnapshot);
        variantId = snapshot.productColorId || snapshot.id || null;
      } catch { /* skip */ }
    }

    if (!variantId) {
      warnings.push(`${item.productName} — variante introuvable`);
      continue;
    }

    const variant = await prisma.productColor.findUnique({
      where: { id: variantId },
      include: { product: { select: { status: true } } },
    });

    if (!variant || variant.product.status !== "ONLINE") {
      warnings.push(`${item.productName} — produit indisponible`);
      continue;
    }

    const { available, currentStock } = await checkStockAvailability(variantId, item.quantity);
    let qty = item.quantity;

    if (!available) {
      if (currentStock <= 0) {
        warnings.push(`${item.productName} — rupture de stock`);
        continue;
      }
      qty = currentStock;
      warnings.push(`${item.productName} — quantite reduite a ${currentStock}`);
    }

    const existing = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    if (existing) {
      const newQty = mode === "merge" ? existing.quantity + qty : qty;
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, variantId, quantity: qty },
      });
    }

    addedCount++;
  }

  revalidatePath("/panier");

  return {
    success: true,
    addedCount,
    warnings,
    message: `${addedCount} article${addedCount > 1 ? "s" : ""} ajoute${addedCount > 1 ? "s" : ""} au panier.`,
  };
}
