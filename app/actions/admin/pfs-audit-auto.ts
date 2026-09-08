"use server";

/**
 * Server actions pour la config d'audit PFS automatique + la lecture du
 * journal historique affiché dans le drawer.
 *
 *   - getPfsAuditAutoConfigAction  : lit toggle + intervalle + email.
 *   - setPfsAuditAutoConfigAction  : écrit la config (toggle ON/OFF + intervalle).
 *   - getPfsAuditHistoryAction     : liste des derniers runs (pour l'onglet Historique).
 *   - getPfsAuditRunDetailsAction  : détail avant/après d'un run donné.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireCurrentTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { setSiteConfig, unsetSiteConfig } from "@/lib/site-config-write";
import {
  KEY_AUTO_ENABLED,
  KEY_AUTO_INTERVAL_SECONDS,
  KEY_AUTO_INTERVAL_HOURS,
  KEY_AUTO_ALERT_EMAIL,
  KEY_AUTO_LAST_RUN_AT,
  KEY_AUTO_PAUSED_AT,
  KEY_AUDIT_AWAITING_PROPAGATIONS,
  MIN_AUTO_INTERVAL_SECONDS,
  resolveIntervalSeconds,
} from "@/lib/pfs-audit-runner";
import {
  listPfsAuditHistoryRuns,
  getPfsAuditRunDetails,
  type PfsAuditHistoryRunSummary,
  type PfsAuditHistoryProductDetail,
} from "@/lib/pfs-audit-history";
import { PFS_AUDIT_SCHEDULER_TICK_MS } from "@/lib/pfs-audit-scheduler";
import { logger } from "@/lib/logger";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
}

export interface PfsAuditAutoConfig {
  enabled: boolean;
  /** Intervalle total en secondes (source de vérité). */
  intervalSeconds: number;
  /** Décomposition en jours/heures/minutes/secondes pour l'UI. */
  breakdown: { days: number; hours: number; minutes: number; seconds: number };
  alertEmail: string;
  lastRunAt: number | null;
}

function breakdownSeconds(total: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const t = Math.max(0, Math.floor(total));
  const days = Math.floor(t / 86400);
  const hours = Math.floor((t % 86400) / 3600);
  const minutes = Math.floor((t % 3600) / 60);
  const seconds = t % 60;
  return { days, hours, minutes, seconds };
}

