/**
 * Helpers purs (0 dép serveur) pour la config relance panier abandonné.
 *
 * Sert au front (validation live dans l'éditeur) et au back (server actions
 * + worker). Une seule source de vérité pour :
 *   - unités de délai (secondes/minutes/heures/jours) et conversions
 *   - validation d'un jeu de stades (délais strictement croissants…)
 *   - détection de la présence du lien de désinscription obligatoire
 */

import { collectBlocksText, type NewsletterBlock } from "@/lib/newsletter-blocks";

export type DelayUnit = "seconds" | "minutes" | "hours" | "days";

export const DELAY_UNIT_LABELS: Record<DelayUnit, { singular: string; plural: string }> = {
  seconds: { singular: "seconde", plural: "secondes" },
  minutes: { singular: "minute", plural: "minutes" },
  hours: { singular: "heure", plural: "heures" },
  days: { singular: "jour", plural: "jours" },
};

/** Précision minimale du worker : moins fin = envoi imprécis, plus fin = charge DB. */
export const WORKER_POLL_INTERVAL_MS = 10_000;

/** Plafond raisonnable côté UI pour éviter les erreurs de saisie catastrophiques. */
export const MAX_STAGES = 10;
/** Un stade minimum de 5 s pour éviter d'envoyer avant que le panier soit persisté. */
export const MIN_DELAY_SECONDS = 5;
/** Plafond à 1 an — passé ça c'est plus une relance panier, c'est un adieu. */
export const MAX_DELAY_SECONDS = 365 * 24 * 3600;

export function toSeconds(value: number, unit: DelayUnit): number {
  switch (unit) {
    case "seconds": return Math.max(0, Math.floor(value));
    case "minutes": return Math.max(0, Math.floor(value)) * 60;
    case "hours":   return Math.max(0, Math.floor(value)) * 3600;
    case "days":    return Math.max(0, Math.floor(value)) * 86400;
  }
}

/**
 * Décompose un nombre de secondes en {value, unit} en choisissant l'unité la
 * plus grande qui permet une valeur entière. Ex : 3600 → {1, "hours"}, 90 →
 * {90, "seconds"} (pas divisible en minutes rondes).
 */
export function fromSeconds(seconds: number): { value: number; unit: DelayUnit } {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return { value: 0, unit: "seconds" };
  if (s % 86400 === 0) return { value: s / 86400, unit: "days" };
  if (s % 3600 === 0)  return { value: s / 3600,  unit: "hours" };
  if (s % 60 === 0)    return { value: s / 60,    unit: "minutes" };
  return { value: s, unit: "seconds" };
}

/** Formate un délai pour affichage humain court : « 2 h 30 min », « 3 j », « 45 s ». */
export function formatDurationShort(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return "0 s";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} j`);
  if (hours > 0) parts.push(`${hours} h`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs} s`);
  return parts.join(" ") || "0 s";
}

/** Formate un délai en pièces pour countdown live : « 2 j 3 h 12 min 45 s ». */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0)  return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

/**
 * Countdown détaillé — affiche toujours les 4 unités (jours / heures /
 * minutes / secondes) avec padding zéros pour ne pas « sauter ». Utilisé
 * dans les vues où on veut vraiment sentir chaque seconde s'écouler.
 * Ex : `0 j 03 h 12 min 45 s` → `0 j 03 h 12 min 44 s` (le champ ne bouge pas).
 */
export function formatCountdownDetailed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return `${days} j ${String(hours).padStart(2, "0")} h ${String(minutes).padStart(2, "0")} min ${String(secs).padStart(2, "0")} s`;
}

// ─── Historique d'envoi ────────────────────────────────────────────────

/**
 * Extrait le dernier stade envoyé depuis un `stagesFired` (JSON stocké dans
 * `AbandonedCartJob`). Retourne `null` si le champ est vide ou mal formé.
 *
 * `existingStageIndices` sert à marquer si le stade fait toujours partie de
 * la config actuelle. Un stade supprimé entre-temps garde son numéro
 * historique + un flag `stillExists=false` pour que la vue affiche
 * « (supprimé) ».
 */
