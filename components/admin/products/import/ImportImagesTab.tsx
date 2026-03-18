"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Step = "upload" | "preview" | "done";

interface FileSummaryGroup {
  reference: string;
  files: { name: string; url: string; color: string; position: number; valid: boolean; error?: string }[];
}

// Parse filename: "REFERENCE COLOR POSITION.ext"
function parseFilename(filename: string): { reference: string; color: string; position: number } | null {
  const ext = filename.lastIndexOf(".");
  const base = ext >= 0 ? filename.slice(0, ext) : filename;
  const parts = base.split(" ").filter(Boolean);
  if (parts.length < 3) return null;
  const position = parseInt(parts[parts.length - 1], 10);
  if (isNaN(position) || position < 1 || position > 10) return null;
  return { reference: parts[0].toUpperCase(), color: parts.slice(1, -1).join(" "), position };
}

function buildPreview(files: File[], previews: string[]): FileSummaryGroup[] {
  const groups = new Map<string, FileSummaryGroup>();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const parsed = parseFilename(f.name);

    const ref = parsed?.reference ?? "(référence inconnue)";
    if (!groups.has(ref)) groups.set(ref, { reference: ref, files: [] });

    groups.get(ref)!.files.push({
      name: f.name,
      url: previews[i],
      color: parsed?.color ?? "—",
      position: parsed?.position ?? 0,
      valid: !!parsed,
      error: !parsed ? 'Format invalide. Attendu : "REF COULEUR POSITION.ext"' : undefined,
    });
  }

  return [...groups.values()];
}

