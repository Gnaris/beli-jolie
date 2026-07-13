"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestPersonalEmailChangeOtp,
  verifyAdminPersonalEmailOtp,
  resetPendingAdminPersonalEmail,
} from "@/app/actions/admin/admin-personal-email";
import { useToast } from "@/components/ui/Toast";

/**
 * Carte « Adresse e-mail où recevoir » de l'onglet Messagerie.
 *
 * Affiche le mail perso verrouillé en lecture seule + bouton Modifier qui
 * ouvre une modale à 2 étapes :
 *   1) Saisie de la nouvelle adresse → envoi d'un code sur l'ANCIENNE
 *   2) Saisie du code 6 chiffres → confirmation + verrouillage
 *
 * L'envoi sur l'ancienne adresse (pas la nouvelle) est une protection
 * anti-vol : un attaquant qui a le panel ne peut pas rediriger les codes
 * OTP futurs vers son propre mail.
 */

interface Props {
  verifiedEmail: string;
  verifiedAt: number | null;
}

type DialogStep = "form" | "code" | null;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(ts: number | null): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export default function PersonalEmailCard({ verifiedEmail, verifiedAt }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<DialogStep>(null);
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");

  const canSubmitNewEmail =
    EMAIL_REGEX.test(newEmail.trim()) &&
    newEmail.trim().toLowerCase() !== verifiedEmail.toLowerCase() &&
    !isPending;

  function openDialog() {
    setNewEmail("");
    setCode("");
    setStep("form");
  }

  function closeDialog() {
    if (isPending) return;
    setStep(null);
    // Nettoie tout OTP en attente s'il en reste un.
    void resetPendingAdminPersonalEmail();
  }

  function handleSendCode() {
    if (!canSubmitNewEmail) return;
    startTransition(async () => {
      const res = await requestPersonalEmailChangeOtp(newEmail.trim());
      if (!res.success) {
        toast.error("Envoi impossible", res.error);
        return;
      }
      setCode("");
      setStep("code");
      toast.success(
        "Code envoyé",
        `Un code à 6 chiffres a été envoyé à ${verifiedEmail}.`
      );
    });
  }

  function handleVerify() {
    const trimmed = code.trim();
    if (trimmed.length < 6) return;
    startTransition(async () => {
      const res = await verifyAdminPersonalEmailOtp(trimmed);
      if (!res.success) {
        toast.error("Code refusé", res.error);
        if (res.code === "expired" || res.code === "too_many_attempts") {
          setStep("form");
          setCode("");
        }
        return;
      }
      toast.success(
        "Adresse mise à jour",
        `Votre nouvel e-mail perso ${res.email} est verrouillé.`
      );
      setStep(null);
      router.refresh();
    });
  }

  const currentEmailDisplay = verifiedEmail || "(aucune)";

  return (
    <>
      {/* Carte principale */}
      <section className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm relative">
        <div
          className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl bg-emerald-300/30 pointer-events-none"
          aria-hidden
        />
        <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-1" />
        <div className="p-4 sm:p-5 relative">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 ring-1 ring-emerald-200 flex items-center justify-center flex-shrink-0">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-5 h-5 text-emerald-700"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 mb-1">
                Vérifiée
              </div>
              <h3 className="font-heading text-[15px] sm:text-base font-bold text-text-primary leading-tight">
                Adresse e-mail où recevoir
              </h3>
              <p className="text-[12.5px] text-text-muted mt-1 leading-snug">
                Codes de sécurité (suppression, rafraîchissement, changement mot
                de passe boîte pro) et notifications de mails non lus.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-bg-secondary rounded-xl border border-border-strong px-3 sm:px-4 py-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                className="w-5 h-5 text-text-muted flex-shrink-0"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 12a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm0 0c0 1.657 1.007 3 2.25 3S21 13.657 21 12a9 9 0 10-2.636 6.364M16.5 12V8.25"
                />
              </svg>
              <span className="font-mono text-text-primary truncate text-sm">
                {currentEmailDisplay}
              </span>
              {verifiedEmail && (
                <span className="badge badge-success shrink-0">Verrouillée</span>
              )}
            </div>
            <button
              type="button"
              onClick={openDialog}
              disabled={!verifiedEmail}
              className="inline-flex items-center gap-2 rounded-lg bg-text-primary hover:bg-text-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                />
              </svg>
              Modifier
            </button>
          </div>

          {verifiedAt && (
            <p className="mt-3 text-[11.5px] text-text-muted">
              Vérifiée le {formatDate(verifiedAt)} · Changement protégé par un
              code envoyé sur cette même adresse.
            </p>
          )}
        </div>
      </section>

      {/* Modale — 2 étapes */}
      {step && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={closeDialog}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-bg-primary rounded-3xl max-w-md w-full shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header aurora */}
            <div className="relative overflow-hidden border-b border-violet-200/60 px-6 py-5 bg-gradient-to-br from-violet-50 via-bg-primary to-white">
              <div
                className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl bg-violet-300/35 pointer-events-none"
                aria-hidden
              />
              <div className="relative flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/80 ring-1 ring-violet-200 flex items-center justify-center flex-shrink-0">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-5 h-5 text-violet-700"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                    />
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-violet-700 font-semibold">
                    Étape {step === "form" ? "1" : "2"} sur 2
                  </div>
                  <h3 className="text-lg font-bold text-text-primary">
                    {step === "form"
                      ? "Nouvelle adresse e-mail"
                      : "Code de vérification"}
                  </h3>
                </div>
              </div>
            </div>

            {/* Body — étape 1 */}
            {step === "form" && (
              <div className="p-6 space-y-4">
                <p className="text-sm text-text-muted">
                  Saisissez la nouvelle adresse. Un code de sécurité sera envoyé
                  sur votre <strong>ancienne</strong> adresse (
                  <span className="font-mono">{verifiedEmail}</span>) pour
                  valider le changement.
                </p>
                <div>
                  <label
                    htmlFor="new-perso-email"
                    className="text-xs font-semibold text-text-primary mb-1 block"
                  >
                    Nouvelle adresse e-mail
                  </label>
                  <input
                    id="new-perso-email"
                    type="email"
                    autoFocus
                    autoComplete="off"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canSubmitNewEmail) {
                        handleSendCode();
                      }
                    }}
                    placeholder="ex. nouvelle-adresse@gmail.com"
                    className="w-full rounded-lg border border-border-strong px-3 py-2 text-sm bg-bg-primary focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeDialog}
                    disabled={isPending}
                    className="rounded-lg bg-bg-primary border border-border-strong hover:bg-bg-secondary text-text-primary text-sm font-semibold px-4 py-2 transition disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={!canSubmitNewEmail}
                    className="rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition"
                  >
                    {isPending ? "Envoi…" : "Envoyer le code"}
                  </button>
                </div>
              </div>
            )}

            {/* Body — étape 2 */}
            {step === "code" && (
              <div className="p-6 space-y-4">
                <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 text-sm text-violet-900">
                  <div className="flex gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                      className="w-5 h-5 flex-shrink-0 mt-0.5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                      />
                    </svg>
                    <div>
                      Code envoyé à{" "}
                      <strong className="font-mono">{verifiedEmail}</strong>.
                      <br />
                      Il expire dans <strong>15 minutes</strong>.
                    </div>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="otp-code"
                    className="text-xs font-semibold text-text-primary mb-1 block"
                  >
                    Code à 6 chiffres
                  </label>
                  <input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && code.length === 6) {
                        handleVerify();
                      }
                    }}
                    placeholder="123456"
                    className="w-full rounded-lg border border-border-strong px-3 py-3 text-center text-2xl tracking-[0.4em] font-bold font-mono bg-bg-primary focus:ring-2 focus:ring-violet-500 focus:border-violet-500 focus:outline-none"
                  />
                </div>
                <div className="text-xs text-text-muted text-center">
                  Vous n'avez pas reçu le code ?{" "}
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={isPending}
                    className="text-violet-700 font-semibold hover:underline disabled:opacity-50"
                  >
                    Renvoyer
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep("form")}
                    disabled={isPending}
                    className="text-sm text-text-muted hover:text-text-primary font-semibold disabled:opacity-50"
                  >
                    ← Retour
                  </button>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeDialog}
                      disabled={isPending}
                      className="rounded-lg bg-bg-primary border border-border-strong hover:bg-bg-secondary text-text-primary text-sm font-semibold px-4 py-2 transition disabled:opacity-50"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={code.length !== 6 || isPending}
                      className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 transition"
                    >
                      {isPending ? "Vérification…" : "Confirmer"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
