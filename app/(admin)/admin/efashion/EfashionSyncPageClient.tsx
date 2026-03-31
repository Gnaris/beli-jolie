"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import EfashionValidationPanel from "@/components/efashion/EfashionValidationPanel";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface EfashionPrepareJob {
  id: string;
  status: "PENDING" | "ANALYZING" | "NEEDS_VALIDATION" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";
  totalProducts: number;
  processedProducts: number;
  readyProducts: number;
  errorProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  lastSkip: number;
  errorMessage: string | null;
  analyzeResult: AnalyzeResult | null;
  logs: {
    productLogs?: string[];
    analyzeLogs?: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface AnalyzeResult {
  totalScanned: number;
  totalNewProducts: number;
  totalExistingSkipped: number;
  missingEntities: {
    categories: { efashionName: string; efashionId?: number; suggestedName: string; usedBy: number }[];
    colors: { efashionName: string; suggestedName: string; hex: string | null; usedBy: number }[];
    compositions: { efashionName: string; suggestedName: string; usedBy: number }[];
  };
  existingMappings: number;
  existingEntities: {
    categories: { id: string; name: string }[];
    colors: { id: string; name: string; hex: string | null; patternImage: string | null }[];
    compositions: { id: string; name: string }[];
  };
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function EfashionSyncPageClient() {
  const router = useRouter();
  const [customLimit, setCustomLimit] = useState("");
  const [efashionCount, setEfashionCount] = useState<number | null>(null);
  const [bjCount, setBjCount] = useState<number | null>(null);
  const [job, setJob] = useState<EfashionPrepareJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // ── Fetch eFashion + BJ product counts ──
  useEffect(() => {
    fetch("/api/admin/efashion-sync/count")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.efashionCount === "number") setEfashionCount(d.efashionCount);
        if (typeof d.bjCount === "number") setBjCount(d.bjCount);
      })
      .catch(() => {});
  }, []);

  // ── Fetch latest job on load ──
  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/efashion-sync");
      const data = await res.json();
      if (data.job) setJob(data.job);
      else setJob(null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // ── Poll job status while active ──
  const isActive = job?.status === "RUNNING" || job?.status === "ANALYZING" || job?.status === "PENDING" || job?.status === "NEEDS_VALIDATION";

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(fetchJob, 3000);
    return () => clearInterval(interval);
  }, [isActive, fetchJob]);

  // ── Start import ──
  const startImport = async () => {
    setStarting(true);
    setError(null);

    try {
      const limit = parseInt(customLimit, 10);
      const res = await fetch("/api/admin/efashion-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit > 0 ? { limit } : {}),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.jobId) {
          router.push(`/admin/efashion/historique/${data.jobId}`);
          return;
        }
        setError(data.error || "Erreur lors du lancement");
        setStarting(false);
        return;
      }

      // Refresh job state to show active status
      setJob({ ...job, id: data.jobId, status: "ANALYZING" } as EfashionPrepareJob);
      setStarting(false);
      // Start polling
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStarting(false);
    }
  };

  const countsLoaded = efashionCount !== null && bjCount !== null;
  const countsMatch = countsLoaded && efashionCount === bjCount;

  // ── Handle validation complete (entities created) ──
  const handleValidated = () => {
    fetchJob();
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">eFashion Paris</h1>
          <p className="page-subtitle">
            Synchronisez et importez vos produits depuis le marketplace B2B eFashion
          </p>
        </div>
      </div>

      {/* eFashion vs BJ count comparison card */}
      <div className="card p-4 flex flex-wrap items-center gap-6">
        {/* eFashion count */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-text-secondary font-body">Produits eFashion</p>
            <p className="text-lg font-semibold text-text-primary font-heading">
              {efashionCount !== null ? efashionCount.toLocaleString("fr-FR") : (
                <span className="inline-block w-12 h-5 bg-bg-secondary rounded animate-pulse" />
              )}
            </p>
          </div>
        </div>

        <div className="w-px h-10 bg-border hidden sm:block" />

        {/* BJ count */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-text-secondary font-body">Produits importés (BJ)</p>
            <p className="text-lg font-semibold text-text-primary font-heading">
              {bjCount !== null ? bjCount.toLocaleString("fr-FR") : (
                <span className="inline-block w-12 h-5 bg-bg-secondary rounded animate-pulse" />
              )}
            </p>
          </div>
        </div>

        <div className="w-px h-10 bg-border hidden sm:block" />

        {/* Status badge */}
        <div className="flex items-center gap-2">
          {!countsLoaded ? (
            <span className="badge badge-neutral">Chargement...</span>
          ) : countsMatch ? (
            <>
              <span className="badge badge-success">Synchronisé</span>
              <span className="text-xs text-text-secondary font-body">
                Les {efashionCount!.toLocaleString("fr-FR")} produits eFashion sont tous importés
              </span>
            </>
          ) : (
            <>
              <span className="badge badge-error">Désynchronisé</span>
              <span className="text-xs text-text-secondary font-body">
                {efashionCount! > bjCount!
                  ? `${(efashionCount! - bjCount!).toLocaleString("fr-FR")} produit(s) eFashion non importé(s)`
                  : `${(bjCount! - efashionCount!).toLocaleString("fr-FR")} produit(s) BJ en excès`}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between">
        <p className="page-subtitle">
          Importe les produits inexistants depuis eFashion Paris
        </p>
        <Link
          href="/admin/efashion/historique"
          className="btn-secondary text-sm shrink-0"
        >
          Historique
        </Link>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Already synced banner */}
      {!loading && !isActive && countsMatch && countsLoaded && (
        <div className="card p-4 flex items-center gap-4 border-[#22C55E]/30 bg-[#22C55E]/5">
          <div className="w-10 h-10 rounded-xl bg-[#22C55E]/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary">
              Tous les produits sont déjà importés
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              Les {efashionCount!.toLocaleString("fr-FR")} produits eFashion sont synchronisés avec la boutique.
            </p>
          </div>
        </div>
      )}

      {/* NEEDS_VALIDATION: show validation panel */}
      {!loading && job?.status === "NEEDS_VALIDATION" && job.analyzeResult && (
        <EfashionValidationPanel
          jobId={job.id}
          analyzeResult={job.analyzeResult}
          onValidated={handleValidated}
        />
      )}

      {/* Action buttons (only when no active job and not fully synced) */}
      {!loading && !isActive && !countsMatch && (
        <>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={10000}
                placeholder="Nb produits (optionnel)"
                value={customLimit}
                onChange={(e) => setCustomLimit(e.target.value)}
                className="field-input w-48 text-sm"
              />
            </div>

            <button
              onClick={startImport}
              disabled={starting}
              className="btn-primary flex-1 min-w-[280px]"
            >
              {starting ? (
                <>
                  <svg className="animate-spin w-5 h-5 mr-2 inline" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Lancement...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5 mr-2 inline"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
                    />
                  </svg>
                  Analyser les produits eFashion
                </>
              )}
            </button>
          </div>
        </>
      )}

      {/* Active job — status display */}
      {!loading && isActive && job && job.status !== "NEEDS_VALIDATION" && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-4">
            <svg
              className="animate-spin w-6 h-6 text-[#22C55E] shrink-0"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div>
              <p className="text-text-primary text-sm font-medium">
                {job.status === "ANALYZING" && "Analyse en cours..."}
                {job.status === "RUNNING" && `Préparation en cours... (${job.processedProducts}/${job.totalProducts})`}
                {job.status === "PENDING" && "En attente..."}
              </p>
              <p className="text-text-secondary text-xs mt-1">
                Vous pouvez naviguer librement — l&apos;importation continue en arrière-plan.
              </p>
            </div>
          </div>

          {/* Progress bar for RUNNING */}
          {job.status === "RUNNING" && job.totalProducts > 0 && (
            <div className="w-full bg-bg-secondary rounded-full h-2">
              <div
                className="bg-[#22C55E] h-2 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (job.processedProducts / job.totalProducts) * 100)}%` }}
              />
            </div>
          )}

          {/* Analyze logs */}
          {job.logs?.analyzeLogs && job.logs.analyzeLogs.length > 0 && (
            <div className="bg-bg-secondary rounded-xl p-3 max-h-48 overflow-y-auto text-xs font-mono text-text-secondary space-y-0.5">
              {job.logs.analyzeLogs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}

          <Link
            href={`/admin/efashion/historique/${job.id}`}
            className="btn-primary inline-block"
          >
            Voir la progression
          </Link>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="card p-8 text-center text-text-secondary">
          Chargement...
        </div>
      )}
    </div>
  );
}
