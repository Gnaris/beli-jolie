"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";
import type { OnboardingStep } from "@/lib/onboarding";

/**
 * Bouton "Continuer" partagé pour toutes les étapes du wizard.
 * Marque l'étape comme complétée puis redirige vers l'étape suivante.
 * Utilisé quand la sauvegarde est déjà faite en amont (auto-save d'un
 * composant enfant, ou étape purement informative).
 */
export default function WizardContinueButton({
  step,
  nextPath,
  label = "Continuer",
  disabled = false,
  className = "",
}: {
  step: OnboardingStep;
  nextPath: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleClick = () => {
    startTransition(async () => {
      const res = await markStepCompleted(step);
      if (!res.success) {
        toast.warning("Étape non validée", res.error ?? "Réessayez.");
        return;
      }
      router.push(nextPath);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isPending}
      className={`inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-violet-500 to-indigo-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {isPending ? "Un instant…" : label}
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </button>
  );
}