export async function getPfsAuditAutoConfigAction(): Promise<
  { success: true; config: PfsAuditAutoConfig } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const rows = await prisma.siteConfig.findMany({
      where: {
        tenantId: tenant.id,
        key: {
          in: [
            KEY_AUTO_ENABLED,
            KEY_AUTO_INTERVAL_SECONDS,
            KEY_AUTO_INTERVAL_HOURS,
            KEY_AUTO_ALERT_EMAIL,
            KEY_AUTO_LAST_RUN_AT,
          ],
        },
      },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const intervalSeconds = resolveIntervalSeconds(rows);
    const lastRunRaw = Number(map.get(KEY_AUTO_LAST_RUN_AT) ?? "0");
    return {
      success: true,
      config: {
        enabled: map.get(KEY_AUTO_ENABLED) === "1",
        intervalSeconds,
        breakdown: breakdownSeconds(intervalSeconds),
        alertEmail: (map.get(KEY_AUTO_ALERT_EMAIL) ?? "").trim(),
        lastRunAt: Number.isFinite(lastRunRaw) && lastRunRaw > 0 ? lastRunRaw : null,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PfsAuditAutoConfigInput {
  enabled: boolean;
  /** Total en secondes calculé côté UI depuis 4 champs jour/heure/min/sec. */
  intervalSeconds: number;
  alertEmail: string;
}

// Borne haute lâche : 90 jours (rétention de l'historique) = évite de saisir
// un intervalle si long que rien ne se déclenche pendant plusieurs mois.
const MAX_AUTO_INTERVAL_SECONDS = 90 * 24 * 3600;

export async function setPfsAuditAutoConfigAction(
  input: PfsAuditAutoConfigInput,
): Promise<{ success: true } | { success: false; error: string }> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();

    if (!Number.isFinite(input.intervalSeconds)) {
      return { success: false, error: "Intervalle invalide." };
    }
    // Validation intervalle : minimum 30 s (évite de saturer PFS), max 90 j.
    const seconds = Math.max(
      MIN_AUTO_INTERVAL_SECONDS,
      Math.min(MAX_AUTO_INTERVAL_SECONDS, Math.floor(input.intervalSeconds)),
    );

    // Validation email (permissive : vide autorisé — on retombe sur admin_personal_email).
    const email = input.alertEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: "Adresse email invalide." };
    }

    await setSiteConfig(KEY_AUTO_ENABLED, input.enabled ? "1" : "0", {
      tenantId: tenant.id,
    });
    await setSiteConfig(KEY_AUTO_INTERVAL_SECONDS, String(seconds), {
      tenantId: tenant.id,
    });
    // Nettoie l'ancienne clé heures pour éviter les incohérences si la
    // cliente réactive plus tard un vieux paramétrage.
    await unsetSiteConfig(KEY_AUTO_INTERVAL_HOURS, { tenantId: tenant.id });
    // Reset le chrono au save : la cliente veut que le compte à rebours
    // reparte de la valeur pleine dès qu'elle modifie l'intervalle ou (re)active
    // le toggle. Sans ça, un changement 1h → 30 min affiche un chrono négatif.
    const nowMs = Date.now();
    await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(nowMs), {
      tenantId: tenant.id,
    });
    // Si l'audit est actuellement en pause, la maintenir : on met à jour
    // pausedAt à maintenant aussi → le chrono figé passe à la nouvelle valeur
    // pleine (dueAt - pausedAt = intervalSeconds). Sans ça la cliente voyait
    // le chrono continuer à descendre en douce pendant la pause.
    const currentPausedRow = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: KEY_AUTO_PAUSED_AT },
      select: { value: true },
    });
    const wasPaused = Number(currentPausedRow?.value ?? "0") > 0;
    if (wasPaused) {
      await setSiteConfig(KEY_AUTO_PAUSED_AT, String(nowMs), {
        tenantId: tenant.id,
      });
    }
    if (email) {
      await setSiteConfig(KEY_AUTO_ALERT_EMAIL, email, { tenantId: tenant.id });
    } else {
      await unsetSiteConfig(KEY_AUTO_ALERT_EMAIL, { tenantId: tenant.id });
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit Auto] Save config failed", { error: msg });
    return { success: false, error: msg };
  }
}

export async function getPfsAuditHistoryAction(
  limit = 30,
): Promise<
  { success: true; runs: PfsAuditHistoryRunSummary[] } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const runs = await listPfsAuditHistoryRuns(tenant.id, limit);
    return { success: true, runs };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PfsAuditNextRunInfo {
  enabled: boolean;
  isRunning: boolean;
  paused: boolean;
  intervalSeconds: number;
  breakdown: { days: number; hours: number; minutes: number; seconds: number };
  lastRunAt: number | null;
  /** Instant du prochain audit (ms). null = pas planifié (toggle OFF ou PFS coupé). */
  nextRunAtMs: number | null;
  /** Message court à afficher dans le bandeau UI. */
  status:
    | "disabled" // toggle OFF
    | "pfs_disabled" // kill switch PFS OFF
    | "running" // audit en cours
    | "paused" // mis en pause manuellement
    | "awaiting_propagations" // audit fini mais jobs marketplace pas encore terminés
    | "pending" // en attente d'un tick
    | "imminent"; // le délai est déjà écoulé, se lance au prochain tick
  /** Nombre de jobs marketplace encore actifs (QUEUED/IN_PROGRESS) — utile
   *  quand status === "awaiting_propagations" pour afficher un compteur. */
  awaitingPropagationsCount?: number;
  /** Tick du scheduler en ms — utile pour l'UI qui refresh à cette cadence. */
  schedulerTickMs: number;
  /**
   * Utilisé uniquement quand `status === "paused"` : temps restant figé au
   * moment de la pause, à afficher tel quel dans le bandeau (le tick local
   * ne doit PAS le décrémenter).
   */
  frozenRemainingMs?: number;
}

