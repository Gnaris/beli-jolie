"use client";

/**
 * Tiroir « Envoi de mails » (widget bulk-mail).
 *
 * Sources agrégées :
 *   • GET /api/admin/bulk-mail-jobs  → envois groupés (newsletter aux fiches),
 *                                      chaque job est dépliable ligne par ligne
 *                                      (En attente / En cours / Envoyé / Échoué)
 *   • GET /api/admin/recent-emails   → mails individuels envoyés en 60 min
 *                                      (auto panier abandonné, retour en stock,
 *                                      inactivité, newsletter à un inscrit…)
 *
 * Structure :
 *   ┌──────────────────────────────┐
 *   │ Header aurora (fuchsia)      │
 *   ├──────────────────────────────┤
 *   │ Barre de progression totale  │
 *   │ (si un job RUNNING)          │
 *   ├──────────────────────────────┤
 *   │ ENVOIS GROUPÉS               │
 *   │  Job A [RUNNING] ▼           │
 *   │    · Marie Dupont · SENT     │
 *   │    · Sophie · SENDING        │
 *   ├──────────────────────────────┤
 *   │ AUTRES ENVOIS RÉCENTS        │
 *   │  · Panier abandonné · Alice  │
 *   │  · Newsletter · Bob          │
 *   └──────────────────────────────┘
 */

import { useCallback, useEffect, useState } from "react";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import { getScenarioLabel } from "@/lib/email-scenarios";

type BulkMailJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

interface Recipient {
  ficheId: string;
  email: string;
  name: string;
  status: "WAITING" | "SENDING" | "SENT" | "FAILED";
  attemptedAt?: string;
  error?: string;
}

interface JobView {
  id: string;
  templateName: string;
  templateSubject: string;
  recipients: Recipient[];
  totalCount: number;
  sentCount: number;
  failedCount: number;
  status: BulkMailJobStatus;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface RecentEmail {
  id: string;
  recipientEmail: string;
  fromName: string | null;
  scenarioKey: string;
  subject: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  sentAt: string;
  userId: string | null;
}

const POLL_ACTIVE_MS = 2_000;
const POLL_IDLE_MS = 30_000;

const MAIL_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline strokeLinecap="round" strokeLinejoin="round" points="22,6 12,13 2,6" />
  </svg>
);