export default function ImportImagesTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [previewGroups, setPreviewGroups] = useState<FileSummaryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: number; total: number; draftId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles(selected);
    setPreviews(selected.map((f) => URL.createObjectURL(f)));
    setStep("upload");
    setResult(null);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setFiles(dropped);
    setPreviews(dropped.map((f) => URL.createObjectURL(f)));
    setStep("upload");
    setResult(null);
    setError(null);
  };

  const showPreview = () => {
    if (files.length === 0) return;
    const groups = buildPreview(files, previews);
    setPreviewGroups(groups);
    setStep("preview");
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);

    const fd = new FormData();
    for (const f of files) fd.append("images", f);

    try {
      const res = await fetch("/api/admin/products/import/images", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur."); return; }
      setResult(data);
      setStep("done");
    } catch {
      setError("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFiles([]); setPreviews([]); setStep("upload"); setResult(null); setError(null); };

  const invalidCount = files.filter((f) => !parseFilename(f.name)).length;
  const validCount = files.length - invalidCount;

  return (
    <div className="space-y-6">
      {/* Naming guide */}
      <div className="bg-[#F7F7F8] border border-[#E5E5E5] rounded-2xl p-6">
        <h3 className="font-semibold text-[#1A1A1A] mb-3 font-[family-name:var(--font-poppins)]">Convention de nommage</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="bg-white border border-[#E5E5E5] rounded-xl p-4 font-mono text-base mb-3">
              <span className="text-blue-600">REFERENCE</span>{" "}
              <span className="text-purple-600">COULEUR</span>{" "}
              <span className="text-orange-600">POSITION</span>
              <span className="text-[#666]">.jpg</span>
            </div>
            <ul className="font-mono text-xs text-[#444] space-y-1">
              <li>REF001 Doré 1.jpg</li>
              <li>REF001 Argenté 2.png</li>
              <li>BIJOU-042 Or Rose 3.webp</li>
            </ul>
          </div>
          <ul className="space-y-1 text-[#666] font-[family-name:var(--font-roboto)]">
            <li>• <strong>Référence</strong> : premier mot (sans espace)</li>
            <li>• <strong>Couleur</strong> : mot(s) du milieu</li>
            <li>• <strong>Position</strong> : dernier chiffre (1-10)</li>
            <li>• Formats : .jpg, .jpeg, .png, .webp, .gif</li>
            <li>• Si couleur introuvable → brouillon avec choix de la bonne variante</li>
          </ul>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 text-sm">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-[#E5E5E5]" />}
            <div className={`flex items-center gap-2 ${step === s ? "text-[#1A1A1A] font-medium" : step === "done" || (step === "preview" && s === "upload") ? "text-green-600" : "text-[#999]"}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step === s ? "bg-[#1A1A1A] text-white" : step === "done" || (step === "preview" && s === "upload") ? "bg-green-100 text-green-600" : "bg-[#F7F7F8] text-[#999]"}`}>
                {step === "done" || (step === "preview" && s === "upload") ? "✓" : i + 1}
              </span>
              {s === "upload" ? "Images" : s === "preview" ? "Résumé" : "Importé"}
            </div>
          </div>
        ))}
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div
            className="border-2 border-dashed border-[#E5E5E5] rounded-xl p-10 text-center cursor-pointer hover:border-[#1A1A1A] transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
            <div className="text-4xl mb-3">🖼️</div>
            {files.length > 0 ? (
              <div>
                <p className="font-medium text-[#1A1A1A]">{files.length} image(s) sélectionnée(s)</p>
                <p className="text-sm text-[#666]">{(files.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(1)} Mo</p>
                {invalidCount > 0 && (
                  <p className="text-sm text-amber-600 mt-1">⚠️ {invalidCount} nom(s) invalide(s) détecté(s)</p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-[#1A1A1A] font-medium">Glissez vos images ici</p>
                <p className="text-sm text-[#666] mt-1">ou cliquez pour sélectionner</p>
                <p className="text-xs text-[#999] mt-2">Formats : .jpg, .jpeg, .png, .webp, .gif</p>
              </div>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={showPreview} disabled={files.length === 0} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              Voir le résumé →
            </button>
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl p-4 bg-[#F7F7F8] border border-[#E5E5E5]">
              <p className="text-2xl font-bold font-[family-name:var(--font-poppins)]">{files.length}</p>
              <p className="text-xs text-[#666] mt-0.5">Images au total</p>
            </div>
            <div className="rounded-xl p-4 bg-green-50 border border-[#E5E5E5]">
              <p className="text-2xl font-bold text-green-700 font-[family-name:var(--font-poppins)]">{validCount}</p>
              <p className="text-xs text-[#666] mt-0.5">Noms valides</p>
            </div>
            <div className={`rounded-xl p-4 border border-[#E5E5E5] ${invalidCount > 0 ? "bg-amber-50" : "bg-green-50"}`}>
              <p className={`text-2xl font-bold font-[family-name:var(--font-poppins)] ${invalidCount > 0 ? "text-amber-700" : "text-green-700"}`}>{invalidCount}</p>
              <p className="text-xs text-[#666] mt-0.5">Noms invalides</p>
            </div>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

          {/* Grouped by reference */}
          <div className="space-y-4">
            {previewGroups.map((group, gi) => (
              <div key={gi} className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <div className="px-6 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-[#1A1A1A]">{group.reference}</span>
                  <span className="text-xs text-[#666]">{group.files.length} image(s)</span>
                  {group.files.some((f) => !f.valid) && (
                    <span className="ml-auto text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      ⚠️ noms invalides
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-[64px_1fr_1fr_1fr_auto] gap-3 items-center px-4 py-2 bg-[#FAFAFA] border-b border-[#F0F0F0] text-xs font-medium text-[#999] uppercase tracking-wide">
                  <div>Aperçu</div>
                  <div>Fichier</div>
                  <div>Couleur</div>
                  <div>Position</div>
                  <div>Statut</div>
                </div>
                <div className="divide-y divide-[#F5F5F5]">
                  {group.files.map((file, fi) => (
                    <div key={fi} className="grid grid-cols-[64px_1fr_1fr_1fr_auto] gap-3 items-center px-4 py-3">
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#E5E5E5] bg-[#F7F7F8]">
                        <Image src={file.url} alt={file.name} fill className="object-cover" unoptimized />
                      </div>
                      <p className="text-xs text-[#444] break-all leading-tight">{file.name}</p>
                      <p className={`text-xs ${file.valid ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>
                        {file.color}
                      </p>
                      <p className={`text-xs ${file.valid ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>
                        {file.position > 0 ? file.position : "—"}
                      </p>
                      <div>
                        {file.valid ? (
                          <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✓ Valide</span>
                        ) : (
                          <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">✗ Format</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={reset} className="btn-secondary">← Changer les images</button>
            <div className="flex items-center gap-3">
              {invalidCount > 0 && (
                <p className="text-sm text-[#666]">{invalidCount} image(s) au format invalide iront en brouillon.</p>
              )}
              <button onClick={handleSubmit} disabled={loading || files.length === 0} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? `Import de ${files.length} image(s)…` : `Confirmer l'import (${files.length} images)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && result && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center text-3xl mx-auto">✓</div>
          <div>
            <p className="text-xl font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">Import terminé</p>
            <p className="text-[#666] mt-1">{result.success} image(s) importée(s) · {result.errors} erreur(s)</p>
          </div>
          <div className="flex justify-center gap-3">
            {result.draftId && (
              <button onClick={() => router.push(`/admin/produits/importer/brouillon/${result.draftId}`)} className="btn-primary text-sm">
                Corriger les erreurs →
              </button>
            )}
            <button onClick={() => router.push("/admin/produits")} className="btn-secondary text-sm">Voir les produits</button>
            <button onClick={reset} className="text-sm text-[#666] underline">Nouvel import</button>
          </div>
        </div>
      )}
    </div>
  );
}
