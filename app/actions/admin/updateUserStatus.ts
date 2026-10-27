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
import { checkWhatsappNumberFireAndForget } from "@/lib/whatsapp-check";
import { requireCurrentTenant } from "@/lib/tenant";
import { tenantALS } from "@/lib/tenant-als";
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
    // après l'update, + phone + hasWhatsapp pour déclencher l'auto-check
    // WhatsApp sur la transition PENDING → APPROVED.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        email: true,
        firstName: true,
        status: true,
        phone: true,
        hasWhatsapp: true,
      },
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

    // Préparation des champs annexes selon la transition.
    //  - APPROVED → DEACTIVATED (désactivation manuelle par l'admin) : on
    //    pose deactivatedForInactivityAt pour tracer la date et clear
    //    probationUntil si elle traînait.
    //  - * → APPROVED : on clear les 3 champs d'inactivité pour que le
    //    worker reparte propre (pas de résidu de l'ancien cycle).
    const extraData: {
      deactivatedForInactivityAt?: Date | null;
      inactivityWarningAt?: Date | null;
      probationUntil?: Date | null;
    } = {};
    if (status === "DEACTIVATED" && user.status === "APPROVED") {
      extraData.deactivatedForInactivityAt = new Date();
      extraData.probationUntil = null;
    } else if (status === "APPROVED") {
      extraData.deactivatedForInactivityAt = null;
      extraData.inactivityWarningAt = null;
      extraData.probationUntil = null;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status, ...extraData },
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

        // Approbation d'un nouveau compte : vérifier en arrière-plan si son
        // numéro a WhatsApp (fire-and-forget, no-op silencieux si la session
        // Baileys n'est pas appairée pour ce tenant ou si le numéro est déjà
        // en cache). Le fire-and-forget détache le contexte request Next.js,
        // on wrap donc tenantALS.run pour que le worker voie le bon tenant.
        if (user.hasWhatsapp === null && user.phone) {
          const tenant = await requireCurrentTenant();
          const phone = user.phone;
          const uid = user.id;
          void tenantALS.run(tenant.id, () =>
            checkWhatsappNumberFireAndForget(tenant.id, tenant.slug, phone, uid),
          );
        }
      } else if (status === "REJECTED") {
        // PENDING → REJECTED : refus d'inscription (mail « votre demande »).
        // L'ancienne transition APPROVED → REJECTED (« révocation ») n'est
        // plus proposée par l'UI depuis 2026-10-27 — la désactivation
        // manuelle d'un compte déjà approuvé passe par DEACTIVATED. Si un
        // appelant force quand même REJECTED depuis APPROVED (API directe),
        // on envoie quand même le mail de révocation historique pour
        // ne pas être silencieux.
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
      } else if (status === "DEACTIVATED" && user.status === "APPROVED") {
        // Désactivation manuelle par l'admin — mail « compte désactivé »
        // générique (le même modèle que l'ancienne révocation : factuel,
        // sans mention de durée d'inactivité).
        notifyClientAccountRevoked({
          email: user.email,
          firstName: user.firstName,
        }).catch((err) =>
          logger.error("[updateUserStatus] Email désactivation échoué", {
            error: err,
          }),
        );
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
