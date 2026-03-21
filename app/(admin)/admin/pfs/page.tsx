"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PfsSyncJob {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  totalProducts: number;
  processedProducts: number;
  createdProducts: number;
  updatedProducts: number;
  skippedProducts: number;
  errorProducts: number;
  lastPage: number;
  errorMessage: string | null;
  errorDetails: { reference: string; error: string }[] | null;
  createdAt: string;
  updatedAt: string;
}

interface MissingCategory {
  pfsName: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingColor {
  pfsName: string;
  pfsReference: string;
  suggestedName: string;
  hex: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingComposition {
  pfsName: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface AnalyzeResult {
  totalScanned: number;
  missingEntities: {
    categories: MissingCategory[];
    colors: MissingColor[];
    compositions: MissingComposition[];
  };
  existingMappings: number;
}

// Editable state for each entity type
interface EditableCategory {
  pfsName: string;
  name: string;
  labels: Record<string, string>;
  usedBy: number;
}

interface EditableColor {
  pfsName: string;
  pfsReference: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  colorMode: "hex" | "pattern";
  labels: Record<string, string>;
  usedBy: number;
}

interface EditableComposition {
  pfsName: string;
  name: string;
  labels: Record<string, string>;
  usedBy: number;
}

type Step = "idle" | "analyzing" | "validation" | "creating" | "syncing";

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function PfsSyncPage() {
  const [step, setStep] = useState<Step>("idle");
  const [pendingLimit, setPendingLimit] = useState<number | undefined>(undefined);
  const [analyzeProgress, setAnalyzeProgress] = useState("");

  // Analyze results (editable)
  const [editCategories, setEditCategories] = useState<EditableCategory[]>([]);
  const [editColors, setEditColors] = useState<EditableColor[]>([]);
  const [editCompositions, setEditCompositions] = useState<EditableComposition[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [existingMappings, setExistingMappings] = useState(0);

  // Sync job
  const [job, setJob] = useState<PfsSyncJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch latest job on load ──
  const fetchJob = useCallback(async (jobId?: string) => {
    try {
      const url = jobId ? `/api/admin/pfs-sync?id=${jobId}` : "/api/admin/pfs-sync";
      const res = await fetch(url);
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

  // Poll while running
  useEffect(() => {
    if (job?.status !== "RUNNING" && job?.status !== "PENDING") return;
    setStep("syncing");
    const interval = setInterval(() => fetchJob(job.id), 3000);
    return () => clearInterval(interval);
  }, [job?.status, job?.id, fetchJob]);

  // When job completes, reset step
  useEffect(() => {
    if (job?.status === "COMPLETED" || job?.status === "FAILED") {
      setStep("idle");
    }
  }, [job?.status]);

  // ── Step 1: Analyze ──
  const startAnalyze = async (limit?: number) => {
    setPendingLimit(limit);
    setStep("analyzing");
    setError(null);
    setAnalyzeProgress("Analyse des produits PFS en cours...");

    try {
      const res = await fetch("/api/admin/pfs-sync/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit ? { limit } : {}),
      });
      const data: AnalyzeResult = await res.json();

      if (!res.ok) {
        setError((data as unknown as { error: string }).error || "Erreur lors de l'analyse");
        setStep("idle");
        return;
      }

      setTotalScanned(data.totalScanned);
      setExistingMappings(data.existingMappings);

      // Convert to editable state
      setEditCategories(
        data.missingEntities.categories.map((c) => ({
          pfsName: c.pfsName,
          name: c.suggestedName,
          labels: c.pfsLabels,
          usedBy: c.usedBy,
        })),
      );
      setEditColors(
        data.missingEntities.colors.map((c) => ({
          pfsName: c.pfsName,
          pfsReference: c.pfsReference,
          name: c.suggestedName,
          hex: c.hex,
          patternImage: null,
          colorMode: "hex" as const,
          labels: c.pfsLabels,
          usedBy: c.usedBy,
        })),
      );
      setEditCompositions(
        data.missingEntities.compositions.map((c) => ({
          pfsName: c.pfsName,
          name: c.suggestedName,
          labels: c.pfsLabels,
          usedBy: c.usedBy,
        })),
      );

      const totalMissing =
        data.missingEntities.categories.length +
        data.missingEntities.colors.length +
        data.missingEntities.compositions.length;

      if (totalMissing === 0) {
        // No missing entities — go straight to sync
        setStep("idle");
        await startSync(limit);
      } else {
        setStep("validation");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("idle");
    }
  };

  // ── Step 2: Create entities & start sync ──
  const validateAndSync = async () => {
    setStep("creating");
    setError(null);

    try {
      // Create missing entities
      const res = await fetch("/api/admin/pfs-sync/create-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: editCategories.map((c) => ({
            pfsName: c.pfsName,
            name: c.name,
            labels: c.labels,
          })),
          colors: editColors.map((c) => ({
            pfsName: c.pfsName,
            name: c.name,
            hex: c.colorMode === "hex" ? c.hex : null,
            patternImage: c.colorMode === "pattern" ? c.patternImage : null,
            labels: c.labels,
          })),
          compositions: editCompositions.map((c) => ({
            pfsName: c.pfsName,
            name: c.name,
            labels: c.labels,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Erreur lors de la création des entités");
        setStep("validation");
        return;
      }

      // Start actual sync
      await startSync(pendingLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("validation");
    }
  };

  // ── Start sync (after validation or if no missing entities) ──
  const startSync = async (limit?: number) => {
    setStep("syncing");
    setError(null);

    try {
      const res = await fetch("/api/admin/pfs-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit ? { limit } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors du lancement");
        if (data.jobId) fetchJob(data.jobId);
        setStep("idle");
        return;
      }
      fetchJob(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("idle");
    }
  };

  const resumeSync = async () => {
    if (!job) return;
    setStep("syncing");
    setError(null);
    try {
      const res = await fetch("/api/admin/pfs-sync/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la reprise");
        setStep("idle");
        return;
      }
      fetchJob(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("idle");
    }
  };

  const progress =
    job && job.totalProducts > 0
      ? Math.round((job.processedProducts / job.totalProducts) * 100)
      : 0;

  const isRunning = job?.status === "RUNNING" || job?.status === "PENDING";
  const isFailed = job?.status === "FAILED";
  const isCompleted = job?.status === "COMPLETED";
  const isBusy = step === "analyzing" || step === "creating" || step === "syncing";

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/admin/produits"
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          &larr; Retour aux produits
        </Link>
      </div>

      <div>
        <h1 className="page-title">Synchronisation PFS</h1>
        <p className="page-subtitle">
          Importe et synchronise les produits depuis Paris Fashion Shop
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: IDLE — Action buttons              */}
      {/* ──────────────────────────────────────── */}
      {step === "idle" && !isRunning && (
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => startAnalyze(10)}
            disabled={isBusy}
            className="btn-secondary"
          >
            Test (10 produits)
          </button>

          <button
            onClick={() => startAnalyze()}
            disabled={isBusy}
            className="btn-primary"
          >
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
            Sync compl&egrave;te (~9 251 produits)
          </button>

          {isFailed && job && (
            <button onClick={resumeSync} disabled={isBusy} className="btn-secondary">
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
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"
                />
              </svg>
              Reprendre (page {job.lastPage + 1})
            </button>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: ANALYZING                          */}
      {/* ──────────────────────────────────────── */}
      {step === "analyzing" && (
        <div className="card p-8 text-center space-y-4">
          <svg
            className="animate-spin w-10 h-10 mx-auto text-text-secondary"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-text-secondary text-sm">{analyzeProgress}</p>
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: VALIDATION                         */}
      {/* ──────────────────────────────────────── */}
      {step === "validation" && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="card p-6">
            <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary mb-2">
              R&eacute;sultat de l&apos;analyse
            </h2>
            <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
              <span>{totalScanned} produits analys&eacute;s</span>
              <span>{existingMappings} mappings existants</span>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <span className="badge-warning">
                {editCategories.length} cat&eacute;gorie{editCategories.length > 1 ? "s" : ""} manquante{editCategories.length > 1 ? "s" : ""}
              </span>
              <span className="badge-info">
                {editColors.length} couleur{editColors.length > 1 ? "s" : ""} manquante{editColors.length > 1 ? "s" : ""}
              </span>
              <span className="badge-neutral">
                {editCompositions.length} composition{editCompositions.length > 1 ? "s" : ""} manquante{editCompositions.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Categories */}
          {editCategories.length > 0 && (
            <ValidationSection title="Cat&eacute;gories manquantes">
              {editCategories.map((cat, idx) => (
                <div
                  key={`cat-${idx}`}
                  className="bg-bg-primary border border-border rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">
                      PFS: <code className="font-medium">{cat.pfsName}</code> &middot;{" "}
                      {cat.usedBy} produit{cat.usedBy > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div>
                    <label className="field-label">Nom</label>
                    <input
                      type="text"
                      className="field-input"
                      value={cat.name}
                      onChange={(e) => {
                        const updated = [...editCategories];
                        updated[idx] = { ...updated[idx], name: e.target.value };
                        setEditCategories(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
            </ValidationSection>
          )}

          {/* Colors */}
          {editColors.length > 0 && (
            <ValidationSection title="Couleurs manquantes">
              {editColors.map((col, idx) => (
                <ColorEditor
                  key={`col-${idx}`}
                  color={col}
                  onChange={(updated) => {
                    const list = [...editColors];
                    list[idx] = updated;
                    setEditColors(list);
                  }}
                />
              ))}
            </ValidationSection>
          )}

          {/* Compositions */}
          {editCompositions.length > 0 && (
            <ValidationSection title="Compositions manquantes">
              {editCompositions.map((comp, idx) => (
                <div
                  key={comp.pfsName}
                  className="bg-bg-primary border border-border rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">
                      PFS: <code className="font-medium">{comp.pfsName}</code> &middot;{" "}
                      {comp.usedBy} produit{comp.usedBy > 1 ? "s" : ""}
                    </span>
                  </div>
                  <div>
                    <label className="field-label">Nom</label>
                    <input
                      type="text"
                      className="field-input"
                      value={comp.name}
                      onChange={(e) => {
                        const updated = [...editCompositions];
                        updated[idx] = { ...updated[idx], name: e.target.value };
                        setEditCompositions(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
            </ValidationSection>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => setStep("idle")}
              className="btn-secondary"
            >
              Annuler
            </button>
            <button
              onClick={validateAndSync}
              className="btn-primary"
            >
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
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Valider et synchroniser
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: CREATING entities                  */}
      {/* ──────────────────────────────────────── */}
      {step === "creating" && (
        <div className="card p-8 text-center space-y-4">
          <svg
            className="animate-spin w-10 h-10 mx-auto text-text-secondary"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <p className="text-text-secondary text-sm">
            Cr&eacute;ation des &eacute;l&eacute;ments manquants...
          </p>
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* Loading state                            */}
      {/* ──────────────────────────────────────── */}
      {loading && step === "idle" && (
        <div className="card p-8 text-center text-text-secondary">
          Chargement...
        </div>
      )}

      {/* No job yet */}
      {!loading && !job && step === "idle" && (
        <div className="card p-8 text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-text-secondary opacity-40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
            />
          </svg>
          <p className="text-text-secondary text-sm">
            Aucune synchronisation lanc&eacute;e. Cliquez sur un bouton ci-dessus pour commencer.
          </p>
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* Active/Latest job                        */}
      {/* ──────────────────────────────────────── */}
      {job && step !== "validation" && (
        <>
          {/* Progress bar */}
          {isRunning && (
            <div className="card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary">
                  Synchronisation en cours...
                </h2>
                <span className="badge-info">{progress}%</span>
              </div>
              <div className="w-full bg-bg-secondary rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-[#22C55E] rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-text-secondary">
                {job.processedProducts.toLocaleString()} /{" "}
                {job.totalProducts.toLocaleString()} produits trait&eacute;s
                {job.lastPage > 0 && ` (page ${job.lastPage})`}
              </p>
            </div>
          )}

          {/* Status banner */}
          {isCompleted && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Synchronisation termin&eacute;e le{" "}
              {new Date(job.updatedAt).toLocaleString("fr-FR")}
            </div>
          )}

          {isFailed && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              <div className="flex items-center gap-2 font-medium">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                Synchronisation &eacute;chou&eacute;e
              </div>
              {job.errorMessage && <p className="mt-1">{job.errorMessage}</p>}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="Total" value={job.totalProducts} color="neutral" />
            <StatCard label="Trait&eacute;s" value={job.processedProducts} color="neutral" />
            <StatCard label="Cr&eacute;&eacute;s" value={job.createdProducts} color="green" />
            <StatCard label="Mis &agrave; jour" value={job.updatedProducts} color="blue" />
            <StatCard label="Ignor&eacute;s" value={job.skippedProducts} color="amber" />
            <StatCard label="Erreurs" value={job.errorProducts} color="red" />
          </div>

          {/* Error details */}
          {job.errorDetails &&
            Array.isArray(job.errorDetails) &&
            job.errorDetails.length > 0 && (
              <div className="card p-6">
                <h3 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary mb-4">
                  D&eacute;tails des erreurs ({job.errorDetails.length})
                </h3>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {job.errorDetails.map((err, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 text-sm py-2 border-b border-border last:border-0"
                    >
                      <code className="text-text-primary font-medium whitespace-nowrap">
                        {err.reference}
                      </code>
                      <span className="text-red-600">{err.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Job info */}
          <div className="card p-4">
            <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
              <span>ID: {job.id}</span>
              <span>
                Cr&eacute;&eacute; le{" "}
                {new Date(job.createdAt).toLocaleString("fr-FR")}
              </span>
              <span>Derni&egrave;re page: {job.lastPage}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function ValidationSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6 space-y-4">
      <h3 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ColorEditor({
  color,
  onChange,
}: {
  color: EditableColor;
  onChange: (updated: EditableColor) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handlePatternUpload = async (file: File) => {
    if (file.size > 512 * 1024) {
      alert("Image trop lourde (max 500 KB)");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/colors/upload-pattern", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.path) {
        onChange({ ...color, patternImage: data.path, colorMode: "pattern" });
      }
    } catch {
      // ignore
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-bg-primary border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">
          PFS: <code className="font-medium">{color.pfsName}</code> ({color.pfsReference}) &middot;{" "}
          {color.usedBy} produit{color.usedBy > 1 ? "s" : ""}
        </span>
      </div>

      {/* Name */}
      <div>
        <label className="field-label">Nom</label>
        <input
          type="text"
          className="field-input"
          value={color.name}
          onChange={(e) => onChange({ ...color, name: e.target.value })}
        />
      </div>

      {/* Color mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            color.colorMode === "hex"
              ? "bg-text-primary text-bg-primary"
              : "bg-bg-secondary text-text-secondary hover:bg-bg-secondary/80"
          }`}
          onClick={() => onChange({ ...color, colorMode: "hex" })}
        >
          Couleur unie
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
            color.colorMode === "pattern"
              ? "bg-text-primary text-bg-primary"
              : "bg-bg-secondary text-text-secondary hover:bg-bg-secondary/80"
          }`}
          onClick={() => onChange({ ...color, colorMode: "pattern" })}
        >
          Motif / Image
        </button>
      </div>

      {/* Hex picker */}
      {color.colorMode === "hex" && (
        <div className="flex items-center gap-3">
          <label className="field-label mb-0">Code couleur</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="w-10 h-10 rounded-lg border border-border cursor-pointer"
              value={color.hex || "#9CA3AF"}
              onChange={(e) => onChange({ ...color, hex: e.target.value })}
            />
            <input
              type="text"
              className="field-input w-28"
              value={color.hex || ""}
              placeholder="#000000"
              onChange={(e) => onChange({ ...color, hex: e.target.value })}
            />
          </div>
          {/* Preview swatch */}
          <div
            className="w-8 h-8 rounded-full border border-border"
            style={{ backgroundColor: color.hex || "#9CA3AF" }}
          />
        </div>
      )}

      {/* Pattern upload */}
      {color.colorMode === "pattern" && (
        <div className="space-y-2">
          <label className="field-label">Image du motif</label>
          {color.patternImage ? (
            <div className="flex items-center gap-3">
              <div
                className="w-16 h-16 rounded-xl border border-border bg-cover bg-center"
                style={{ backgroundImage: `url(${color.patternImage})` }}
              />
              <button
                type="button"
                className="text-xs text-red-600 hover:text-red-700"
                onClick={() => onChange({ ...color, patternImage: null })}
              >
                Supprimer
              </button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-border rounded-xl p-4 text-center cursor-pointer hover:border-text-secondary transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handlePatternUpload(file);
              }}
            >
              {uploading ? (
                <span className="text-xs text-text-secondary">Upload en cours...</span>
              ) : (
                <span className="text-xs text-text-secondary">
                  Cliquer ou glisser une image (PNG, JPG, WebP &middot; max 500 KB)
                </span>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePatternUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    neutral: "bg-bg-secondary text-text-primary",
    green: "bg-green-50 text-green-700",
    blue: "bg-blue-50 text-blue-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
  };

  return (
    <div
      className={`rounded-xl p-4 ${colorClasses[color] || colorClasses.neutral}`}
    >
      <div className="text-2xl font-bold font-[family-name:var(--font-poppins)]">
        {value.toLocaleString()}
      </div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}
