"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Actions admin de gestion du crédit (avoir) d'un client. Le stock est partagé
 * avec le modèle `Credit` déjà utilisé pour les avoirs de facture — même
 * portefeuille, deux origines possibles.
 */

export interface AddClientCreditInput {
  amount: number;
  /** ISO date (yyyy-mm-dd) ou null pour pas d'expiration. */
  expiresAt?: string | null;
  /** Motif libre — visible sur la fiche client admin (max 500 caractères). */
  reason?: string | null;
}

export async function addClientCredit(
  userId: string,
  input: AddClientCreditInput,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
  } catch {
    return { success: false, error: "Accès non autorisé." };
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "Le montant doit être supérieur à 0." };
  }
  if (amount > 100_000) {
    return { success: false, error: "Le montant est trop élevé." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!user) return { success: false, error: "Client introuvable." };
  if (user.role === "ADMIN") return { success: false, error: "Impossible de créditer un administrateur." };

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return { success: false, error: "Date d'expiration invalide." };
    }
    if (parsed.getTime() < Date.now()) {
      return { success: false, error: "La date d'expiration doit être dans le futur." };
    }
    expiresAt = parsed;
  }

  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 500) {
    return { success: false, error: "Le motif ne doit pas dépasser 500 caractères." };
  }

  const credit = await prisma.credit.create({
    data: {
      userId,
      amount,
      remainingAmount: amount,
      expiresAt,
      reason,
    },
  });

  logger.info(
    `[Admin/Credit] Crédit ${credit.id} créé (${amount} €) pour user ${userId}`,
  );

  revalidatePath(`/admin/clients/${userId}`);
  return { success: true };
}

/**
 * Suppression douce : passe le remainingAmount à 0 pour "annuler" le crédit
 * sans supprimer la trace historique. On refuse la suppression si le crédit
 * a déjà été utilisé sur une commande (garde l'auditabilité).
 */
export async function revokeClientCredit(
  creditId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await requireAdmin();
  } catch {
    return { success: false, error: "Accès non autorisé." };
  }

  const credit = await prisma.credit.findUnique({
    where: { id: creditId },
    include: { _count: { select: { usages: true } } },
  });
  if (!credit) return { success: false, error: "Crédit introuvable." };
  if (credit._count.usages > 0) {
    return { success: false, error: "Ce crédit a déjà été utilisé sur une commande — impossible à supprimer." };
  }

  await prisma.credit.update({
    where: { id: creditId },
    data: { remainingAmount: 0 },
  });

  logger.info(`[Admin/Credit] Crédit ${creditId} révoqué (mis à 0)`);
  revalidatePath(`/admin/clients/${credit.userId}`);
  return { success: true };
}
