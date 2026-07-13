"use client";

/**
 * <OtpConfirmDialog> + useOtpConfirm()
 *
 * Modale de vérification par code OTP (6 chiffres reçu par mail) avant toute
 * action destructive sur produit (supprimer / rafraîchir / archiver).
 *
 * Trois palettes selon l'action : delete=rose, refresh=sky, archive=amber.
 *
 * Usage :
 *   const otp = useOtpConfirm();
 *   const res = await otp({
 *     action: "delete",
 *     title: "Confirmer la suppression",
 *     message: "Ces produits seront retirés des marketplaces liées.",
 *     productIds: ["id1", "id2"],
 *     productLabels: [{ reference: "A2158-BLC", name: "Boucles..." }, ...],
 *   });
 *   if (res.confirmed) {
 *     await bulkDeleteProducts(ids, res.otp);
 *   }
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  requestAdminActionOtp,
  setAdminActionOtpPause,
} from "@/app/actions/admin/admin-action-otp";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type OtpAction = "delete" | "refresh" | "archive";
export type OtpPauseChoice = "15min" | "1h" | "24h" | null;

export interface OtpProductLabel {
  reference: string;
  name?: string;
}

export interface OtpConfirmOptions {
  action: OtpAction;
  title: string;
  message: string;
  productIds: string[];
  productLabels: OtpProductLabel[];
  /** Libellé du bouton de confirmation (défaut : "Supprimer" / "Rafraîchir" / "Archiver"). */
  confirmLabel?: string;
}

/**
 * Résultat renvoyé par la promise du hook :
 * - `confirmed: false` → l'admin a annulé (ou fermé la modale)
 * - `confirmed: true, otp: null` → une pause est active côté serveur, pas de code demandé
 * - `confirmed: true, otp: {...}` → code vérifié, à passer aux server actions
 */
export type OtpConfirmResult =
  | { confirmed: false }
  | {
      confirmed: true;
      /** À passer tel quel à la server action (bulkDeleteProducts, etc.).
       * `null` si aucune vérif n'a été nécessaire (pause active). */
      otp:
        | null
        | {
            otpId: string;
            code: string;
            pauseChoice?: OtpPauseChoice;
          };
    };

interface OtpConfirmContextValue {
  confirm: (opts: OtpConfirmOptions) => Promise<OtpConfirmResult>;
}

// ─────────────────────────────────────────────
// Config visuelle par action
// ─────────────────────────────────────────────

const ACTION_CONFIG: Record<
  OtpAction,
  {
    iconBg: string;
    iconRing: string;
    iconColor: string;
    barGradient: string;
    haloBg: string;
    infoBg: string;
    infoBorder: string;
    infoText: string;
    inputFocus: string;
    inputRing: string;
    selectFocus: string;
    btnGradient: string;
    btnShadow: string;
    icon: React.ReactNode;
    eyebrow: string;
    defaultConfirm: string;
  }
