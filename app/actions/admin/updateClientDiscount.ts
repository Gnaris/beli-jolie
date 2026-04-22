"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClientDiscountType, ClientDiscountMode } from "@prisma/client";

export interface UpdateClientDiscountInput {
  discountType:         ClientDiscountType | null;
  discountValue:        number | null;
  discountMode:         ClientDiscountMode | null;
  discountMinAmount:    number | null;
  discountMinQuantity:  number | null;
  shippingDiscountType:  ClientDiscountType | null;
  shippingDiscountValue: number | null;
  freeShipping:         boolean;
}

export async function updateClientDiscount(
  userId: string,
  input: UpdateClientDiscountInput
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) return { success: false, error: "Utilisateur introuvable." };
  if (user.role === "ADMIN") return { success: false, error: "Impossible de modifier un administrateur." };

  // Validation — product discount
  if (input.discountType && (input.discountValue == null)) {
    return { success: false, error: "Valeur de remise manquante." };
  }
  if (input.discountType === "PERCENT" && input.discountValue != null) {
    if (input.discountValue <= 0 || input.discountValue > 100) {
      return { success: false, error: "La remise en % doit être entre 0 et 100." };
    }
  }
  if (input.discountType === "AMOUNT" && input.discountValue != null) {
    if (input.discountValue <= 0) {
      return { success: false, error: "La remise en € doit être supérieure à 0." };
    }
  }
  if (input.discountMode === "THRESHOLD") {
    const hasAmount = input.discountMinAmount != null && input.discountMinAmount > 0;
    const hasQty = input.discountMinQuantity != null && input.discountMinQuantity > 0;
    if (!hasAmount && !hasQty) {
      return { success: false, error: "Il faut définir au moins un montant minimum ou un nombre minimum d'articles." };
    }
  }

  // Validation — shipping discount
  if (input.shippingDiscountType && (input.shippingDiscountValue == null)) {
    return { success: false, error: "Valeur de remise livraison manquante." };
  }
  if (input.shippingDiscountType === "PERCENT" && input.shippingDiscountValue != null) {
    if (input.shippingDiscountValue <= 0 || input.shippingDiscountValue > 100) {
      return { success: false, error: "La remise livraison en % doit être entre 0 et 100." };
    }
  }
  if (input.shippingDiscountType === "AMOUNT" && input.shippingDiscountValue != null) {
    if (input.shippingDiscountValue <= 0) {
      return { success: false, error: "La remise livraison en € doit être supérieure à 0." };
    }
  }

  const hasDiscount = !!input.discountType;

  await prisma.user.update({
    where: { id: userId },
    data: {
      discountType:          hasDiscount ? input.discountType : null,
      discountValue:         hasDiscount ? input.discountValue : null,
      discountMode:          hasDiscount ? (input.discountMode ?? "PERMANENT") : null,
      discountMinAmount:     hasDiscount && input.discountMode === "THRESHOLD" ? (input.discountMinAmount ?? null) : null,
      discountMinQuantity:   hasDiscount && input.discountMode === "THRESHOLD" ? (input.discountMinQuantity ?? null) : null,
      discountNextOrderUsed: hasDiscount && input.discountMode === "NEXT_ORDER" ? false : false,
      freeShipping:          input.freeShipping,
      shippingDiscountType:  input.shippingDiscountType ?? null,
      shippingDiscountValue: input.shippingDiscountType ? (input.shippingDiscountValue ?? null) : null,
    },
  });

  revalidatePath(`/admin/utilisateurs/${userId}`);
  return { success: true };
}
