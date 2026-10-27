/**
 * Configuration pure (module sans dépendance serveur) pour la désactivation
 * automatique des clients inactifs.
 *
 * Règle métier figée avec la cliente (2026-10-27) :
 *  - On regarde UNIQUEMENT la dernière commande (pas la connexion).
 *  - Clients jamais commandé : on compte depuis `createdAt`.
 *  - Après `warningDays` sans commande, le client reçoit un mail
 *    d'avertissement. `graceDays` plus tard sans nouvelle commande, son
 *    statut passe APPROVED → DEACTIVATED (le client peut encore se connecter
 *    et parcourir, mais plus voir les prix).
 *  - La réactivation est MANUELLE (admin). À la réactivation, l'admin pose
 *    une période de probation (`probationDays` jours) : si le client ne
 *    commande pas d'ici là, il repasse DEACTIVATED immédiatement (pas de
 *    nouvel avertissement, il a été prévenu lors de la réactivation).
 *  - Si le client commande pendant la probation, probationUntil est levée
 *    et il repart dans le cycle normal (365 jours à partir de sa commande).
 *
 * Clés SiteConfig (par tenant) :
 *  - inactive_revoke_enabled        : "true" | "false"
 *  - inactive_revoke_warning_days   : int ≥ 1
 *  - inactive_revoke_grace_days     : int ≥ 1
 *  - inactive_revoke_probation_days : int ≥ 1
 */

export const INACTIVE_REVOKE_ENABLED_KEY = "inactive_revoke_enabled";
export const INACTIVE_REVOKE_WARNING_DAYS_KEY = "inactive_revoke_warning_days";
export const INACTIVE_REVOKE_GRACE_DAYS_KEY = "inactive_revoke_grace_days";
export const INACTIVE_REVOKE_PROBATION_DAYS_KEY = "inactive_revoke_probation_days";

export const INACTIVE_REVOKE_MIN_WARNING_DAYS = 1;
export const INACTIVE_REVOKE_MAX_WARNING_DAYS = 36500;
export const INACTIVE_REVOKE_MIN_GRACE_DAYS = 1;
export const INACTIVE_REVOKE_MAX_GRACE_DAYS = 3650;
export const INACTIVE_REVOKE_MIN_PROBATION_DAYS = 1;
export const INACTIVE_REVOKE_MAX_PROBATION_DAYS = 3650;

/** Tick du worker : les délais sont en jours, 1h suffit largement. */
export const INACTIVE_REVOKE_POLL_INTERVAL_MS = 60 * 60 * 1000;

export interface InactiveRevokeSettings {
  enabled: boolean;
  warningDays: number | null;
  graceDays: number | null;
  probationDays: number | null;
}

/**
 * Parse une chaîne SiteConfig en entier positif borné. Renvoie null si
 * absent, non entier, ou hors bornes.
 */
