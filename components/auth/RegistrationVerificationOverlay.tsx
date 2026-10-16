"use client";

import { useEffect } from "react";

/**
 * Overlay de vérification affiché pendant / après l'envoi d'une inscription.
 *
 * 4 états sur le même squelette visuel (slate, pastille 72×72, titre Poppins,
 * chip de contexte, bande dégradée en haut) :
 *   - loading  : vérification en cours (SIRET / TVA selon zone)
 *   - success  : compte approuvé automatiquement
 *   - pending  : dossier transmis à l'équipe pour validation manuelle
 *   - rejected : numéro introuvable → inscription refusée
 */
export type VerificationState = "loading" | "success" | "pending" | "rejected";

export type VerificationZone = "FR" | "EU" | "WORLD";

interface Props {
  state: VerificationState;
  zone: VerificationZone;
  /** Nom retourné par le registre (ex : « ACME SARL » depuis VIES). Optionnel. */
  companyName?: string | null;
  /**
   * `true` quand l'état est "pending" à cause d'une panne du service de
   * vérification (annuaire-entreprises ou VIES down). Affiche un message
   * dédié « service indisponible, dossier mis en revue manuelle ».
   */
  serviceErrored?: boolean;
  /** Appelé quand on clique « Fermer » ou « Modifier mes informations ». */
  onClose: () => void;
  /** Appelé au clic sur le CTA principal des états finaux (loading = aucun bouton). */
  onPrimary: () => void;
}

function fiscalLabel(zone: VerificationZone): string {
  if (zone === "FR") return "SIRET";
  if (zone === "EU") return "numéro de TVA intracommunautaire";
  return "numéro d'entreprise";
}

function registryLabel(zone: VerificationZone): string {
  if (zone === "FR") return "Connexion à l'annuaire des entreprises";
  if (zone === "EU") return "Connexion au registre européen VIES";
  return "Connexion au registre officiel";
}

