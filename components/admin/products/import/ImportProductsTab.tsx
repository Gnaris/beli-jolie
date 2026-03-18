"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { PreviewResult, PreviewProduct } from "@/app/api/admin/products/import/preview/route";

const TEMPLATE_JSON = JSON.stringify(
  [
    {
      reference: "REF001",
      name: "Nom du produit",
      description: "Description optionnelle",
      category: "Nom de la catégorie",
      tags: ["tag1", "tag2"],
      compositions: [{ material: "Acier inoxydable", percentage: 85 }],
      colors: [
        { color: "Doré", saleType: "UNIT", unitPrice: 25.99, stock: 100, weight: 50, isPrimary: true },
        { color: "Argenté", saleType: "PACK", unitPrice: 20.0, stock: 50, weight: 50, isPrimary: false, packQuantity: 12 },
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
  const [importResult, setImportResult] = useState<{ success: number; errors: number; total: number; draftId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const analyzeFile = async () => {
    if (!file) return;
    setLoadingPreview(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
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
  };

  const confirmImport = async () => {
    if (!file) return;
    setLoadingImport(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/admin/products/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur d'importation."); return; }
      setImportResult(data);
      setStep("done");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoadingImport(false);
    }
  };

  const reset = () => {
    setFile(null); setStep("upload"); setPreview(null); setImportResult(null); setError(null);
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
      <div className="bg-[#F7F7F8] border border-[#E5E5E5] rounded-2xl p-6">
        <h3 className="font-semibold text-[#1A1A1A] mb-3 font-[family-name:var(--font-poppins)]">Format d'importation</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm text-[#666]">
          <ul className="space-y-1 font-[family-name:var(--font-roboto)]">
            <li><span className="text-red-500">*</span> <code className="bg-white px-1 rounded text-xs">reference</code> — Référence unique</li>
            <li><span className="text-red-500">*</span> <code className="bg-white px-1 rounded text-xs">name</code> — Nom (FR)</li>
            <li><span className="text-red-500">*</span> <code className="bg-white px-1 rounded text-xs">color</code> — Couleur (doit exister)</li>
            <li><span className="text-red-500">*</span> <code className="bg-white px-1 rounded text-xs">sale_type</code> — UNIT ou PACK</li>
            <li><span className="text-red-500">*</span> <code className="bg-white px-1 rounded text-xs">unit_price</code> — Prix HT (€)</li>
            <li><span className="text-red-500">*</span> <code className="bg-white px-1 rounded text-xs">stock</code> — Stock</li>
            <li><code className="bg-white px-1 rounded text-xs">pack_qty</code> / <code className="bg-white px-1 rounded text-xs">category</code> / <code className="bg-white px-1 rounded text-xs">tags</code> / <code className="bg-white px-1 rounded text-xs">composition</code></li>
          </ul>
          <div>
            <p className="font-medium text-[#1A1A1A] mb-2">Règles</p>
            <ul className="space-y-1 font-[family-name:var(--font-roboto)]">
              <li>• Excel : <strong>une ligne = une variante couleur</strong> — même référence = même produit</li>
              <li>• Les couleurs et catégories doivent exister en base</li>
              <li>• Produits créés en statut <strong>Hors ligne</strong></li>
            </ul>
            <div className="mt-3 flex gap-2">
              <button onClick={() => downloadTemplate("json")} className="text-xs px-3 py-1.5 border border-[#E5E5E5] rounded-lg hover:bg-white transition-colors">↓ Template JSON</button>
              <button onClick={() => downloadTemplate("xlsx")} className="text-xs px-3 py-1.5 border border-[#E5E5E5] rounded-lg hover:bg-white transition-colors">↓ Template Excel</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Step indicator ── */}
      <div className="flex items-center gap-3 text-sm">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-[#E5E5E5]" />}
            <div className={`flex items-center gap-2 ${step === s ? "text-[#1A1A1A] font-medium" : step === "done" || (step === "preview" && s === "upload") ? "text-green-600" : "text-[#999]"}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? "bg-[#1A1A1A] text-white" : step === "done" || (step === "preview" && s === "upload") ? "bg-green-100 text-green-600" : "bg-[#F7F7F8] text-[#999]"}`}>
                {step === "done" || (step === "preview" && s === "upload") ? "✓" : i + 1}
              </span>
              {s === "upload" ? "Fichier" : s === "preview" ? "Résumé" : "Importé"}
            </div>
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {step === "upload" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div
            className="border-2 border-dashed border-[#E5E5E5] rounded-xl p-10 text-center cursor-pointer hover:border-[#1A1A1A] transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input ref={fileRef} type="file" accept=".json,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
            <div className="text-4xl mb-3">📄</div>
            {file ? (
              <div>
                <p className="font-medium text-[#1A1A1A]">{file.name}</p>
                <p className="text-sm text-[#666]">{(file.size / 1024).toFixed(1)} Ko</p>
              </div>
            ) : (
              <div>
                <p className="text-[#1A1A1A] font-medium">Glissez votre fichier ici</p>
                <p className="text-sm text-[#666] mt-1">ou cliquez pour sélectionner</p>
                <p className="text-xs text-[#999] mt-2">Formats : .json, .xlsx, .xls</p>
              </div>
            )}
          </div>
          {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
          <div className="mt-4 flex justify-end">
            <button onClick={analyzeFile} disabled={!file || loadingPreview} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
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

          {/* Product table — grouped */}
          <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="grid grid-cols-[auto_1fr_1fr_2fr_auto] gap-4 px-6 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] text-xs font-medium text-[#666] uppercase tracking-wide">
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

      {/* ── Step: Done ── */}
      {step === "done" && importResult && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center space-y-4">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl mx-auto">✓</div>
          <div>
            <p className="text-xl font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
              Importation terminée
            </p>
            <p className="text-[#666] mt-1 font-[family-name:var(--font-roboto)]">
              {importResult.success} produit(s) importé(s) · {importResult.errors} erreur(s)
            </p>
          </div>
          <div className="flex justify-center gap-3">
            {importResult.draftId && (
              <button onClick={() => router.push(`/admin/produits/importer/brouillon/${importResult.draftId}`)} className="btn-primary text-sm">
                Corriger les erreurs →
              </button>
            )}
            <button onClick={() => router.push("/admin/produits")} className="btn-secondary text-sm">Voir les produits</button>
            <button onClick={reset} className="text-sm text-[#666] underline">Nouvelle importation</button>
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
  const colors = { neutral: "bg-[#F7F7F8] text-[#1A1A1A]", green: "bg-green-50 text-green-700", red: "bg-red-50 text-red-700" };
  return (
    <div className={`rounded-xl p-4 ${colors[color]} border border-[#E5E5E5]`}>
      <p className="text-2xl font-bold font-[family-name:var(--font-poppins)]">{value}</p>
      <p className="text-xs mt-0.5 font-[family-name:var(--font-roboto)] opacity-80">{label}</p>
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
          <p className="font-mono text-sm font-medium text-[#1A1A1A]">{p.reference}</p>
          {p.referenceExists && <p className="text-xs text-red-500">Déjà existante</p>}
        </div>

        {/* Name + Category */}
        <div>
          <p className="text-sm font-medium text-[#1A1A1A] truncate">{p.name || "—"}</p>
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
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${v.errors.length > 0 ? "bg-red-50 border-red-200 text-red-700" : "bg-[#F7F7F8] border-[#E5E5E5] text-[#444]"}`}
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
        <div className="px-6 pb-4 bg-[#FAFAFA] border-t border-[#F0F0F0]">
          <div className="grid gap-2 pt-3">
            {p.variants.map((v, i) => (
              <div key={i} className={`flex items-start gap-3 p-2 rounded-lg text-sm ${v.errors.length > 0 ? "bg-red-50" : "bg-white"}`}>
                <div className="w-1/4 font-medium text-[#1A1A1A]">{v.color || "—"}</div>
                <div className="text-[#666]">{v.saleType}{v.saleType === "PACK" ? ` × ${v.packQuantity}` : ""} · {v.unitPrice}€ · stock: {v.stock}</div>
                {v.errors.length > 0 && (
                  <div className="ml-auto text-red-600 text-xs">{v.errors.join(" · ")}</div>
                )}
              </div>
            ))}
            {p.category && !p.categoryFound && (
              <div className="p-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠️ Catégorie &laquo;{p.category}&raquo; introuvable — elle sera ignorée lors de l'import.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