export function BulkMailDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [recent, setRecent] = useState<RecentEmail[]>([]);
  const [isVisible, setIsVisible] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [jobsRes, recentRes] = await Promise.all([
        fetch("/api/admin/bulk-mail-jobs", { cache: "no-store" }),
        fetch("/api/admin/recent-emails", { cache: "no-store" }),
      ]);
      if (jobsRes.ok) {
        const data = (await jobsRes.json()) as { jobs?: JobView[] };
        setJobs(data.jobs ?? []);
      }
      if (recentRes.ok) {
        const data = (await recentRes.json()) as { emails?: RecentEmail[] };
        setRecent(data.emails ?? []);
      }
    } catch {
      // ignoré
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (isVisible) void refresh();
  }, [isVisible, refresh]);

  const active = jobs.filter((j) => j.status === "PENDING" || j.status === "RUNNING");

  useEffect(() => {
    if (!isVisible) return;
    const delay = active.length > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(refresh, delay);
    return () => window.clearInterval(id);
  }, [active.length, isVisible, refresh]);

  useEffect(() => {
    // Badge = envois groupés actifs (halo pulse) OU nb de mails récents à voir.
    const count = active.length > 0 ? active.length : recent.length;
    setBadge("bulk-mail", { count, pulse: active.length > 0 });
  }, [active.length, recent.length, setBadge]);

  async function onDismissDone() {
    try {
      await fetch("/api/admin/bulk-mail-jobs?status=done", { method: "DELETE" });
      await refresh();
    } catch {
      // ignoré
    }
  }

  async function onDismissOne(id: string) {
    try {
      await fetch(`/api/admin/bulk-mail-jobs?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      // ignoré
    }
  }

  async function onDeleteRecent(id: string) {
    try {
      await fetch(`/api/admin/recent-emails?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await refresh();
    } catch {
      // ignoré
    }
  }

  async function onClearAllRecent() {
    if (!window.confirm("Vider tous les envois récents (dernière heure) ? Cette action est irréversible.")) {
      return;
    }
    try {
      await fetch("/api/admin/recent-emails", { method: "DELETE" });
      await refresh();
    } catch {
      // ignoré
    }
  }

  const totalPlanned = active.reduce((n, j) => n + j.totalCount, 0);
  const totalProcessed = active.reduce((n, j) => n + j.sentCount + j.failedCount, 0);
  const pct = totalPlanned > 0 ? Math.round((totalProcessed / totalPlanned) * 100) : 0;

  const title =
    active.length > 0
      ? `${totalProcessed} / ${totalPlanned} envoyés`
      : jobs.length + recent.length > 0
        ? `${jobs.length + recent.length} envoi${jobs.length + recent.length > 1 ? "s" : ""}`
        : "Aucun envoi";

  const isEmpty = jobs.length === 0 && recent.length === 0;

  return (
    <DrawerShell
      open={openWidget === "bulk-mail"}
      onClose={close}
      accent="fuchsia"
      eyebrow="Envoi de mails"
      title={
        <span className="flex items-center gap-1.5">
          {active.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={MAIL_ICON}
      autoScrollFullscreen
      footer={
        <div className="text-[11px] text-slate-500 flex items-center justify-between">
          <span>~24 mails / min</span>
          {jobs.some((j) => j.status === "COMPLETED" || j.status === "FAILED") && (
            <button
              type="button"
              onClick={onDismissDone}
              className="text-slate-500 hover:text-slate-700 underline"
            >
              Vider les terminés
            </button>
          )}
        </div>
      }
    >
      {isEmpty ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun envoi récent.</p>
          <p className="text-xs text-slate-400 mt-1">
            Les mails auto et manuels apparaissent ici pendant 1 h après envoi.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && totalPlanned > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-slate-600">Progression envois groupés</p>
                <p className="text-xs font-semibold text-fuchsia-700 tabular-nums">
                  {totalProcessed} / {totalPlanned}
                </p>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-fuchsia-500 to-pink-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}

          {jobs.length > 0 && (
            <>
              <SectionHeader>Envois groupés</SectionHeader>
              {jobs.map((job) => (
                <JobBlock key={job.id} job={job} onDismiss={() => onDismissOne(job.id)} />
              ))}
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="px-4 py-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-fuchsia-700 font-semibold bg-fuchsia-50/40 border-b border-slate-100">
                <span>Autres envois récents (1 h)</span>
                <button
                  type="button"
                  onClick={onClearAllRecent}
                  className="text-[10px] normal-case tracking-normal font-medium text-slate-500 hover:text-rose-600 underline"
                  title="Supprimer tous les envois récents de la liste"
                >
                  Vider tout
                </button>
              </div>
              {recent.map((e) => (
                <RecentEmailRow
                  key={e.id}
                  email={e}
                  onDelete={() => onDeleteRecent(e.id)}
                />
              ))}
            </>
          )}
        </>
      )}
    </DrawerShell>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-fuchsia-700 font-semibold bg-fuchsia-50/40 border-b border-slate-100">
      {children}
    </div>
  );
}

