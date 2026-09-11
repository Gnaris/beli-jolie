"use server";

/**
 * Envoi d'une newsletter à des fiches clients (AdminClientCard).
 *
 * L'envoi passe par la file `BulkMailJob` — cette action **crée le job** puis
 * retourne immédiatement. Le worker `lib/bulk-mail-worker.ts` prend le relais
 * et envoie séquentiellement (300 ms entre chaque mail) tout en mettant à jour
 * le statut de chaque destinataire dans le JSON `recipients`. Le widget
 * « Envoi de mails » du rail admin poll `/api/admin/bulk-mail-jobs` pour
 * afficher la progression ligne par ligne (En attente / En cours / Envoyé /
 * Échoué + message).
 *
 * Différences avec `sendNewsletterToUsers` :
 *  - Cible `AdminClientCard` (fiches admin, pas des comptes User).
 *  - Filtre les fiches sans email — impossible d'envoyer un mail.
 *  - Aucun blocage RGPD par case opt-in : ces contacts B2B viennent des
 *    marketplaces (PFS/Ankor/eFa/…). Le lien de désinscription pointe vers un
 *    mailto à l'email de la boutique (traité par la cliente).
 *
 * Retour :
 *  - `{ success: true, jobId, queued }` — nb de fiches effectivement mises en
 *    file (les fiches sans email sont ignorées et comptées dans `excluded`).
 *  - `{ success: false, error }` — refus (aucun destinataire, modèle inconnu…).
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { enqueueBulkMailJob } from "@/lib/bulk-mail-worker";

export async function sendNewsletterToFiches({
  templateId,
  ficheIds,
}: {
  templateId: string;
  ficheIds: string[];
}): Promise<
  | { success: true; jobId: string; queued: number; excluded: number }
  | { success: false; error: string }
> {
  try {
    if (ficheIds.length === 0) {
      return { success: false, error: "Aucune fiche sélectionnée." };
    }

    const { tenant } = await requireAdmin();

    // 1. Modèle
    const template = await prisma.newsletterTemplate.findFirst({
      where: { id: templateId, tenantId: tenant.id },
      select: { id: true, name: true, subject: true, blocks: true },
    });
    if (!template) return { success: false, error: "Modèle introuvable." };

    const blocks = Array.isArray(template.blocks) ? template.blocks : [];
    if (blocks.length === 0) {
      return { success: false, error: "Le modèle sélectionné est vide (aucun bloc)." };
    }

    // 2. Fiches — filtre email non vide
    const fiches = await prisma.adminClientCard.findMany({
      where: { id: { in: ficheIds }, tenantId: tenant.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        email: true,
      },
    });

    const withEmail = fiches.filter(
      (f): f is typeof f & { email: string } => !!f.email && f.email.trim().length > 0,
    );
    const excludedCount = ficheIds.length - withEmail.length;

    if (withEmail.length === 0) {
      return {
        success: false,
        error:
          excludedCount > 0
            ? `Aucune fiche destinataire valide : ${excludedCount} fiche${excludedCount > 1 ? "s" : ""} sans email.`
            : "Aucune fiche trouvée.",
      };
    }

    // 3. Enqueue — la vraie logique d'envoi vit dans le worker
    const { jobId } = await enqueueBulkMailJob({
      tenantId: tenant.id,
      templateId: template.id,
      templateName: template.name,
      templateSubject: template.subject,
      recipients: withEmail.map((f) => ({
        ficheId: f.id,
        email: f.email,
        name: `${f.firstName} ${f.lastName}`.trim() || f.company || f.email,
      })),
    });

    // Refresh la table côté marketing (la colonne « Dernier mail » va bouger
    // à mesure que le worker avance, mais on rafraîchit une fois côté serveur
    // pour la première mise à jour).
    revalidatePath("/admin/marketing");
    revalidatePath("/admin/clients");

    return {
      success: true,
      jobId,
      queued: withEmail.length,
      excluded: excludedCount,
    };
  } catch (err) {
    logger.error("[sendNewsletterToFiches]", { templateId, error: err as Error });
    return { success: false, error: (err as Error).message };
  }
}
