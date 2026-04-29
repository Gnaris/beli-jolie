"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import Image from "next/image";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useBackdropClose } from "@/hooks/useBackdropClose";

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

interface FileOverride {
  position?: number;
  color?: string;  // Display name (e.g. "Doré/Noir")
}

interface VariantOption {
  id: string;
  name: string;
  hex: string;
  patternImage?: string | null;
  colorNames: string; // Comma-separated for filename convention
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

  // Override state for manual editing of preview
  const [overrides, setOverrides] = useState<Map<string, FileOverride>>(new Map());
  const [editingPosition, setEditingPosition] = useState<string | null>(null); // filename
  const [colorVariants, setColorVariants] = useState<VariantOption[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);

  // Color modal state
  const [colorModalOpen, setColorModalOpen] = useState(false);
  const [colorModalFilename, setColorModalFilename] = useState<string | null>(null);
  const [colorModalRef, setColorModalRef] = useState<string | null>(null);
  const [allColors, setAllColors] = useState<{ id: string; name: string; hex: string | null; patternImage: string | null }[]>([]);
  const [loadingAllColors, setLoadingAllColors] = useState(false);
  const [colorModalSearch, setColorModalSearch] = useState("");
  const colorModalSearchRef = useRef<HTMLInputElement>(null);

  // Multi-color selection in modal
  interface SelectedColor { colorId: string; colorName: string; colorHex: string; patternImage: string | null }
  const [selectedColors, setSelectedColors] = useState<SelectedColor[]>([]);
  const [chipDragIdx, setChipDragIdx] = useState<number | null>(null);
  const [chipDragOverIdx, setChipDragOverIdx] = useState<number | null>(null);

  // Variant attributes form (shown when combination is new)
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [variantAttrs, setVariantAttrs] = useState({
    unitPrice: "",
    weight: "",
    stock: "0",
    saleType: "UNIT" as "UNIT" | "PACK",
    packQuantity: "",
    size: "",
  });
  const [creatingVariant, setCreatingVariant] = useState(false);

  // Create new color in modal
  const [creatingColor, setCreatingColor] = useState(false);
  const [newColorName, setNewColorName] = useState("");
  const [newColorHex, setNewColorHex] = useState("#9CA3AF");
  const [newColorMode, setNewColorMode] = useState<"hex" | "pattern">("hex");
  const [newColorPatternFile, setNewColorPatternFile] = useState<File | null>(null);
  const [newColorPatternPreview, setNewColorPatternPreview] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState(false);

