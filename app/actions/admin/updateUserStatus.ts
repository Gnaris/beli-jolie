"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  notifyClientAccountApproved,
  notifyClientAccountRejected,
} from "@/lib/notifications";
import type { UserStatus } from "@prisma/client";

/**
 * Server Action — Mise à jour du statut d'un compte client
 *
 * Sécurité : vérifie côté serveur que l'appelant est bien ADMIN
 * Utilisée depuis la page /admin/utilisateurs/[id]
 *
 * @param userId  - ID de l'utilisateur à mettre à jour
 * @param status  - Nouveau statut : APPROVED ou REJECTED
 */
export async function updateUserStatus(userId: string, status: UserStatus) {
  // Double vérification de sécurité côté serveur
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }

  // Vérification que l'utilisateur existe — on récupère email/firstName pour
  // pouvoir prévenir le client par email après l'update.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, firstName: true, status: true },
  });

  if (!user) {
    throw new Error("Utilisateur introuvable.");
  }

  // On ne peut pas modifier le statut d'un autre admin
  if (user.role === "ADMIN") {
    throw new Error("Impossible de modifier le statut d'un administrateur.");
  }

  // Mise à jour du statut
  await prisma.user.update({
    where: { id: userId },
    data: { status },
  });

  // Notifier le client par email si le statut change vraiment
  // (fire-and-forget : ne pas bloquer la redirection en cas d'échec SMTP).
  if (user.status !== status) {
    if (status === "APPROVED") {
      notifyClientAccountApproved({
        email: user.email,
        firstName: user.firstName,
      }).catch((err) =>
        logger.error("[updateUserStatus] Email approbation échoué", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } else if (status === "REJECTED") {
      notifyClientAccountRejected({
        email: user.email,
        firstName: user.firstName,
      }).catch((err) =>
        logger.error("[updateUserStatus] Email refus échoué", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  // Revalidation du cache des pages admin concernées
  revalidatePath("/admin/utilisateurs");
  revalidatePath(`/admin/utilisateurs/${userId}`);
  revalidatePath("/admin");

  // Redirection vers la liste
  redirect("/admin/utilisateurs");
}
