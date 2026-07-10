"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

export default function DoneStepButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleFinish = () => {
    startTransition(async () => {
      const res = await completeOnboarding();
      if (res.success) {
        toast.success("Configuration terminée", "Bienvenue dans votre nouvelle boutique 🎉");
        router.push("/admin");
      } else {
        toast.error("Erreur", res.error ?? "Impossible de terminer la configuration.");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleFinish}
      disabled={isPending}
      className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-2xl text-white font-bold text-base shadow-xl bg-gradient-to-br from-emerald-500 to-teal-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isPending ? "Un instant…" : "Ouvrir mon tableau de bord"}
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </button>
  );
}
