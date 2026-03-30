"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PfsPrepareJob {
  id: string;
  status: "PENDING" | "ANALYZING" | "NEEDS_VALIDATION" | "RUNNING" | "COMPLETED" | "FAILED" | "STOPPED";
  totalProducts: number;
  processedProducts: number;
  readyProducts: number;
  errorProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  lastPage: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActiveImportJob {
  id: string;
  status: "PENDING" | "PROCESSING" | "UPLOADING";
  type: string;
  totalItems: number;
  processedItems: number;
  createdAt: string;
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function PfsSyncPageClient() {
  const router = useRouter();
  const [customLimit, setCustomLimit] = useState("");
  const [pfsCount, setPfsCount] = useState<number | null>(null);
  const [bjCount, setBjCount] = useState<number | null>(null);
  const [job, setJob] = useState<PfsPrepareJob | null>(null);
  const [activeImportJob, setActiveImportJob] = useState<ActiveImportJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // ── Fetch PFS + BJ product counts ──
  useEffect(() => {
    fetch("/api/admin/pfs-sync/count")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.pfsCount === "number") setPfsCount(d.pfsCount);
        if (typeof d.bjCount === "number") setBjCount(d.bjCount);
      })
      .catch(() => {});
  }, []);

  // ── Fetch latest job on load ──
  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pfs-sync/prepare");
      const data = await res.json();
      if (data.job) setJob(data.job);
      else setJob(null);
      setActiveImportJob(data.activeImportJob || null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // ── Start import ──
  const startImport = async () => {
    setStarting(true);
    setError(null);

    try {
      const limit = parseInt(customLimit, 10);
      const res = await fetch("/api/admin/pfs-sync/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit > 0 ? { limit } : {}),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409 && data.jobId) {
          // Job already running — redirect to it
          router.push(`/admin/pfs/resume/${data.jobId}`);
          return;
        }
        setError(data.error || "Erreur lors du lancement");
        return;
      }

      // Redirect to the resume page
      router.push(`/admin/pfs/resume/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setStarting(false);
    }
  };

  const countsLoaded = pfsCount !== null && bjCount !== null;
  const countsMatch = countsLoaded && pfsCount === bjCount;
  const isActive = job?.status === "RUNNING" || job?.status === "ANALYZING" || job?.status === "PENDING" || job?.status === "NEEDS_VALIDATION";
  const hasActiveImport = !!activeImportJob;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Paris Fashion Shop</h1>
          <p className="page-subtitle">
            Synchronisez et mappez vos produits depuis le marketplace B2B
          </p>
        </div>
      </div>

      {/* PFS vs BJ count comparison card */}
      <div className="card p-4 flex flex-wrap items-center gap-6">
        {/* PFS count */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-bg-secondary flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-text-secondary font-body">Produits PFS</p>
            <p className="text-lg font-semibold text-text-primary font-heading">
              {pfsCount !== null ? pfsCount.toLocaleString("fr-FR") : (
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
                Les {pfsCount!.toLocaleString("fr-FR")} produits PFS sont tous importés
              </span>
            </>
          ) : (
            <>
              <span className="badge badge-error">Désynchronisé</span>
              <span className="text-xs text-text-secondary font-body">
                {pfsCount! > bjCount!
                  ? `${(pfsCount! - bjCount!).toLocaleString("fr-FR")} produit(s) PFS non importé(s)`
                  : `${(bjCount! - pfsCount!).toLocaleString("fr-FR")} produit(s) BJ en excès`}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between">
        <p className="page-subtitle">
          Importe les produits inexistants depuis Paris Fashion Shop
        </p>
        <Link
          href="/admin/pfs/resume"
          className="btn-secondary text-sm shrink-0"
        >
          Résumé
        </Link>
      </div>

      {/* Active import job banner */}
      {!loading && hasActiveImport && (
        <div className="card p-4 flex items-center gap-4 border-[#F59E0B]/30 bg-[#F59E0B]/5">
          <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-[#F59E0B]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary">
              Une importation est déjà en cours
            </p>
            <p className="text-xs text-text-secondary mt-0.5">
              Veuillez attendre la fin de l&apos;importation avant d&apos;en lancer une nouvelle.
            </p>
          </div>
          <Link
            href="/admin/produits/importer/historique"
            className="btn-secondary text-sm shrink-0"
          >
            Voir
          </Link>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Already synced banner */}
      {!loading && !isActive && !hasActiveImport && countsMatch && countsLoaded && (
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
              Les {pfsCount!.toLocaleString("fr-FR")} produits PFS sont synchronisés avec la boutique.
            </p>
          </div>
        </div>
      )}

      {/* Action buttons (only when no active job, no active import, and not fully synced) */}
      {!loading && !isActive && !hasActiveImport && !countsMatch && (
        <>
          {/* Warning alert */}
          <div className="flex items-start gap-3 bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl px-4 py-3">
            <svg className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm text-[#92400E] font-body">
              <span className="font-semibold">Attention :</span> Paris Fashion Shop sera inutilisable pendant toute la durée de l&apos;importation. Veuillez patienter jusqu&apos;à la fin du processus.
            </p>
          </div>

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
                  Importer les produits inexistants depuis PFS
                </>
              )}
            </button>
          </div>
        </>
      )}

      {/* Active job — redirect link */}
      {!loading && isActive && job && (
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
                {job.status === "NEEDS_VALIDATION" && "En attente de validation des entités manquantes"}
                {job.status === "RUNNING" && "Préparation en cours..."}
                {job.status === "PENDING" && "En attente..."}
              </p>
              <p className="text-text-secondary text-xs mt-1">
                Vous pouvez naviguer librement — l&apos;importation continue en arrière-plan.
              </p>
            </div>
          </div>
          <Link
            href={`/admin/pfs/resume/${job.id}`}
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
