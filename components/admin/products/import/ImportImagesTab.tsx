"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Step = "upload" | "preview" | "uploading" | "done";
type ConflictStrategy = "replace" | "next_available" | "skip";

interface FileSummaryGroup {
  reference: string;
  files: { name: string; url: string; color: string; position: number; valid: boolean; error?: string }[];
}

interface ConflictInfo {
  filename: string;
  reference: string;
  color: string;
  position: number;
  existingImagePath: string;
  availablePositions: number[];
}

interface PerFileResolution {
  filename: string;
  strategy: ConflictStrategy;
  chosenPosition?: number;
}

function parseFilename(filename: string): { reference: string; color: string; position: number } | null {
  const extIdx = filename.lastIndexOf(".");
  const base = extIdx >= 0 ? filename.slice(0, extIdx) : filename;
  let reference: string;
  let color: string;
  let positionStr: string;
  if (base.includes("_")) {
    const firstUnderscore = base.indexOf("_");
    const lastUnderscore = base.lastIndexOf("_");
    if (firstUnderscore === lastUnderscore) return null;
    reference = base.slice(0, firstUnderscore);
    color = base.slice(firstUnderscore + 1, lastUnderscore);
    positionStr = base.slice(lastUnderscore + 1);
  } else {
    const parts = base.split(" ").filter(Boolean);
    if (parts.length < 3) return null;
    reference = parts[0];
    positionStr = parts[parts.length - 1];
    color = parts.slice(1, parts.length - 1).join(" ");
  }
  const position = parseInt(positionStr, 10);
  if (isNaN(position) || position < 1 || position > 10) return null;
  reference = reference.trim().toUpperCase();
  color = color.trim();
  if (!reference || !color) return null;
  return { reference, color, position };
}

function buildPreview(files: File[], previews: string[]): FileSummaryGroup[] {
  const groups = new Map<string, FileSummaryGroup>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const parsed = parseFilename(f.name);
    const ref = parsed?.reference ?? "(référence inconnue)";
    if (!groups.has(ref)) groups.set(ref, { reference: ref, files: [] });
    groups.get(ref)!.files.push({
      name: f.name, url: previews[i], color: parsed?.color ?? "—",
      position: parsed?.position ?? 0, valid: !!parsed,
      error: !parsed ? "Format invalide." : undefined,
    });
  }
  return [...groups.values()];
}

const BATCH_SIZE = 50;
const STRATEGY_LABELS: Record<ConflictStrategy, string> = {
  replace: "Remplacer l\u2019existante",
  next_available: "Position suivante disponible",
  skip: "Ignorer (ne pas importer)",
};

