"use server";
/**
 * Server actions pour les MUTATIONS de l'onboarding wizard.
 * Les lectures (getOnboardingStatus, isOnboardingCompleted) sont dans
 * lib/onboarding.ts pour etre utilisables depuis les layouts server.
 */

import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth";
import { revalidatePath, revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ONBOARDING_COMPLETED_AT_KEY,
  ONBOARDING_STEPS,
  ONBOARDING_STEPS_COMPLETED_KEY,
  getOnboardingStatus,
  type OnboardingStep,
} from "@/lib/onboarding";

async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
  return session;
}

async function requireAdmin() {
  await requireAdminSession();
}

/**
 * Marque une etape comme completee. Idempotent : ajouter deux fois la meme
 * etape ne fait rien de plus.
 */
export async function markStepCompleted(
  step: OnboardingStep,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (!(ONBOARDING_STEPS as readonly string[]).includes(step)) {
      return { success: false, error: "Etape inconnue" };
    }
    const current = await getOnboardingStatus();
    if (current.stepsCompleted.includes(step)) {
      return { success: true };
    }
    const next = [...current.stepsCompleted, step];
    await prisma.siteConfig.upsert({
      where: { key: ONBOARDING_STEPS_COMPLETED_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: ONBOARDING_STEPS_COMPLETED_KEY, value: JSON.stringify(next) },
    });
    revalidateTag("site-config", "default");
    revalidatePath("/admin/bienvenue");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/**
 * Marque l'onboarding comme completement termine (etape "done" atteinte
 * ou clic sur "Passer et configurer plus tard"). Enleve la redirection auto
 * vers le wizard pour les prochaines connexions.
 */
export async function completeOnboarding(): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const now = new Date().toISOString();
    await prisma.siteConfig.upsert({
      where: { key: ONBOARDING_COMPLETED_AT_KEY },
      update: { value: now },
      create: { key: ONBOARDING_COMPLETED_AT_KEY, value: now },
    });
    revalidateTag("site-config", "default");
    revalidatePath("/admin");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}

/** Alias explicite pour le bouton "Passer et configurer plus tard". */
export async function skipOnboarding(): Promise<{ success: boolean; error?: string }> {
  return completeOnboarding();
}

/**
 * Change le mot de passe de l'admin connecte. Utilise a l'etape 1 du wizard
 * pour forcer le changement du mdp initial genere par new-shop.sh.
 * Contraintes : min 8 caracteres. Le mdp de la boite mail (Dovecot) reste
 * inchange — l'admin le connait separement.
 */
export async function updateAdminPassword(
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireAdminSession();
    const password = (newPassword ?? "").toString();
    if (password.length < 8) {
      return { success: false, error: "Le mot de passe doit faire au moins 8 caractères." };
    }
    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashed },
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erreur" };
  }
}
