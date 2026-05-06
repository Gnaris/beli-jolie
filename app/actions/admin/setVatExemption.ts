"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isEuNonFrance } from "@/lib/vat";

/**
 * Server Action — Bascule l'exonération TVA d'un client.
 *
 * Règle : seuls les clients dont le pays est dans l'UE hors France peuvent
 * être exonérés de TVA française (article 196 directive 2006/112/CE).
 * Les Français paient toujours la TVA, les DOM-TOM et hors UE n'en paient
 * jamais (peu importe ce flag).
 *
 * Quand `exempt = true` : on enregistre `vatValidatedAt` (maintenant) et
 * `vatValidatedBy` (id de l'admin connecté).
 * Quand `exempt = false` : on remet ces champs à null.
 */
export async function setVatExemption(
  userId: string,
  exempt: boolean,
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return { success: false, error: "Accès non autorisé." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, addressCountry: true, vatExempt: true },
  });

  if (!user) return { success: false, error: "Utilisateur introuvable." };
  if (user.role === "ADMIN") {
    return { success: false, error: "Action impossible sur un administrateur." };
  }

  // Sécurité : on n'autorise l'exonération que pour les clients UE hors France.
  if (exempt && !isEuNonFrance(user.addressCountry)) {
    return {
      success: false,
      error:
        "L'exonération TVA n'est applicable qu'aux clients établis dans l'UE hors France.",
    };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        vatExempt: exempt,
        vatValidatedAt: exempt ? new Date() : null,
        vatValidatedBy: exempt ? session.user.id : null,
      },
    });

    revalidatePath(`/admin/utilisateurs/${userId}`);
    revalidatePath("/admin/utilisateurs");

    return { success: true };
  } catch (err) {
    logger.error("[setVatExemption] update failed", {
      error: err instanceof Error ? err.message : String(err),
      userId,
      exempt,
    });
    return { success: false, error: "Une erreur est survenue. Réessayez." };
  }
}
