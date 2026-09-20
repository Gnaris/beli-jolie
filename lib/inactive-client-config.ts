/**
 * Helpers spécifiques à la relance inactivité + point de départ du timer.
 * Les helpers vraiment génériques (conversion secondes, validation ordre,
 * détection {unsubscribeLink}, extraction du dernier envoyé) sont mutualisés
 * avec la config panier abandonné pour éviter de dupliquer 3 fois la même
 * logique.
 */

import {
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  MAX_STAGES,
  validateStages,
  templateHasUnsubscribeLink,
  extractLastSentFromFired,
  toSeconds,
  fromSeconds,
  formatDurationShort,
  formatCountdown,
  formatCountdownDetailed,
  DELAY_UNIT_LABELS,
  type DelayUnit,
  type StageLike,
  type StageValidationError,
} from "@/lib/abandoned-cart-config";

// Re-export : les vues (éditeur, countdown) tapent sur ces helpers sans se
// soucier de la source. Un jour on pourra les déplacer dans un module partagé
// "mail-stage-shared" mais pour l'instant garder abandoned-cart-config comme
// source de vérité évite un remaniement risqué du panier abandonné (prod).
export {
  MIN_DELAY_SECONDS,
  MAX_DELAY_SECONDS,
  MAX_STAGES,
  validateStages,
  templateHasUnsubscribeLink,
  extractLastSentFromFired,
  toSeconds,
  fromSeconds,
  formatDurationShort,
  formatCountdown,
  formatCountdownDetailed,
  DELAY_UNIT_LABELS,
};
export type { DelayUnit, StageLike, StageValidationError };

/** Précision du worker inactivité : tick toutes les minutes.
 * On pourrait aller à 10 min sans dommage (stades en jours), mais garder 1 min
 * évite les faux « bloqué sur envoi imminent » côté vue admin quand la cliente
 * teste avec des délais courts. Coût : 1 SELECT SiteConfig + 1 SELECT users
 * éligibles par tenant/min — négligeable en prod. */
export const INACTIVE_WORKER_POLL_INTERVAL_MS = 60 * 1000; // 1 min

/** Défaut du Stage 1 à la migration lazy : 30 jours d'inactivité. */
export const DEFAULT_STAGE_1_DELAY_SECONDS = 30 * 86400;

/**
 * Point de départ du timer = « dernière activité connue ». Sert pour TOUS les
 * stades (les délais 30j/45j/60j sont cumulatifs depuis ce point, pas depuis
 * chaque mail précédent). Une visite RÉELLE bumpe lastSeenAt → décalage du
 * timer vers le futur au retour, mais le cycle en cours n'est PAS reset.
 * Le reset complet du cycle (stagesFired vidé) est déclenché uniquement par
 * une commande via `shouldWipeCycle`.
 */
export function computeReferenceAt(user: {
  lastSeenAt: Date | null;
  lastOrderAt: Date | null;
  createdAt: Date;
}): Date {
  const candidates: Date[] = [user.createdAt];
  if (user.lastSeenAt) candidates.push(user.lastSeenAt);
  if (user.lastOrderAt) candidates.push(user.lastOrderAt);
  let latest = candidates[0];
  for (const c of candidates) {
    if (c.getTime() > latest.getTime()) latest = c;
  }
  return latest;
}

/**
 * Fast-forward : trouve le plus haut stade dont le délai est déjà écoulé
 * ET qui n'a pas encore été envoyé. Sert à ne PAS spammer un client
 * anciennement inactif (ex : 1 an sans venir + config 30/45/60j → envoi
 * unique Stade 3, pas 1+2+3). Retourne null si aucun stade n'est dû.
 */
export function pickFastForwardStage<
  S extends { stageIndex: number; delaySeconds: number },
>(stages: S[], elapsedSeconds: number, maxFired: number): S | null {
  let picked: S | null = null;
  for (const s of stages) {
    if (s.stageIndex <= maxFired) continue;
    if (elapsedSeconds < s.delaySeconds) continue;
    if (!picked || s.stageIndex > picked.stageIndex) picked = s;
  }
  return picked;
}

/**
 * Détecte un reset de cycle par commande : si le client a passé commande
 * APRÈS le dernier mail envoyé, on wipe stagesFired et on repart au Stade 1.
 * Une simple visite ne wipe PAS le cycle.
 */
export function shouldWipeCycle(
  lastOrderAt: Date | null,
  lastFiredSentAt: Date | null,
): boolean {
  if (!lastFiredSentAt || !lastOrderAt) return false;
  return lastOrderAt.getTime() > lastFiredSentAt.getTime();
}
