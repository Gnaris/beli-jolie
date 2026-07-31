"use client";

/**
 * Tiroir « Images produits » — reprend la logique du feu ImportProgressWidget
 * (polling /api/admin/import-jobs) et présente les jobs actifs + derniers
 * terminés avec une barre de progression globale.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";

interface JobView {
  id: string;
  type: "PRODUCTS" | "IMAGES";
  status: "PENDING" | "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  filename: string | null;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorMessage: string | null;
  updatedAt: string;
}

const ACTIVE = new Set(["PENDING", "UPLOADING", "PROCESSING"]);
const DONE = new Set(["COMPLETED", "FAILED"]);
const RECENT_DONE_MS = 8 * 60_000;
const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 60_000;

const IMAGES_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
);

export function ImagesDrawer() {
  const { openWidget, close, setBadge } = useRightRail();
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [isVisible, setIsVisible] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/import-jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { jobs?: JobView[] };
      setJobs(data.jobs ?? []);
    } catch {
      // ignored
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

  const recent = jobs.filter((j) => {
    if (!DONE.has(j.status)) return false;
    const age = Date.now() - new Date(j.updatedAt).getTime();
    return age < RECENT_DONE_MS;
  });

  useEffect(() => {
    setBadge("images", { count: active.length, pulse: active.length > 0 });
  }, [active.length, setBadge]);

  const totalPlanned = active.reduce((n, j) => n + (j.totalItems || 0), 0);
  const totalProcessed = active.reduce((n, j) => n + (j.processedItems || 0), 0);
  const pct = totalPlanned > 0 ? Math.round((totalProcessed / totalPlanned) * 100) : 0;

  const title =
    active.length > 0
      ? `${totalProcessed} / ${totalPlanned} traitées`
      : recent.length > 0
      ? `${recent.length} terminé${recent.length > 1 ? "s" : ""}`
      : "Aucun import";

  return (
    <DrawerShell
      open={openWidget === "images"}
      onClose={close}
      accent="emerald"
      eyebrow="Images"
      title={
        <span className="flex items-center gap-1.5">
          {active.length > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          )}
          {title}
        </span>
      }
      icon={IMAGES_ICON}
      footer={
        <div className="text-[11px] text-slate-500 flex items-center justify-between">
          <span>3 en parallèle</span>
          <Link href="/admin/produits/importer" className="text-slate-500 hover:text-slate-700 underline">
            Ouvrir l&apos;import
          </Link>
        </div>
      }
    >
      {jobs.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun import récent.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && totalPlanned > 0 && (
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-slate-600">Progression totale</p>
                <p className="text-xs font-semibold text-emerald-700 tabular-nums">
                  {totalProcessed} / {totalPlanned}
                </p>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          {active.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
          {recent.length > 0 && (
            <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-emerald-700 font-semibold bg-emerald-50/40 border-b border-slate-100">
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

function JobRow({ job }: { job: JobView }) {
  const active = ACTIVE.has(job.status);
  const done = job.status === "COMPLETED";
  const failed = job.status === "FAILED";
  const isImages = job.type === "IMAGES";
  const bg = failed ? "bg-rose-50/30" : done ? "bg-emerald-50/20" : "";

  return (
    <div className={`px-4 py-3 border-b border-slate-100 ${bg}`}>
      <div className="flex items-center gap-2">
        <span className="text-base flex-shrink-0" aria-hidden>
          {isImages ? "🖼️" : "📦"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">
            {job.filename || (isImages ? "Import images" : "Import produits")}
          </p>
          <p className="text-[11px] text-slate-500">
            {active
              ? `${job.processedItems} / ${job.totalItems} traité${job.totalItems > 1 ? "s" : ""}`
              : done
              ? `${job.successItems} réussi${job.successItems > 1 ? "s" : ""}${job.errorItems > 0 ? ` · ${job.errorItems} erreur${job.errorItems > 1 ? "s" : ""}` : ""}`
              : failed
              ? job.errorMessage?.slice(0, 60) || "Échec"
              : job.status}
          </p>
        </div>
        {active && (
          <svg className="w-4 h-4 text-emerald-700 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {done && (
          <svg className="w-4 h-4 text-emerald-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </div>
  );
}
