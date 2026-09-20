"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { ProfileSchema, nullifyEmpty } from "@/lib/user-profile-schema";

export interface UpdateProfileInput {
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  vatNumber?: string;
  siret?: string;
  addressStreet?: string;
  addressComplement?: string;
  addressZip?: string;
  addressCity?: string;
  addressCountry?: string;
}

export async function updateProfile(
  data: UpdateProfileInput,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await getServerSession(authOptions);
  if (!session) return { success: false, error: "Non autorisé." };

  const parsed = ProfileSchema.safeParse(data);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { success: false, error: firstIssue?.message ?? "Données invalides." };
  }

  const p = parsed.data;
  const newSiret = nullifyEmpty(p.siret);
  const newVat = nullifyEmpty(p.vatNumber);

  // Charge l'état actuel — sert au check unicité SIRET et à la détection
  // du changement de N° TVA (déclenche reset VIES).
  const current = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, siret: true, vatNumber: true, tenantId: true },
  });
  if (!current) return { success: false, error: "Compte introuvable." };

  // Unicité SIRET par tenant (findFirst car @@unique composite).
  if (newSiret && newSiret !== current.siret) {
    const dup = await prisma.user.findFirst({
      where: {
        siret: newSiret,
        tenantId: current.tenantId,
        NOT: { id: current.id },
      },
      select: { id: true },
    });
    if (dup) return { success: false, error: "Ce SIRET est déjà utilisé par un autre compte." };
  }

  const vatChanged = newVat !== current.vatNumber;

  try {
    await prisma.user.update({
      where: { id: current.id },
      data: {
        firstName: p.firstName,
        lastName: p.lastName,
        company: p.company,
        phone: p.phone,
        siret: newSiret,
        vatNumber: newVat,
        addressStreet: nullifyEmpty(p.addressStreet),
        addressComplement: nullifyEmpty(p.addressComplement),
        addressZip: nullifyEmpty(p.addressZip),
        addressCity: nullifyEmpty(p.addressCity),
        addressCountry: nullifyEmpty(p.addressCountry),
        // Si le numéro TVA change, la vérification VIES précédente ne vaut plus.
        // On efface tout — l'admin devra re-valider l'exonération si applicable.
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

    revalidatePath("/espace-pro");
    return { success: true };
  } catch (err) {
    logger.error("[updateProfile] update failed", { error: err, userId: current.id });
    return { success: false, error: "Une erreur est survenue. Réessayez." };
  }
}

/**
 * Bascule la préférence newsletter du client authentifié.
 * Une case unique couvre newsletter + relances panier abandonné + relances
 * inactivité (RGPD + choix cliente). Se désinscrire coupe donc AUSSI toute
 * relance : on force les opt-out à true et on annule les jobs en attente.
 * Se réinscrire remet les opt-out à false — de nouveaux jobs seront créés
 * naturellement au prochain déclencheur (mutation panier / worker inactivité).
 */
export async function setNewsletterPreference(accept: boolean) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non autorise");

  const userId = session.user.id;
  const accepts = Boolean(accept);

  await prisma.user.update({
    where: { id: userId },
    data: {
      acceptsNewsletter: accepts,
      abandonedCartOptOut: !accepts,
      inactiveClientOptOut: !accepts,
    },
  });

  if (!accepts) {
    await Promise.all([
      prisma.abandonedCartJob.updateMany({
        where: { userId, status: "PENDING" },
        data: {
          status: "CANCELLED",
          nextStageAt: null,
          cancelReason: "OPT_OUT",
        },
      }),
      prisma.inactiveClientJob.updateMany({
        where: { userId, status: "PENDING" },
        data: {
          status: "CANCELLED",
          cancelReason: "OPT_OUT",
        },
      }),
    ]);
  }

  revalidatePath("/espace-pro");
  return { success: true, acceptsNewsletter: accepts };
}