export default function RegistrationVerificationOverlay({
  state, zone, companyName, serviceErrored, onClose, onPrimary,
}: Props) {
  // Bloque le scroll de la page en-dessous tant que l'overlay est ouvert.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const label = fiscalLabel(zone);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="verif-title"
      className="fixed inset-0 z-[100] grid place-items-center p-5 bg-[rgba(15,23,42,0.55)] backdrop-blur-[6px]"
    >
      <div className="w-full max-w-[460px] bg-bg-primary border border-border rounded-3xl overflow-hidden shadow-2xl">
        {/* Bande dégradée haute — couleur selon l'état */}
        <div className={`h-1 ${TOP_BAR[state]}`} />

        <div className="px-8 pt-9 pb-7 text-center">
          {/* Pastille icône — 72×72 identique sur les 4 états */}
          <div className={`relative inline-grid place-items-center w-[72px] h-[72px] rounded-[20px] border mx-auto mb-5 ${TILE_BG[state]}`}>
            {state === "loading" && (
              <span
                aria-hidden="true"
                className="absolute -inset-2 rounded-[24px] border border-slate-400/50 animate-[ping_1.6s_ease-out_infinite]"
              />
            )}
            {state === "loading" && <LoadingIcon />}
            {state === "success" && <SuccessIcon />}
            {state === "pending" && <PendingIcon />}
            {state === "rejected" && <RejectedIcon />}
          </div>

          {/* Titre + corps du message, dépendent de l'état et de la zone */}
          <h3 id="verif-title" className="font-heading text-xl font-bold text-text-primary leading-tight mb-2.5">
            {state === "loading" && "Nous vérifions votre société…"}
            {state === "success" && "Votre compte a été vérifié avec succès"}
            {state === "pending" && (serviceErrored
              ? "Service de vérification indisponible"
              : "Votre inscription est validée")}
            {state === "rejected" && "Votre inscription a été refusée"}
          </h3>
          <p className="font-body text-[14.5px] leading-[1.55] text-text-secondary max-w-[360px] mx-auto">
            {state === "loading" && (
              <>Un instant, nous interrogeons le registre officiel pour valider votre <strong className="font-semibold text-text-primary">{label}</strong>. Ça prend quelques secondes.</>
            )}
            {state === "success" && (
              <>Nous avons retrouvé votre société dans le registre officiel. Vous pouvez dès maintenant <strong className="font-semibold text-text-primary">vous connecter</strong> et accéder au catalogue professionnel.</>
            )}
            {state === "pending" && !serviceErrored && (
              <>Un administrateur a été <strong className="font-semibold text-text-primary">notifié</strong> pour vérifier votre compte. Vous recevrez un email dès que votre accès sera activé.</>
            )}
            {state === "pending" && serviceErrored && (
              <>Le registre officiel est <strong className="font-semibold text-text-primary">momentanément indisponible</strong>. Votre dossier est bien enregistré — un administrateur l'examinera dès que possible et vous recevrez un email.</>
            )}
            {state === "rejected" && (
              <>Les informations que vous avez saisies sont <strong className="font-semibold text-text-primary">introuvables dans le registre</strong>. Vérifiez votre {label} ou contactez-nous si vous pensez qu'il s'agit d'une erreur.</>
            )}
          </p>

          {/* Chip de contexte — statique sauf chargement (dot clignotante) */}
          <ChipLine
            state={state}
            label={state === "loading"
              ? registryLabel(zone)
              : state === "success"
                ? (companyName ? `${label.toUpperCase()} valide · ${companyName}` : `${label} valide`)
                : state === "pending"
                  ? (serviceErrored ? "Vérification reportée en revue manuelle" : "Dossier transmis à l'équipe")
                  : `${label} introuvable au registre`}
          />

          {/* Étapes — chargement uniquement */}
          {state === "loading" && (
            <div className="mt-4 grid gap-1.5 max-w-[320px] mx-auto text-left">
              <Step done>Informations transmises</Step>
              <Step active>Interrogation du registre officiel…</Step>
              <Step>Analyse de la réponse</Step>
            </div>
          )}

          {/* Boutons — tout sauf chargement.
              success + pending → 1 seul bouton « Fermer » qui redirige vers
              l'accueil (compte déjà créé + auto-signin déclenché côté form).
              rejected → 2 boutons pour laisser le choix de corriger ou de
              quitter la page. */}
          {state === "success" && (
            <div className="flex justify-center mt-6 pt-5 border-t border-border">
              <button
                type="button"
                onClick={onPrimary}
                className="h-11 px-6 rounded-xl font-body font-semibold text-sm bg-bg-dark text-text-inverse border border-bg-dark hover:bg-[#1e293b] transition"
              >
                Fermer
              </button>
            </div>
          )}
          {state === "pending" && (
            <div className="flex justify-center mt-6 pt-5 border-t border-border">
              <button
                type="button"
                onClick={onPrimary}
                className="h-11 px-6 rounded-xl font-body font-semibold text-sm bg-bg-dark text-text-inverse border border-bg-dark hover:bg-[#1e293b] transition"
              >
                Fermer
              </button>
            </div>
          )}
          {state === "rejected" && (
            <div className="flex gap-2.5 justify-center mt-6 pt-5 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                className="h-11 px-5 rounded-xl font-body font-semibold text-sm text-text-primary border border-border-strong hover:bg-bg-secondary transition"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={onPrimary}
                className="h-11 px-5 rounded-xl font-body font-semibold text-sm bg-bg-dark text-text-inverse border border-bg-dark hover:bg-[#1e293b] transition"
              >
                Modifier mes informations
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TOP_BAR: Record<VerificationState, string> = {
  loading: "bg-gradient-to-r from-slate-500 to-slate-900",
  success: "bg-gradient-to-r from-emerald-300 to-emerald-700",
  pending: "bg-gradient-to-r from-slate-400 to-slate-700",
  rejected: "bg-gradient-to-r from-rose-300 to-rose-700",
};

const TILE_BG: Record<VerificationState, string> = {
  loading: "bg-gradient-to-b from-slate-50 to-slate-200 border-slate-300",
  success: "bg-gradient-to-b from-emerald-50 to-emerald-100 border-emerald-200",
  pending: "bg-gradient-to-b from-slate-50 to-slate-200 border-slate-300",
  rejected: "bg-gradient-to-b from-rose-50 to-rose-100 border-rose-200",
};

function ChipLine({ state, label }: { state: VerificationState; label: string }) {
  const dot =
    state === "loading"  ? "bg-slate-700 animate-pulse" :
    state === "success"  ? "bg-emerald-500" :
    state === "pending"  ? "bg-amber-500" :
                           "bg-rose-500";
  return (
    <div className="inline-flex items-center gap-2 mt-4 px-3 py-1.5 rounded-full bg-bg-secondary border border-border text-xs font-medium text-text-secondary">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span>{label}</span>
    </div>
  );
}

function Step({ done, active, children }: { done?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2.5 text-[12.5px] ${done || active ? "text-text-primary" : "text-text-muted"} ${active ? "font-medium" : ""}`}>
      <span className={`relative inline-grid place-items-center w-3.5 h-3.5 rounded-full border-[1.5px] flex-none ${
        done ? "border-emerald-500 bg-emerald-500" :
        active ? "border-slate-700" :
        "border-border-strong"
      }`}>
        {done && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
        {active && (
          <span className="absolute -inset-1 rounded-full border-2 border-slate-700/35 border-t-transparent animate-spin" />
        )}
      </span>
      <span>{children}</span>
    </div>
  );
}

/* ─── Icônes ─────────────────────────────────────────────────────────── */

function LoadingIcon() {
  return (
    <svg className="w-9 h-9 text-slate-700 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a9 9 0 0 1 9 9" opacity="0.9" />
      <path d="M12 3a9 9 0 0 0-9 9" opacity="0.15" />
      <path d="M21 12a9 9 0 0 1-9 9" opacity="0.5" />
      <path d="M3 12a9 9 0 0 0 9 9" opacity="0.15" />
    </svg>
  );
}
function SuccessIcon() {
  return (
    <svg className="w-9 h-9 text-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
    </svg>
  );
}
function PendingIcon() {
  return (
    <svg className="w-9 h-9 text-slate-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3 2" />
    </svg>
  );
}
function RejectedIcon() {
  return (
    <svg className="w-9 h-9 text-rose-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m9.5 9.5 5 5m0-5-5 5" />
    </svg>
  );
}
