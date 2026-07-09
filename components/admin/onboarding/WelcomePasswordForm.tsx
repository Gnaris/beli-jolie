"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markStepCompleted,
  updateAdminPassword,
} from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

export default function WelcomePasswordForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordsDiffer = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await updateAdminPassword(password);
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Impossible de sauvegarder le mot de passe.");
        return;
      }
      const step = await markStepCompleted("welcome");
      if (!step.success) {
        toast.warning("Mot de passe changé", "Mais impossible de marquer l'étape. Vous pouvez continuer.");
      } else {
        toast.success("Mot de passe mis à jour", "On passe à la suite.");
      }
      router.push("/admin/bienvenue/societe");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium text-text-primary mb-1.5 block flex items-center justify-between">
          <span>Nouveau mot de passe</span>
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="text-xs text-violet-700 hover:underline"
          >
            {showPassword ? "Masquer" : "Afficher"}
          </button>
        </label>
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          placeholder="8 caractères minimum"
        />
        {passwordTooShort && (
          <p className="text-xs text-rose-600 mt-1">Encore {8 - password.length} caractères minimum.</p>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-text-primary mb-1.5 block">
          Confirmer le mot de passe
        </label>
        <input
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          className="w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          placeholder="Retapez le même mot de passe"
        />
        {passwordsDiffer && (
          <p className="text-xs text-rose-600 mt-1">Les deux mots de passe ne correspondent pas.</p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-violet-500 to-indigo-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? "Sauvegarde…" : "Sauvegarder et continuer"}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
      </button>
    </form>
  );
}