export default function ImportImagesTab() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("upload");
  const [previewGroups, setPreviewGroups] = useState<FileSummaryGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedBatches, setUploadedBatches] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | null>(null);
  const [jobProgress, setJobProgress] = useState({ processed: 0, total: 0, success: 0, errors: 0, errorDraftId: null as string | null, errorMessage: null as string | null });

  // Conflict state
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [conflictChecked, setConflictChecked] = useState(false);
  const [conflictChecking, setConflictChecking] = useState(false);
  const [defaultStrategy, setDefaultStrategy] = useState<ConflictStrategy>("replace");
  const [perFileResolutions, setPerFileResolutions] = useState<Map<string, PerFileResolution>>(new Map());

  useEffect(() => {
    if (step !== "done" || !jobId) return;
    if (jobStatus === "COMPLETED" || jobStatus === "FAILED") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/import-jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        const job = data.job;
        setJobStatus(job.status);
        setJobProgress({ processed: job.processedItems, total: job.totalItems, success: job.successItems, errors: job.errorItems, errorDraftId: job.errorDraftId, errorMessage: job.errorMessage });
      } catch { /* retry */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [step, jobId, jobStatus]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    setFiles(selected);
    setPreviews(selected.slice(0, 200).map((f) => URL.createObjectURL(f)));
    setStep("upload"); setError(null);
    setConflicts([]); setConflictChecked(false); setPerFileResolutions(new Map());
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setFiles(dropped);
    setPreviews(dropped.slice(0, 200).map((f) => URL.createObjectURL(f)));
    setStep("upload"); setError(null);
    setConflicts([]); setConflictChecked(false); setPerFileResolutions(new Map());
  };

  const showPreview = async () => {
    if (files.length === 0) return;
    const groups = buildPreview(files.slice(0, 200), previews.slice(0, 200));
    setPreviewGroups(groups);
    setStep("preview");
    await checkConflicts();
  };

  const checkConflicts = async () => {
    setConflictChecking(true);
    try {
      const parsed = files
        .map((f) => { const p = parseFilename(f.name); return p ? { filename: f.name, reference: p.reference, color: p.color, position: p.position } : null; })
        .filter((f): f is NonNullable<typeof f> => f !== null);
      if (parsed.length === 0) { setConflicts([]); setConflictChecked(true); return; }
      const res = await fetch("/api/admin/products/import/images/check-conflicts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: parsed }),
      });
      if (res.ok) { const data = await res.json(); setConflicts(data.conflicts ?? []); }
      else { setConflicts([]); }
    } catch { setConflicts([]); }
    finally { setConflictChecked(true); setConflictChecking(false); }
  };

  const updatePerFileResolution = (filename: string, value: string) => {
    setPerFileResolutions((prev) => {
      const next = new Map(prev);
      if (value.startsWith("pos_")) {
        next.set(filename, { filename, strategy: "next_available", chosenPosition: parseInt(value.slice(4), 10) });
      } else {
        next.set(filename, { filename, strategy: value as ConflictStrategy });
      }
      return next;
    });
  };

  const getSelectValue = (filename: string): string => {
    const r = perFileResolutions.get(filename);
    if (!r) return defaultStrategy;
    if (r.chosenPosition != null) return `pos_${r.chosenPosition}`;
    return r.strategy;
  };

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setLoading(true); setError(null); setStep("uploading");
    try {
      const createFd = new FormData();
      createFd.append("type", "IMAGES");
      createFd.append("file", new Blob(), "placeholder");
      const createRes = await fetch("/api/admin/import-jobs", { method: "POST", body: createFd });
      const createData = await createRes.json();
      if (!createRes.ok) { setError(createData.error ?? "Erreur."); setStep("preview"); return; }
      const createdJobId = createData.jobId as string;
      setJobId(createdJobId);
      const batches = Math.ceil(files.length / BATCH_SIZE);
      setTotalBatches(batches); setUploadedBatches(0);
      for (let i = 0; i < batches; i++) {
        const batchFiles = files.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const fd = new FormData();
        for (const f of batchFiles) fd.append("images", f);
        const res = await fetch(`/api/admin/import-jobs/${createdJobId}`, { method: "POST", body: fd });
        if (!res.ok) { const data = await res.json(); setError(data.error ?? `Erreur batch ${i + 1}.`); setStep("preview"); setLoading(false); return; }
        setUploadedBatches(i + 1);
      }
      const startFd = new FormData();
      startFd.append("action", "start");
      if (conflicts.length > 0) {
        startFd.append("resolutions", JSON.stringify({ defaultStrategy, perFile: [...perFileResolutions.values()] }));
      }
      const startRes = await fetch(`/api/admin/import-jobs/${createdJobId}`, { method: "POST", body: startFd });
      if (!startRes.ok) { const data = await startRes.json(); setError(data.error ?? "Erreur."); setStep("preview"); setLoading(false); return; }
      setStep("done");
    } catch { setError("Erreur réseau."); setStep("preview"); }
    finally { setLoading(false); }
  };

  const reset = () => {
    setFiles([]); setPreviews([]); setStep("upload"); setError(null);
    setUploadedBatches(0); setTotalBatches(0); setJobId(null); setJobStatus(null);
    setJobProgress({ processed: 0, total: 0, success: 0, errors: 0, errorDraftId: null, errorMessage: null });
    setConflicts([]); setConflictChecked(false); setPerFileResolutions(new Map());
  };

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
              <div><span className="text-blue-600">REFERENCE</span>{" "}<span className="text-purple-600">COULEUR</span>{" "}<span className="text-orange-600">POSITION</span><span className="text-[#666]">.jpg</span></div>
              <div className="text-[#999]">ou</div>
              <div><span className="text-blue-600">REFERENCE</span><span className="text-[#999]">_</span><span className="text-purple-600">COULEUR</span><span className="text-[#999]">_</span><span className="text-orange-600">POSITION</span><span className="text-[#666]">.jpg</span></div>
            </div>
            <ul className="font-mono text-xs text-[#444] space-y-1">
              <li>REF001 Doré 1.jpg</li>
              <li>REF001_Argenté_2.png</li>
              <li>A200_Doré,Rouge,Noir_1.jpg</li>
              <li>BIJOU-042 Or Rose 3.webp</li>
            </ul>
          </div>
          <ul className="space-y-1 text-[#666] font-[family-name:var(--font-roboto)]">
            <li>• <strong>Référence</strong> : premier mot (sans espace)</li>
            <li>• <strong>Couleur</strong> : mot(s) du milieu</li>
            <li>• <strong>Position</strong> : dernier chiffre (1-10)</li>
            <li>• Formats : .jpg, .jpeg, .png, .webp, .gif</li>
            <li>• Max 5 000 images par import</li>
            <li>• La position est préservée exactement (ex : position 2 reste en position 2 même sans image en position 1)</li>
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
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCurrent ? "bg-[#1A1A1A] text-white" : isDone ? "bg-green-100 text-green-600" : "bg-[#F7F7F8] text-[#999]"}`}>{isDone ? "\u2713" : i + 1}</span>
                {s === "upload" ? "Images" : s === "preview" ? "Résumé" : "Lancé"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="border-2 border-dashed border-[#E5E5E5] rounded-xl p-10 text-center cursor-pointer hover:border-[#1A1A1A] transition-colors"
            onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
            <svg className="w-12 h-12 mx-auto text-[#999] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            {files.length > 0 ? (
              <div>
                <p className="font-medium text-[#1A1A1A]">{files.length} image(s) sélectionnée(s)</p>
                <p className="text-sm text-[#666]">{(files.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(1)} Mo</p>
                {invalidCount > 0 && <p className="text-sm text-amber-600 mt-1">{invalidCount} nom(s) invalide(s)</p>}
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
            <button onClick={showPreview} disabled={files.length === 0} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">Voir le résumé →</button>
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

          {/* Conflict checking spinner */}
          {conflictChecking && (
            <div className="p-4 bg-[#F7F7F8] border border-[#E5E5E5] rounded-2xl flex items-center gap-3">
              <svg className="w-5 h-5 text-[#1A1A1A] animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-[#666] font-[family-name:var(--font-roboto)]">Vérification des conflits de position...</p>
            </div>
          )}

          {/* No conflicts */}
          {conflictChecked && conflicts.length === 0 && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-3">
              <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-green-700 font-[family-name:var(--font-roboto)]">Aucun conflit de position détecté.</p>
            </div>
          )}

          {/* Conflicts panel */}
          {conflictChecked && conflicts.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-amber-800 font-[family-name:var(--font-poppins)]">{conflicts.length} conflit(s) de position</p>
                    <p className="text-xs text-amber-600 font-[family-name:var(--font-roboto)]">Des images existent déjà à ces positions. Choisissez quoi faire.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-amber-700 font-[family-name:var(--font-roboto)] whitespace-nowrap">Par défaut :</label>
                  <select value={defaultStrategy} onChange={(e) => setDefaultStrategy(e.target.value as ConflictStrategy)}
                    className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-white text-[#1A1A1A] font-[family-name:var(--font-roboto)] focus:outline-none focus:ring-1 focus:ring-amber-400">
                    {Object.entries(STRATEGY_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div className="divide-y divide-amber-100 max-h-[400px] overflow-y-auto">
                {conflicts.map((c) => (
                  <div key={c.filename} className="px-6 py-3 flex items-center gap-4">
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-amber-200 bg-amber-50 shrink-0">
                      <Image src={`/${c.existingImagePath}`} alt="Existante" fill className="object-cover" unoptimized />
                      <span className="absolute bottom-0 left-0 bg-amber-600/80 text-white text-[8px] px-1">P{c.position}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[#1A1A1A] font-medium truncate font-[family-name:var(--font-roboto)]">{c.filename}</p>
                      <p className="text-[10px] text-[#666] font-[family-name:var(--font-roboto)]">{c.reference} · {c.color} · Position {c.position}</p>
                    </div>
                    <select value={getSelectValue(c.filename)} onChange={(e) => updatePerFileResolution(c.filename, e.target.value)}
                      className="text-xs border border-[#E5E5E5] rounded-lg px-2 py-1.5 bg-white text-[#1A1A1A] font-[family-name:var(--font-roboto)] focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] min-w-[180px]">
                      {Object.entries(STRATEGY_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                      {c.availablePositions.length > 0 && (
                        <optgroup label="Choisir une position">
                          {c.availablePositions.map((pos) => <option key={`pos-${pos}`} value={`pos_${pos}`}>Position {pos}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File groups */}
          <div className="space-y-4">
            {previewGroups.slice(0, 20).map((group, gi) => (
              <div key={gi} className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <div className="px-6 py-3 bg-[#F7F7F8] border-b border-[#E5E5E5] flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-[#1A1A1A]">{group.reference}</span>
                  <span className="text-xs text-[#666]">{group.files.length} image(s)</span>
                  {group.files.some((f) => !f.valid) && <span className="ml-auto text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">noms invalides</span>}
                </div>
                <div className="grid grid-cols-[64px_1fr_1fr_1fr_auto] gap-3 items-center px-4 py-2 bg-[#FAFAFA] border-b border-[#F0F0F0] text-xs font-medium text-[#999] uppercase tracking-wide">
                  <div>Aperçu</div><div>Fichier</div><div>Couleur</div><div>Position</div><div>Statut</div>
                </div>
                <div className="divide-y divide-[#F5F5F5]">
                  {group.files.map((file, fi) => {
                    const hasConflict = conflicts.some((cc) => cc.filename === file.name);
                    return (
                      <div key={fi} className={`grid grid-cols-[64px_1fr_1fr_1fr_auto] gap-3 items-center px-4 py-3 ${hasConflict ? "bg-amber-50/50" : ""}`}>
                        <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-[#E5E5E5] bg-[#F7F7F8]">
                          <Image src={file.url} alt={file.name} fill className="object-cover" unoptimized />
                        </div>
                        <p className="text-xs text-[#444] break-all leading-tight">{file.name}</p>
                        <p className={`text-xs ${file.valid ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>{file.color}</p>
                        <p className={`text-xs ${file.valid ? "text-[#1A1A1A] font-medium" : "text-red-500 italic"}`}>{file.position > 0 ? file.position : "—"}</p>
                        <div>
                          {hasConflict ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Conflit</span>
                            : file.valid ? <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Valide</span>
                            : <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Format</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {previewGroups.length > 20 && <p className="text-sm text-[#999] text-center">… et {previewGroups.length - 20} autres références</p>}
          </div>

          <div className="flex items-center justify-between">
            <button onClick={reset} className="btn-secondary">← Changer les images</button>
            <div className="flex items-center gap-3">
              {invalidCount > 0 && <p className="text-sm text-[#666]">{invalidCount} image(s) invalide(s) iront en brouillon.</p>}
              <button onClick={handleSubmit} disabled={loading || files.length === 0 || conflictChecking} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {loading ? "Envoi en cours…" : conflictChecking ? "Vérification..." : `Lancer l'import (${files.length} images)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Uploading */}
      {step === "uploading" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-[#F7F7F8] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#1A1A1A] animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-lg font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">Envoi des images au serveur</p>
            <p className="text-sm text-[#666] mt-1 font-[family-name:var(--font-roboto)]">Ne fermez pas cette page pendant l&apos;envoi. Le traitement continuera en arrière-plan.</p>
          </div>
          <div>
            <div className="flex items-center justify-between text-sm text-[#666] mb-2">
              <span>Lot {uploadedBatches}/{totalBatches}</span>
              <span>{totalBatches > 0 ? Math.round((uploadedBatches / totalBatches) * 100) : 0}%</span>
            </div>
            <div className="w-full h-3 bg-[#F0F0F0] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300 ease-out" style={{ width: `${totalBatches > 0 ? (uploadedBatches / totalBatches) * 100 : 0}%`, background: "linear-gradient(90deg, #1A1A1A, #444)" }} />
            </div>
            <p className="text-xs text-[#999] mt-2 text-center">{Math.min(uploadedBatches * BATCH_SIZE, files.length)} / {files.length} images envoyées</p>
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {jobStatus === "COMPLETED" ? (
            <>
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <p className="text-xl font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">Import terminé</p>
                <p className="text-[#666] mt-1 font-[family-name:var(--font-roboto)]">{jobProgress.success} image(s) importée(s).{jobProgress.errors > 0 && ` ${jobProgress.errors} erreur(s).`}</p>
              </div>
            </>
          ) : jobStatus === "FAILED" ? (
            <>
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </div>
              <div>
                <p className="text-xl font-semibold font-[family-name:var(--font-poppins)] text-red-700">Erreur</p>
                <p className="text-[#666] mt-1 font-[family-name:var(--font-roboto)]">{jobProgress.errorMessage || "Une erreur est survenue."}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-amber-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <div>
                <p className="text-xl font-semibold font-[family-name:var(--font-poppins)] text-[#1A1A1A]">Traitement en cours...</p>
                <p className="text-[#666] mt-1 font-[family-name:var(--font-roboto)]">{jobProgress.processed}/{jobProgress.total} traitées. {jobProgress.success} réussie(s).</p>
                {jobProgress.total > 0 && (
                  <div className="w-64 mx-auto mt-3">
                    <div className="w-full h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${(jobProgress.processed / jobProgress.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                <p className="text-[#999] text-sm mt-3 font-[family-name:var(--font-roboto)]">Vous pouvez fermer cette page.</p>
              </div>
            </>
          )}
          <div className="flex justify-center gap-3">
            <button onClick={() => router.push("/admin/produits")} className="btn-primary text-sm">Voir les produits</button>
            <button onClick={reset} className="btn-secondary text-sm">Nouvel import</button>
          </div>
        </div>
      )}
    </div>
  );
}
