"use client";

/**
 * Tiroir « Photos Microstore » — polling /api/admin/microstore-upload-jobs.
 *
 * Chaque job = un produit BJ dont on envoie les photos vers Microstore
 * (Station de Transfert). Affiché en X/N par produit avec la phase courante
 * (envoi OSS puis PATCH couverture). Terminé DONE / FAILED reste visible
 * pendant ~8 min avant de disparaître.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";

type UploadJobStatus = "PENDING" | "UPLOADING" | "PATCHING" | "DONE" | "FAILED";

interface UploadJobView {
  id: string;
  reference: string;
  productName: string | null;
  status: UploadJobStatus;
  totalImages: number;
  uploadedImages: number;
  failedImages: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const ACTIVE = new Set<UploadJobStatus>(["PENDING", "UPLOADING", "PATCHING"]);
const POLL_ACTIVE_MS = 3_000;
const POLL_IDLE_MS = 15_000;

const ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
    />
  </svg>
);

export function MicrostoreUploadDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const [jobs, setJobs] = useState<UploadJobView[]>([]);
  const [isVisible, setIsVisible] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/microstore-upload-jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: UploadJobView[] };
      setJobs(data.jobs ?? []);
    } catch {
      // ignored — polling suivant réessaiera
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

  const active = jobs.filter((j) => ACTIVE.has(j.status));

  useEffect(() => {
    if (!isVisible) return;
    const delay = active.length > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(refresh, delay);
    return () => window.clearInterval(id);
  }, [active.length, isVisible, refresh]);

  const recent = jobs.filter((j) => !ACTIVE.has(j.status));

  useEffect(() => {
    setBadge("microstore-upload", { count: active.length, pulse: active.length > 0 });
  }, [active.length, setBadge]);

  const totalPlanned = active.reduce((n, j) => n + (j.totalImages || 0), 0);
  const totalUploaded = active.reduce((n, j) => n + (j.uploadedImages || 0), 0);
  const pct = totalPlanned > 0 ? Math.round((totalUploaded / totalPlanned) * 100) : 0;

  const title =
    active.length > 0
      ? `${totalUploaded} / ${totalPlanned} photos envoyées`
      : recent.length > 0
        ? `${recent.length} produit${recent.length > 1 ? "s" : ""} terminé${recent.length > 1 ? "s" : ""}`
        : "Aucun envoi en cours";

  return (
    <DrawerShell
      open={openWidget === "microstore-upload"}
      onClose={close}
      accent="cyan"
      eyebrow="Photos Microstore"
      title={
        <span className="flex items-center gap-1.5">
          {active.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={ICON}
      footer={
        <div className="text-[11px] text-slate-500 flex items-center justify-between">
          <span>Envoi Station de Transfert</span>
          <Link
            href="/admin/parametres"
            className="text-slate-500 hover:text-slate-700 underline"
          >
            Ouvrir les réglages
          </Link>
        </div>
      }
    >
      {jobs.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun envoi de photos récent.</p>
          <p className="mt-2 text-xs text-slate-400">
            Les envois vers Microstore s&apos;affichent ici dès que vous cliquez sur
            « Envoyer les photos ».
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 && totalPlanned > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-slate-600">Progression totale</p>
                <p className="text-xs font-semibold text-cyan-700 tabular-nums">
                  {totalUploaded} / {totalPlanned}
                </p>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          {active.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
          {recent.length > 0 && (
            <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-cyan-700 font-semibold bg-cyan-50/40 border-b border-slate-100">
              Récemment terminés
            </div>
          )}
          {recent.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </>
      )}
    </DrawerShell>
  );
}

function statusLabel(status: UploadJobStatus): string {
  switch (status) {
    case "PENDING":
      return "En attente";
    case "UPLOADING":
      return "Envoi en cours";
    case "PATCHING":
      return "Finalisation";
    case "DONE":
      return "Terminé";
    case "FAILED":
      return "Échec";
  }
}

function JobRow({ job }: { job: UploadJobView }) {
  const active = ACTIVE.has(job.status);
  const done = job.status === "DONE";
  const failed = job.status === "FAILED";
  const bg = failed ? "bg-rose-50/40" : done ? "bg-cyan-50/20" : "";

  const total = job.totalImages || 0;
  const uploaded = job.uploadedImages || 0;
  const failedCount = job.failedImages || 0;
  const pct = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;

  return (
    <div className={`px-4 py-3 border-b border-slate-100 ${bg}`}>
      <div className="flex items-start gap-2">
        <span className="text-base flex-shrink-0 pt-0.5" aria-hidden>
          📸
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">
              {job.productName || job.reference}
            </p>
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex-shrink-0">
              {job.reference}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {active
              ? total > 0
                ? `${statusLabel(job.status)} · ${uploaded} / ${total} photo${total > 1 ? "s" : ""}`
                : statusLabel(job.status)
              : done
                ? `${uploaded} photo${uploaded > 1 ? "s" : ""} envoyée${uploaded > 1 ? "s" : ""}${failedCount > 0 ? ` · ${failedCount} erreur${failedCount > 1 ? "s" : ""}` : ""}`
                : failed
                  ? job.errorMessage?.slice(0, 80) || "Échec"
                  : statusLabel(job.status)}
          </p>
          {active && total > 0 && (
            <div className="relative mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
        {active && (
          <svg
            className="w-4 h-4 text-cyan-700 animate-spin flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {done && (
          <svg
            className="w-4 h-4 text-cyan-700 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {failed && (
          <svg
            className="w-4 h-4 text-rose-600 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
    </div>
  );
}
