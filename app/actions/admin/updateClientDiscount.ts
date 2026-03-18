"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClientDiscountType } from "@prisma/client";

export interface UpdateClientDiscountInput {
  discountType:  ClientDiscountType | null;
  discountValue: number | null;
  freeShipping:  boolean;
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

  // Validation
  if (input.discountType && (input.discountValue === null || input.discountValue === undefined)) {
    return { success: false, error: "Valeur de remise manquante." };
  }
  if (input.discountType === "PERCENT" && input.discountValue !== null && input.discountValue !== undefined) {
    if (input.discountValue <= 0 || input.discountValue > 100) {
      return { success: false, error: "La remise en % doit être entre 0 et 100." };
    }
  }
  if (input.discountType === "AMOUNT" && input.discountValue !== null && input.discountValue !== undefined) {
    if (input.discountValue <= 0) {
      return { success: false, error: "La remise en € doit être supérieure à 0." };
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      discountType:  input.discountType,
      discountValue: input.discountType ? input.discountValue : null,
      freeShipping:  input.freeShipping,
    },
  });

  revalidatePath(`/admin/utilisateurs/${userId}`);
  return { success: true };
}
