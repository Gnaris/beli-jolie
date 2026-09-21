"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";
import { logger } from "@/lib/logger";
import { AdminProfileSchema, nullifyEmpty } from "@/lib/user-profile-schema";

export interface UpdateClientProfileInput {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
  siret?: string;
  vatNumber?: string;
  addressStreet?: string;
  addressComplement?: string;
  addressZip?: string;
  addressCity?: string;
  addressCountry?: string;
}

/**
 * Server Action — Édite le profil complet d'un client (admin uniquement).
 *
 * Unicité vérifiée par tenant : email et SIRET.
 * Si le N° TVA change, on efface la validation VIES précédente (l'admin
 * devra re-valider l'exonération TVA manuellement si applicable).
 * L'email est modifiable — la session du client reste valide (JWT signé sur
 * l'id, pas l'email), il utilisera la nouvelle adresse à sa prochaine
 * connexion.
 */
export async function updateClientProfile(
  clientId: string,
  data: UpdateClientProfileInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenant } = await requireAdmin();

  const parsed = AdminProfileSchema.safeParse(data);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { success: false, error: firstIssue?.message ?? "Données invalides." };
  }
  const p = parsed.data;

  const target = await prisma.user.findFirst({
    where: { id: clientId, tenantId: tenant.id },
    select: {
      id: true,
      email: true,
      siret: true,
      vatNumber: true,
      role: true,
    },
  });
  if (!target) return { success: false, error: "Client introuvable." };
  if (target.role === "ADMIN") {
    return { success: false, error: "Action impossible sur un administrateur." };
  }

  const newEmail = p.email;
  const newSiret = nullifyEmpty(p.siret);
  const newVat = nullifyEmpty(p.vatNumber);

  // Unicité email par tenant.
  if (newEmail !== target.email) {
    const dup = await prisma.user.findFirst({
      where: { email: newEmail, tenantId: tenant.id, NOT: { id: target.id } },
      select: { id: true },
    });
    if (dup) return { success: false, error: "Cet email est déjà utilisé par un autre compte." };
  }

  // Unicité SIRET par tenant.
  if (newSiret && newSiret !== target.siret) {
    const dup = await prisma.user.findFirst({
      where: { siret: newSiret, tenantId: tenant.id, NOT: { id: target.id } },
      select: { id: true },
    });
    if (dup) return { success: false, error: "Ce SIRET est déjà utilisé par un autre compte." };
  }

  const vatChanged = newVat !== target.vatNumber;
  const emailChanged = newEmail !== target.email;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          firstName: p.firstName,
          lastName: p.lastName,
          email: newEmail,
          company: p.company,
          phone: p.phone,
          siret: newSiret,
          vatNumber: newVat,
          addressStreet: nullifyEmpty(p.addressStreet),
          addressComplement: nullifyEmpty(p.addressComplement),
          addressZip: nullifyEmpty(p.addressZip),
          addressCity: nullifyEmpty(p.addressCity),
          addressCountry: nullifyEmpty(p.addressCountry),
          ...(vatChanged && {
            viesValid: null,
            viesName: null,
            viesAddress: null,
            viesRequestDate: null,
            viesError: null,
            vatExempt: false,
            vatValidatedAt: null,
            vatValidatedBy: null,
          }),
        },
      });

      if (emailChanged) {
        await tx.order.updateMany({
          where: { userId: target.id },
          data: { clientEmail: newEmail },
        });
      }
    });

    revalidatePath(`/admin/clients/${clientId}`);
    revalidatePath("/admin/clients");
    return { success: true };
  } catch (err) {
    logger.error("[updateClientProfile] update failed", {
      error: err,
      clientId,
    });
    return { success: false, error: "Une erreur est survenue. Réessayez." };
  }
}
