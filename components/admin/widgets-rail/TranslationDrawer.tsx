"use client";

/**
 * Contenu du tiroir Traduction.
 *
 * Poll `/api/admin/translation-jobs` toutes les 1.5 s pour afficher :
 *  - Les lots en cours + le mot actuellement traduit (avec la traduction dès
 *    qu'elle arrive) et les langues déjà finies.
 *  - Les lots en attente.
 *  - Les 5 dernières minutes de lots terminés (avec bouton croix pour cacher).
 *
 * Alimente le badge du rail avec le nombre de lots actifs (PENDING+PROCESSING),
 * clignotant tant qu'il reste du travail.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";

interface TranslationJob {
  id: string;
  section: string;
  entityType: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  totalCount: number;
  doneCount: number;
  errorCount: number;
  currentItemText: string | null;
  currentItemTranslation: string | null;
  currentLocale: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 60_000;

const TRANSLATION_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802"
    />
  </svg>
);

export function TranslationDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [isVisible, setIsVisible] = useState(true);
  const isMounted = useRef(true);

  useEffect(() => () => {
    isMounted.current = false;
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/translation-jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: TranslationJob[] };
      if (isMounted.current) setJobs(data.jobs ?? []);
    } catch {
      // silence — le prochain tick réessaie
    }
  }, []);

  // Suivi de la visibilité de l'onglet — on coupe le poll si l'onglet est caché.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // Re-poll immédiat au retour de visibilité (capte les jobs qui ont bougé).
  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const hasActive = jobs.some((j) => j.status === "PENDING" || j.status === "PROCESSING");

  // Polling adaptatif : 1,5s si un lot tourne, 15s sinon. Coupé si onglet caché.
  useEffect(() => {
    if (!isVisible) return;
    const delay = hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(load, delay);
    return () => window.clearInterval(id);
  }, [hasActive, isVisible, load]);

  // Alimente le badge du rail à partir de la liste des jobs actifs.
  useEffect(() => {
    const active = jobs.filter((j) => j.status === "PENDING" || j.status === "PROCESSING").length;
    setBadge("translation", { count: active, pulse: active > 0 });
  }, [jobs, setBadge]);

  const activeJobs = jobs.filter((j) => j.status === "PENDING" || j.status === "PROCESSING");
  const doneJobs = jobs.filter((j) => j.status === "DONE" || j.status === "FAILED");

  const title =
    activeJobs.length > 0
      ? `${activeJobs.length} lot${activeJobs.length > 1 ? "s" : ""} en cours`
      : doneJobs.length > 0
      ? `${doneJobs.length} lot${doneJobs.length > 1 ? "s" : ""} terminé${doneJobs.length > 1 ? "s" : ""}`
      : "Aucun lot";

  const dismissAll = useCallback(async () => {
    try {
      await fetch("/api/admin/translation-jobs?status=done", { method: "DELETE" });
    } catch {}
    void load();
  }, [load]);

  const dismissOne = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/admin/translation-jobs/${id}`, { method: "DELETE" });
      } catch {}
      void load();
    },
    [load],
  );

  return (
    <DrawerShell
      open={openWidget === "translation"}
      onClose={close}
      accent="violet"
      eyebrow="Traduction"
      title={
        <span className="flex items-center gap-1.5">
          {activeJobs.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={TRANSLATION_ICON}
      autoScrollFullscreen
      footer={
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Vous pouvez continuer à travailler</span>
          {doneJobs.length > 0 && (
            <button
              type="button"
              onClick={dismissAll}
              className="text-slate-500 hover:text-slate-700 underline"
            >
              Vider les terminés
            </button>
          )}
        </div>
      }
    >
      {jobs.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun lot en cours.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Cliquez sur « Tout traduire » depuis une page (Couleurs, Mots-clés…) pour lancer un lot.
          </p>
        </div>
      ) : (
        <>
          {activeJobs.map((job) => (
            <ActiveJobRow key={job.id} job={job} />
          ))}
          {doneJobs.map((job) => (
            <DoneJobRow key={job.id} job={job} onDismiss={() => dismissOne(job.id)} />
          ))}
        </>
      )}
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────
// Sous-composants — 1 ligne par lot
// ────────────────────────────────────────────────────────

function ActiveJobRow({ job }: { job: TranslationJob }) {
  const pct = job.totalCount === 0 ? 0 : Math.round((job.doneCount / job.totalCount) * 100);
  const isProcessing = job.status === "PROCESSING";

  return (
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${isProcessing ? "bg-emerald-100" : "bg-slate-100"}`}>
            {isProcessing ? (
              <svg className="w-3.5 h-3.5 text-emerald-700 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 7v5l3 2" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{job.section}</p>
            <p className="text-[11px] text-slate-500">
              {isProcessing ? "Traduction en cours…" : "En attente…"}
            </p>
          </div>
        </div>
        <p className={`text-xs font-semibold tabular-nums flex-shrink-0 ${isProcessing ? "text-emerald-700" : "text-slate-500"}`}>
          {job.doneCount} / {job.totalCount}
        </p>
      </div>

      {/* Barre de progression */}
      <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2.5">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
            isProcessing ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-slate-300"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Mot en cours (uniquement quand PROCESSING) */}
      {isProcessing && job.currentItemText && (
        <div className="rounded-lg bg-violet-50/70 border border-violet-100 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-violet-700 font-semibold mb-1">
            En train de traduire
          </p>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-800 truncate">{job.currentItemText}</span>
            {job.currentItemTranslation && (
              <>
                <svg className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="italic text-violet-700 truncate">{job.currentItemTranslation}</span>
              </>
            )}
          </div>
          {job.currentLocale && (
            <p className="text-[10px] text-slate-500 mt-1">
              Langue en cours : {job.currentLocale.toUpperCase()}
            </p>
          )}
        </div>
      )}

      {job.errorCount > 0 && (
        <p className="text-[11px] text-amber-700 mt-2">
          {job.errorCount} traduction{job.errorCount > 1 ? "s ont" : " a"} échoué
        </p>
      )}
    </div>
  );
}

function DoneJobRow({
  job,
  onDismiss,
}: {
  job: TranslationJob;
  onDismiss: () => void;
}) {
  const failed = job.status === "FAILED";
  const partial = job.errorCount > 0;
  const bg = failed ? "bg-rose-50/40" : partial ? "bg-amber-50/40" : "bg-emerald-50/40";
  const iconBg = failed ? "bg-rose-100" : partial ? "bg-amber-100" : "bg-emerald-100";
  const iconColor = failed ? "text-rose-700" : partial ? "text-amber-700" : "text-emerald-700";
  const textColor = failed ? "text-rose-700" : partial ? "text-amber-700" : "text-emerald-700";

  return (
    <div className={`px-4 py-3 border-b border-slate-100 ${bg}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-md ${iconBg} flex items-center justify-center flex-shrink-0`}>
            {failed ? (
              <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className={`w-3.5 h-3.5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{job.section}</p>
            <p className={`text-[11px] ${textColor}`}>
              {failed
                ? "Échec"
                : partial
                ? `${job.doneCount - job.errorCount} traduits · ${job.errorCount} raté${job.errorCount > 1 ? "s" : ""}`
                : `${job.doneCount} mot${job.doneCount > 1 ? "s" : ""} traduit${job.doneCount > 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="w-6 h-6 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center flex-shrink-0"
          title="Cacher"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
