"use client";

/**
 * Bandeau « Prochain audit auto dans XX:XX:XX » affiché en tête du drawer
 * Audit PFS. Décrémente localement chaque seconde et re-fetch l'info toutes
 * les 30 s pour rester aligné avec l'état serveur.
 *
 * États rendus :
 *   - disabled     : « Audit automatique désactivé »
 *   - pfs_disabled : « PFS coupé côté produits »
 *   - running      : « Audit en cours… »
 *   - pending      : « Prochain audit dans HH:MM:SS » (attente délai)
 *   - imminent     : « Prochain audit dans MM:SS » (délai écoulé, prochain tick)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPfsAuditNextRunAction,
  togglePfsAuditPauseAction,
  triggerPfsAuditIfDueAction,
  setPfsAuditAutoEnabledAction,
  type PfsAuditNextRunInfo,
} from "@/app/actions/admin/pfs-audit-auto";
import { useToast } from "@/components/ui/Toast";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  if (d > 0) return `${d}j ${two(h)}:${two(m)}:${two(s)}`;
  if (h > 0) return `${two(h)}:${two(m)}:${two(s)}`;
  return `${two(m)}:${two(s)}`;
}

function formatInterval(seconds: number): string {
  if (seconds <= 0) return "0 s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}j`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}min`);
  if (s > 0 && d === 0 && h === 0) parts.push(`${s}s`);
  return parts.join(" ") || `${s}s`;
}

const REFRESH_MS_IDLE = 30_000;
const REFRESH_MS_RUNNING = 3_000;

export function PfsAuditNextRunBanner() {
  const toast = useToast();
  const [info, setInfo] = useState<PfsAuditNextRunInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pauseBusy, setPauseBusy] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [enableBusy, setEnableBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await getPfsAuditNextRunAction();
    if (r.success) setInfo(r.info);
  }, []);

  const handleTogglePause = useCallback(async () => {
    if (pauseBusy || !info) return;
    setPauseBusy(true);
    try {
      const r = await togglePfsAuditPauseAction();
      if (r.success) {
        toast.success(r.paused ? "Audit en pause" : "Audit repris");
        await load();
      } else {
        toast.error("Impossible", r.error);
      }
    } finally {
      setPauseBusy(false);
    }
  }, [pauseBusy, info, toast, load]);

  const handleReenable = useCallback(async () => {
    if (enableBusy) return;
    setEnableBusy(true);
    try {
      const r = await setPfsAuditAutoEnabledAction(true);
      if (!r.success) {
        toast.error("Impossible de réactiver", r.error);
        return;
      }
      toast.success("Audit automatique réactivé");
      await load();
    } finally {
      setEnableBusy(false);
    }
  }, [enableBusy, toast, load]);

  const handleLaunchNow = useCallback(async () => {
    if (launchBusy || !info) return;
    setLaunchBusy(true);
    try {
      const r = await triggerPfsAuditIfDueAction({ force: true });
      if (!r.success) {
        toast.error("Impossible de lancer l'audit", r.error);
        return;
      }
      if (!r.launched) {
        // Serveur a refusé (audit en cours, en pause, PFS coupé, désactivé).
        toast.info("Audit non lancé", "Vérifiez qu'aucun audit n'est déjà en cours.");
        return;
      }
      toast.success("Audit auto lancé");
      await load();
    } finally {
      setLaunchBusy(false);
    }
  }, [launchBusy, info, toast, load]);

  useEffect(() => {
    void load();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    // Écoute les saves depuis Paramètres → PFS → Audit auto pour refresh
    // instantané le bandeau, plutôt que d'attendre le prochain poll 30 s.
    const onConfigChanged = () => void load();
    window.addEventListener("pfs-audit-config-changed", onConfigChanged);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("pfs-audit-config-changed", onConfigChanged);
    };
  }, [load]);

  // Poll adaptatif : 3 s quand un audit tourne, qu'il est imminent OU qu'on
  // attend la fin des propagations (le compteur descend en temps réel). 30 s
  // sinon (économise CPU/BDD).
  const needFastPoll =
    info?.isRunning ||
    info?.status === "imminent" ||
    info?.status === "awaiting_propagations";
  useEffect(() => {
    const delay = needFastPoll ? REFRESH_MS_RUNNING : REFRESH_MS_IDLE;
    const id = window.setInterval(() => void load(), delay);
    return () => window.clearInterval(id);
  }, [needFastPoll, load]);

  // Dès que le chrono passe sous 0, on force un tick serveur pour lancer
  // l'audit tout de suite au lieu d'attendre le prochain tick scheduler.
  // Idempotent côté serveur ; on garde en plus un flag local anti-double
  // pour ne pas re-tirer à chaque tick 1 s.
  const triggerFiredRef = useRef(false);
  useEffect(() => {
    if (!info) return;
    if (info.status !== "pending") {
      triggerFiredRef.current = false;
      return;
    }
    if (!info.nextRunAtMs) return;
    const remaining = info.nextRunAtMs - now;
    if (remaining > 0) return;
    if (triggerFiredRef.current) return;
    triggerFiredRef.current = true;
    void (async () => {
      const r = await triggerPfsAuditIfDueAction();
      if (r.success && r.launched) void load();
    })();
  }, [info, now, load]);

  if (!info) {
    return (
      <div className="mx-3 mt-2 mb-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
        Chargement…
      </div>
    );
  }

  let bg = "bg-slate-50 border-slate-200";
  let dot = "bg-slate-400";
  let label: string;
  let value = "";

  switch (info.status) {
    case "disabled":
      label = "Audit automatique désactivé";
      dot = "bg-slate-400";
      break;
    case "pfs_disabled":
      label = "PFS coupé côté produits";
      bg = "bg-amber-50 border-amber-200";
      dot = "bg-amber-500";
      break;
    case "running":
      label = "Audit en cours…";
      bg = "bg-sky-50 border-sky-200";
      dot = "bg-sky-500 animate-pulse";
      break;
    case "awaiting_propagations":
      label =
        typeof info.awaitingPropagationsCount === "number" && info.awaitingPropagationsCount > 0
          ? `Envoi aux marketplaces… (${info.awaitingPropagationsCount} restant${info.awaitingPropagationsCount > 1 ? "s" : ""})`
          : "Envoi aux marketplaces…";
      bg = "bg-violet-50 border-violet-200";
      dot = "bg-violet-500 animate-pulse";
      break;
    case "paused":
      label = "En pause";
      bg = "bg-slate-50 border-slate-300";
      dot = "bg-slate-500";
      // Chrono figé : on affiche le temps restant tel qu'il était au moment
      // de la pause (le tick local ne le fait pas descendre).
      value = typeof info.frozenRemainingMs === "number"
        ? formatCountdown(info.frozenRemainingMs)
        : "";
      break;
    case "imminent":
      // Chrono à 0 mais l'audit n'a pas encore démarré (le scheduler tick au
      // plus toutes les 30 s). On affiche « Démarrage imminent… » sans
      // countdown pour ne pas montrer un chrono qui semble redémarrer à 30 s.
      label = "Démarrage imminent…";
      bg = "bg-emerald-50 border-emerald-200";
      dot = "bg-emerald-500 animate-pulse";
      break;
    case "pending": {
      // Cas particulier : le chrono a atteint 0 mais le serveur n'a pas encore
      // basculé sur "imminent"/"running" (poll toutes les 3-30s). On affiche
      // localement « Audit en cours… » pour ne pas laisser un "00:00" bloqué
      // à l'écran (règle validée cliente 2026-09-08).
      const remainingMs = info.nextRunAtMs ? info.nextRunAtMs - now : 0;
      if (remainingMs <= 0) {
        label = "Audit en cours…";
        bg = "bg-sky-50 border-sky-200";
        dot = "bg-sky-500 animate-pulse";
      } else {
        label = "Prochain audit dans";
        bg = "bg-emerald-50 border-emerald-200";
        dot = "bg-emerald-500";
        value = formatCountdown(remainingMs);
      }
      break;
    }
  }

  const canTogglePause =
    info.enabled && (info.status === "pending" || info.status === "imminent" || info.status === "paused");
  // « Lancer maintenant » : uniquement quand l'audit auto est activé, PFS
  // encore branché, aucun audit en cours et pas en pause. Bypass le chrono.
  const canLaunchNow =
    info.enabled && (info.status === "pending" || info.status === "imminent");

  return (
    <div className={`mx-3 mt-2 mb-1 rounded-lg border ${bg} px-3 py-2 flex items-center gap-2 text-[11.5px]`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
      <span className="text-slate-700 font-semibold flex-1 truncate">
        {label}
        {value && <span className="ml-1 tabular-nums text-slate-900">{value}</span>}
      </span>
      {(info.status === "pending" || info.status === "imminent") && (
        <span className="text-slate-400 text-[10.5px] shrink-0 hidden sm:inline">
          toutes les {formatInterval(info.intervalSeconds)}
        </span>
      )}
      {info.status === "disabled" && (
        <button
          type="button"
          onClick={handleReenable}
          disabled={enableBusy}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 transition disabled:opacity-40 shrink-0"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
          Réactiver
        </button>
      )}
      {canLaunchNow && (
        <button
          type="button"
          onClick={handleLaunchNow}
          disabled={launchBusy}
          title="Lancer un audit auto maintenant"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-emerald-600 hover:bg-white/80 hover:text-emerald-700 transition disabled:opacity-40"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 0 0 12.8 5.3M19.5 12A7.5 7.5 0 0 0 6.7 6.7" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5v4h4M19.5 19.5v-4h-4" />
          </svg>
        </button>
      )}
      {canTogglePause && (
        <button
          type="button"
          onClick={handleTogglePause}
          disabled={pauseBusy}
          title={info.status === "paused" ? "Reprendre" : "Mettre en pause"}
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-600 hover:bg-white/80 hover:text-slate-900 transition disabled:opacity-40"
        >
          {info.status === "paused" ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