> = {
  delete: {
    iconBg: "bg-rose-100",
    iconRing: "ring-rose-200",
    iconColor: "text-rose-600",
    barGradient: "bg-gradient-to-r from-rose-400 via-rose-500 to-rose-600",
    haloBg: "bg-rose-400/15",
    infoBg: "bg-rose-50",
    infoBorder: "border-rose-100",
    infoText: "text-rose-900",
    inputFocus: "focus:border-rose-400",
    inputRing: "focus:ring-rose-100",
    selectFocus: "focus:border-rose-400 focus:ring-rose-100",
    btnGradient: "bg-gradient-to-br from-rose-500 to-rose-600",
    btnShadow: "shadow-rose-500/25 hover:shadow-rose-500/40",
    eyebrow: "Sécurité",
    defaultConfirm: "Supprimer",
    icon: (
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    ),
  },
  refresh: {
    iconBg: "bg-sky-100",
    iconRing: "ring-sky-200",
    iconColor: "text-sky-600",
    barGradient: "bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600",
    haloBg: "bg-sky-400/15",
    infoBg: "bg-sky-50",
    infoBorder: "border-sky-100",
    infoText: "text-sky-900",
    inputFocus: "focus:border-sky-400",
    inputRing: "focus:ring-sky-100",
    selectFocus: "focus:border-sky-400 focus:ring-sky-100",
    btnGradient: "bg-gradient-to-br from-sky-500 to-sky-600",
    btnShadow: "shadow-sky-500/25 hover:shadow-sky-500/40",
    eyebrow: "Sécurité",
    defaultConfirm: "Rafraîchir",
    icon: (
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  archive: {
    iconBg: "bg-amber-100",
    iconRing: "ring-amber-200",
    iconColor: "text-amber-600",
    barGradient: "bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600",
    haloBg: "bg-amber-400/15",
    infoBg: "bg-amber-50",
    infoBorder: "border-amber-100",
    infoText: "text-amber-900",
    inputFocus: "focus:border-amber-400",
    inputRing: "focus:ring-amber-100",
    selectFocus: "focus:border-amber-400 focus:ring-amber-100",
    btnGradient: "bg-gradient-to-br from-amber-500 to-amber-600",
    btnShadow: "shadow-amber-500/25 hover:shadow-amber-500/40",
    eyebrow: "Sécurité",
    defaultConfirm: "Archiver",
    icon: (
      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    ),
  },
};

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const OtpConfirmContext = createContext<OtpConfirmContextValue | null>(null);

export function useOtpConfirm(): OtpConfirmContextValue {
  const ctx = useContext(OtpConfirmContext);
  if (!ctx) throw new Error("useOtpConfirm doit être utilisé dans <OtpConfirmProvider>");
  return ctx;
}

// ─────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────

function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function useCountdown(expiresAt: number | null): number {
  const [remaining, setRemaining] = useState<number>(() =>
    expiresAt ? Math.max(0, expiresAt - Date.now()) : 0
  );
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemaining(Math.max(0, expiresAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return remaining;
}

// ─────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────

interface ModalProps {
  opts: OtpConfirmOptions;
  onResult: (r: OtpConfirmResult) => void;
}

function OtpModal({ opts, onResult }: ModalProps) {
  const cfg = ACTION_CONFIG[opts.action];
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  // States :
  //  - "sending"  : envoi initial du mail, spinner
  //  - "ready"    : mail envoyé, l'admin saisit son code
  //  - "verifying": vérification en cours (submit)
  //  - "bypassed" : pause active côté serveur — la promise résout OK direct
  const [state, setState] = useState<"sending" | "ready" | "verifying" | "bypassed">(
    "sending"
  );
  const [otpId, setOtpId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [recipientMasked, setRecipientMasked] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [pauseChoice, setPauseChoice] = useState<OtpPauseChoice>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  // Garde l'envoi initial contre le double-render de React Strict Mode
  // (Next.js dev). Sans ce garde, l'admin recevrait 2 mails par ouverture.
  const initialRequestFiredRef = useRef(false);

  const remaining = useCountdown(expiresAt);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Envoi initial du code
  useEffect(() => {
    if (initialRequestFiredRef.current) return;
    initialRequestFiredRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const r = await requestAdminActionOtp({
          action: opts.action,
          productIds: opts.productIds,
        });
        if (cancelled) return;
        if (!r.success) {
          setError(r.error);
          setState("ready"); // permet le "Renvoyer"
          return;
        }
        if (r.bypassedByPause) {
          setState("bypassed");
          // Résout la promise immédiatement (pas de mail nécessaire)
          setTimeout(() => resolve({ confirmed: true, otp: null }), 400);
          return;
        }
        setOtpId(r.otpId);
        setRecipientMasked(r.recipientMasked);
        setExpiresAt(r.expiresAt);
        setState("ready");
        // Focus la 1ère case après montage
        setTimeout(() => inputsRef.current[0]?.focus(), 100);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Erreur d'envoi.");
        setState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resolve(result: OtpConfirmResult) {
    setClosing(true);
    setTimeout(() => onResult(result), 200);
  }

  // Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") resolve({ confirmed: false });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateDigit(idx: number, raw: string) {
    // Support du collage complet du code
    if (raw.length > 1) {
      const clean = raw.replace(/\D/g, "").slice(0, 6).split("");
      const next = ["", "", "", "", "", ""];
      clean.forEach((d, i) => (next[i] = d));
      setDigits(next);
      const lastFilled = Math.min(clean.length, 6) - 1;
      inputsRef.current[lastFilled + 1]?.focus();
      inputsRef.current[Math.min(lastFilled, 5)]?.focus();
      return;
    }
    const d = raw.replace(/\D/g, "");
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = d;
      return next;
    });
    if (d && idx < 5) inputsRef.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      inputsRef.current[idx + 1]?.focus();
    }
  }

  async function handleResend() {
    setError(null);
    setDigits(["", "", "", "", "", ""]);
    setState("sending");
    try {
      const r = await requestAdminActionOtp({
        action: opts.action,
        productIds: opts.productIds,
      });
      if (!r.success) {
        setError(r.error);
        setState("ready");
        return;
      }
      if (r.bypassedByPause) {
        setState("bypassed");
        setTimeout(() => resolve({ confirmed: true, otp: null }), 400);
        return;
      }
      setOtpId(r.otpId);
      setRecipientMasked(r.recipientMasked);
      setExpiresAt(r.expiresAt);
      setState("ready");
      setTimeout(() => inputsRef.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'envoi.");
      setState("ready");
    }
  }

  async function handleConfirm() {
    const code = digits.join("");
    if (code.length !== 6) {
      setError("Saisissez les 6 chiffres.");
      return;
    }
    if (!otpId) {
      setError("Aucun code en attente. Cliquez sur « Renvoyer ».");
      return;
    }
    setError(null);
    setState("verifying");

    // Si la fréquence a été modifiée, on l'applique côté serveur AVANT
    // de résoudre la promise (comme ça, la pause est déjà posée quand
    // le caller appelle sa server action métier).
    if (pauseChoice) {
      try {
        await setAdminActionOtpPause(pauseChoice);
      } catch {
        // silencieux — la pause est un bonus, pas bloquant
      }
    }

    // On résout la promise en fournissant l'OTP au caller.
    // La vérification serveur (via `guardAdminActionOtp`) se fera lors
    // de la server action métier (bulkDeleteProducts, etc.).
    resolve({
      confirmed: true,
      otp: {
        otpId,
        code,
        pauseChoice: pauseChoice ?? undefined,
      },
    });
  }

  const canConfirm = state === "ready" && digits.every((d) => d);
  const countLabel = `${opts.productIds.length} produit${opts.productIds.length > 1 ? "s" : ""}`;

  const modal = (
    <div
      ref={backdropRef}
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === backdropRef.current;
      }}
      onMouseUp={(e) => {
        if (e.target === backdropRef.current && mouseDownOnBackdrop.current) {
          resolve({ confirmed: false });
        }
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[10001] flex items-center justify-center p-3 sm:p-6 transition-all duration-200 ${
        closing ? "bg-black/0 backdrop-blur-0" : "bg-black/50 backdrop-blur-[3px]"
      }`}
      style={{ animation: closing ? undefined : "otpFadeIn 0.2s ease-out" }}
    >
      <div
        className={`relative w-full max-w-lg rounded-2xl sm:rounded-3xl bg-white shadow-2xl border overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        } ${cfg.infoBorder}`}
        style={{ animation: closing ? undefined : "otpSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Bande dégradée */}
        <div className={`h-1 ${cfg.barGradient}`} />

        {/* Halo décoratif */}
        <div className={`absolute -top-12 -right-12 w-48 h-48 rounded-full blur-3xl ${cfg.haloBg} pointer-events-none`} />

        <div className="relative p-5 sm:p-8">
          {/* Header */}
          <div className="flex items-start gap-3 sm:gap-4 mb-5 sm:mb-6">
            <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl ${cfg.iconBg} ring-1 ${cfg.iconRing} flex items-center justify-center flex-shrink-0 ${cfg.iconColor}`}>
              {cfg.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] uppercase tracking-[0.18em] font-semibold mb-1 ${cfg.iconColor}`}>
                {cfg.eyebrow}
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight">
                {opts.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">{opts.message}</p>
            </div>
          </div>

          {/* Liste refs (si plus d'un produit) */}
          {opts.productLabels.length > 1 && (
            <details className="rounded-xl bg-slate-50 border border-slate-200 mb-5 sm:mb-6" open>
              <summary className="p-3 flex items-center justify-between hover:bg-slate-100 rounded-xl transition cursor-pointer list-none">
                <span className="text-sm font-semibold text-slate-900">
                  Produits concernés ({opts.productLabels.length})
                </span>
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div className="px-3 pb-3 max-h-40 overflow-y-auto space-y-1">
                {opts.productLabels.map((l, i) => (
                  <div
                    key={i}
                    className="text-xs font-mono text-slate-600 py-1 px-2 rounded bg-white border border-slate-100"
                  >
                    {l.reference}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Fiche produit unique */}
          {opts.productLabels.length === 1 && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 mb-5 sm:mb-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-200 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">
                  {opts.productLabels[0].name ?? "Produit"}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  {opts.productLabels[0].reference}
                </div>
              </div>
            </div>
          )}

          {/* Bandeau mail */}
          {state === "bypassed" ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4 mb-5 flex items-start gap-3">
              <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <div className="text-sm text-emerald-900">
                Vérification en pause. L'action va se déclencher directement.
              </div>
            </div>
          ) : (
            <div className={`rounded-xl ${cfg.infoBg} border ${cfg.infoBorder} p-3 sm:p-4 mb-5 flex items-start gap-3`}>
              <svg className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cfg.iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <div className={`text-xs sm:text-sm min-w-0 ${cfg.infoText}`}>
                {state === "sending" ? (
                  <>Envoi du code en cours…</>
                ) : recipientMasked ? (
                  <>
                    Un code à 6 chiffres {opts.productIds.length > 1 ? "pour valider ce lot " : ""}
                    vient d'être envoyé à
                    <br />
                    <span className="font-semibold break-all">{recipientMasked}</span>
                    <div className="text-xs mt-1 opacity-75">Valable 15 minutes.</div>
                    <a
                      href="https://mail.beliandjolie.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white border border-current/20 hover:border-current/40 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                      Ouvrir ma boîte mail
                      <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  </>
                ) : (
                  <>Impossible d'envoyer le code.</>
                )}
              </div>
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-100 p-3 mb-4 text-xs sm:text-sm text-red-900">
              {error}
            </div>
          )}

          {/* Inputs OTP — cachés si bypassed */}
          {state !== "bypassed" && (
            <div className="mb-5">
              <label className="block text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold mb-3">
                Code de vérification
              </label>
              <div className="flex gap-1.5 sm:gap-2 justify-center">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputsRef.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={i === 0 ? 6 : 1}
                    value={d}
                    disabled={state === "sending" || state === "verifying"}
                    onChange={(e) => updateDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    className={`w-11 h-14 sm:w-14 sm:h-16 text-center text-2xl sm:text-3xl font-bold rounded-lg sm:rounded-xl border-2 border-slate-200 bg-white transition ${cfg.inputFocus} focus:outline-none focus:ring-4 ${cfg.inputRing} disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                ))}
              </div>
              <div className="mt-3 flex justify-between items-center text-xs">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={state === "sending" || state === "verifying"}
                  className="text-slate-500 hover:text-slate-700 underline disabled:opacity-50"
                >
                  {state === "sending" ? "Envoi…" : "Renvoyer le code"}
                </button>
                {expiresAt && remaining > 0 && (
                  <span className="text-slate-400">Expire dans {formatCountdown(remaining)}</span>
                )}
              </div>
            </div>
          )}

          {/* Menu déroulant fréquence */}
          {state !== "bypassed" && (
            <div className="mb-5 sm:mb-6">
              <label className="block text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold mb-2">
                Fréquence de vérification
              </label>
              <div className="relative">
                <select
                  value={pauseChoice ?? ""}
                  disabled={state === "sending" || state === "verifying"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPauseChoice(v === "" ? null : (v as OtpPauseChoice));
                  }}
                  className={`w-full appearance-none bg-white border-2 border-slate-200 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 pr-10 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none ${cfg.selectFocus} focus:ring-4 transition disabled:opacity-50`}
                >
                  <option value="">Toujours me prévenir (recommandé)</option>
                  <option value="15min">Pause de 15 minutes</option>
                  <option value="1h">Pause de 1 heure</option>
                  <option value="24h">Pause de 24 heures</option>
                </select>
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-2">
                Une pause désactive la vérification par code pour toutes les suppressions, rafraîchissements et archivages pendant la durée choisie.
              </p>
            </div>
          )}

          {/* Boutons */}
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => resolve({ confirmed: false })}
              className="flex-1 px-4 py-3 rounded-xl bg-white border-2 border-slate-200 text-slate-700 font-semibold hover:bg-slate-50 transition text-sm sm:text-base"
            >
              Annuler
            </button>
            {state !== "bypassed" && (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm}
                className={`flex-1 px-4 py-3 rounded-xl ${cfg.btnGradient} text-white font-semibold shadow-lg ${cfg.btnShadow} transition text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none`}
              >
                {state === "verifying" ? "Vérification…" : opts.confirmLabel ?? cfg.defaultConfirm}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return mounted ? createPortal(modal, document.body) : null;
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function OtpConfirmProvider({ children }: { children: React.ReactNode }) {
  const idRef = useRef(0);
  const [current, setCurrent] = useState<{
    id: number;
    opts: OtpConfirmOptions;
    resolve: (r: OtpConfirmResult) => void;
  } | null>(null);

  const confirmFn = useCallback(
    (opts: OtpConfirmOptions): Promise<OtpConfirmResult> => {
      return new Promise<OtpConfirmResult>((resolve) => {
        const id = ++idRef.current;
        setCurrent({ id, opts, resolve });
      });
    },
    []
  );

  function handleResult(r: OtpConfirmResult) {
    current?.resolve(r);
    setCurrent(null);
  }

  return (
    <OtpConfirmContext.Provider value={{ confirm: confirmFn }}>
      {children}
      {current && (
        <OtpModal key={current.id} opts={current.opts} onResult={handleResult} />
      )}
      <style jsx global>{`
        @keyframes otpFadeIn {
          from { background-color: rgba(0,0,0,0); }
          to   { background-color: rgba(0,0,0,0.5); }
        }
        @keyframes otpSlideUp {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </OtpConfirmContext.Provider>
  );
}
