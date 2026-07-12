/**
 * lib/onboarding.ts
 *
 * Helpers de LECTURE de l'onboarding wizard. Importable depuis n'importe
 * ou (layout, page, server action). Les MUTATIONS sont dans
 * app/actions/admin/onboarding.ts.
 */

import { prisma } from "@/lib/prisma";

export const ONBOARDING_STEPS = [
  "welcome",
  "company",
  "brand",
  "stripe",
  "email",
  "shipping",
  "legal",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_COMPLETED_AT_KEY = "onboarding_completed_at";
export const ONBOARDING_STEPS_COMPLETED_KEY = "onboarding_steps_completed";

export type OnboardingStatus = {
  completedAt: string | null;
  stepsCompleted: OnboardingStep[];
};

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const rows = await prisma.siteConfig.findMany({
    where: {
      key: { in: [ONBOARDING_COMPLETED_AT_KEY, ONBOARDING_STEPS_COMPLETED_KEY] },
    },
  });
  const completedAt = rows.find((r) => r.key === ONBOARDING_COMPLETED_AT_KEY)?.value ?? null;
  const rawSteps = rows.find((r) => r.key === ONBOARDING_STEPS_COMPLETED_KEY)?.value ?? null;

  return { completedAt, stepsCompleted: parseStepsCompleted(rawSteps) };
}

/**
 * Parse la valeur brute de `onboarding_steps_completed`. Exportee pour permettre
 * aux tests d'evaluer la logique sans passer par la BDD.
 */
export function parseStepsCompleted(raw: string | null): OnboardingStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is OnboardingStep =>
      typeof s === "string" && (ONBOARDING_STEPS as readonly string[]).includes(s),
    );
  } catch {
    return [];
  }
}

/** Version rapide : renvoie true si le wizard a deja ete termine (ou skippe). */
export async function isOnboardingCompleted(tenantId?: string | null): Promise<boolean> {
  const row = tenantId
    ? await prisma.siteConfig.findFirst({
        where: { key: ONBOARDING_COMPLETED_AT_KEY, tenantId },
      })
    : await prisma.siteConfig.findFirst({
        where: { key: ONBOARDING_COMPLETED_AT_KEY },
      });
  return !!row?.value;
}