function JobBlock({ job, onDismiss }: { job: JobView; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(job.status === "RUNNING" || job.status === "PENDING");
  const active = job.status === "RUNNING" || job.status === "PENDING";
  const failed = job.status === "FAILED";
  const done = job.status === "COMPLETED";

  const bg = failed ? "bg-rose-50/30" : done ? "bg-emerald-50/20" : "";

  return (
    <div className={`border-b border-slate-100 ${bg}`}>
      <div className="px-4 py-3 flex items-start gap-3">
        <StatusDot status={job.status} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 truncate">{job.templateName}</p>
          <p className="text-[11px] text-slate-500 truncate">{job.templateSubject}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px]">
            <span className="text-emerald-700 font-medium">
              {job.sentCount} envoyé{job.sentCount > 1 ? "s" : ""}
            </span>
            {job.failedCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-rose-600 font-medium">
                  {job.failedCount} échec{job.failedCount > 1 ? "s" : ""}
                </span>
              </>
            )}
            {active && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">
                  {job.totalCount - job.sentCount - job.failedCount} en attente
                </span>
              </>
            )}
          </div>
          {job.errorMessage && (
            <p className="mt-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
              {job.errorMessage}
            </p>
          )}
        </div>
        {!active && (
          <button
            type="button"
            onClick={onDismiss}
            title="Cacher ce job"
            className="text-slate-400 hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-slate-400 hover:text-slate-600 shrink-0"
          aria-label={expanded ? "Replier" : "Déplier"}
        >
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {expanded && job.recipients.length > 0 && (
        <div className="bg-slate-50/40 border-t border-slate-100">
          {job.recipients.map((r, idx) => (
            <RecipientRow key={`${job.id}-${idx}`} recipient={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RecipientRow({ recipient }: { recipient: Recipient }) {
  const bg =
    recipient.status === "FAILED"
      ? "bg-rose-50/40"
      : recipient.status === "SENDING"
        ? "bg-fuchsia-50/50"
        : "";

  return (
    <div className={`px-4 py-2 border-b border-slate-100 last:border-0 ${bg} flex items-start gap-3`}>
      <RecipientStatusIcon status={recipient.status} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-slate-800 truncate">{recipient.name}</p>
        <p className="text-[11px] text-slate-500 truncate">{recipient.email}</p>
        {recipient.error && (
          <p className="text-[11px] text-rose-700 mt-1 break-words">{recipient.error}</p>
        )}
      </div>
      <RecipientStatusBadge status={recipient.status} />
    </div>
  );
}

function RecentEmailRow({
  email,
  onDelete,
}: {
  email: RecentEmail;
  onDelete: () => void;
}) {
  const failed = email.status === "FAILED";
  const bg = failed ? "bg-rose-50/40" : "";
  return (
    <div className={`px-4 py-2 border-b border-slate-100 last:border-0 ${bg} flex items-start gap-3`}>
      <EmailStatusIcon status={email.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-700 shrink-0">
            {getScenarioLabel(email.scenarioKey)}
          </span>
          <span className="text-slate-300 shrink-0">·</span>
          <span className="text-[11px] text-slate-500 truncate">{email.recipientEmail}</span>
        </div>
        <p className="text-[12.5px] font-medium text-slate-800 truncate">{email.subject}</p>
        {email.errorMessage && (
          <p className="text-[11px] text-rose-700 mt-1 break-words">{email.errorMessage}</p>
        )}
      </div>
      <EmailStatusBadge status={email.status} sentAt={email.sentAt} />
      <button
        type="button"
        onClick={onDelete}
        title="Supprimer cet envoi de la liste"
        aria-label="Supprimer cet envoi"
        className="text-slate-400 hover:text-rose-600 shrink-0 mt-0.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: BulkMailJobStatus }) {
  if (status === "PENDING") {
    return <span className="mt-1 w-2 h-2 rounded-full bg-slate-400 shrink-0" title="En attente" />;
  }
  if (status === "RUNNING") {
    return (
      <span className="mt-1 relative w-2 h-2 shrink-0" title="En cours">
        <span className="absolute inset-0 rounded-full bg-fuchsia-500 animate-ping opacity-70" />
        <span className="relative w-2 h-2 rounded-full bg-fuchsia-500 block" />
      </span>
    );
  }
  if (status === "COMPLETED") {
    return <span className="mt-1 w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Terminé" />;
  }
  return <span className="mt-1 w-2 h-2 rounded-full bg-rose-500 shrink-0" title="Échec global" />;
}

function RecipientStatusIcon({ status }: { status: Recipient["status"] }) {
  if (status === "WAITING") {
    return (
      <svg className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="10" />
        <polyline strokeLinecap="round" strokeLinejoin="round" points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (status === "SENDING") {
    return (
      <svg className="w-4 h-4 text-fuchsia-600 animate-spin shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    );
  }
  if (status === "SENT") {
    return (
      <svg className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function RecipientStatusBadge({ status }: { status: Recipient["status"] }) {
  const label =
    status === "WAITING"
      ? "En attente"
      : status === "SENDING"
        ? "En cours"
        : status === "SENT"
          ? "Envoyé"
          : "Échoué";
  const cls =
    status === "WAITING"
      ? "bg-slate-100 text-slate-600 border-slate-200"
      : status === "SENDING"
        ? "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200"
        : status === "SENT"
          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
          : "bg-rose-100 text-rose-700 border-rose-200";
  return (
    <span
      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}
    >
      {label}
    </span>
  );
}

function EmailStatusIcon({ status }: { status: "SENT" | "FAILED" }) {
  if (status === "SENT") {
    return (
      <svg className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function EmailStatusBadge({ status, sentAt }: { status: "SENT" | "FAILED"; sentAt: string }) {
  const relative = formatRelative(sentAt);
  const cls =
    status === "SENT"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : "bg-rose-100 text-rose-700 border-rose-200";
  return (
    <span
      className={`shrink-0 inline-flex flex-col items-end gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${cls}`}
      title={new Date(sentAt).toLocaleString("fr-FR")}
    >
      <span>{status === "SENT" ? "Envoyé" : "Échoué"}</span>
      <span className="opacity-70 font-normal">{relative}</span>
    </span>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h`;
}
