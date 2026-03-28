"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PreviewResult, PreviewProduct, MissingEntity } from "@/app/api/admin/products/import/preview/route";

const TEMPLATE_JSON = JSON.stringify(
  [
    // ── Produit simple : 1 couleur, vente à l'unité ──
    {
      reference: "BJ-001",
      name: "Collier Étoile",
      description: "Collier fin avec pendentif étoile",
      category: "Accessoires",
      sub_categories: ["Petits accessoires"],
      tags: ["tendance", "premium"],
      compositions: [{ material: "Coton", percentage: 100 }],
      colors: [
        { color: "Doré", saleType: "UNIT", unitPrice: 12.50, stock: 200, weight: 30, isPrimary: true },
      ],
    },
    // ── Produit multi-variantes : 3 couleurs, chacune en UNIT + PACK ──
    {
      reference: "PRD-002",
      name: "Produit Classique",
      description: "Produit ajustable, finition soignée",
      category: "Textiles",
      sub_categories: ["T-shirts", "Basiques"],
      tags: ["classique", "ajustable"],
      compositions: [
        { material: "Coton", percentage: 85 },
        { material: "Polyester", percentage: 15 },
      ],
      similar_refs: ["PRD-003", "PRD-004"],
      colors: [
        { color: "Doré", saleType: "UNIT", unitPrice: 8.99, stock: 500, weight: 45, isPrimary: true },
        { color: "Doré", saleType: "PACK", unitPrice: 7.50, stock: 100, weight: 45, packQuantity: 12 },
        { color: "Argenté", saleType: "UNIT", unitPrice: 8.99, stock: 300, weight: 45, isPrimary: false },
        { color: "Argenté", saleType: "PACK", unitPrice: 7.50, stock: 80, weight: 45, packQuantity: 12 },
        { color: "Or Rose", saleType: "UNIT", unitPrice: 9.99, stock: 200, weight: 45, isPrimary: false },
        { color: "Or Rose", saleType: "PACK", unitPrice: 8.50, stock: 50, weight: 45, packQuantity: 12 },
      ],
    },
    // ── Produit avec variante multi-couleurs (sous-couleurs) ──
    {
      reference: "PRD-003",
      name: "Produit Trio",
      description: "Produit tricolore empilable",
      category: "Déco",
      tags: ["trio", "empilable"],
      similar_refs: ["PRD-002"],
      colors: [
        { color: "Doré/Argenté/Or Rose", saleType: "UNIT", unitPrice: 6.50, stock: 150, weight: 15, isPrimary: true, size: "17" },
        { color: "Doré/Argenté/Or Rose", saleType: "PACK", unitPrice: 5.50, stock: 40, weight: 15, packQuantity: 24 },
        { color: "Noir/Doré", saleType: "UNIT", unitPrice: 7.00, stock: 100, weight: 15, size: "18" },
      ],
    },
    // ── Produit avec remise ──
    {
      reference: "PRD-004",
      name: "Produit Promo",
      category: "Accessoires",
      tags: ["promo"],
      compositions: [{ material: "Coton", percentage: 100 }],
      similar_refs: ["PRD-002", "PRD-003"],
      colors: [
        { color: "Doré", saleType: "UNIT", unitPrice: 5.99, stock: 800, weight: 20, isPrimary: true, discountType: "PERCENT", discountValue: 10 },
        { color: "Doré", saleType: "PACK", unitPrice: 4.99, stock: 200, weight: 20, packQuantity: 12, discountType: "PERCENT", discountValue: 15 },
      ],
    },
  ],
  null,
  2
);

type Step = "upload" | "preview" | "done";

