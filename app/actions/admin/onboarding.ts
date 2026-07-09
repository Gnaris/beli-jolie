"use server";
/**
 * Server actions pour les MUTATIONS de l'onboarding wizard.
 * Les lectures (getOnboardingStatus, isOnboardingCompleted) sont dans
 * lib/onboarding.ts pour etre utilisables depuis les layouts server.
 */

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

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
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
