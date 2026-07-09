"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

export default function WelcomeStartButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleStart = () => {
    startTransition(async () => {
      const res = await markStepCompleted("welcome");
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Impossible de continuer.");
        return;
      }
      router.push("/admin/bienvenue/societe");
    });
  };

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={isPending}
      className="inline-flex items-center gap-2 px-8 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-violet-500 to-indigo-600 hover:brightness-105 transition disabled:opacity-60"
    >
      {isPending ? "Chargement…" : "Commencer la configuration"}
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
      </svg>
    </button>
  );
}
