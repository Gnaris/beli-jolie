"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface PfsPrepareJob {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  totalProducts: number;
  processedProducts: number;
  readyProducts: number;
  errorProducts: number;
  approvedProducts: number;
  rejectedProducts: number;
  lastPage: number;
  errorMessage: string | null;
  logs: {
    productLogs: string[];
    imageLogs: string[];
    imageStats: {
      total: number;
      completed: number;
      failed: number;
      active: number;
      pending: number;
    };
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface MissingCategory {
  pfsName: string;
  pfsCategoryId: string;
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

interface EditableCategory {
  pfsName: string;
  pfsCategoryId: string;
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

type Step = "idle" | "analyzing" | "validation" | "creating" | "preparing";

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function PfsSyncPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [pendingLimit, setPendingLimit] = useState<number | undefined>(undefined);
  const [customLimit, setCustomLimit] = useState("");
  const [analyzeProgress, setAnalyzeProgress] = useState("");
  const [pfsCount, setPfsCount] = useState<number | null>(null);

  // Analyze results (editable)
  const [editCategories, setEditCategories] = useState<EditableCategory[]>([]);
  const [editColors, setEditColors] = useState<EditableColor[]>([]);
  const [editCompositions, setEditCompositions] = useState<EditableComposition[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [existingMappings, setExistingMappings] = useState(0);

  // Prepare job
  const [job, setJob] = useState<PfsPrepareJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProductLogs, setShowProductLogs] = useState(true);
  const [showImageLogs, setShowImageLogs] = useState(true);
  const productLogsEndRef = useRef<HTMLDivElement>(null);
  const imageLogsEndRef = useRef<HTMLDivElement>(null);
  const [analyzeLogs, setAnalyzeLogs] = useState<string[]>([]);
  const analyzeLogsEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch PFS product count ──
  useEffect(() => {
    fetch("/api/admin/pfs-sync/count")
      .then((r) => r.json())
      .then((d) => setPfsCount(d.count))
      .catch(() => {});
  }, []);

  // ── Fetch latest prepare job on load ──
  const fetchJob = useCallback(async (jobId?: string) => {
    try {
      const url = jobId
        ? `/api/admin/pfs-sync/prepare?id=${jobId}`
        : "/api/admin/pfs-sync/prepare";
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
    if (step !== "preparing") setStep("preparing");
    const interval = setInterval(() => fetchJob(job.id), 3000);
    return () => clearInterval(interval);
  }, [job?.status, job?.id, fetchJob, step]);

  // Auto-scroll logs
  const logsData = job?.logs || null;
  useEffect(() => {
    if (showProductLogs && productLogsEndRef.current) {
      productLogsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsData?.productLogs, showProductLogs]);
  useEffect(() => {
    if (showImageLogs && imageLogsEndRef.current) {
      imageLogsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsData?.imageLogs, showImageLogs]);
  useEffect(() => {
    if (analyzeLogsEndRef.current) {
      analyzeLogsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [analyzeLogs]);

  // When job fails, reset to idle (redirect to resume happens immediately on job creation now)
  useEffect(() => {
    if (job?.status === "FAILED" && step === "preparing") {
      setStep("idle");
    }
  }, [job?.status, step]);

  // ── Step 1: Analyze (SSE streaming) ──
  const startAnalyze = async (limit?: number) => {
    setPendingLimit(limit);
    setJob(null);
    setStep("analyzing");
    setError(null);
    setAnalyzeLogs([]);
    setAnalyzeProgress("Connexion au serveur...");

    try {
      const res = await fetch("/api/admin/pfs-sync/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit ? { limit } : {}),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Erreur serveur" }));
        setError(data.error || "Erreur lors de l'analyse");
        setStep("idle");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("Streaming non supporté");
        setStep("idle");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finalData: AnalyzeResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "progress") {
              const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
              setAnalyzeLogs((prev) => [...prev, `[${time}] ${data.message}`]);
              setAnalyzeProgress(data.message);
            } else if (data.type === "done") {
              finalData = data as AnalyzeResult;
            } else if (data.type === "error") {
              setError(data.message);
              setStep("idle");
              return;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      if (!finalData) {
        setError("Analyse interrompue sans résultat");
        setStep("idle");
        return;
      }

      setTotalScanned(finalData.totalScanned);
      setExistingMappings(finalData.existingMappings);

      setEditCategories(
        finalData.missingEntities.categories.map((c) => ({
          pfsName: c.pfsName,
          pfsCategoryId: c.pfsCategoryId,
          name: c.suggestedName,
          labels: c.pfsLabels,
          usedBy: c.usedBy,
        })),
      );
      setEditColors(
        finalData.missingEntities.colors.map((c) => ({
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
        finalData.missingEntities.compositions.map((c) => ({
          pfsName: c.pfsName,
          name: c.suggestedName,
          labels: c.pfsLabels,
          usedBy: c.usedBy,
        })),
      );

      const totalMissing =
        finalData.missingEntities.categories.length +
        finalData.missingEntities.colors.length +
        finalData.missingEntities.compositions.length;

      const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setAnalyzeLogs((prev) => [
        ...prev,
        `[${time}] Analyse terminée — ${finalData!.totalScanned} produits, ${totalMissing} entités manquantes`,
      ]);

      if (totalMissing === 0) {
        setStep("idle");
        await startPrepare(limit);
      } else {
        setStep("validation");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("idle");
    }
  };

  // ── Step 2: Create entities & start prepare ──
  const validateAndPrepare = async () => {
    setStep("creating");
    setError(null);

    try {
      const res = await fetch("/api/admin/pfs-sync/create-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: editCategories.map((c) => ({
            pfsName: c.pfsName,
            pfsCategoryId: c.pfsCategoryId,
            name: c.name,
            labels: c.labels,
          })),
          colors: editColors.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
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

      await startPrepare(pendingLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("validation");
    }
  };

  // ── Start prepare (after validation or if no missing entities) ──
  // Redirects immediately to the resume page so products appear one by one
  const startPrepare = async (limit?: number) => {
    setStep("preparing");
    setError(null);

    try {
      const res = await fetch("/api/admin/pfs-sync/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limit ? { limit } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors du lancement");
        setStep("idle");
        return;
      }
      // Redirect immediately — products will appear one by one on the resume page
      router.push(`/admin/pfs/resume/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
      setStep("idle");
    }
  };

  const cancelPrepare = async () => {
    if (!job) return;
    if (!confirm("Annuler la préparation en cours ?")) return;
    try {
      await fetch(`/api/admin/pfs-sync/prepare?id=${job.id}`, {
        method: "DELETE",
      });
      setStep("idle");
    } catch {
      // For now, just reset UI state since cancel route doesn't support prepare jobs yet
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
  const isBusy = step === "analyzing" || step === "creating" || step === "preparing";

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

      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Synchronisation PFS</h1>
          <p className="page-subtitle">
            Prépare et importe les produits depuis Paris Fashion Shop
          </p>
        </div>
        <Link
          href="/admin/pfs/resume"
          className="btn-secondary text-sm shrink-0"
        >
          Résumé
        </Link>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-[#EF4444]/5 border border-[#EF4444]/20 text-[#EF4444] px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: IDLE — Action buttons              */}
      {/* ──────────────────────────────────────── */}
      {step === "idle" && !isRunning && (
        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={10000}
              placeholder="Nb produits"
              value={customLimit}
              onChange={(e) => setCustomLimit(e.target.value)}
              className="field-input w-32 text-sm"
            />
          </div>

          <div className="flex gap-3 flex-1 min-w-0">
            <button
              onClick={() => {
                const n = parseInt(customLimit, 10);
                startAnalyze(n > 0 ? n : 10);
              }}
              disabled={isBusy}
              className="btn-secondary flex-1"
            >
              {customLimit && parseInt(customLimit, 10) > 0
                ? `Préparer ${parseInt(customLimit, 10)} produits`
                : "Test (10 produits)"}
            </button>

          <button
            onClick={() => startAnalyze()}
            disabled={isBusy}
            className="btn-primary flex-1"
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
            {pfsCount !== null
              ? `Préparation complète (~${pfsCount.toLocaleString()} produits)`
              : "Préparation complète"}
          </button>
          </div>

          {/* Show "Review" button if there's a completed job with ready products */}
          {isCompleted && job && job.readyProducts > 0 && (
            <Link
              href={`/admin/pfs/resume/${job.id}`}
              className="btn-secondary"
            >
              <svg className="w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Voir les produits ({job.readyProducts} prêts)
            </Link>
          )}

          {isFailed && job && (
            <button onClick={() => startPrepare(pendingLimit)} disabled={isBusy} className="btn-secondary">
              Reprendre (page {job.lastPage + 1})
            </button>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: ANALYZING                          */}
      {/* ──────────────────────────────────────── */}
      {step === "analyzing" && (
        <div className="space-y-4">
          <div className="card p-6 flex items-center gap-4">
            <svg
              className="animate-spin w-6 h-6 text-[#22C55E] shrink-0"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-text-primary text-sm font-medium">{analyzeProgress}</p>
          </div>

          {analyzeLogs.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-6 py-3 bg-[#1A1A1A] text-white flex items-center gap-3">
                <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span className="font-[family-name:var(--font-poppins)] font-semibold text-sm">
                  Console d&apos;analyse ({analyzeLogs.length} lignes)
                </span>
              </div>
              <div className="bg-[#0D0D0D] text-[#E0E0E0] px-6 py-4 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
                {analyzeLogs.map((line, idx) => (
                  <div
                    key={idx}
                    className={`py-0.5 ${
                      line.includes("terminée") ? "text-green-400"
                        : line.includes("Page") ? "text-blue-300"
                          : line.includes("chargé") ? "text-cyan-300"
                            : ""
                    }`}
                  >
                    {line}
                  </div>
                ))}
                <div ref={analyzeLogsEndRef} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: VALIDATION                         */}
      {/* ──────────────────────────────────────── */}
      {step === "validation" && (
        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary mb-2">
              Résultat de l&apos;analyse
            </h2>
            <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
              <span>{totalScanned} produits analysés</span>
              <span>{existingMappings} mappings existants</span>
            </div>
            <div className="flex flex-wrap gap-3 mt-4">
              <span className="badge badge-warning">
                {editCategories.length} catégorie{editCategories.length > 1 ? "s" : ""} manquante{editCategories.length > 1 ? "s" : ""}
              </span>
              <span className="badge badge-info">
                {editColors.length} couleur{editColors.length > 1 ? "s" : ""} manquante{editColors.length > 1 ? "s" : ""}
              </span>
              <span className="badge badge-neutral">
                {editCompositions.length} composition{editCompositions.length > 1 ? "s" : ""} manquante{editCompositions.length > 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {editCategories.length > 0 && (
            <ValidationSection title="Catégories manquantes">
              {editCategories.map((cat, idx) => (
                <div key={`cat-${idx}`} className="bg-bg-primary border border-border rounded-xl p-4 space-y-3">
                  <span className="text-xs text-text-secondary">
                    PFS: <code className="font-medium">{cat.pfsName}</code> &middot; {cat.usedBy} produit{cat.usedBy > 1 ? "s" : ""}
                  </span>
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

          {editCompositions.length > 0 && (
            <ValidationSection title="Compositions manquantes">
              {editCompositions.map((comp, idx) => (
                <div key={comp.pfsName} className="bg-bg-primary border border-border rounded-xl p-4 space-y-3">
                  <span className="text-xs text-text-secondary">
                    PFS: <code className="font-medium">{comp.pfsName}</code> &middot; {comp.usedBy} produit{comp.usedBy > 1 ? "s" : ""}
                  </span>
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

          <div className="flex gap-3 flex-wrap">
            <button onClick={() => setStep("idle")} className="btn-secondary">
              Annuler
            </button>
            <button onClick={validateAndPrepare} className="btn-primary">
              <svg className="w-5 h-5 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Valider et préparer
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: CREATING entities                  */}
      {/* ──────────────────────────────────────── */}
      {step === "creating" && (
        <div className="card p-8 text-center space-y-4">
          <svg className="animate-spin w-10 h-10 mx-auto text-text-secondary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-text-secondary text-sm">Création des éléments manquants...</p>
        </div>
      )}

      {/* ──────────────────────────────────────── */}
      {/* STEP: PREPARING — Live consoles          */}
      {/* ──────────────────────────────────────── */}
      {step === "preparing" && job && (
        <>
          {/* Progress bar */}
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary">
                Préparation en cours...
              </h2>
              <span className="badge badge-info">{progress}%</span>
            </div>
            <div className="w-full bg-bg-secondary rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-[#22C55E] rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                {job.processedProducts.toLocaleString()} / {job.totalProducts.toLocaleString()} produits
                {job.lastPage > 0 && ` (page ${job.lastPage})`}
              </p>
              <button onClick={cancelPrepare} className="btn-danger text-xs px-3 h-9">
                Annuler
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total" value={job.totalProducts} color="neutral" />
            <StatCard label="Prêts" value={job.readyProducts} color="green" />
            <StatCard label="En cours" value={job.processedProducts - job.readyProducts - job.errorProducts} color="blue" />
            <StatCard label="Erreurs" value={job.errorProducts} color="red" />
          </div>

          {/* Dual consoles */}
          {logsData && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Product console */}
              {logsData.productLogs && logsData.productLogs.length > 0 && (
                <div className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowProductLogs((v) => !v)}
                    aria-expanded={showProductLogs}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[#1A1A1A] text-white hover:bg-[#2A2A2A] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      <span className="font-[family-name:var(--font-poppins)] font-semibold text-sm">
                        Produits ({logsData.productLogs.length})
                      </span>
                    </div>
                    <svg className={`w-4 h-4 transition-transform ${showProductLogs ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {showProductLogs && (
                    <div className="bg-[#0D0D0D] text-[#E0E0E0] px-4 py-3 max-h-80 overflow-y-auto font-mono text-[11px] leading-relaxed">
                      {logsData.productLogs.map((line, idx) => (
                        <div key={idx} className={`py-0.5 ${logColor(line)}`}>{line}</div>
                      ))}
                      <div ref={productLogsEndRef} />
                    </div>
                  )}
                </div>
              )}

              {/* Image console */}
              {((logsData.imageLogs && logsData.imageLogs.length > 0) || logsData.imageStats) && (
                <div className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowImageLogs((v) => !v)}
                    aria-expanded={showImageLogs}
                    className="w-full flex items-center justify-between px-4 py-3 bg-[#1A1A1A] text-white hover:bg-[#2A2A2A] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                      </svg>
                      <span className="font-[family-name:var(--font-poppins)] font-semibold text-sm">
                        Images {logsData.imageStats ? `(${logsData.imageStats.completed}/${logsData.imageStats.total})` : ""}
                      </span>
                    </div>
                    <svg className={`w-4 h-4 transition-transform ${showImageLogs ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {logsData.imageStats && logsData.imageStats.total > 0 && (
                    <div className="bg-[#111] px-4 py-2 flex flex-wrap gap-3 text-[11px] font-mono border-b border-[#222]">
                      <span className="text-green-400">{logsData.imageStats.completed} OK</span>
                      <span className="text-blue-400">{logsData.imageStats.active} en cours</span>
                      <span className="text-yellow-400">{logsData.imageStats.pending} en attente</span>
                      {logsData.imageStats.failed > 0 && <span className="text-red-400">{logsData.imageStats.failed} erreur{logsData.imageStats.failed > 1 ? "s" : ""}</span>}
                    </div>
                  )}
                  {showImageLogs && logsData.imageLogs && (
                    <div className="bg-[#0D0D0D] text-[#E0E0E0] px-4 py-3 max-h-80 overflow-y-auto font-mono text-[11px] leading-relaxed">
                      {logsData.imageLogs.map((line, idx) => (
                        <div key={idx} className={`py-0.5 ${logColor(line)}`}>{line}</div>
                      ))}
                      <div ref={imageLogsEndRef} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Button to go to review while preparing is still running */}
          {job.readyProducts > 0 && (
            <div className="text-center">
              <Link
                href={`/admin/pfs/resume/${job.id}`}
                className="btn-primary inline-block"
              >
                Voir les {job.readyProducts} produit{job.readyProducts > 1 ? "s" : ""} prêt{job.readyProducts > 1 ? "s" : ""}
              </Link>
            </div>
          )}
        </>
      )}

      {/* ──────────────────────────────────────── */}
      {/* Loading state                            */}
      {/* ──────────────────────────────────────── */}
      {loading && step === "idle" && (
        <div className="card p-8 text-center text-text-secondary">
          Chargement...
        </div>
      )}

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
            Aucune préparation lancée. Cliquez sur un bouton ci-dessus pour commencer.
          </p>
        </div>
      )}

      {/* Completed job info (when idle) */}
      {step === "idle" && job && !isRunning && (
        <div className="card p-4">
          <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
            <span>
              {isCompleted ? "Terminé" : isFailed ? "Échoué" : ""} le{" "}
              {new Date(job.updatedAt).toLocaleString("fr-FR")}
            </span>
            <span>{job.readyProducts} prêts</span>
            <span>{job.approvedProducts} approuvés</span>
            <span>{job.rejectedProducts} refusés</span>
            {job.errorMessage && (
              <span className="text-[#EF4444]">{job.errorMessage}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function logColor(line: string): string {
  if (line.includes("❌") || line.includes("💥")) return "text-red-400";
  if (line.includes("✅") || line.includes("🏁")) return "text-green-400";
  if (line.includes("⚠️") || line.includes("⏭")) return "text-yellow-400";
  if (line.includes("▶") || line.includes("──")) return "text-blue-300";
  if (line.includes("🚀") || line.includes("📊") || line.includes("📄")) return "text-cyan-300";
  if (line.includes("⬇️")) return "text-blue-300";
  if (line.includes("📥")) return "text-[#888]";
  if (line.includes("⏳")) return "text-yellow-400";
  return "";
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function ValidationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-6 space-y-4">
      <h3 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ColorEditor({ color, onChange }: { color: EditableColor; onChange: (updated: EditableColor) => void }) {
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
      <span className="text-xs text-text-secondary">
        PFS: <code className="font-medium">{color.pfsName}</code> ({color.pfsReference}) &middot; {color.usedBy} produit{color.usedBy > 1 ? "s" : ""}
      </span>

      <div>
        <label className="field-label">Nom</label>
        <input type="text" className="field-input" value={color.name} onChange={(e) => onChange({ ...color, name: e.target.value })} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${color.colorMode === "hex" ? "bg-text-primary text-bg-primary" : "bg-bg-secondary text-text-secondary hover:bg-bg-secondary/80"}`}
          onClick={() => onChange({ ...color, colorMode: "hex" })}
        >
          Couleur unie
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${color.colorMode === "pattern" ? "bg-text-primary text-bg-primary" : "bg-bg-secondary text-text-secondary hover:bg-bg-secondary/80"}`}
          onClick={() => onChange({ ...color, colorMode: "pattern" })}
        >
          Motif / Image
        </button>
      </div>

      {color.colorMode === "hex" && (
        <div className="flex items-center gap-3">
          <label className="field-label mb-0">Code couleur</label>
          <input type="color" className="w-10 h-10 rounded-lg border border-border cursor-pointer" value={color.hex || "#9CA3AF"} onChange={(e) => onChange({ ...color, hex: e.target.value })} />
          <input type="text" className="field-input w-28" value={color.hex || ""} placeholder="#000000" onChange={(e) => onChange({ ...color, hex: e.target.value })} />
          <div className="w-8 h-8 rounded-full border border-border" style={{ backgroundColor: color.hex || "#9CA3AF" }} />
        </div>
      )}

      {color.colorMode === "pattern" && (
        <div className="space-y-2">
          <label className="field-label">Image du motif</label>
          {color.patternImage ? (
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-xl border border-border bg-cover bg-center" style={{ backgroundImage: `url(${color.patternImage})` }} />
              <button type="button" className="text-xs text-red-600 hover:text-red-700" onClick={() => onChange({ ...color, patternImage: null })}>
                Supprimer
              </button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed border-border rounded-xl p-4 text-center cursor-pointer hover:border-text-secondary transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) handlePatternUpload(file); }}
            >
              {uploading ? (
                <span className="text-xs text-text-secondary">Upload en cours...</span>
              ) : (
                <span className="text-xs text-text-secondary">Cliquer ou glisser une image (PNG, JPG, WebP &middot; max 500 KB)</span>
              )}
            </div>
          )}
          <input ref={fileInputRef} type="file" className="hidden" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePatternUpload(file); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    neutral: "bg-bg-secondary text-text-primary",
    green: "bg-[#22C55E]/10 text-[#22C55E]",
    blue: "bg-[#3B82F6]/10 text-[#3B82F6]",
    amber: "bg-[#F59E0B]/10 text-[#F59E0B]",
    red: "bg-[#EF4444]/10 text-[#EF4444]",
  };

  return (
    <div className={`rounded-xl p-4 ${colorClasses[color] || colorClasses.neutral}`}>
      <div className="text-2xl font-bold font-[family-name:var(--font-poppins)]">
        {value.toLocaleString()}
      </div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}