export async function getPfsAuditNextRunAction(): Promise<
  { success: true; info: PfsAuditNextRunInfo } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const rows = await prisma.siteConfig.findMany({
      where: {
        tenantId: tenant.id,
        key: {
          in: [
            KEY_AUTO_ENABLED,
            KEY_AUTO_INTERVAL_SECONDS,
            KEY_AUTO_INTERVAL_HOURS,
            KEY_AUTO_LAST_RUN_AT,
            KEY_AUTO_PAUSED_AT,
            KEY_AUDIT_AWAITING_PROPAGATIONS,
            "pfs_audit_state",
            "pfs_products_management_enabled",
          ],
        },
      },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const enabled = map.get(KEY_AUTO_ENABLED) === "1";
    const pfsProdEnabled = (map.get("pfs_products_management_enabled") ?? "1") !== "0";
    const intervalSeconds = resolveIntervalSeconds(rows);
    const lastRunRaw = Number(map.get(KEY_AUTO_LAST_RUN_AT) ?? "0");
    // `let` (pas const) — on peut re-baser cette valeur juste après quand la
    // fin des propagations reset le chrono, sinon le calcul du dueAt plus bas
    // continue à voir l'ancien timestamp et affiche un chrono déjà entamé.
    let lastRunAt: number | null =
      Number.isFinite(lastRunRaw) && lastRunRaw > 0 ? lastRunRaw : null;
    const pausedAtRaw = Number(map.get(KEY_AUTO_PAUSED_AT) ?? "0");
    const paused = Number.isFinite(pausedAtRaw) && pausedAtRaw > 0;
    // Flag « audit fini, propagations en cours ». Si présent, on compte les
    // MarketplaceRefreshJob QUEUED/IN_PROGRESS pour ce tenant ; s'il n'en
    // reste plus, on efface le flag ET on reset le chrono (le décompte
    // repart de zéro APRÈS la fin de la dernière propagation, pas avant).
    const awaitingRaw = map.get(KEY_AUDIT_AWAITING_PROPAGATIONS);
    let awaitingActive = !!awaitingRaw;
    let awaitingCount = 0;
    if (awaitingActive) {
      awaitingCount = await prisma.marketplaceRefreshJob.count({
        where: {
          tenantId: tenant.id,
          status: { in: ["QUEUED", "IN_PROGRESS"] },
        },
      });
      if (awaitingCount === 0) {
        // Toutes les propagations sont finies — on relance le chrono.
        const newLastRunAt = Date.now();
        await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(newLastRunAt), {
          tenantId: tenant.id,
        });
        await unsetSiteConfig(KEY_AUDIT_AWAITING_PROPAGATIONS, {
          tenantId: tenant.id,
        });
        awaitingActive = false;
        // Re-base la variable locale : sinon le dueAt calculé plus bas
        // utilise l'ancien lastRunAt et le chrono repart à « intervalle
        // moins durée audit » au lieu de la valeur pleine.
        lastRunAt = newLastRunAt;
      }
    }

    let isRunning = false;
    const rawState = map.get("pfs_audit_state");
    if (rawState) {
      try {
        const parsed = JSON.parse(rawState) as { status?: string };
        isRunning = parsed.status === "RUNNING";
      } catch {
        /* état corrompu — ignoré */
      }
    }

    let status: PfsAuditNextRunInfo["status"];
    let nextRunAtMs: number | null;
    let frozenRemainingMs: number | undefined;
    if (!enabled) {
      status = "disabled";
      nextRunAtMs = null;
    } else if (!pfsProdEnabled) {
      status = "pfs_disabled";
      nextRunAtMs = null;
    } else if (isRunning) {
      status = "running";
      nextRunAtMs = null;
    } else if (awaitingActive) {
      status = "awaiting_propagations";
      nextRunAtMs = null;
    } else if (paused) {
      // Pause : chrono figé au moment de la pause. On calcule le temps qu'il
      // restait à ce moment-là et on le renvoie tel quel via frozenRemainingMs.
      status = "paused";
      const dueAtBase = (lastRunAt ?? 0) + intervalSeconds * 1000;
      nextRunAtMs = null;
      frozenRemainingMs = Math.max(0, dueAtBase - pausedAtRaw);
    } else {
      const dueAt = (lastRunAt ?? 0) + intervalSeconds * 1000;
      const now = Date.now();
      if (dueAt <= now) {
        // Délai écoulé — le prochain tick du scheduler va lancer l'audit.
        status = "imminent";
        nextRunAtMs = now + PFS_AUDIT_SCHEDULER_TICK_MS;
      } else {
        status = "pending";
        nextRunAtMs = dueAt;
      }
    }

    return {
      success: true,
      info: {
        enabled,
        isRunning,
        paused,
        intervalSeconds,
        breakdown: breakdownSeconds(intervalSeconds),
        lastRunAt,
        nextRunAtMs,
        status,
        awaitingPropagationsCount: awaitingActive ? awaitingCount : undefined,
        schedulerTickMs: PFS_AUDIT_SCHEDULER_TICK_MS,
        frozenRemainingMs,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Force un tick immédiat du scheduler côté serveur : appelée par le bandeau
 * timer dès que le chrono UI atteint 0, pour ne pas attendre le prochain tick
 * (5 s en dev, 5 min en prod). Idempotent — no-op si :
 *   - un audit tourne déjà,
 *   - la config auto est désactivée,
 *   - l'audit est en pause,
 *   - le délai n'est pas encore écoulé (garde-fou anti-abus UI).
 */
export async function triggerPfsAuditIfDueAction(opts?: {
  /** Bypass le check `dueAt <= now` : forcé par le bouton « Lancer maintenant »
   *  du bandeau (cliente veut relancer l'audit auto sans attendre la fin du
   *  chrono). Les autres gardes-fous (enabled/paused/RUNNING) restent actifs. */
  force?: boolean;
}): Promise<
  { success: true; launched: boolean } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const rows = await prisma.siteConfig.findMany({
      where: {
        tenantId: tenant.id,
        key: {
          in: [
            KEY_AUTO_ENABLED,
            KEY_AUTO_INTERVAL_SECONDS,
            KEY_AUTO_INTERVAL_HOURS,
            KEY_AUTO_LAST_RUN_AT,
            KEY_AUTO_PAUSED_AT,
            "pfs_audit_state",
            "pfs_products_management_enabled",
          ],
        },
      },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    if (map.get(KEY_AUTO_ENABLED) !== "1") return { success: true, launched: false };
    if ((map.get("pfs_products_management_enabled") ?? "1") === "0") return { success: true, launched: false };
    const pausedAtRaw = Number(map.get(KEY_AUTO_PAUSED_AT) ?? "0");
    if (Number.isFinite(pausedAtRaw) && pausedAtRaw > 0) return { success: true, launched: false };
    try {
      const parsed = JSON.parse(map.get("pfs_audit_state") ?? "{}") as { status?: string };
      if (parsed.status === "RUNNING") return { success: true, launched: false };
    } catch { /* état corrompu — safe : on ne lance rien */ return { success: true, launched: false }; }
    // Bloc « en attente des propagations » : on ne relance JAMAIS un audit
    // tant que les jobs marketplace du précédent tournent encore, même en
    // force. Sinon on spam des bugs (règle validée cliente 2026-09-08).
    const awaitingRow = await prisma.siteConfig.findFirst({
      where: { tenantId: tenant.id, key: KEY_AUDIT_AWAITING_PROPAGATIONS },
      select: { value: true },
    });
    if (awaitingRow?.value) {
      const remaining = await prisma.marketplaceRefreshJob.count({
        where: {
          tenantId: tenant.id,
          status: { in: ["QUEUED", "IN_PROGRESS"] },
        },
      });
      if (remaining > 0) return { success: true, launched: false };
    }
    if (!opts?.force) {
      const intervalSeconds = resolveIntervalSeconds(rows);
      const lastRun = Number(map.get(KEY_AUTO_LAST_RUN_AT) ?? "0");
      const dueAt = (Number.isFinite(lastRun) ? lastRun : 0) + intervalSeconds * 1000;
      if (dueAt > Date.now()) return { success: true, launched: false };
    }

    // Lance en tâche de fond via ALS (le scheduler fait pareil).
    const { tenantALS } = await import("@/lib/tenant-als");
    const { startPfsAuditInBackground } = await import("@/lib/pfs-audit-runner");
    await tenantALS.run(tenant.id, async () => {
      await startPfsAuditInBackground(tenant.id, { autoTriggered: true });
    });
    return { success: true, launched: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Bascule ON/OFF le toggle d'audit auto (`pfs_audit_auto_enabled`). Utilisé
 * par le bouton « Réactiver » du bandeau après qu'un audit manuel ait coupé
 * l'auto. À la réactivation, remet `lastRunAt = now` pour que le chrono
 * reparte de la valeur pleine, et efface une éventuelle pause résiduelle.
 */
export async function setPfsAuditAutoEnabledAction(
  enabled: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    await setSiteConfig(KEY_AUTO_ENABLED, enabled ? "1" : "0", {
      tenantId: tenant.id,
    });
    if (enabled) {
      await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(Date.now()), {
        tenantId: tenant.id,
      });
      await unsetSiteConfig(KEY_AUTO_PAUSED_AT, { tenantId: tenant.id });
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Audit Auto] Toggle enabled failed", { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Bascule l'état de pause de l'audit auto. Pause = mémorise le timestamp de
 * pause dans `pfs_audit_auto_paused_at`. Reprise = décale `pfs_audit_auto_last_run_at`
 * de la durée de la pause pour que le chrono reprenne exactement où il s'était
 * arrêté (règle validée cliente : « sans changer le chronomètre en cours »).
 */
export async function togglePfsAuditPauseAction(): Promise<
  { success: true; paused: boolean } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const rows = await prisma.siteConfig.findMany({
      where: {
        tenantId: tenant.id,
        key: { in: [KEY_AUTO_PAUSED_AT, KEY_AUTO_LAST_RUN_AT] },
      },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const currentPausedAt = Number(map.get(KEY_AUTO_PAUSED_AT) ?? "0");
    const isPaused = Number.isFinite(currentPausedAt) && currentPausedAt > 0;

    if (isPaused) {
      // Reprise : glisse lastRunAt de la durée de la pause pour conserver
      // le temps restant. Ex : si la pause a duré 42 min, on ajoute 42 min
      // à lastRunAt → le chrono reprend au même endroit.
      const pausedDurationMs = Date.now() - currentPausedAt;
      const lastRun = Number(map.get(KEY_AUTO_LAST_RUN_AT) ?? "0");
      if (Number.isFinite(lastRun) && lastRun > 0) {
        await setSiteConfig(KEY_AUTO_LAST_RUN_AT, String(lastRun + pausedDurationMs), {
          tenantId: tenant.id,
        });
      }
      await unsetSiteConfig(KEY_AUTO_PAUSED_AT, { tenantId: tenant.id });
      return { success: true, paused: false };
    }

    await setSiteConfig(KEY_AUTO_PAUSED_AT, String(Date.now()), {
      tenantId: tenant.id,
    });
    return { success: true, paused: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Supprime UN run d'historique (cascade sur les changes). Utilisé par l'icône
 * corbeille sur chaque carte de l'onglet Historique.
 */
export async function deletePfsAuditRunAction(
  runId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    await prisma.pfsAuditRun.deleteMany({ where: { id: runId, tenantId: tenant.id } });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Supprime TOUT l'historique du tenant courant. Bouton « Tout supprimer »
 * en tête d'onglet Historique (avec confirmation UI).
 */
export async function deleteAllPfsAuditRunsAction(): Promise<
  { success: true; deleted: number } | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const res = await prisma.pfsAuditRun.deleteMany({ where: { tenantId: tenant.id } });
    return { success: true, deleted: res.count };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getPfsAuditRunDetailsAction(
  runId: string,
): Promise<
  | { success: true; products: PfsAuditHistoryProductDetail[] }
  | { success: false; error: string }
> {
  await requireAdmin();
  try {
    const tenant = await requireCurrentTenant();
    const products = await getPfsAuditRunDetails(tenant.id, runId);
    return { success: true, products };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
