"use server";

import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  notifyClientAccountApproved,
  notifyClientAccountRejected,
  notifyClientAccountRevoked,
} from "@/lib/notifications";
import type { UserStatus } from "@prisma/client";

/**
 * Server Action — Mise à jour du statut d'un compte client
 *
 * Sécurité : vérifie côté serveur que l'appelant est bien ADMIN
 * Utilisée depuis la page /admin/clients/[id] via un composant client
 * (`UserStatusActions`) qui gère la navigation post-action côté navigateur.
 *
 * Pas de `redirect()` ici : Next.js 16 déclenche un bug de manifest
 * (`InvariantError: The client reference manifest for route
 * "/admin/clients/[id]" does not exist`) quand une action redirige
 * depuis une route dynamique lourde en composants client → page blanche.
 */
export async function updateUserStatus(
  userId: string,
  status: UserStatus,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "ADMIN") {
      return { success: false, error: "Accès non autorisé." };
    }

    // On récupère email/firstName pour pouvoir prévenir le client par email
    // après l'update.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, firstName: true, status: true },
    });

    if (!user) {
      return { success: false, error: "Utilisateur introuvable." };
    }

    if (user.role === "ADMIN") {
      return {
        success: false,
        error: "Impossible de modifier le statut d'un administrateur.",
      };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status },
    });

    // Notifier le client par email si le statut change vraiment
    // (fire-and-forget : ne pas bloquer la réponse en cas d'échec SMTP).
    if (user.status !== status) {
      if (status === "APPROVED") {
        notifyClientAccountApproved({
          email: user.email,
          firstName: user.firstName,
        }).catch((err) =>
          logger.error("[updateUserStatus] Email approbation échoué", {
            error: err,
          }),
        );
      } else if (status === "REJECTED") {
        // On distingue :
        //  - PENDING → REJECTED : première demande d'inscription refusée
        //    → mail « votre demande d'inscription »
        //  - APPROVED → REJECTED : révocation d'un compte déjà validé
        //    → mail « votre compte a été désactivé »
        if (user.status === "APPROVED") {
          notifyClientAccountRevoked({
            email: user.email,
            firstName: user.firstName,
          }).catch((err) =>
            logger.error("[updateUserStatus] Email révocation échoué", {
              error: err,
            }),
          );
        } else {
          notifyClientAccountRejected({
            email: user.email,
            firstName: user.firstName,
          }).catch((err) =>
            logger.error("[updateUserStatus] Email refus échoué", {
              error: err,
            }),
          );
        }
      }
    }

    revalidatePath("/admin/clients");
    revalidatePath(`/admin/clients/${userId}`);
    revalidatePath("/admin");
    revalidateTag("users", "default");

    return { success: true };
  } catch (err) {
    logger.error("[updateUserStatus] Erreur inattendue", { error: err });
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Une erreur est survenue lors de la mise à jour du statut.",
    };
  }
}
