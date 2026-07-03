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
  shippingDiscountType:      ClientDiscountType | null;
  shippingDiscountValue:     number | null;
  shippingDiscountMode:      ClientDiscountMode | null;
  shippingDiscountMinAmount: number | null;
  shippingDiscountMinQuantity: number | null;
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

  // ── Validation — remise produits ────────────────────────────────────────
  if (input.discountType && input.discountValue == null) {
    return { success: false, error: "Valeur de remise produit manquante." };
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
  if (input.discountType && input.discountMode === "THRESHOLD") {
    const hasAmount = input.discountMinAmount != null && input.discountMinAmount > 0;
    const hasQty    = input.discountMinQuantity != null && input.discountMinQuantity > 0;
    if (!hasAmount && !hasQty) {
      return { success: false, error: "Remise produit : définir un montant ou une quantité minimum." };
    }
  }

  // ── Validation — remise livraison ───────────────────────────────────────
  if (input.shippingDiscountType && input.shippingDiscountValue == null) {
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
  if (input.shippingDiscountType && input.shippingDiscountMode === "THRESHOLD") {
    const hasAmount = input.shippingDiscountMinAmount != null && input.shippingDiscountMinAmount > 0;
    const hasQty    = input.shippingDiscountMinQuantity != null && input.shippingDiscountMinQuantity > 0;
    if (!hasAmount && !hasQty) {
      return { success: false, error: "Remise livraison : définir un montant ou une quantité minimum." };
    }
  }

  const hasDiscount     = !!input.discountType;
  const hasShipDiscount = !!input.shippingDiscountType;

  await prisma.user.update({
    where: { id: userId },
    data: {
      // Remise produits
      discountType:          hasDiscount ? input.discountType : null,
      discountValue:         hasDiscount ? input.discountValue : null,
      discountMode:          hasDiscount ? (input.discountMode ?? "PERMANENT") : null,
      discountMinAmount:     hasDiscount && input.discountMode === "THRESHOLD" ? input.discountMinAmount : null,
      discountMinQuantity:   hasDiscount && input.discountMode === "THRESHOLD" ? input.discountMinQuantity : null,
      discountNextOrderUsed: false,

      // Remise livraison
      freeShipping:                  input.freeShipping,
      shippingDiscountType:          hasShipDiscount ? input.shippingDiscountType : null,
      shippingDiscountValue:         hasShipDiscount ? input.shippingDiscountValue : null,
      shippingDiscountMode:          hasShipDiscount ? (input.shippingDiscountMode ?? "PERMANENT") : null,
      shippingDiscountMinAmount:     hasShipDiscount && input.shippingDiscountMode === "THRESHOLD" ? input.shippingDiscountMinAmount : null,
      shippingDiscountMinQuantity:   hasShipDiscount && input.shippingDiscountMode === "THRESHOLD" ? input.shippingDiscountMinQuantity : null,
      shippingDiscountNextOrderUsed: false,
    },
  });

  revalidatePath(`/admin/utilisateurs/${userId}`);
  return { success: true };
}