export function extractLastSentFromFired(
  raw: unknown,
  existingStageIndices: Set<number>,
): { stageIndex: number; at: Date; stillExists: boolean } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  // On prend l'entrée au plus grand stageIndex (les stades s'envoient dans
  // l'ordre croissant — donc c'est le dernier envoyé chronologiquement).
  let best: { stageIndex: number; at: string } | null = null;
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const rec = e as Record<string, unknown>;
    const idx = Number(rec.stageIndex);
    const at = typeof rec.sentAt === "string" ? rec.sentAt : "";
    if (!Number.isFinite(idx) || idx <= 0 || !at) continue;
    if (!best || idx > best.stageIndex) best = { stageIndex: idx, at };
  }
  if (!best) return null;
  const parsed = new Date(best.at);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    stageIndex: best.stageIndex,
    at: parsed,
    stillExists: existingStageIndices.has(best.stageIndex),
  };
}

// ─── Validation d'un jeu de stades ─────────────────────────────────────

export interface StageLike {
  stageIndex: number;
  delaySeconds: number;
}

export interface StageValidationError {
  stageIndex: number;
  code:
    | "DELAY_TOO_SMALL"
    | "DELAY_TOO_LARGE"
    | "DELAY_NOT_INCREASING"
    | "MISSING_UNSUBSCRIBE"
    | "MISSING_FOOTER";
  message: string;
}

/**
 * Valide un jeu de stades (délais). Ne prend PAS les templates : voir
 * `validateStageTemplate` pour la validation par template.
 * Contraintes :
 *   - au moins 1 stade
 *   - délais dans [MIN_DELAY_SECONDS, MAX_DELAY_SECONDS]
 *   - délais strictement croissants (stade N+1 > stade N)
 */
export function validateStages(stages: StageLike[]): StageValidationError[] {
  const errors: StageValidationError[] = [];
  if (stages.length === 0) return errors; // « aucun stade » se traduit par « automatisation off » côté server
  const sorted = [...stages].sort((a, b) => a.stageIndex - b.stageIndex);
  let previous = -Infinity;
  for (const s of sorted) {
    if (s.delaySeconds < MIN_DELAY_SECONDS) {
      errors.push({
        stageIndex: s.stageIndex,
        code: "DELAY_TOO_SMALL",
        message: `Stade ${s.stageIndex} : le délai doit être d'au moins ${MIN_DELAY_SECONDS} secondes.`,
      });
    } else if (s.delaySeconds > MAX_DELAY_SECONDS) {
      errors.push({
        stageIndex: s.stageIndex,
        code: "DELAY_TOO_LARGE",
        message: `Stade ${s.stageIndex} : le délai est trop grand (max ${formatDurationShort(MAX_DELAY_SECONDS)}).`,
      });
    }
    if (s.delaySeconds <= previous) {
      errors.push({
        stageIndex: s.stageIndex,
        code: "DELAY_NOT_INCREASING",
        message: `Stade ${s.stageIndex} : le délai doit être plus grand que celui du stade précédent.`,
      });
    }
    previous = s.delaySeconds;
  }
  return errors;
}

// ─── Validation « lien de désinscription obligatoire » ─────────────────

/**
 * Le token du merge tag qu'on impose dans le footer de chaque template de
 * stade. Aligné avec `lib/mail-merge-variables.ts` (`requiredMarketing: true`).
 */
export const UNSUBSCRIBE_TOKEN = "unsubscribeLink";

/**
 * Vérifie qu'un template contient la variable `{unsubscribeLink}` — obligation
 * CNIL/LCEN pour tout mail marketing. On tolère 2 conventions :
 *   - bloc « Pied de page » dédié (`type: "footer"`, convention actuelle)
 *   - blocs `heading` dans le pied (convention historique, encore présente
 *     dans `SCENARIO_DEFAULTS` seedés)
 *
 * Concrètement : on cherche le token dans TOUT le contenu textuel visible du
 * mail via `collectBlocksText`. Si l'admin modifie ensuite le template via
 * l'éditeur newsletter, la validation plus stricte de cet éditeur (bloc
 * footer obligatoire) s'appliquera à la sauvegarde.
 */
export function templateHasUnsubscribeLink(blocks: NewsletterBlock[]): boolean {
  const haystack = collectBlocksText(blocks);
  return haystack.includes(`{${UNSUBSCRIBE_TOKEN}}`);
}
