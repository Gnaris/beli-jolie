"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendAdminPersonalEmailOtp,
  verifyAdminPersonalEmailOtp,
  resetPendingAdminPersonalEmail,
} from "@/app/actions/admin/admin-personal-email";
import type { AdminPersonalEmailState } from "@/app/actions/admin/admin-personal-email-constants";
import { markStepCompleted } from "@/app/actions/admin/onboarding";
import { useToast } from "@/components/ui/Toast";

/**
 * Étape wizard « Mail perso » — s'affiche après provisioning de la boîte pro.
 *
 * Trois modes :
 *   - locked   : mail perso vérifié, verrouillé (juste un récap)
 *   - awaiting : mail saisi + OTP envoyé, en attente de code
 *   - idle     : rien saisi, formulaire prêt
 *
 * Une fois `locked`, l'étape « email » du wizard est marquée complétée et
 * la cliente peut continuer. Un changement ultérieur passera par
 * Paramètres → Messagerie (nouvelle procédure OTP).
 */
export default function AdminPersonalEmailStep({
  initialState,
  defaultSuggestedEmail,
}: {
  initialState: AdminPersonalEmailState;
  /**
   * Mail perso pré-rempli (souvent = adresse de transfert saisie lors du
   * provisioning de la boîte pro). La cliente peut le modifier avant envoi.
   */
  defaultSuggestedEmail?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<AdminPersonalEmailState>(initialState);
  const [email, setEmail] = useState(
    initialState.pendingEmail ?? defaultSuggestedEmail ?? ""
  );
  const [code, setCode] = useState("");

  const isLocked = !!state.verifiedEmail;
  const isAwaiting = !!state.pendingEmail && !isLocked;

  const canSendEmail =
    !!email.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    !isPending;

  const handleSendCode = () => {
    if (!canSendEmail) return;
    startTransition(async () => {
      const res = await sendAdminPersonalEmailOtp(email.trim());
      if (!res.success) {
        toast.error("Envoi impossible", res.error);
        return;
      }
      setState((s) => ({
        ...s,
        pendingEmail: res.email,
        otpExpiresAt: res.expiresAt,
        otpAttempts: 0,
      }));
      setCode("");
      toast.success("Code envoyé", `Vérifiez votre boîte ${res.email}.`);
    });
  };

  const handleVerify = () => {
    const trimmed = code.trim();
    if (trimmed.length < 6) return;
    startTransition(async () => {
      const res = await verifyAdminPersonalEmailOtp(trimmed);
      if (!res.success) {
        toast.error("Code refusé", res.error);
        if (res.code === "expired" || res.code === "too_many_attempts") {
          setState((s) => ({
            ...s,
            pendingEmail: null,
            otpExpiresAt: null,
            otpAttempts: 0,
          }));
        } else {
          setState((s) => ({
            ...s,
            otpAttempts: s.otpAttempts + 1,
          }));
        }
        return;
      }
      setState((s) => ({
        ...s,
        verifiedEmail: res.email,
        verifiedAt: Date.now(),
        pendingEmail: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      }));
      toast.success("E-mail vérifié", "Votre adresse perso est verrouillée.");
      await markStepCompleted("email");
      router.refresh();
    });
  };

  const handleChangeEmail = () => {
    startTransition(async () => {
      await resetPendingAdminPersonalEmail();
      setState((s) => ({
        ...s,
        pendingEmail: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      }));
      setCode("");
    });
  };

  // ══════════════════════════════════════════════════════════════════════
  // MODE VERROUILLÉ
  // ══════════════════════════════════════════════════════════════════════
  if (isLocked) {
    return (
      <section className="rounded-3xl bg-emerald-50/60 border border-emerald-200 p-6 md:p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center text-2xl">
            🔒
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-700 font-semibold mb-1">
              Étape 5 — Votre e-mail perso
            </p>
            <h2 className="font-heading text-xl font-bold text-emerald-900 mb-1 break-all">
              {state.verifiedEmail}
            </h2>
            <p className="text-sm text-emerald-800/90">
              Adresse vérifiée et verrouillée. Vous y recevrez les codes de
              sécurité, les notifications privées et les liens de récupération
              de mot de passe de votre boîte pro.
            </p>
            <p className="text-xs text-emerald-800/70 mt-3">
              Pour la changer plus tard : <strong>Paramètres → Messagerie</strong>{" "}
              (un nouveau code sera envoyé pour confirmer).
            </p>
          </div>
        </div>
      </section>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // MODE ATTENTE DE CODE
  // ══════════════════════════════════════════════════════════════════════
  if (isAwaiting) {
    return (
      <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.18em] text-violet-600 font-semibold mb-3 flex items-center gap-2">
          <span className="w-1 h-3 bg-violet-500 rounded" /> Étape 5 — Confirmez votre e-mail perso
        </p>
        <h2 className="font-heading text-xl font-bold text-text-primary mb-1">
          Un code de 6 chiffres a été envoyé à
        </h2>
        <p className="font-mono text-base text-violet-700 mb-4 break-all">
          {state.pendingEmail}
        </p>
        <p className="text-sm text-text-secondary mb-4">
          Ouvrez ce mail et recopiez le code ci-dessous. Il expire dans 15
          minutes. Si vous ne le voyez pas, vérifiez vos spams.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] mb-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123 456"
            disabled={isPending}
            className="w-full rounded-xl border border-border bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.4em] focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />
          <button
            type="button"
            onClick={handleVerify}
            disabled={isPending || code.trim().length < 6}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-base shadow-md bg-gradient-to-br from-violet-500 to-indigo-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? "…" : "Vérifier"}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
          <button
            type="button"
            onClick={handleSendCode}
            disabled={isPending}
            className="text-sm text-violet-700 hover:text-violet-900 font-medium underline underline-offset-2"
          >
            📧 Renvoyer un code
          </button>
          <span className="text-text-secondary/50">·</span>
          <button
            type="button"
            onClick={handleChangeEmail}
            disabled={isPending}
            className="text-sm text-text-secondary hover:text-text-primary font-medium underline underline-offset-2"
          >
            ✏️ Changer d&apos;adresse
          </button>
        </div>
      </section>
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // MODE SAISIE INITIALE
  // ══════════════════════════════════════════════════════════════════════
  return (
    <section className="rounded-3xl bg-white border border-border p-6 md:p-8 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-violet-600 font-semibold mb-3 flex items-center gap-2">
        <span className="w-1 h-3 bg-violet-500 rounded" /> Étape 5 — Votre e-mail perso
      </p>
      <h2 className="font-heading text-xl font-bold text-text-primary mb-1">
        Une adresse perso pour recevoir les codes de sécurité
      </h2>
      <p className="text-sm text-text-secondary mb-4">
        C&apos;est cette adresse qui recevra les <strong>codes de confirmation</strong>{" "}
        pour les actions importantes (suppression, rafraîchissement…) et le lien
        de <strong>récupération du mot de passe de votre boîte pro</strong> si
        vous le perdez un jour. Elle est indépendante de votre boîte pro pour
        rester joignable même en cas de souci.
      </p>

      <div className="rounded-2xl bg-violet-50 border border-violet-200 p-4 mb-4 text-sm text-violet-900">
        <p className="font-semibold mb-1">🔐 On vous envoie un code pour la vérifier</p>
        <p className="text-violet-900/80">
          Dès que vous cliquez sur « Envoyer le code », un mail arrive sur
          l&apos;adresse saisie. Vous recopiez le code de 6 chiffres et
          l&apos;adresse est verrouillée. Vous pouvez la changer autant de
          fois que vous voulez avant confirmation.
        </p>
      </div>

      <label className="text-sm font-medium text-text-primary mb-1.5 block">
        Votre e-mail personnel <span className="text-rose-500">*</span>
      </label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="votre-nom@gmail.com"
        disabled={isPending}
        className="w-full rounded-xl border border-border bg-white px-4 py-3 text-[15px] focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
      />
      <p className="text-xs text-text-secondary/70 mt-1.5">
        Utilisez une adresse à laquelle vous accédez tous les jours (Gmail,
        iCloud, Orange…). Évitez l&apos;adresse de votre boîte pro : si vous
        perdez son mot de passe, on ne pourra plus vous joindre.
      </p>

      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={handleSendCode}
          disabled={!canSendEmail}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-base shadow-lg bg-gradient-to-br from-violet-500 to-indigo-600 hover:brightness-105 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? "Envoi en cours…" : "📧 Envoyer le code de vérification"}
        </button>
      </div>
    </section>
  );
}
