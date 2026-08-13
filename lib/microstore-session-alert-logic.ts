/**
 * Microstore — logique pure d'alerte session (extraite du composant React
 * pour pouvoir être testée sans DOM).
 *
 * Seuils demandés par la cliente (2026-08-13) :
 *  - Session BOSS/QR       → alerte à partir de 1 h avant expiration
 *  - Station de transfert  → alerte à partir de 30 min avant expiration
 *
 * En dessous de 0 seconde restante on bascule en état « expired » (barre
 * rouge) — le libellé « expire dans… » n'a plus de sens.
 */

export type MicrostoreSessionKind = "boss" | "pictureStation";
export type MicrostoreAlertLevel = "ok" | "soon" | "expired";

export const MICROSTORE_ALERT_THRESHOLDS_MS: Record<MicrostoreSessionKind, number> = {
  boss: 60 * 60 * 1000,
  pictureStation: 30 * 60 * 1000,
};

/**
 * Retourne l'état d'alerte pour une session Microstore donnée.
 * `expiresAtIso === null` → jamais connecté → toujours "ok" (rien à afficher).
 */
export function getMicrostoreAlertLevel(
  kind: MicrostoreSessionKind,
  expiresAtIso: string | null,
  now: number = Date.now(),
): MicrostoreAlertLevel {
  if (!expiresAtIso) return "ok";
  const expiresAt = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(expiresAt)) return "ok";
  const remaining = expiresAt - now;
  if (remaining <= 0) return "expired";
  if (remaining <= MICROSTORE_ALERT_THRESHOLDS_MS[kind]) return "soon";
  return "ok";
}

/**
 * Formate un delta en millisecondes en libellé court FR pour la barre :
 *  - 2 700 000 ms → "45 min"
 *  - 3 600 000 ms → "1 h"
 *  - 5 400 000 ms → "1 h 30 min"
 *  - <= 0         → "0 min"
 *
 * On ne parle pas en secondes : le rafraîchissement du composant est en
 * minutes, afficher les secondes ferait scintiller la barre.
 */
export function formatMicrostoreRemaining(remainingMs: number): string {
  if (remainingMs <= 0) return "0 min";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

/**
 * Clé localStorage utilisée pour mémoriser qu'un admin a cliqué sur « Fermer »
 * sur une alerte pour une session donnée. La date d'expiration est incluse :
 * dès que la session est renouvelée, la clé change et l'alerte réapparaît
 * — sans avoir besoin de faire du ménage.
 */
export function microstoreDismissKey(
  kind: MicrostoreSessionKind,
  expiresAtIso: string,
): string {
  return `microstore-alert-dismissed:${kind}:${expiresAtIso}`;
}
