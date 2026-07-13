"use client";

import { useState, useTransition } from "react";
import {
  requestMailboxPasswordResetOtp,
  verifyAndResetMailboxPassword,
} from "@/app/actions/admin/mailbox-password";

interface Props {
  /** Adresse perso configurée (mail_notify_email). null = pas configurée. */
  persoEmail: string | null;
  /** Adresse de la boîte pro (smtp_user). null = pas configurée. */
  mailboxUser: string | null;
}

type Step = "idle" | "otp";

export default function MailboxPasswordResetCard({ persoEmail, mailboxUser }: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [otpId, setOtpId] = useState<string | null>(null);
  const [recipientMasked, setRecipientMasked] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [isRequesting, startRequestTransition] = useTransition();
  const [isConfirming, startConfirmTransition] = useTransition();

  function resetForm() {
    setStep("idle");
    setOtpId(null);
    setRecipientMasked(null);
    setExpiresAt(null);
    setCode("");
    setNewPassword("");
    setNewPasswordConfirm("");
  }

  function handleRequestOtp() {
    setMessage(null);
    startRequestTransition(async () => {
      const result = await requestMailboxPasswordResetOtp();
      if (!result.success) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setOtpId(result.otpId);
      setRecipientMasked(result.recipientMasked);
      setExpiresAt(result.expiresAt);
      setStep("otp");
      setMessage({
        type: "info",
        text: `Un code à 6 chiffres a été envoyé à ${result.recipientMasked}. Il expire dans 15 minutes.`,
      });
    });
  }

  function handleConfirm() {
    if (!otpId) return;
    setMessage(null);
    startConfirmTransition(async () => {
      const result = await verifyAndResetMailboxPassword({
        otpId,
        code: code.trim(),
        newPassword,
        newPasswordConfirm,
      });
      if (!result.success) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      resetForm();
      setMessage({
        type: "success",
        text: `✅ Mot de passe de ${result.mailboxUser} mis à jour. Utilisez-le désormais pour vous connecter à Roundcube. Attention : Roundcube va vous demander de vous reconnecter au prochain rafraîchissement.`,
      });
    });
  }

  const minutesLeft = expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 60000)) : null;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      <div className="p-5 border-b border-zinc-100 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-zinc-900">Changer le mot de passe de la boîte pro</div>
          <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
            {mailboxUser
              ? `Génère un nouveau mot de passe pour ${mailboxUser}. Un code de sécurité sera envoyé à votre email perso ${persoEmail ? `(${persoEmail})` : "(à configurer)"}.`
              : "Aucune boîte mail pro configurée pour cette boutique."}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {step === "idle" && (
          <>
            <div className="text-[12px] text-zinc-600 leading-relaxed bg-zinc-50 border border-zinc-200 rounded-lg p-3">
              🛡️ <strong>Sécurité :</strong> même si quelqu'un vole votre session admin, il ne peut pas changer ce mot de passe sans aussi avoir accès à votre boîte mail perso <strong>{persoEmail || "(non configurée)"}</strong>.
            </div>
            <button
              type="button"
              onClick={handleRequestOtp}
              disabled={isRequesting || !persoEmail || !mailboxUser}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm px-4 py-2.5 transition-colors"
              title={!persoEmail ? "Configurez d'abord un email perso ci-dessus" : ""}
            >
              {isRequesting ? "Envoi du code…" : "Demander un code de réinitialisation"}
            </button>
          </>
        )}

        {step === "otp" && (
          <>
            <div className="text-[12px] text-zinc-600 leading-relaxed bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              📬 Code envoyé à <strong>{recipientMasked}</strong>. Vérifiez votre boîte perso.{" "}
              {minutesLeft !== null && <>Le code expire dans <strong>{minutesLeft} min</strong>.</>}
            </div>

            <div>
              <label className="field-label">Code reçu par mail (6 chiffres)</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="field-input font-mono text-lg tracking-widest text-center w-full"
              />
            </div>

            <div>
              <label className="field-label">Nouveau mot de passe (12–128 caractères)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Un mot de passe fort, unique"
                className="field-input"
              />
            </div>

            <div>
              <label className="field-label">Confirmer le nouveau mot de passe</label>
              <input
                type="password"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                placeholder="Retapez-le pour être sûre"
                className="field-input"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={resetForm}
                disabled={isConfirming}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white text-zinc-700 font-medium text-sm px-4 py-2 hover:bg-zinc-50 disabled:opacity-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirming || code.length !== 6 || newPassword.length < 12 || newPassword !== newPasswordConfirm}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm px-4 py-2 transition-colors"
              >
                {isConfirming ? "Mise à jour…" : "Confirmer le nouveau mot de passe"}
              </button>
            </div>
          </>
        )}

        {message && (
          <div
            className={`rounded-lg px-3 py-2 text-xs font-body leading-relaxed ${
              message.type === "success"
                ? "bg-green-50 text-green-700 border border-green-200"
                : message.type === "error"
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-sky-50 text-sky-700 border border-sky-200"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
