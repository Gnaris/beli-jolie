"use client";

/**
 * MicrostoreSessionAlerts
 * ─────────────────────────────────────────────────────────────────────────
 * Barre(s) flottante(s) en haut au centre de l'admin, qui préviennent quand
 * une des deux sessions Microstore approche de la fin ou est déjà expirée :
 *  - Session BOSS/QR       : nécessaire pour modifier une fiche produit
 *  - Station de transfert  : nécessaire pour uploader les photos
 *
 * Règles de visibilité :
 *  - Rien si `expiresAt === null` (jamais connecté sur cette session).
 *  - Barre orange « expire dans X min » si dans la fenêtre d'alerte
 *    (1 h pour BOSS, 30 min pour la Station).
 *  - Barre rouge « session expirée » si déjà passé.
 *  - Un bouton « Fermer » masque la barre courante ; dès que l'admin
 *    renouvelle la session, `expiresAt` change → la clé de dismiss change →
 *    la barre réapparaît sur la prochaine session qui arrive à expiration.
 *  - Les deux barres s'empilent verticalement si les deux alertes sont
 *    actives en même temps.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getMicrostoreAlertLevel,
  formatMicrostoreRemaining,
  microstoreDismissKey,
  type MicrostoreSessionKind,
} from "@/lib/microstore-session-alert-logic";

interface Props {
  bossExpiresAtIso: string | null;
  pictureStationExpiresAtIso: string | null;
}

const RENEW_HREF = "/admin/parametres?tab=marketplaces#microstore";

const LABELS: Record<
  MicrostoreSessionKind,
  { title: string; short: string }
> = {
  boss: {
    title: "Session Microstore — fiches produits",
    short: "modification des fiches produits",
  },
  pictureStation: {
    title: "Station de transfert d'images Microstore",
    short: "envoi des photos produits",
  },
};

export default function MicrostoreSessionAlerts({
  bossExpiresAtIso,
  pictureStationExpiresAtIso,
}: Props) {
  // Recalcule le "temps restant" chaque minute pour que la barre glisse toute
  // seule de "1 h" à "59 min", puis à "expirée" — sans reload.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  // Gate le rendu sur l'hydratation : SSR ne peut pas lire localStorage,
  // donc si on rendait tout de suite on afficherait le bandeau (le serveur
  // le considère non-dismiss), puis on le masquerait au premier
  // useEffect → flash « bandeau qui apparaît puis disparaît » signalé par
  // la cliente (2026-08-13). Tant que hydrated = false, on ne rend rien
  // et on laisse le premier useEffect ci-dessous lire localStorage AVANT
  // de laisser le composant s'afficher.
  const [hydrated, setHydrated] = useState(false);

  // On hydrate le dismiss depuis localStorage APRÈS le mount pour éviter un
  // mismatch SSR (pas d'accès à window côté serveur).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const next: Record<string, boolean> = {};
    for (const [kind, iso] of [
      ["boss", bossExpiresAtIso] as const,
      ["pictureStation", pictureStationExpiresAtIso] as const,
    ]) {
      if (!iso) continue;
      const key = microstoreDismissKey(kind, iso);
      if (window.localStorage.getItem(key) === "1") next[key] = true;
    }
    setDismissed(next);
    setHydrated(true);
  }, [bossExpiresAtIso, pictureStationExpiresAtIso]);

  const handleDismiss = useCallback((kind: MicrostoreSessionKind, iso: string) => {
    const key = microstoreDismissKey(kind, iso);
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // localStorage indisponible (mode privé strict) — on masque quand même
      // en mémoire pour la session en cours.
    }
    setDismissed((d) => ({ ...d, [key]: true }));
  }, []);

  const items: Array<{
    kind: MicrostoreSessionKind;
    iso: string;
    level: "soon" | "expired";
    remainingMs: number;
  }> = [];

  for (const [kind, iso] of [
    ["boss", bossExpiresAtIso] as const,
    ["pictureStation", pictureStationExpiresAtIso] as const,
  ]) {
    if (!iso) continue;
    const level = getMicrostoreAlertLevel(kind, iso, now);
    if (level === "ok") continue;
    if (dismissed[microstoreDismissKey(kind, iso)]) continue;
    items.push({
      kind,
      iso,
      level,
      remainingMs: new Date(iso).getTime() - now,
    });
  }

  // Attends la lecture localStorage avant de rendre — évite le flash
  // « bandeau qui apparaît puis disparaît » après un refresh navigateur.
  if (!hydrated) return null;
  if (items.length === 0) return null;

  return (
    <div
      className="fixed left-1/2 top-4 z-[70] flex -translate-x-1/2 flex-col gap-2 w-[min(92vw,640px)]"
      role="region"
      aria-label="Alertes session Microstore"
    >
      {items.map(({ kind, iso, level, remainingMs }) => (
        <MicrostoreAlertBar
          key={`${kind}:${iso}`}
          kind={kind}
          level={level}
          remainingMs={remainingMs}
          onDismiss={() => handleDismiss(kind, iso)}
        />
      ))}
    </div>
  );
}

function MicrostoreAlertBar({
  kind,
  level,
  remainingMs,
  onDismiss,
}: {
  kind: MicrostoreSessionKind;
  level: "soon" | "expired";
  remainingMs: number;
  onDismiss: () => void;
}) {
  const labels = LABELS[kind];
  const isExpired = level === "expired";
  const color = isExpired
    ? "bg-red-50 border-red-300 text-red-900"
    : "bg-amber-50 border-amber-300 text-amber-900";
  const linkColor = isExpired
    ? "bg-red-600 text-white hover:bg-red-700"
    : "bg-amber-600 text-white hover:bg-amber-700";
  const iconColor = isExpired ? "text-red-600" : "text-amber-600";

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border ${color} px-4 py-2.5 shadow-lg backdrop-blur-sm`}
      role="alert"
    >
      <span className={`shrink-0 ${iconColor}`} aria-hidden="true">
        {isExpired ? <IconWarning /> : <IconClock />}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-tight">
        <p className="font-semibold">{labels.title}</p>
        <p className="text-[12px] opacity-90">
          {isExpired ? (
            <>
              Session expirée — l'
              {labels.short}
              {" "}est bloqué tant que vous ne l'aurez pas renouvelée.
            </>
          ) : (
            <>
              Expire dans {formatMicrostoreRemaining(remainingMs)}. Après ça,
              {" l'"}{labels.short} sera bloqué.
            </>
          )}
        </p>
      </div>
      <Link
        href={RENEW_HREF}
        className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${linkColor}`}
      >
        Renouveler
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer l'alerte"
        className="shrink-0 rounded-full p-1.5 hover:bg-black/5"
      >
        <IconClose />
      </button>
    </div>
  );
}

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v3.75m0 3.75h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