export function parseDaysSetting(
  raw: string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

export function parseWarningDays(raw: string | null | undefined): number | null {
  return parseDaysSetting(
    raw,
    INACTIVE_REVOKE_MIN_WARNING_DAYS,
    INACTIVE_REVOKE_MAX_WARNING_DAYS,
  );
}

export function parseGraceDays(raw: string | null | undefined): number | null {
  return parseDaysSetting(
    raw,
    INACTIVE_REVOKE_MIN_GRACE_DAYS,
    INACTIVE_REVOKE_MAX_GRACE_DAYS,
  );
}

export function parseProbationDays(raw: string | null | undefined): number | null {
  return parseDaysSetting(
    raw,
    INACTIVE_REVOKE_MIN_PROBATION_DAYS,
    INACTIVE_REVOKE_MAX_PROBATION_DAYS,
  );
}

/**
 * Vrai si l'automatisation est pleinement configurée : enabled + les 3
 * délais présents. Pré-requis du worker. Si probationDays manque,
 * l'avertissement/désactivation marche mais la réactivation côté UI est
 * refusée (côté server action).
 */
export function isRevocationActive(settings: InactiveRevokeSettings): boolean {
  return (
    settings.enabled &&
    settings.warningDays !== null &&
    settings.graceDays !== null
  );
}

/**
 * Référence du compteur d'inactivité : date de la dernière commande, ou à
 * défaut date de création du compte (règle métier : jamais commandé = inactif
 * depuis inscription).
 */
export function computeInactivityReferenceAt(params: {
  lastOrderAt: Date | null;
  createdAt: Date;
}): Date {
  return params.lastOrderAt ?? params.createdAt;
}

/**
 * Phase d'un client vis-à-vis du cycle de désactivation. Pur, sans effet de
 * bord. Appelé par le worker ET par les vues admin pour afficher l'état en
 * direct.
 *
 * Priorités (de la plus prioritaire à la moins) :
 *  1. PROBATION_EXPIRED : client APPROVED avec probationUntil dépassée et
 *     aucune commande depuis la pose de la probation → re-désactivation directe.
 *  2. PROBATION_ACTIVE  : client APPROVED en période de probation en cours.
 *  3. (hors probation) WARNING_DUE / GRACE / REVOKE_DUE / ACTIVE comme avant.
 */
export type RevokePhase =
  | "ACTIVE" // commande récente, rien à faire
  | "WARNING_DUE" // dépasse warningDays, pas encore averti → envoyer avertissement
  | "GRACE" // averti, dans la fenêtre de grâce → attendre
  | "REVOKE_DUE" // averti + grâce dépassée → désactiver
  | "PROBATION_ACTIVE" // réactivé, probation en cours — rien à faire
  | "PROBATION_EXPIRED"; // probation dépassée sans commande → re-désactiver direct

export interface ComputePhaseInput {
  now: Date;
  referenceAt: Date;
  inactivityWarningAt: Date | null;
  probationUntil: Date | null;
  warningDays: number;
  graceDays: number;
  /**
   * Durée de probation actuellement configurée. Sert à retrouver la date
   * approximative de pose de la probation (= probationUntil - probationDays).
   * Si la cliente change probationDays après la pose, l'estimation sera
   * biaisée de quelques jours — acceptable en pratique.
   */
  probationDays: number;
}

/**
 * Vrai si une commande (referenceAt) a eu lieu APRÈS la pose de la probation.
 * On estime la pose via `probationUntil - probationDays`. Exporté pour tests.
 */
export function hasOrderedDuringProbation(input: {
  referenceAt: Date;
  probationUntil: Date;
  probationDays: number;
}): boolean {
  const probationStartedMs =
    input.probationUntil.getTime() - input.probationDays * 86_400_000;
  return input.referenceAt.getTime() >= probationStartedMs;
}

export function computeRevokePhase(input: ComputePhaseInput): RevokePhase {
  const { now, referenceAt, inactivityWarningAt, probationUntil } = input;

  // Branche probation : prioritaire si probationUntil est posée.
  if (probationUntil !== null) {
    const orderedDuring = hasOrderedDuringProbation({
      referenceAt,
      probationUntil,
      probationDays: input.probationDays,
    });
    if (orderedDuring) {
      // Commande passée pendant la probation → le client revient dans le
      // cycle normal. Le worker va clear probationUntil et repartir sur le
      // compteur warningDays à partir de referenceAt (= la nouvelle commande).
      return "ACTIVE";
    }
    if (now.getTime() >= probationUntil.getTime()) {
      return "PROBATION_EXPIRED";
    }
    return "PROBATION_ACTIVE";
  }

  const warningThresholdMs = input.warningDays * 86_400_000;
  const graceThresholdMs = input.graceDays * 86_400_000;
  const inactiveSinceMs = now.getTime() - referenceAt.getTime();

  // Wipe implicite : si une commande (= referenceAt récent) est postérieure à
  // l'avertissement, l'avertissement est caduc — on le traite comme non envoyé.
  const warningStillValid =
    inactivityWarningAt !== null &&
    inactivityWarningAt.getTime() >= referenceAt.getTime();

  if (!warningStillValid) {
    return inactiveSinceMs >= warningThresholdMs ? "WARNING_DUE" : "ACTIVE";
  }

  // Averti et toujours inactif → suivre la fenêtre de grâce.
  const sinceWarningMs = now.getTime() - inactivityWarningAt!.getTime();
  return sinceWarningMs >= graceThresholdMs ? "REVOKE_DUE" : "GRACE";
}

/**
 * Jours entiers d'inactivité (floor), pour l'affichage dans le mail et dans
 * les logs. Jamais négatif.
 */
export function daysBetween(now: Date, past: Date): number {
  const ms = now.getTime() - past.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}
