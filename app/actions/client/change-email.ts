"use server";

import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import {
  createEmailChangeToken,
  sendEmailChangeConfirmationEmail,
  sendEmailChangeNoticeToOldEmail,
} from "@/lib/email-change";

const RequestEmailChangeSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Email invalide.").max(180),
  currentPassword: z.string().min(1, "Mot de passe requis."),
});

export type RequestEmailChangeInput = z.infer<typeof RequestEmailChangeSchema>;

type ActionResult =
  | { success: true }
  | { success: false; error: string };

export async function requestEmailChange(
  input: RequestEmailChangeInput,
): Promise<ActionResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false, error: "Non autorisé." };

  const parsed = RequestEmailChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  const rl = rateLimit(`email-change:${session.user.id}`, 5, 60 * 60 * 1000);
  if (!rl.success) {
    return { success: false, error: "Trop de tentatives. Réessayez plus tard." };
  }

  const { newEmail, currentPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, password: true, tenantId: true },
  });
  if (!user) return { success: false, error: "Compte introuvable." };

  if (newEmail === user.email.toLowerCase()) {
    return { success: false, error: "Cet email est déjà le vôtre." };
  }

  const passwordOk = await bcrypt.compare(currentPassword, user.password);
  if (!passwordOk) {
    return { success: false, error: "Mot de passe incorrect." };
  }

  const existing = await prisma.user.findFirst({
    where: { email: newEmail, NOT: { id: user.id } },
    select: { id: true },
  });
  if (existing) {
    return { success: false, error: "Cet email est déjà utilisé par un autre compte." };
  }

  try {
    const { token } = await createEmailChangeToken({
      userId: user.id,
      oldEmail: user.email,
      newEmail,
    });

    await Promise.allSettled([
      sendEmailChangeConfirmationEmail({ userId: user.id, newEmail, token }),
      sendEmailChangeNoticeToOldEmail({
        userId: user.id,
        oldEmail: user.email,
        newEmail,
      }),
    ]);

    return { success: true };
  } catch (err) {
    logger.error("[requestEmailChange] failed", { error: err, userId: user.id });
    return { success: false, error: "Une erreur est survenue. Réessayez." };
  }
}

/**
 * Consomme un token de confirmation et bascule l'email du user.
 * Appelé depuis la page publique /confirmer-email — pas d'auth requise
 * (le token est la preuve d'identité, comme pour le reset mdp).
 */
export async function confirmEmailChange(
  token: string,
): Promise<
  | { success: true; newEmail: string }
  | { success: false; error: string }
> {
  const trimmed = (token ?? "").trim();
  if (!trimmed) return { success: false, error: "Lien invalide." };

  const record = await prisma.emailChangeToken.findUnique({
    where: { token: trimmed },
  });
  if (!record || record.used || record.expiresAt < new Date()) {
    return { success: false, error: "Lien invalide ou expiré." };
  }

  const clash = await prisma.user.findFirst({
    where: { email: record.newEmail, NOT: { id: record.userId } },
    select: { id: true },
  });
  if (clash) {
    await prisma.emailChangeToken.update({
      where: { token: trimmed },
      data: { used: true },
    });
    return {
      success: false,
      error: "Cet email a été pris entre-temps par un autre compte. Contactez-nous.",
    };
  }

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { email: record.newEmail },
      }),
      prisma.emailChangeToken.update({
        where: { token: trimmed },
        data: { used: true },
      }),
    ]);
    return { success: true, newEmail: record.newEmail };
  } catch (err) {
    logger.error("[confirmEmailChange] failed", { error: err, userId: record.userId });
    return { success: false, error: "Une erreur est survenue. Réessayez." };
  }
}
