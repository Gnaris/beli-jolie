"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Step = "upload" | "preview" | "uploading" | "done";

interface FileSummaryGroup {
  reference: string;
  files: { name: string; url: string; color: string; position: number; valid: boolean; error?: string }[];
}

// Parse filename: "REFERENCE COLOR POSITION.ext" or "REFERENCE_COLOR_POSITION.ext"
// Supports multi-color: "A200_Doré/Rouge/Noir_1.jpg" or "A200 Doré/Rouge/Noir 1.jpg"
function parseFilename(filename: string): { reference: string; color: string; position: number } | null {
  const extIdx = filename.lastIndexOf(".");
  const base = extIdx >= 0 ? filename.slice(0, extIdx) : filename;

  let parts: string[];
  if (base.includes("_") && !base.includes(" ")) {
    parts = base.split("_").filter(Boolean);
  } else {
    parts = base.split(" ").filter(Boolean);
  }

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

const BATCH_SIZE = 50; // images per upload batch

export default function ImportImagesTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [previewGroups, setPreviewGroups] = useState<FileSummaryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload progress
  const [uploadedBatches, setUploadedBatches] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles(selected);
    // Only create preview URLs for the first 200 files to save memory
    setPreviews(selected.slice(0, 200).map((f) => URL.createObjectURL(f)));
    setStep("upload");
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setFiles(dropped);
    setPreviews(dropped.slice(0, 200).map((f) => URL.createObjectURL(f)));
    setStep("upload");
    setError(null);
  };

  const showPreview = () => {
    if (files.length === 0) return;
    // Only preview first 200 files
    const previewFiles = files.slice(0, 200);
    const previewPreviews = previews.slice(0, 200);
    const groups = buildPreview(previewFiles, previewPreviews);
    setPreviewGroups(groups);
    setStep("preview");
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setStep("uploading");

    try {
      // Step 1: Create import job
      const createFd = new FormData();
      createFd.append("type", "IMAGES");
      createFd.append("file", new Blob(), "placeholder"); // Required by the route
      const createRes = await fetch("/api/admin/import-jobs", { method: "POST", body: createFd });
      const createData = await createRes.json();
      if (!createRes.ok) { setError(createData.error ?? "Erreur création du job."); setStep("preview"); return; }

      const jobId = createData.jobId;
      const batches = Math.ceil(files.length / BATCH_SIZE);
      setTotalBatches(batches);
      setUploadedBatches(0);

      // Step 2: Upload files in batches
      for (let i = 0; i < batches; i++) {
        const batchFiles = files.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const fd = new FormData();
        for (const f of batchFiles) fd.append("images", f);

        const res = await fetch(`/api/admin/import-jobs/${jobId}`, { method: "POST", body: fd });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? `Erreur batch ${i + 1}/${batches}.`);
          setStep("preview");
          setLoading(false);
          return;
        }

        setUploadedBatches(i + 1);
      }

      // Step 3: Start processing
      const startFd = new FormData();
      startFd.append("action", "start");
      const startRes = await fetch(`/api/admin/import-jobs/${jobId}`, { method: "POST", body: startFd });
      if (!startRes.ok) {
        const data = await startRes.json();
        setError(data.error ?? "Erreur démarrage du traitement.");
        setStep("preview");
        setLoading(false);
        return;
      }

      // Done — processing continues in background
      setStep("done");
    } catch {
      setError("Erreur réseau.");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setFiles([]); setPreviews([]); setStep("upload"); setError(null); setUploadedBatches(0); setTotalBatches(0); };

  const invalidCount = files.filter((f) => !parseFilename(f.name)).length;
  const validCount = files.length - invalidCount;

  return (
    <div className="space-y-6">
      {/* Naming guide */}
      <div className="bg-[#F7F7F8] border border-[#E5E5E5] rounded-2xl p-6">
        <h3 className="font-semibold text-[#1A1A1A] mb-3 font-[family-name:var(--font-poppins)]">Convention de nommage</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="bg-white border border-[#E5E5E5] rounded-xl p-4 font-mono text-sm mb-3 space-y-1">
              <div>
                <span className="text-blue-600">REFERENCE</span>{" "}
                <span className="text-purple-600">COULEUR</span>{" "}
                <span className="text-orange-600">POSITION</span>
                <span className="text-[#666]">.jpg</span>
              </div>
              <div className="text-[#999]">ou</div>
              <div>
                <span className="text-blue-600">REFERENCE</span>
                <span className="text-[#999]">_</span>
                <span className="text-purple-600">COULEUR</span>
                <span className="text-[#999]">_</span>
                <span className="text-orange-600">POSITION</span>
                <span className="text-[#666]">.jpg</span>
              </div>
            </div>
            <ul className="font-mono text-xs text-[#444] space-y-1">
              <li>REF001 Doré 1.jpg</li>
              <li>REF001_Argenté_2.png</li>
              <li>A200_Doré/Rouge/Noir_1.jpg</li>
              <li>BIJOU-042 Or Rose 3.webp</li>
            </ul>
          </div>
          <ul className="space-y-1 text-[#666] font-[family-name:var(--font-roboto)]">
            <li>• <strong>Référence</strong> : premier mot (sans espace)</li>
            <li>• <strong>Couleur</strong> : mot(s) du milieu</li>
            <li>• <strong>Position</strong> : dernier chiffre (1-10)</li>
            <li>• Formats : .jpg, .jpeg, .png, .webp, .gif</li>
            <li>• Max 5 000 images par import</li>
            <li>• Si couleur introuvable → brouillon avec choix de la bonne variante</li>
          </ul>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 text-sm">
        {(["upload", "preview", "done"] as const).map((s, i) => {
          const isCurrent = step === s || (step === "uploading" && s === "preview");
          const isDone = step === "done" || (step === "uploading" && s === "upload") || (step === "preview" && s === "upload");
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-[#E5E5E5]" />}
              <div className={`flex items-center gap-2 ${isCurrent ? "text-[#1A1A1A] font-medium" : isDone ? "text-green-600" : "text-[#999]"}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCurrent ? "bg-[#1A1A1A] text-white" : isDone ? "bg-green-100 text-green-600" : "bg-[#F7F7F8] text-[#999]"}`}>
                  {isDone ? "✓" : i + 1}
                </span>
                {s === "upload" ? "Images" : s === "preview" ? "Résumé" : "Lancé"}
              </div>
            </div>
          );
        })}
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
            <div className="text-4xl mb-3">
              <svg className="w-12 h-12 mx-auto text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            {files.length > 0 ? (
              <div>
                <p className="font-medium text-[#1A1A1A]">{files.length} image(s) sélectionnée(s)</p>
                <p className="text-sm text-[#666]">{(files.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(1)} Mo</p>
                {invalidCount > 0 && (
                  <p className="text-sm text-amber-600 mt-1">{invalidCount} nom(s) invalide(s) détecté(s)</p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-[#1A1A1A] font-medium">Glissez vos images ici</p>
                <p className="text-sm text-[#666] mt-1">ou cliquez pour sélectionner</p>
                <p className="text-xs text-[#999] mt-2">Formats : .jpg, .jpeg, .png, .webp, .gif · Max 5 000 images</p>
              </div>
            )}
          </div>
          {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
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

          {/* Grouped by reference — show max 20 groups */}
          <div className="space-y-4">
            {previewGroups.slice(0, 20).map((group, gi) => (
              <div key={gi} className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <div className="px-6 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-[#1A1A1A]">{group.reference}</span>
                  <span className="text-xs text-[#666]">{group.files.length} image(s)</span>
                  {group.files.some((f) => !f.valid) && (
                    <span className="ml-auto text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      noms invalides
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
                          <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Valide</span>
                        ) : (
                          <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Format</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {previewGroups.length > 20 && (
              <p className="text-sm text-[#999] text-center">
                … et {previewGroups.length - 20} autres références (aperçu limité aux 20 premières)
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={reset} className="btn-secondary">← Changer les images</button>
            <div className="flex items-center gap-3">
              {invalidCount > 0 && (
                <p className="text-sm text-[#666]">{invalidCount} image(s) au format invalide iront en brouillon.</p>
              )}
              <button onClick={handleSubmit} disabled={loading || files.length === 0} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? "Envoi en cours…" : `Lancer l'import (${files.length} images)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Uploading — shows upload progress */}
      {step === "uploading" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-[#F7F7F8] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#1A1A1A] animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-lg font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
              Envoi des images au serveur
            </p>
            <p className="text-sm text-[#666] mt-1 font-[family-name:var(--font-roboto)]">
              Ne fermez pas cette page pendant l'envoi.
              <br />
              Le traitement continuera en arrière-plan après l'envoi.
            </p>
          </div>

          {/* Upload progress bar */}
          <div>
            <div className="flex items-center justify-between text-sm text-[#666] mb-2">
              <span>Lot {uploadedBatches}/{totalBatches}</span>
              <span>{totalBatches > 0 ? Math.round((uploadedBatches / totalBatches) * 100) : 0}%</span>
            </div>
            <div className="w-full h-3 bg-[#F0F0F0] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300 ease-out"
                style={{
                  width: `${totalBatches > 0 ? (uploadedBatches / totalBatches) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #1A1A1A, #444)",
                }}
              />
            </div>
            <p className="text-xs text-[#999] mt-2 text-center">
              {uploadedBatches * BATCH_SIZE > files.length ? files.length : uploadedBatches * BATCH_SIZE} / {files.length} images envoyées
            </p>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
        </div>
      )}

      {/* Step: Done — upload complete, processing in background */}
      {step === "done" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-amber-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <div>
            <p className="text-xl font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">
              Traitement en cours...
            </p>
            <p className="text-[#666] mt-1 font-[family-name:var(--font-roboto)]">
              {files.length} image(s) envoyées. Le serveur les traite en arrière-plan.
            </p>
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 font-[family-name:var(--font-roboto)]">
              Les images ne sont <strong>pas encore importées</strong>. Le serveur vérifie chaque référence et couleur.
              <br />
              En cas d'erreur (référence introuvable, couleur inconnue), vous pourrez corriger dans le brouillon.
            </div>
            <p className="text-[#999] text-sm mt-3 font-[family-name:var(--font-roboto)]">
              Vous pouvez fermer cette page ou éteindre votre PC.
              <br />
              Suivez la progression dans le panneau en bas à droite.
            </p>
          </div>
          <div className="flex justify-center gap-3">
            <button onClick={() => router.push("/admin/produits")} className="btn-primary text-sm">Voir les produits</button>
            <button onClick={reset} className="btn-secondary text-sm">Nouvel import</button>
          </div>
        </div>
      )}
    </div>
  );
}