export default function ImportProductsTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: number; total: number; draftId?: string; jobId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Job polling state
  const [jobStatus, setJobStatus] = useState<"PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | null>(null);
  const [jobProgress, setJobProgress] = useState({ processed: 0, total: 0, success: 0, errors: 0, errorDraftId: null as string | null, errorMessage: null as string | null });

  // Poll job status when in "done" step
  useEffect(() => {
    if (step !== "done" || !importResult?.jobId) return;
    if (jobStatus === "COMPLETED" || jobStatus === "FAILED") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/import-jobs/${importResult.jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        const job = data.job;
        setJobStatus(job.status);
        setJobProgress({
          processed: job.processedItems,
          total: job.totalItems,
          success: job.successItems,
          errors: job.errorItems,
          errorDraftId: job.errorDraftId,
          errorMessage: job.errorMessage,
        });
      } catch {
        // Silently retry on next interval
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [step, importResult?.jobId, jobStatus]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setStep("upload");
    setPreview(null);
    setError(null);
    setImportResult(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setStep("upload"); setPreview(null); setError(null); }
  };

  const analyzeFile = useCallback(async (targetFile?: File) => {
    const f = targetFile ?? file;
    if (!f) return;
    setLoadingPreview(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", f);
    try {
      const res = await fetch("/api/admin/products/import/preview", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur d'analyse."); return; }
      setPreview(data);
      setStep("preview");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoadingPreview(false);
    }
  }, [file]);

  const confirmImport = async () => {
    if (!file) return;
    setLoadingImport(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", "PRODUCTS");
    try {
      const res = await fetch("/api/admin/import-jobs", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur d'importation."); return; }
      // Job created — background processing started
      setImportResult({ success: 0, errors: 0, total: preview?.totalVariants ?? 0, jobId: data.jobId });
      setStep("done");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoadingImport(false);
    }
  };

  const reset = () => {
    setFile(null); setStep("upload"); setPreview(null); setImportResult(null); setError(null);
    setJobStatus(null); setJobProgress({ processed: 0, total: 0, success: 0, errors: 0, errorDraftId: null, errorMessage: null });
  };

  const downloadTemplate = (type: "json" | "xlsx") => {
    if (type === "json") {
      const blob = new Blob([TEMPLATE_JSON], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "template-produits.json"; a.click();
      URL.revokeObjectURL(url);
    } else {
      window.open("/api/admin/products/import/template", "_blank");
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Format guide ── */}
      <div className="bg-bg-secondary border border-border rounded-2xl p-6">
        <h3 className="font-semibold text-text-primary mb-3 font-heading">Format d'importation</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-[#666]">
          <ul className="space-y-1 font-body">
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">reference</code> — Référence unique</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">name</code> — Nom (FR)</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">color</code> — Couleur (ex: Doré, Doré/Rouge/Noir pour multi-couleur)</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">sale_type</code> — UNIT ou PACK</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">unit_price</code> — Prix HT (€)</li>
            <li><span className="text-red-500">*</span> <code className="bg-bg-primary px-1 rounded text-xs">stock</code> — Stock</li>
            <li><code className="bg-bg-primary px-1 rounded text-xs">pack_qty</code> · <code className="bg-bg-primary px-1 rounded text-xs">category</code> · <code className="bg-bg-primary px-1 rounded text-xs">tags</code></li>
            <li><code className="bg-bg-primary px-1 rounded text-xs">sub_categories</code> · <code className="bg-bg-primary px-1 rounded text-xs">composition</code></li>
            <li><code className="bg-bg-primary px-1 rounded text-xs">similar_refs</code> — Réf. produits similaires (ex: BJ-002,BJ-003)</li>
          </ul>
          <div>
            <p className="font-medium text-text-primary mb-2">Règles</p>
            <ul className="space-y-1 font-body">
              <li>• Excel : <strong>une ligne = une variante couleur</strong> — même référence = même produit</li>
              <li>• Les couleurs et catégories doivent exister en base</li>
              <li>• Produits créés en statut <strong>Hors ligne</strong></li>
              <li>• <strong>Produits similaires</strong> : si la référence n'existe pas encore, le lien sera créé automatiquement quand le produit sera importé plus tard</li>
              <li>• <strong>Traitement en arrière-plan</strong> : vous pouvez fermer la page après confirmation</li>
            </ul>
            <div className="mt-3 flex gap-2">
              <button onClick={() => downloadTemplate("json")} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-bg-primary transition-colors">↓ Template JSON</button>
              <button onClick={() => downloadTemplate("xlsx")} className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-bg-primary transition-colors">↓ Template Excel</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-3 text-sm">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-[#E5E5E5]" />}
            <div className={`flex items-center gap-2 ${step === s ? "text-text-primary font-medium" : step === "done" || (step === "preview" && s === "upload") ? "text-green-600" : "text-[#999]"}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? "bg-bg-dark text-text-inverse" : step === "done" || (step === "preview" && s === "upload") ? "bg-green-100 text-green-600" : "bg-bg-secondary text-[#999]"}`}>
                {step === "done" || (step === "preview" && s === "upload") ? "✓" : i + 1}
              </span>
              {s === "upload" ? "Fichier" : s === "preview" ? "Résumé" : "Importé"}
            </div>
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {step === "upload" && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div
            className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-bg-dark transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input ref={fileRef} type="file" accept=".json,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
            <div className="text-4xl mb-3">📄</div>
            {file ? (
              <div>
                <p className="font-medium text-text-primary">{file.name}</p>
                <p className="text-sm text-[#666]">{(file.size / 1024).toFixed(1)} Ko</p>
              </div>
            ) : (
              <div>
                <p className="text-text-primary font-medium">Glissez votre fichier ici</p>
                <p className="text-sm text-[#666] mt-1">ou cliquez pour sélectionner</p>
                <p className="text-xs text-[#999] mt-2">Formats : .json, .xlsx, .xls</p>
              </div>
            )}
          </div>
          {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
          <div className="mt-4 flex justify-end">
            <button onClick={() => analyzeFile()} disabled={!file || loadingPreview} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {loadingPreview ? "Analyse en cours…" : "Analyser le fichier →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Preview ── */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Produits détectés" value={preview.totalProducts} color="neutral" />
            <StatCard label="Variantes totales" value={preview.totalVariants} color="neutral" />
            <StatCard label="Prêts à importer" value={preview.readyToImport} color="green" />
            <StatCard label="Avec erreurs" value={preview.withErrors + preview.alreadyExist} color={preview.withErrors + preview.alreadyExist > 0 ? "red" : "green"} />
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

          {/* Missing entities — quick create */}
          {preview.missingEntities && preview.missingEntities.length > 0 && (
            <MissingEntitiesPanel
              entities={preview.missingEntities}
              onEntitiesCreated={() => analyzeFile()}
            />
          )}

          {/* Product table — grouped */}
          <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="grid grid-cols-[auto_1fr_1fr_2fr_auto] gap-4 px-6 py-3 bg-bg-secondary border-b border-border text-xs font-medium text-[#666] uppercase tracking-wide">
              <div>Statut</div>
              <div>Référence</div>
              <div>Nom / Catégorie</div>
              <div>Variantes couleurs</div>
              <div>Erreurs</div>
            </div>
            <div className="divide-y divide-[#F0F0F0] max-h-[500px] overflow-y-auto">
              {preview.products.map((p, i) => (
                <ProductPreviewRow key={i} product={p} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <button onClick={reset} className="btn-secondary">← Changer de fichier</button>
            <div className="flex items-center gap-3">
              {preview.readyToImport === 0 && (
                <p className="text-sm text-[#666]">Aucun produit ne peut être importé.</p>
              )}
              {preview.readyToImport > 0 && (
                <p className="text-sm text-[#666]">
                  {preview.withErrors + preview.alreadyExist > 0
                    ? `${preview.readyToImport} produit(s) seront importés, ${preview.withErrors + preview.alreadyExist} ignorés.`
                    : `${preview.readyToImport} produit(s) prêts.`}
                </p>
              )}
              <button
                onClick={confirmImport}
                disabled={loadingImport || preview.readyToImport === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingImport ? "Importation…" : `Confirmer l'importation (${preview.readyToImport})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Done — processing with real-time progress ── */}
      {step === "done" && importResult && (
        <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center space-y-5">
          {/* Icon — spinner while processing, checkmark or X when done */}
          {jobStatus === "COMPLETED" ? (
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${jobProgress.errors > 0 ? "bg-amber-50" : "bg-green-50"}`}>
              <svg className={`w-8 h-8 ${jobProgress.errors > 0 ? "text-amber-600" : "text-green-600"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
          ) : jobStatus === "FAILED" ? (
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          ) : (
            <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-amber-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {/* Title */}
          <p className="text-xl font-semibold font-heading text-text-primary">
            {jobStatus === "COMPLETED"
              ? (jobProgress.errors > 0 ? "Import terminé avec des erreurs" : "Import terminé avec succès !")
              : jobStatus === "FAILED"
              ? "Échec de l'import"
              : "Traitement en cours..."}
          </p>

          {/* Progress bar — during processing */}
          {jobStatus !== "COMPLETED" && jobStatus !== "FAILED" && (
            <div className="max-w-md mx-auto">
              <div className="flex items-center justify-between text-sm text-[#666] mb-2">
                <span>{jobProgress.processed} / {jobProgress.total || preview?.totalProducts || "?"} traité(s)</span>
                <span>{jobProgress.total > 0 ? Math.round((jobProgress.processed / jobProgress.total) * 100) : 0}%</span>
              </div>
              <div className="w-full h-3 bg-[#F0F0F0] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${jobProgress.total > 0 ? (jobProgress.processed / jobProgress.total) * 100 : 0}%`,
                    background: "linear-gradient(90deg, #1A1A1A, #444)",
                  }}
                />
              </div>
              <p className="text-xs text-[#999] mt-3 font-body">
                Le serveur vérifie chaque ligne (couleurs, catégories, etc.). Vous pouvez fermer cette page.
              </p>
            </div>
          )}

          {/* Results — when completed */}
          {jobStatus === "COMPLETED" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto">
                <div className="rounded-xl p-3 bg-bg-secondary border border-border">
                  <p className="text-2xl font-bold font-heading">{jobProgress.total}</p>
                  <p className="text-xs text-[#666]">Total</p>
                </div>
                <div className="rounded-xl p-3 bg-green-50 border border-green-200">
                  <p className="text-2xl font-bold text-green-700 font-heading">{jobProgress.success}</p>
                  <p className="text-xs text-green-600">Importés</p>
                </div>
                <div className={`rounded-xl p-3 border ${jobProgress.errors > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                  <p className={`text-2xl font-bold font-heading ${jobProgress.errors > 0 ? "text-red-700" : "text-green-700"}`}>{jobProgress.errors}</p>
                  <p className={`text-xs ${jobProgress.errors > 0 ? "text-red-600" : "text-green-600"}`}>Erreurs</p>
                </div>
              </div>

              {jobProgress.errorDraftId && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
                  {jobProgress.errors} ligne(s) en erreur. Vous pouvez les corriger dans le brouillon.
                  <br />
                  <Link href={`/admin/produits/importer/brouillon/${jobProgress.errorDraftId}`} className="font-medium underline hover:text-amber-900 transition-colors">
                    Corriger les erreurs →
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Error — when failed */}
          {jobStatus === "FAILED" && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 max-w-lg mx-auto">
              {jobProgress.errorMessage || "Une erreur inattendue est survenue lors du traitement."}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-center gap-3">
            {jobStatus === "COMPLETED" || jobStatus === "FAILED" ? (
              <>
                <Link href="/admin/produits/importer/historique" className="btn-primary text-sm">
                  Voir l&apos;historique
                </Link>
                <button onClick={() => router.push("/admin/produits")} className="btn-secondary text-sm">Voir les produits</button>
                <button onClick={reset} className="btn-secondary text-sm">Nouvelle importation</button>
              </>
            ) : (
              <>
                <button onClick={() => router.push("/admin/produits")} className="btn-secondary text-sm">Voir les produits</button>
                <button onClick={reset} className="btn-secondary text-sm">Nouvelle importation</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: "neutral" | "green" | "red" }) {
  const colors = { neutral: "bg-bg-secondary text-text-primary", green: "bg-green-50 text-green-700", red: "bg-red-50 text-red-700" };
  return (
    <div className={`rounded-xl p-4 ${colors[color]} border border-border`}>
      <p className="text-2xl font-bold font-heading">{value}</p>
      <p className="text-xs mt-0.5 font-body opacity-80">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// Missing Entities Panel — quick create
// ─────────────────────────────────────────────

const ENTITY_LABELS: Record<MissingEntity["type"], { label: string; plural: string; icon: string; action: string }> = {
  category: { label: "Catégorie", plural: "Catégories", icon: "📂", action: "create_category" },
  color: { label: "Couleur", plural: "Couleurs", icon: "🎨", action: "create_color" },
  subcategory: { label: "Sous-catégorie", plural: "Sous-catégories", icon: "📁", action: "create_subcategory" },
  composition: { label: "Composition", plural: "Compositions", icon: "⚗️", action: "create_composition" },
};

function MissingEntitiesPanel({ entities, onEntitiesCreated }: { entities: MissingEntity[]; onEntitiesCreated: () => void }) {
  const [creating, setCreating] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());
  const [creatingAll, setCreatingAll] = useState(false);
  const [colorHexes, setColorHexes] = useState<Record<string, string>>({});
  // Pattern image state per color name
  const [colorModes, setColorModes] = useState<Record<string, "hex" | "pattern">>({});
  const [colorPatterns, setColorPatterns] = useState<Record<string, string>>({});
  const [uploadingPattern, setUploadingPattern] = useState<Set<string>>(new Set());
  const patternInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const grouped = entities.reduce<Record<string, MissingEntity[]>>((acc, e) => {
    (acc[e.type] ??= []).push(e);
    return acc;
  }, {});

  const remaining = entities.filter((e) => !created.has(`${e.type}:${e.name}`));

  const handlePatternUpload = async (colorName: string, file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      alert("Format non supporté. Utilisez PNG, JPG ou WebP.");
      return;
    }
    if (file.size > 512 * 1024) {
      alert("Image trop lourde (max 500 KB).");
      return;
    }
    setUploadingPattern((prev) => new Set(prev).add(colorName));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        setColorPatterns((prev) => ({ ...prev, [colorName]: data.path }));
      }
    } catch {
      // silently ignore
    } finally {
      setUploadingPattern((prev) => { const s = new Set(prev); s.delete(colorName); return s; });
    }
  };

  const removePattern = async (colorName: string) => {
    const patternPath = colorPatterns[colorName];
    if (patternPath) {
      try {
        await fetch("/api/admin/colors/upload-pattern", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: patternPath }),
        });
      } catch { /* ignore */ }
    }
    setColorPatterns((prev) => { const n = { ...prev }; delete n[colorName]; return n; });
    // Reset file input
    const inp = patternInputRefs.current[colorName];
    if (inp) inp.value = "";
  };

  const createEntity = async (entity: MissingEntity, hex?: string) => {
    const key = `${entity.type}:${entity.name}`;
    if (created.has(key) || creating.has(key)) return;

    setCreating((prev) => new Set(prev).add(key));
    try {
      const body: Record<string, string> = {
        action: ENTITY_LABELS[entity.type].action,
        name: entity.name,
      };
      if (entity.type === "color") {
        const mode = colorModes[entity.name] ?? "hex";
        if (mode === "pattern" && colorPatterns[entity.name]) {
          body.patternImage = colorPatterns[entity.name];
        } else if (hex) {
          body.colorHex = hex;
        }
      }
      if (entity.type === "subcategory" && entity.parentCategoryName) {
        body.parentCategoryName = entity.parentCategoryName;
      }

      const res = await fetch("/api/admin/products/import/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCreated((prev) => new Set(prev).add(key));
      }
    } catch {
      // silently ignore
    } finally {
      setCreating((prev) => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const createAll = async () => {
    setCreatingAll(true);
    // Create categories first so subcategories can reference them
    const sorted = [...remaining].sort((a, b) => {
      const order: Record<string, number> = { category: 0, color: 1, composition: 2, subcategory: 3 };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    });
    for (const entity of sorted) {
      await createEntity(entity, colorHexes[entity.name]);
    }
    setCreatingAll(false);
    onEntitiesCreated();
  };

  const handleCreateSingle = async (entity: MissingEntity) => {
    await createEntity(entity, colorHexes[entity.name]);
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-text-primary font-heading text-sm">
            Éléments manquants ({remaining.length})
          </h3>
          <p className="text-xs text-amber-700 mt-0.5 font-body">
            Ces éléments n'existent pas encore en base. Créez-les pour débloquer l'import.
          </p>
        </div>
        {remaining.length > 0 && (
          <button
            onClick={createAll}
            disabled={creatingAll}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {creatingAll ? "Création en cours…" : `Tout créer (${remaining.length})`}
          </button>
        )}
        {remaining.length === 0 && (
          <button onClick={onEntitiesCreated} className="btn-primary text-xs">
            Re-analyser le fichier
          </button>
        )}
      </div>

      <div className="space-y-3">
        {(Object.keys(ENTITY_LABELS) as MissingEntity["type"][]).map((type) => {
          const items = grouped[type];
          if (!items?.length) return null;

          return (
            <div key={type}>
              <p className="text-xs font-medium text-[#666] mb-1.5 uppercase tracking-wide">
                {ENTITY_LABELS[type].icon} {ENTITY_LABELS[type].plural} ({items.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {items.map((entity) => {
                  const key = `${entity.type}:${entity.name}`;
                  const isCreated = created.has(key);
                  const isCreating = creating.has(key);

                  const mode = colorModes[entity.name] ?? "hex";
                  const patternPath = colorPatterns[entity.name];
                  const isUploading = uploadingPattern.has(entity.name);

                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      {type === "color" && !isCreated && (
                        <>
                          {/* Toggle hex / pattern */}
                          <button
                            type="button"
                            onClick={() => setColorModes((prev) => ({ ...prev, [entity.name]: mode === "hex" ? "pattern" : "hex" }))}
                            className="w-6 h-6 rounded border border-border flex items-center justify-center cursor-pointer hover:border-bg-dark transition-colors"
                            title={mode === "hex" ? "Passer en mode motif/image" : "Passer en mode couleur unie"}
                          >
                            {mode === "hex" ? (
                              <span className="text-[10px]">🎨</span>
                            ) : (
                              <span className="text-[10px]">🖼️</span>
                            )}
                          </button>

                          {mode === "hex" ? (
                            <input
                              type="color"
                              value={colorHexes[entity.name] ?? "#9CA3AF"}
                              onChange={(e) => setColorHexes((prev) => ({ ...prev, [entity.name]: e.target.value }))}
                              className="w-6 h-6 rounded border border-border cursor-pointer p-0"
                              title="Choisir la couleur hex"
                            />
                          ) : (
                            <>
                              {patternPath ? (
                                <div className="relative w-6 h-6 rounded border border-border overflow-hidden group">
                                  <img src={patternPath} alt="motif" className="w-full h-full object-cover" />
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); removePattern(entity.name); }}
                                    className="absolute inset-0 bg-black/50 text-text-inverse text-[10px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                    title="Supprimer le motif"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <label
                                  className={`w-6 h-6 rounded border border-dashed border-[#999] flex items-center justify-center cursor-pointer hover:border-bg-dark transition-colors ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
                                  title="Uploader une image motif (PNG, JPG, WebP — max 500KB)"
                                >
                                  {isUploading ? (
                                    <span className="inline-block w-3 h-3 border-2 border-[#999] border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <span className="text-[10px] text-[#999]">+</span>
                                  )}
                                  <input
                                    ref={(el) => { patternInputRefs.current[entity.name] = el; }}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) handlePatternUpload(entity.name, file);
                                    }}
                                  />
                                </label>
                              )}
                            </>
                          )}
                        </>
                      )}
                      {type === "color" && isCreated && patternPath && (
                        <div className="w-6 h-6 rounded border border-green-200 overflow-hidden">
                          <img src={patternPath} alt="motif" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <button
                        onClick={() => handleCreateSingle(entity)}
                        disabled={isCreated || isCreating || (type === "color" && mode === "pattern" && !patternPath && !colorHexes[entity.name])}
                        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                          isCreated
                            ? "bg-green-50 border-green-200 text-green-700 cursor-default"
                            : isCreating
                            ? "bg-bg-primary border-border text-[#999] cursor-wait"
                            : "bg-bg-primary border-border text-text-primary hover:border-bg-dark hover:bg-bg-secondary cursor-pointer"
                        }`}
                      >
                        {isCreated ? (
                          <span className="text-green-600">✓</span>
                        ) : isCreating ? (
                          <span className="inline-block w-3 h-3 border-2 border-[#999] border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <span className="text-[#999]">+</span>
                        )}
                        <span className="font-medium">{entity.name}</span>
                        {entity.parentCategoryName && (
                          <span className="text-[10px] text-[#666] italic">→ {entity.parentCategoryName}</span>
                        )}
                        <span className="text-[10px] text-[#999]">({entity.usedBy} produit{entity.usedBy > 1 ? "s" : ""})</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductPreviewRow({ product: p }: { product: PreviewProduct }) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = p.status === "ok" ? "✓" : p.status === "warning" ? "⚠️" : "✗";
  const statusCls = p.status === "ok"
    ? "text-green-600 bg-green-50"
    : p.status === "warning"
    ? "text-amber-600 bg-amber-50"
    : "text-red-600 bg-red-50";

  return (
    <>
      <div
        className={`grid grid-cols-[auto_1fr_1fr_2fr_auto] gap-4 items-start px-6 py-3 cursor-pointer hover:bg-[#FAFAFA] transition-colors ${p.totalErrors > 0 ? "bg-red-50/20" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status */}
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${statusCls}`}>
          {statusIcon}
        </span>

        {/* Reference */}
        <div>
          <p className="font-mono text-sm font-medium text-text-primary">{p.reference}</p>
          {p.referenceExists && <p className="text-xs text-red-500">Déjà existante</p>}
        </div>

        {/* Name + Category */}
        <div>
          <p className="text-sm font-medium text-text-primary truncate">{p.name || "—"}</p>
          {p.category && (
            <p className={`text-xs ${p.categoryFound ? "text-[#666]" : "text-red-500"}`}>
              {p.category}{!p.categoryFound && " ✗"}
            </p>
          )}
        </div>

        {/* Variants compact */}
        <div className="flex flex-wrap gap-1">
          {p.variants.map((v, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${v.errors.length > 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-bg-secondary border-border text-[#444]"}`}
            >
              {!v.colorFound && <span>⚠️</span>}
              {v.color || "?"}
              <span className="text-[10px] opacity-60">{v.saleType === "PACK" ? `×${v.packQuantity ?? "?"}` : `${v.unitPrice}€`}</span>
            </span>
          ))}
        </div>

        {/* Error count */}
        <div className="text-right">
          {p.totalErrors > 0 ? (
            <span className="text-xs text-red-600 font-medium">{p.totalErrors} erreur{p.totalErrors > 1 ? "s" : ""}</span>
          ) : (
            <span className="text-xs text-green-600">OK</span>
          )}
          <div className="text-xs text-[#999] mt-0.5">{expanded ? "▲" : "▼"}</div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-6 pb-4 bg-[#FAFAFA] border-t border-border-light">
          <div className="grid gap-2 pt-3">
            {p.variants.map((v, i) => (
              <div key={i} className={`flex items-start gap-3 p-2 rounded-lg text-sm ${v.errors.length > 0 ? "bg-red-50" : "bg-bg-primary"}`}>
                <div className="w-1/4 font-medium text-text-primary">{v.color || "—"}</div>
                <div className="text-[#666]">{v.saleType}{v.saleType === "PACK" ? ` × ${v.packQuantity}` : ""} · {v.unitPrice}€ · stock: {v.stock}</div>
                {v.errors.length > 0 && (
                  <div className="ml-auto text-red-600 text-xs">{v.errors.join(" · ")}</div>
                )}
              </div>
            ))}
            {p.category && !p.categoryFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Catégorie &laquo;{p.category}&raquo; introuvable.</div>
            )}
            {p.composition && !p.compositionsFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Composition(s) introuvable(s) : {p.composition}</div>
            )}
            {p.subCategories && !p.subCategoriesFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Sous-catégorie(s) introuvable(s) : {p.subCategories}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