  const fetchAllColors = useCallback(async () => {
    setLoadingAllColors(true);
    try {
      const res = await fetch("/api/admin/products/import/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_colors" }),
      });
      const data = await res.json();
      if (data.colors) setAllColors(data.colors);
    } finally {
      setLoadingAllColors(false);
    }
  }, []);

  const openColorModal = useCallback((filename: string, reference: string) => {
    setColorModalFilename(filename);
    setColorModalRef(reference);
    setColorModalOpen(true);
    setColorModalSearch("");
    setCreatingColor(false);
    setSelectedColors([]);
    setShowVariantForm(false);
    setVariantAttrs({ unitPrice: "", weight: "", stock: "0", saleType: "UNIT", packQuantity: "", size: "" });
    fetchAllColors();
    fetchVariants(reference);
  }, [fetchAllColors]);

  const closeColorModal = useCallback(() => {
    setColorModalOpen(false);
    setColorModalFilename(null);
    setColorModalRef(null);
    setColorModalSearch("");
    setCreatingColor(false);
    setSelectedColors([]);
    setShowVariantForm(false);
    setNewColorName("");
    setNewColorHex("#9CA3AF");
    setNewColorMode("hex");
    setNewColorPatternFile(null);
    setNewColorPatternPreview(null);
  }, []);

  const backdropColorModal = useBackdropClose(closeColorModal);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!colorModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [colorModalOpen]);

  useEffect(() => {
    if (colorModalOpen) setTimeout(() => colorModalSearchRef.current?.focus(), 50);
  }, [colorModalOpen]);

  const toggleColor = (opt: { id: string; name: string; hex: string | null; patternImage: string | null }) => {
    const exists = selectedColors.find((s) => s.colorId === opt.id);
    if (exists) {
      setSelectedColors(selectedColors.filter((s) => s.colorId !== opt.id));
    } else {
      setSelectedColors([...selectedColors, {
        colorId: opt.id,
        colorName: opt.name,
        colorHex: opt.hex ?? "#9CA3AF",
        patternImage: opt.patternImage,
      }]);
    }
  };

  const removeSelectedColor = (colorId: string) => {
    setSelectedColors(selectedColors.filter((s) => s.colorId !== colorId));
  };

  // Drag & drop for reordering selected color chips
  const handleChipDragStart = (e: React.DragEvent, idx: number) => {
    setChipDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 20, 20);
    }
  };
  const handleChipDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setChipDragOverIdx(idx);
  };
  const handleChipDragEnd = () => {
    if (chipDragIdx !== null && chipDragOverIdx !== null && chipDragIdx !== chipDragOverIdx) {
      const updated = [...selectedColors];
      const [moved] = updated.splice(chipDragIdx, 1);
      updated.splice(chipDragOverIdx, 0, moved);
      setSelectedColors(updated);
    }
    setChipDragIdx(null);
    setChipDragOverIdx(null);
  };

  const validateColorSelection = () => {
    if (selectedColors.length === 0 || !colorModalFilename) return;
    // Check if this combination already exists as a variant on the product
    const selectedNames = selectedColors.map((s) => s.colorName).join(",");
    const existingMatch = colorVariants.find((v) => v.colorNames === selectedNames);
    if (existingMatch) {
      // Combination exists → assign directly
      setOverride(colorModalFilename, { color: selectedNames });
      const newOv = new Map(overrides);
      newOv.set(colorModalFilename, { ...newOv.get(colorModalFilename), color: selectedNames });
      checkConflicts(newOv);
      closeColorModal();
    } else {
      // New combination → show variant attributes form
      setShowVariantForm(true);
    }
  };

  const submitVariantCreation = async () => {
    if (!colorModalRef || !colorModalFilename || !canSubmitVariant) return;
    const price = parseFloat(variantAttrs.unitPrice);
    if (isNaN(price) || price <= 0) return;
    setCreatingVariant(true);
    try {
      const res = await fetch("/api/admin/products/import/images/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: colorModalRef,
          colorIds: selectedColors.map((s) => s.colorId),
          unitPrice: price,
          weight: parseFloat(variantAttrs.weight) || 0.1,
          stock: parseInt(variantAttrs.stock) || 0,
          saleType: variantAttrs.saleType,
          packQuantity: variantAttrs.saleType === "PACK" ? (parseInt(variantAttrs.packQuantity) || null) : null,
          size: variantAttrs.size || null,
        }),
      });
      const data = await res.json();
      if (data.ok && data.variant) {
        // Assign the newly created variant's colorNames
        const colorNames = data.variant.colorNames;
        setOverride(colorModalFilename, { color: colorNames });
        const newOv = new Map(overrides);
        newOv.set(colorModalFilename, { ...newOv.get(colorModalFilename), color: colorNames });
        checkConflicts(newOv);
        closeColorModal();
      }
    } finally {
      setCreatingVariant(false);
    }
  };

  const selectedColorIds = new Set(selectedColors.map((s) => s.colorId));

  const handlePatternFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!validTypes.includes(file.type) || file.size > 500 * 1024) return;
    setNewColorPatternFile(file);
    setNewColorPatternPreview(URL.createObjectURL(file));
  };

  const createNewColorInModal = async () => {
    if (!newColorName.trim()) return;
    setSavingColor(true);
    try {
      let patternPath: string | null = null;
      if (newColorMode === "pattern" && newColorPatternFile) {
        const fd = new FormData();
        fd.append("file", newColorPatternFile);
        const uploadRes = await fetch("/api/admin/colors/upload-pattern", { method: "POST", body: fd });
        if (!uploadRes.ok) { setSavingColor(false); return; }
        const uploadData = await uploadRes.json();
        if (uploadData.path) patternPath = uploadData.path;
      }
      const res = await fetch("/api/admin/products/import/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_color",
          name: newColorName.trim(),
          colorHex: newColorMode === "hex" ? newColorHex : null,
          patternImage: patternPath,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const entity = data.entity;
        // Add to allColors list
        setAllColors((prev) => [...prev, { id: entity.id, name: entity.name, hex: entity.hex, patternImage: entity.patternImage }].sort((a, b) => a.name.localeCompare(b.name)));
        // Reset form
        setCreatingColor(false);
        setNewColorName("");
        setNewColorHex("#9CA3AF");
        setNewColorMode("hex");
        setNewColorPatternFile(null);
        setNewColorPatternPreview(null);
        // Refresh variants
        if (colorModalRef) await fetchVariants(colorModalRef);
      }
    } finally {
      setSavingColor(false);
    }
  };

  const filteredModalColors = colorModalSearch.trim()
    ? allColors.filter((c) => c.name.toLowerCase().includes(colorModalSearch.trim().toLowerCase()))
    : allColors;

  // Variant form validation
  const vaPriceNum = variantAttrs.unitPrice ? parseFloat(variantAttrs.unitPrice) : 0;
  const vaWeightNum = variantAttrs.weight ? parseFloat(variantAttrs.weight) : 0;
  const vaPackQtyNum = variantAttrs.packQuantity ? parseInt(variantAttrs.packQuantity) : 0;
  const canSubmitVariant =
    selectedColors.length > 0 &&
    vaPriceNum > 0 &&
    vaWeightNum > 0 &&
    (variantAttrs.saleType === "UNIT" || vaPackQtyNum >= 2);

  const getEffectiveValues = (file: { name: string; color: string; position: number }) => {
    const ov = overrides.get(file.name);
    return {
      color: ov?.color ?? file.color,
      position: ov?.position ?? file.position,
    };
  };

  const setOverride = (filename: string, patch: Partial<FileOverride>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      const existing = next.get(filename) ?? {};
      next.set(filename, { ...existing, ...patch });
      return next;
    });
  };

  const fetchVariants = async (reference: string) => {
    setLoadingVariants(true);
    setColorVariants([]);
    try {
      const res = await fetch(`/api/admin/products/import/images/variants?reference=${encodeURIComponent(reference)}`);
      if (res.ok) {
        const data = await res.json();
        setColorVariants(data.variants ?? []);
      }
    } catch { /* ignore */ }
    finally { setLoadingVariants(false); }
  };

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
    setOverrides(new Map()); setEditingPosition(null); closeColorModal();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    setFiles(dropped);
    setPreviews(dropped.slice(0, 200).map((f) => URL.createObjectURL(f)));
    setStep("upload"); setError(null);
    setConflicts([]); setConflictChecked(false); setPerFileResolutions(new Map());
    setOverrides(new Map()); setEditingPosition(null); closeColorModal();
  };

  const showPreview = async () => {
    if (files.length === 0) return;
    const groups = buildPreview(files.slice(0, 200), previews.slice(0, 200));
    setPreviewGroups(groups);
    setStep("preview");
    await checkConflicts();
  };

  const checkConflicts = async (currentOverrides?: Map<string, FileOverride>) => {
    const ov = currentOverrides ?? overrides;
    setConflictChecking(true);
    try {
      const parsed = files
        .map((f) => {
          const p = parseFilename(f.name);
          if (!p) return null;
          const o = ov.get(f.name);
          return { filename: f.name, reference: p.reference, color: o?.color ?? p.color, position: o?.position ?? p.position };
        })
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
      // Send file overrides (position/color changes)
      if (overrides.size > 0) {
        const ovObj: Record<string, FileOverride> = {};
        overrides.forEach((v, k) => { ovObj[k] = v; });
        startFd.append("overrides", JSON.stringify(ovObj));
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
    setOverrides(new Map()); setEditingPosition(null); closeColorModal();
  };

  const invalidCount = files.filter((f) => !parseFilename(f.name)).length;
  const validCount = files.length - invalidCount;

  // Detect within-import position duplicates (same reference + color + position)
  const importDuplicates = (() => {
    if (step !== "preview") return new Set<string>();
    const seen = new Map<string, string>(); // key → first filename
    const dupes = new Set<string>();
    for (const f of files) {
      const p = parseFilename(f.name);
      if (!p) continue;
      const eff = getEffectiveValues({ name: f.name, color: p.color, position: p.position });
      const key = `${p.reference}::${eff.color}::${eff.position}`;
      if (seen.has(key)) {
        dupes.add(f.name);
        dupes.add(seen.get(key)!);
      } else {
        seen.set(key, f.name);
      }
    }
    return dupes;
  })();

  return (
    <div className="space-y-6">
      {/* Naming guide */}
      <div className="bg-bg-secondary border border-border rounded-2xl p-6">
        <h3 className="font-semibold text-text-primary mb-3 font-heading">Convention de nommage</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="bg-bg-primary border border-border rounded-xl p-4 font-mono text-sm mb-3 space-y-1">
              <div><span className="text-blue-600">REFERENCE</span>{" "}<span className="text-purple-600">COULEUR</span>{" "}<span className="text-orange-600">POSITION</span><span className="text-[#666]">.jpg</span></div>
              <div className="text-[#999]">ou</div>
              <div><span className="text-blue-600">REFERENCE</span><span className="text-[#999]">_</span><span className="text-purple-600">COULEUR</span><span className="text-[#999]">_</span><span className="text-orange-600">POSITION</span><span className="text-[#666]">.jpg</span></div>
            </div>
            <ul className="font-mono text-xs text-[#444] space-y-1">
              <li>REF001 Doré 1.jpg</li>
              <li>REF001_Argenté_2.png</li>
              <li>A200_Doré,Rouge,Noir_1.jpg</li>
              <li>PROD-042 Or Rose 3.webp</li>
            </ul>
          </div>
          <ul className="space-y-1 text-[#666] font-body">
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
              <div className={`flex items-center gap-2 ${isCurrent ? "text-text-primary font-medium" : isDone ? "text-green-600" : "text-[#999]"}`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCurrent ? "bg-bg-dark text-text-inverse" : isDone ? "bg-green-100 text-green-600" : "bg-bg-secondary text-[#999]"}`}>{isDone ? "\u2713" : i + 1}</span>
                {s === "upload" ? "Images" : s === "preview" ? "Résumé" : "Lancé"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-bg-dark transition-colors"
            onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
            <svg className="w-12 h-12 mx-auto text-[#999] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            {files.length > 0 ? (
              <div>
                <p className="font-medium text-text-primary">{files.length} image(s) sélectionnée(s)</p>
                <p className="text-sm text-[#666]">{(files.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(1)} Mo</p>
                {invalidCount > 0 && <p className="text-sm text-amber-600 mt-1">{invalidCount} nom(s) invalide(s)</p>}
              </div>
            ) : (
              <div>
                <p className="text-text-primary font-medium">Glissez vos images ici</p>
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
            <div className="rounded-xl p-4 bg-bg-secondary border border-border">
              <p className="text-2xl font-bold font-heading">{files.length}</p>
              <p className="text-xs text-[#666] mt-0.5">Images au total</p>
            </div>
            <div className="rounded-xl p-4 bg-green-50 border border-border">
              <p className="text-2xl font-bold text-green-700 font-heading">{validCount}</p>
              <p className="text-xs text-[#666] mt-0.5">Noms valides</p>
            </div>
            <div className={`rounded-xl p-4 border border-border ${invalidCount > 0 ? "bg-amber-50" : "bg-green-50"}`}>
              <p className={`text-2xl font-bold font-heading ${invalidCount > 0 ? "text-amber-700" : "text-green-700"}`}>{invalidCount}</p>
              <p className="text-xs text-[#666] mt-0.5">Noms invalides</p>
            </div>
          </div>

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

          {/* Conflict checking spinner */}
          {conflictChecking && (
            <div className="p-4 bg-bg-secondary border border-border rounded-2xl flex items-center gap-3">
              <svg className="w-5 h-5 text-text-primary animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-[#666] font-body">Vérification des conflits de position...</p>
            </div>
          )}

          {/* No conflicts */}
          {conflictChecked && conflicts.length === 0 && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-center gap-3">
              <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-sm text-green-700 font-body">Aucun conflit de position détecté.</p>
            </div>
          )}

          {/* Conflicts panel */}
          {conflictChecked && conflicts.length > 0 && (
            <div className="bg-bg-primary border border-amber-200 rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-amber-800 font-heading">{conflicts.length} conflit(s) de position</p>
                    <p className="text-xs text-amber-600 font-body">Des images existent déjà à ces positions. Choisissez quoi faire.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-amber-700 font-body whitespace-nowrap">Par défaut :</label>
                  <select value={defaultStrategy} onChange={(e) => setDefaultStrategy(e.target.value as ConflictStrategy)}
                    className="text-xs border border-amber-300 rounded-lg px-2 py-1.5 bg-bg-primary text-text-primary font-body focus:outline-none focus:ring-1 focus:ring-amber-400">
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
                      <p className="text-xs text-text-primary font-medium truncate font-body">{c.filename}</p>
                      <p className="text-[10px] text-[#666] font-body">{c.reference} · {c.color} · Position {c.position}</p>
                    </div>
                    <select value={getSelectValue(c.filename)} onChange={(e) => updatePerFileResolution(c.filename, e.target.value)}
                      className="text-xs border border-border rounded-lg px-2 py-1.5 bg-bg-primary text-text-primary font-body focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] min-w-[180px]">
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

          {/* Within-import duplicates warning */}
          {importDuplicates.size > 0 && (
            <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl flex items-center gap-3">
              <svg className="w-5 h-5 text-orange-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-sm text-orange-700 font-body">
                <strong>{importDuplicates.size} fichier(s)</strong> ciblent la même référence + couleur + position. Modifiez la position ou la couleur pour éviter les conflits.
              </p>
            </div>
          )}

          {/* File groups */}
          <div className="space-y-4">
            {previewGroups.slice(0, 20).map((group, gi) => (
              <div key={gi} className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
                <div className="px-6 py-3 bg-bg-secondary border-b border-border flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-text-primary">{group.reference}</span>
                  <span className="text-xs text-[#666]">{group.files.length} image(s)</span>
                  {group.files.some((f) => !f.valid) && <span className="ml-auto text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">noms invalides</span>}
                </div>
                <div className="grid grid-cols-[64px_1fr_1fr_80px_auto] gap-3 items-center px-4 py-2 bg-[#FAFAFA] border-b border-border-light text-xs font-medium text-[#999] uppercase tracking-wide">
                  <div>Aperçu</div><div>Fichier</div><div>Couleur</div><div>Position</div><div>Statut</div>
                </div>
                <div className="divide-y divide-[#F5F5F5]">
                  {group.files.map((file, fi) => {
                    const hasConflict = conflicts.some((cc) => cc.filename === file.name);
                    const hasDupe = importDuplicates.has(file.name);
                    const eff = getEffectiveValues(file);
                    const hasOverride = overrides.has(file.name);
                    const isEditingPos = editingPosition === file.name;
                    return (
                      <div key={fi}>
                        <div className={`grid grid-cols-[64px_1fr_1fr_80px_auto] gap-3 items-center px-4 py-3 ${hasConflict ? "bg-amber-50/50" : ""}`}>
                          <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-border bg-bg-secondary">
                            <Image src={file.url} alt={file.name} fill className="object-cover" unoptimized />
                          </div>
                          <p className="text-xs text-[#444] break-all leading-tight">{file.name}</p>
                          {/* Color — clickable to edit */}
                          <div className="flex items-center gap-1">
                            <p className={`text-xs ${file.valid ? "text-text-primary font-medium" : "text-red-500 italic"}`}>
                              {eff.color || "—"}
                              {hasOverride && overrides.get(file.name)?.color && (
                                <span className="ml-1 text-[10px] text-blue-600">(modifié)</span>
                              )}
                            </p>
                            {file.valid && group.reference !== "(référence inconnue)" && (
                              <button
                                onClick={() => {
                                  openColorModal(file.name, group.reference);
                                  setEditingPosition(null);
                                }}
                                className="p-0.5 text-[#999] hover:text-text-primary transition-colors"
                                title="Modifier la couleur"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                            )}
                          </div>
                          {/* Position — clickable to edit */}
                          <div className="flex items-center gap-1">
                            {isEditingPos ? (
                              <div className="relative" ref={(el) => {
                                if (el) {
                                  const handler = (e: MouseEvent) => {
                                    if (!el.contains(e.target as Node)) {
                                      setEditingPosition(null);
                                      document.removeEventListener("mousedown", handler);
                                    }
                                  };
                                  document.addEventListener("mousedown", handler);
                                }
                              }}>
                                <button type="button" className="flex items-center gap-1 px-2 py-1 text-xs font-medium border border-[#1A1A1A] rounded-md bg-bg-primary text-text-primary min-w-[42px] justify-center">
                                  {eff.position}
                                  <svg className="w-3 h-3 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </button>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 flex flex-row bg-bg-primary border border-border rounded-lg shadow-[0_4px_16px_rgba(0,0,0,0.12)] overflow-hidden">
                                  {[1, 2, 3, 4, 5].map((p) => (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={() => {
                                        setOverride(file.name, { position: p });
                                        setEditingPosition(null);
                                        const newOv = new Map(overrides);
                                        newOv.set(file.name, { ...newOv.get(file.name), position: p });
                                        checkConflicts(newOv);
                                      }}
                                      className={`w-8 h-8 text-xs text-center transition-colors cursor-pointer ${
                                        p === eff.position
                                          ? "bg-bg-dark text-text-inverse font-semibold"
                                          : "text-[#666] hover:bg-bg-secondary hover:text-text-primary"
                                      }`}
                                    >
                                      {p}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className={`text-xs ${file.valid ? "text-text-primary font-medium" : "text-red-500 italic"}`}>
                                  {eff.position > 0 ? eff.position : "—"}
                                  {hasOverride && overrides.get(file.name)?.position && (
                                    <span className="ml-1 text-[10px] text-blue-600">(modifié)</span>
                                  )}
                                </p>
                                {file.valid && (
                                  <button
                                    onClick={() => { setEditingPosition(file.name); closeColorModal(); }}
                                    className="p-0.5 text-[#999] hover:text-text-primary transition-colors"
                                    title="Modifier la position"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                          <div>
                            {hasDupe ? <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">Doublon</span>
                              : hasConflict ? <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Conflit</span>
                              : file.valid ? <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Valide</span>
                              : <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Format</span>}
                          </div>
                        </div>
                        {/* Color edit panel removed — handled by modal */}
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
        <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-text-primary animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-lg font-semibold font-heading text-text-primary">Envoi des images au serveur</p>
            <p className="text-sm text-[#666] mt-1 font-body">Ne fermez pas cette page pendant l&apos;envoi. Le traitement continuera en arrière-plan.</p>
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
        <div className="bg-bg-primary border border-border rounded-2xl p-8 text-center space-y-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {jobStatus === "COMPLETED" ? (
            <>
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <div>
                <p className="text-xl font-semibold font-heading text-text-primary">Import terminé</p>
                <p className="text-[#666] mt-1 font-body">{jobProgress.success} image(s) importée(s).{jobProgress.errors > 0 && ` ${jobProgress.errors} erreur(s).`}</p>
                {jobProgress.errors > 0 && jobProgress.errorDraftId && (
                  <a
                    href={`/admin/produits/importer/brouillon/${jobProgress.errorDraftId}`}
                    className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                    Voir et corriger les {jobProgress.errors} erreur{jobProgress.errors > 1 ? "s" : ""}
                  </a>
                )}
              </div>
            </>
          ) : jobStatus === "FAILED" ? (
            <>
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </div>
              <div>
                <p className="text-xl font-semibold font-heading text-red-700">Erreur</p>
                <p className="text-[#666] mt-1 font-body">{jobProgress.errorMessage || "Une erreur est survenue."}</p>
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
                <p className="text-xl font-semibold font-heading text-text-primary">Traitement en cours...</p>
                <p className="text-[#666] mt-1 font-body">{jobProgress.processed}/{jobProgress.total} traitées. {jobProgress.success} réussie(s).</p>
                {jobProgress.total > 0 && (
                  <div className="w-64 mx-auto mt-3">
                    <div className="w-full h-2 bg-[#F0F0F0] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${(jobProgress.processed / jobProgress.total) * 100}%` }} />
                    </div>
                  </div>
                )}
                <p className="text-[#999] text-sm mt-3 font-body">Vous pouvez fermer cette page.</p>
              </div>
            </>
          )}
          <div className="flex justify-center gap-3">
            <button onClick={() => router.push("/admin/produits")} className="btn-primary text-sm">Voir les produits</button>
            <button onClick={reset} className="btn-secondary text-sm">Nouvel import</button>
          </div>
        </div>
      )}
      {/* Color selection modal (portal) */}
      {colorModalOpen && createPortal(
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4" onMouseDown={backdropColorModal.onMouseDown} onMouseUp={backdropColorModal.onMouseUp}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div
            className="relative bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
            style={{ maxHeight: "min(90vh, 780px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ═══ PAGE 1: Color selection ═══ */}
            {!showVariantForm ? (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                  <div>
                    <h3 className="text-sm font-semibold font-heading text-text-primary">
                      Sélectionner les couleurs
                    </h3>
                    <p className="text-[11px] text-text-muted font-body mt-0.5">
                      1re couleur = principale
                    </p>
                  </div>
                  <button type="button" onClick={closeColorModal} className="w-8 h-8 flex items-center justify-center hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Selected colors — draggable chips */}
                {selectedColors.length > 0 && (
                  <div className="px-5 py-3 bg-bg-secondary border-b border-border shrink-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide">
                        Sélection ({selectedColors.length})
                      </span>
                      {selectedColors.length > 1 && (
                        <span className="text-[10px] text-text-muted font-body">
                          Glissez pour réordonner
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedColors.map((s, idx) => {
                        const isDragging = chipDragIdx === idx;
                        const isDragOver = chipDragOverIdx === idx && chipDragIdx !== idx;
                        return (
                          <div
                            key={s.colorId}
                            draggable
                            onDragStart={(e) => handleChipDragStart(e, idx)}
                            onDragOver={(e) => handleChipDragOver(e, idx)}
                            onDragEnd={handleChipDragEnd}
                            className={`flex items-center gap-2 bg-bg-primary border-2 rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing transition-all select-none
                              ${isDragging ? "opacity-40 scale-95" : ""}
                              ${isDragOver ? "border-[#1A1A1A] shadow-md" : "border-border"}
                            `}
                          >
                            {/* Drag handle */}
                            <svg className="w-3.5 h-3.5 text-[#C0C0C0] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                              <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                            </svg>
                            <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shrink-0
                              ${idx === 0 ? "bg-bg-dark text-text-inverse" : "bg-[#E5E5E5] text-text-secondary"}
                            `}>
                              {idx + 1}
                            </span>
                            <ColorSwatch hex={s.colorHex} patternImage={s.patternImage} size={22} rounded="full" />
                            <span className="text-xs font-medium font-body text-text-primary max-w-[100px] truncate">
                              {s.colorName}
                            </span>
                            {idx === 0 && (
                              <span className="text-[9px] font-semibold bg-[#22C55E] text-white px-1.5 py-0.5 rounded">1re</span>
                            )}
                            {/* Remove */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removeSelectedColor(s.colorId); }}
                              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors shrink-0 ml-0.5"
                              aria-label={`Retirer ${s.colorName}`}
                            >
                              <svg className="w-3.5 h-3.5 text-[#C0C0C0] hover:text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Existing variants for quick assignment */}
                {loadingVariants && (
                  <div className="px-5 py-3 bg-[#FAFAFA] border-b border-border shrink-0">
                    <p className="text-xs text-[#666]">Chargement des variantes...</p>
                  </div>
                )}
                {!loadingVariants && colorVariants.length > 0 && (
                  <div className="px-5 py-3 bg-[#FAFAFA] border-b border-border shrink-0">
                    <span className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide">
                      Combinaisons existantes
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {colorVariants.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            if (colorModalFilename) {
                              setOverride(colorModalFilename, { color: v.colorNames });
                              const newOv = new Map(overrides);
                              newOv.set(colorModalFilename, { ...newOv.get(colorModalFilename), color: v.colorNames });
                              checkConflicts(newOv);
                            }
                            closeColorModal();
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border bg-bg-primary rounded-lg hover:border-bg-dark transition-colors text-xs"
                        >
                          <ColorSwatch hex={v.hex} patternImage={v.patternImage} size={16} rounded="full" />
                          <span className="font-body text-text-primary">{v.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search */}
                <div className="px-5 py-3 border-b border-border shrink-0">
                  <div className="flex items-center gap-2 bg-bg-secondary border border-border px-3 py-2.5 rounded-xl">
                    <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                    </svg>
                    <input
                      ref={colorModalSearchRef}
                      type="text"
                      value={colorModalSearch}
                      onChange={(e) => setColorModalSearch(e.target.value)}
                      placeholder="Rechercher une couleur..."
                      className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none min-w-0 font-body"
                    />
                    {colorModalSearch && (
                      <button type="button" onClick={() => setColorModalSearch("")} className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text-primary">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Color grid */}
                <div className="flex-1 overflow-y-auto px-5 py-3" style={{ minHeight: 160 }}>
                  {loadingAllColors ? (
                    <div className="py-10 text-center text-sm text-text-muted font-body">Chargement...</div>
                  ) : filteredModalColors.length === 0 ? (
                    <div className="py-10 text-center text-sm text-text-muted font-body">Aucun résultat</div>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                      {filteredModalColors.map((opt) => {
                        const isChecked = selectedColorIds.has(opt.id);
                        const position = selectedColors.findIndex((s) => s.colorId === opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => toggleColor(opt)}
                            className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all text-center
                              ${isChecked
                                ? "border-[#1A1A1A] bg-bg-secondary shadow-sm"
                                : "border-transparent hover:border-border hover:bg-[#FAFAFA]"
                              }
                            `}
                            title={opt.name}
                          >
                            {/* Checkmark badge */}
                            {isChecked && (
                              <span className={`absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full text-[9px] font-bold shadow-sm
                                ${position === 0 ? "bg-[#22C55E] text-white" : "bg-bg-dark text-text-inverse"}
                              `}>
                                {position + 1}
                              </span>
                            )}
                            {/* Color swatch */}
                            <div
                              className={`w-10 h-10 rounded-full border-2 transition-all shrink-0
                                ${isChecked ? "border-[#1A1A1A] scale-110" : "border-border"}
                              `}
                              style={
                                opt.patternImage
                                  ? { backgroundImage: `url(${opt.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                                  : { backgroundColor: opt.hex || "#9CA3AF" }
                              }
                            />
                            {/* Name */}
                            <span className="text-[10px] leading-tight font-body text-text-secondary w-full truncate">
                              {opt.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Create new color — collapsible */}
                <div className="border-t border-border shrink-0">
                  {!creatingColor ? (
                    <button
                      type="button"
                      onClick={() => setCreatingColor(true)}
                      className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm text-text-secondary font-medium hover:text-text-primary hover:bg-[#FAFAFA] transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Créer une nouvelle couleur
                    </button>
                  ) : (
                    <div className="px-5 py-4 bg-[#FAFAFA] space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide">Nouvelle couleur</p>
                        <button
                          type="button"
                          onClick={() => { setCreatingColor(false); setNewColorName(""); setNewColorPatternFile(null); setNewColorPatternPreview(null); }}
                          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[#E5E5E5] transition-colors"
                          aria-label="Fermer"
                        >
                          <svg className="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          className="field-input flex-1"
                          placeholder="Nom de la couleur"
                          value={newColorName}
                          onChange={(e) => setNewColorName(e.target.value)}
                          autoFocus
                        />
                        <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
                          <button
                            type="button"
                            onClick={() => setNewColorMode("hex")}
                            className={`text-[11px] px-2.5 py-2 transition-colors ${
                              newColorMode === "hex" ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                            }`}
                          >
                            Unie
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewColorMode("pattern")}
                            className={`text-[11px] px-2.5 py-2 border-l border-border transition-colors ${
                              newColorMode === "pattern" ? "bg-bg-dark text-text-inverse" : "bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                            }`}
                          >
                            Motif
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {newColorMode === "hex" ? (
                          <>
                            <input
                              type="color"
                              value={newColorHex}
                              onChange={(e) => setNewColorHex(e.target.value)}
                              className="w-9 h-9 rounded-lg cursor-pointer border border-border shrink-0"
                            />
                            <input
                              className="field-input w-24 font-mono text-xs"
                              value={newColorHex}
                              onChange={(e) => setNewColorHex(e.target.value)}
                            />
                          </>
                        ) : (
                          <>
                            {newColorPatternPreview ? (
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-9 h-9 rounded-lg border border-border shrink-0"
                                  style={{ backgroundImage: `url(${newColorPatternPreview})`, backgroundSize: "cover", backgroundPosition: "center" }}
                                />
                                <button
                                  type="button"
                                  onClick={() => { setNewColorPatternFile(null); setNewColorPatternPreview(null); }}
                                  className="text-[11px] text-red-500 hover:underline"
                                >
                                  Supprimer
                                </button>
                              </div>
                            ) : (
                              <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-[#D0D0D0] rounded-lg cursor-pointer hover:border-[#9CA3AF] transition-colors">
                                <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-[11px] text-text-muted">PNG, JPG, WebP — max 500 Ko</span>
                                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handlePatternFileChange} />
                              </label>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={createNewColorInModal}
                          disabled={savingColor || !newColorName.trim() || (newColorMode === "pattern" && !newColorPatternFile)}
                          className="btn-primary text-xs px-3 py-2 ml-auto disabled:opacity-50 shrink-0"
                        >
                          {savingColor ? "..." : "Créer"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer — page 1 */}
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-bg-primary shrink-0">
                  <span className="text-xs text-text-muted font-body">
                    {selectedColors.length === 0 ? "Aucune couleur" : `${selectedColors.length} couleur${selectedColors.length > 1 ? "s" : ""}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={closeColorModal}
                      className="px-4 py-2.5 text-xs font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
                    >
                      Annuler
                    </button>
                    <button type="button" onClick={validateColorSelection} disabled={selectedColors.length === 0}
                      className="px-4 py-2.5 text-xs font-medium font-body text-text-inverse bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40"
                    >
                      Valider
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* ═══ PAGE 2: Variant attributes form ═══ */
              <>
                {/* Header — page 2 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowVariantForm(false)}
                      className="w-8 h-8 flex items-center justify-center hover:bg-bg-secondary rounded-lg transition-colors"
                      aria-label="Retour"
                    >
                      <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div>
                      <h3 className="text-sm font-semibold font-heading text-text-primary">
                        Nouvelle variante
                      </h3>
                      <p className="text-[11px] text-text-muted font-body mt-0.5">
                        Combinaison inexistante sur <strong className="text-text-primary">{colorModalRef}</strong>
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={closeColorModal} className="w-8 h-8 flex items-center justify-center hover:bg-bg-secondary rounded-lg transition-colors" aria-label="Fermer">
                    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Selected colors summary */}
                <div className="px-5 py-3 bg-bg-secondary border-b border-border shrink-0">
                  <p className="text-[11px] font-semibold text-text-secondary font-body uppercase tracking-wide mb-2">
                    Couleurs sélectionnées
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedColors.map((s, idx) => (
                      <div key={s.colorId} className="flex items-center gap-1.5 bg-bg-primary border border-border rounded-full px-2.5 py-1">
                        <span className={`text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full shrink-0
                          ${idx === 0 ? "bg-bg-dark text-text-inverse" : "bg-[#E5E5E5] text-text-secondary"}
                        `}>
                          {idx + 1}
                        </span>
                        <ColorSwatch hex={s.colorHex} patternImage={s.patternImage} size={14} rounded="full" />
                        <span className="text-[11px] font-body text-text-primary">{s.colorName}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Form fields */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="field-label">Prix unitaire HT (€) <span className="text-red-500">*</span></label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={`field-input w-full ${variantAttrs.unitPrice && vaPriceNum <= 0 ? "!border-red-400" : ""}`}
                        placeholder="Ex : 4.50"
                        value={variantAttrs.unitPrice}
                        onChange={(e) => setVariantAttrs((p) => ({ ...p, unitPrice: e.target.value }))}
                        autoFocus
                      />
                      {variantAttrs.unitPrice && vaPriceNum <= 0 && (
                        <p className="text-[10px] text-red-500 mt-0.5">Le prix doit être supérieur à 0</p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Poids (g) <span className="text-red-500">*</span></label>
                      <input
                        type="number"
                        min="1"
                        className={`field-input w-full ${variantAttrs.weight && vaWeightNum <= 0 ? "!border-red-400" : ""}`}
                        placeholder="Ex : 8"
                        value={variantAttrs.weight}
                        onChange={(e) => setVariantAttrs((p) => ({ ...p, weight: e.target.value }))}
                      />
                      {variantAttrs.weight && vaWeightNum <= 0 && (
                        <p className="text-[10px] text-red-500 mt-0.5">Le poids doit être supérieur à 0</p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Stock</label>
                      <input
                        type="number"
                        min="0"
                        className="field-input w-full"
                        placeholder="0"
                        value={variantAttrs.stock}
                        onChange={(e) => setVariantAttrs((p) => ({ ...p, stock: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="field-label">Taille</label>
                      <input
                        type="text"
                        className="field-input w-full"
                        placeholder="Ex : 17, L, XL"
                        value={variantAttrs.size}
                        onChange={(e) => setVariantAttrs((p) => ({ ...p, size: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label">Type de vente <span className="text-red-500">*</span></label>
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => setVariantAttrs((p) => ({ ...p, saleType: "UNIT" }))}
                        className={`flex-1 text-sm px-4 py-2.5 rounded-lg border transition-colors font-medium ${
                          variantAttrs.saleType === "UNIT"
                            ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                            : "bg-bg-primary text-text-secondary border-border hover:border-[#9CA3AF]"
                        }`}
                      >
                        Unité
                      </button>
                      <button type="button" onClick={() => setVariantAttrs((p) => ({ ...p, saleType: "PACK" }))}
                        className={`flex-1 text-sm px-4 py-2.5 rounded-lg border transition-colors font-medium ${
                          variantAttrs.saleType === "PACK"
                            ? "bg-bg-dark text-text-inverse border-[#1A1A1A]"
                            : "bg-bg-primary text-text-secondary border-border hover:border-[#9CA3AF]"
                        }`}
                      >
                        Pack
                      </button>
                    </div>
                  </div>

                  {variantAttrs.saleType === "PACK" && (
                    <div>
                      <label className="field-label">Quantité par pack <span className="text-red-500">*</span></label>
                      <input
                        type="number"
                        min="2"
                        className={`field-input w-full ${variantAttrs.packQuantity && vaPackQtyNum < 2 ? "!border-red-400" : ""}`}
                        placeholder="Ex : 6"
                        value={variantAttrs.packQuantity}
                        onChange={(e) => setVariantAttrs((p) => ({ ...p, packQuantity: e.target.value }))}
                      />
                      {variantAttrs.packQuantity && vaPackQtyNum < 2 && (
                        <p className="text-[10px] text-red-500 mt-0.5">Minimum 2 unités par pack</p>
                      )}
                    </div>
                  )}

                  {/* Validation summary */}
                  {!canSubmitVariant && (variantAttrs.unitPrice || variantAttrs.weight) && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                      <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-[11px] text-amber-700 font-body">
                        Remplissez les champs obligatoires (<span className="text-red-500">*</span>) pour continuer.
                      </p>
                    </div>
                  )}
                </div>

                {/* Footer — page 2 */}
                <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-bg-primary shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowVariantForm(false)}
                    className="px-4 py-2.5 text-xs font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Retour
                  </button>
                  <button
                    type="button"
                    onClick={submitVariantCreation}
                    disabled={!canSubmitVariant || creatingVariant}
                    className="px-5 py-2.5 text-xs font-medium font-body text-text-inverse bg-bg-dark rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40"
                  >
                    {creatingVariant ? "Création..." : "Créer la variante et assigner"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
