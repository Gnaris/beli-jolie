"use client";

import { useState, useTransition } from "react";
import { sendOnboardingTestEmail } from "@/app/actions/admin/onboarding-email-test";
import { useToast } from "@/components/ui/Toast";

export default function EmailTestButton({
  defaultTo,
  disabled = false,
}: {
  defaultTo: string;
  disabled?: boolean;
}) {
  const [to, setTo] = useState(defaultTo);
  const [isPending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const toast = useToast();

  const handleTest = () => {
    if (!to.trim()) {
      toast.warning("Adresse manquante", "Renseignez une adresse email de test.");
      return;
    }
    startTransition(async () => {
      const res = await sendOnboardingTestEmail(to.trim());
      if (res.success) {
        setLastResult({ ok: true, message: `Email envoyé à ${to.trim()}.` });
        toast.success("Envoyé", "Vérifiez votre boîte mail (regardez aussi les indésirables).");
      } else {
        setLastResult({ ok: false, message: res.error ?? "Échec de l'envoi." });
        toast.error("Échec", res.error ?? "Impossible d'envoyer l'email.");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="votre-email@exemple.fr"
          className="flex-1 rounded-xl border border-border bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
          disabled={disabled || isPending}
        />
        <button
          type="button"
          onClick={handleTest}
          disabled={disabled || isPending || !to.trim()}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 text-white font-semibold text-sm shadow hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Envoi…" : "Envoyer un test"}
        </button>
      </div>
      {lastResult && (
        <div
          className={`text-sm rounded-xl px-3 py-2 border ${
            lastResult.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {lastResult.message}
        </div>
      )}
    </div>
  );
}
