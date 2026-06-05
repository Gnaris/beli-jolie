"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface JobView {
  id: string;
  type: "PRODUCTS" | "IMAGES";
  status: "PENDING" | "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  filename: string | null;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorDraftId: string | null;
  errorMessage: string | null;
  updatedAt: string;
}

const ACTIVE_STATUSES = new Set(["PENDING", "UPLOADING", "PROCESSING"]);
const DONE_STATUSES = new Set(["COMPLETED", "FAILED"]);
const STALE_UPLOAD_MS = 90_000;
const DONE_DISPLAY_MS = 8 * 60 * 1000;
const DISMISSED_STORAGE_KEY = "bj.importWidget.dismissedIds";

function pickRelevantJob(jobs: JobView[]): JobView | null {
  const active = jobs.find((j) => ACTIVE_STATUSES.has(j.status));
  if (active) return active;
  const recentDone = jobs.find((j) => {
    if (!DONE_STATUSES.has(j.status)) return false;
    const age = Date.now() - new Date(j.updatedAt).getTime();
    return age < DONE_DISPLAY_MS;
  });
  return recentDone ?? null;
}

function readDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function persistDismissedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...ids].slice(-50)));
  } catch {
    // storage may be full / disabled
  }
}

/**
 * Widget global qui suit les imports en cours côté serveur, même lorsque
 * l'utilisatrice a quitté la page d'import. Affiché en bas à gauche, masqué
 * automatiquement quand on est déjà sur /admin/produits/importer (la page
 * affiche son propre suivi).
 */
export default function ImportProgressWidget() {
  const pathname = usePathname();
  const [job, setJob] = useState<JobView | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedIds());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/import-jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const next = pickRelevantJob(data.jobs ?? []);
      setJob(next);
    } catch {
      // network blip — try again next interval
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistDismissedIds(next);
      return next;
    });
  }, []);

  const cancelJob = useCallback(async (id: string) => {
    try {
      const fd = new FormData();
      fd.append("action", "cancel");
      await fetch(`/api/admin/import-jobs/${id}`, { method: "POST", body: fd });
    } catch {
      // best-effort: even on error, dismiss locally so the widget stops
    } finally {
      dismiss(id);
      refresh();
    }
  }, [dismiss, refresh]);

  // Hide while on the importer page itself (tab UI already shows progress)
  const onImporterPage = pathname?.startsWith("/admin/produits/importer");
  if (onImporterPage) return null;

  if (!job || dismissedIds.has(job.id)) return null;

  const isImages = job.type === "IMAGES";
  const isActive = ACTIVE_STATUSES.has(job.status);
  const isDone = job.status === "COMPLETED";
  const isFailed = job.status === "FAILED";
  const total = job.totalItems || 0;
  const processed = job.processedItems || 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  // Detect stuck upload (browser left mid-upload)
  const updatedAge = Date.now() - new Date(job.updatedAt).getTime();
  const isStaleUpload = job.status === "UPLOADING" && updatedAge > STALE_UPLOAD_MS;

  let title: string;
  let detail: string;
  if (isStaleUpload) {
    title = "Envoi des images interrompu";
    detail = "Vous avez quitté la page d'envoi. Revenez pour relancer.";
  } else if (job.status === "UPLOADING") {
    title = "Envoi des images au serveur…";
    detail = total > 0 ? `${total} fichier(s) reçu(s)` : "En cours…";
  } else if (job.status === "PENDING") {
    title = isImages ? "Import images en attente" : "Import produits en attente";
    detail = "Le serveur va démarrer…";
  } else if (job.status === "PROCESSING") {
    title = isImages ? "Import images en cours" : "Import produits en cours";
    detail = `${processed}/${total || "?"} traité(s)${job.errorItems > 0 ? ` · ${job.errorItems} erreur(s)` : ""}`;
  } else if (isDone) {
    title = isImages ? "Import images terminé" : "Import produits terminé";
    detail = `${job.successItems} réussi(s)${job.errorItems > 0 ? ` · ${job.errorItems} erreur(s)` : ""}`;
  } else if (isFailed) {
    title = isImages ? "Import images échoué" : "Import produits échoué";
    detail = job.errorMessage?.slice(0, 80) || "Une erreur est survenue.";
  } else {
    return null;
  }

  const colorClasses = isStaleUpload || isFailed
    ? "border-red-200 bg-red-50"
    : isDone
      ? (job.errorItems > 0 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50")
      : "border-blue-200 bg-blue-50";

  const accentText = isStaleUpload || isFailed
    ? "text-red-800"
    : isDone
      ? (job.errorItems > 0 ? "text-amber-800" : "text-green-800")
      : "text-blue-800";

  const accentSub = isStaleUpload || isFailed
    ? "text-red-700"
    : isDone
      ? (job.errorItems > 0 ? "text-amber-700" : "text-green-700")
      : "text-blue-700";

  const barClasses = isStaleUpload || isFailed
    ? "bg-red-500"
    : isDone
      ? (job.errorItems > 0 ? "bg-amber-500" : "bg-green-500")
      : "bg-blue-500";

  return (
    <div
      className={`fixed bottom-4 left-4 z-[9000] w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-lg p-3.5 font-body animate-fadeIn ${colorClasses}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2.5">
        <span className="text-lg shrink-0" aria-hidden="true">{isImages ? "🖼️" : "📦"}</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${accentText} truncate`}>{title}</p>
          <p className={`text-xs ${accentSub} mt-0.5 truncate`}>{detail}</p>

          {isActive && total > 0 && !isStaleUpload && (
            <div className="mt-2 h-1.5 bg-white/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barClasses}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <Link
              href="/admin/produits/importer"
              className={`text-xs font-medium underline-offset-2 hover:underline ${accentText}`}
            >
              Revenir à l&apos;import
            </Link>
            {isStaleUpload && (
              <button
                type="button"
                onClick={() => cancelJob(job.id)}
                className={`text-xs font-medium ${accentText} hover:opacity-80 underline-offset-2 hover:underline`}
              >
                Annuler cet envoi
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(job.id)}
              className={`text-xs ${accentSub} hover:opacity-80 ml-auto`}
            >
              Masquer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
