"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CustomSelect from "@/components/ui/CustomSelect";
import QuickCreateModal from "@/components/admin/products/QuickCreateModal";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import {
  createCategoryQuick,
  createColorQuick,
  createCompositionQuick,
  createManufacturingCountryQuick,
  createSeasonQuick,
} from "@/app/actions/admin/quick-create";

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
  pfsGender?: string;
  pfsFamilyId?: string;
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
  pfsReference: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingCountry {
  pfsReference: string;
  suggestedName: string;
  pfsLabels: Record<string, string>;
}

interface MissingSeason {
  pfsReference: string;
  suggestedName: string;
  pfsLabels: Record<string, string>;
}

interface MissingSize {
  name: string;
  usedBy: number;
  pfsCategoryIds?: string[];
}

interface AnalyzeResult {
  totalScanned: number;
  missingEntities: {
    categories: MissingCategory[];
    colors: MissingColor[];
    compositions: MissingComposition[];
    countries: MissingCountry[];
    seasons: MissingSeason[];
    sizes: MissingSize[];
  };
  existingMappings: number;
  existingEntities?: {
    categories: { id: string; name: string; pfsCategoryId?: string | null }[];
    colors: { id: string; name: string; hex: string | null; patternImage: string | null }[];
    compositions: { id: string; name: string }[];
    countries: { id: string; name: string; isoCode: string | null }[];
    seasons: { id: string; name: string }[];
  };
}

interface ExistingEntity {
  id: string;
  name: string;
}

interface ExistingColor extends ExistingEntity {
  hex: string | null;
  patternImage: string | null;
}

interface ExistingEntities {
  categories: (ExistingEntity & { pfsCategoryId?: string | null })[];
  colors: ExistingColor[];
  compositions: ExistingEntity[];
  countries: (ExistingEntity & { isoCode: string | null })[];
  seasons: ExistingEntity[];
}

interface EditableSize {
  name: string;
  usedBy: number;
  bjCategoryIds: string[];
  pfsSizeRefs: string[]; // PFS size refs to map via SizePfsMapping
}

interface EditableCategory {
  pfsName: string;
  pfsCategoryId: string;
  pfsGender: string;
  pfsFamilyId: string;
  bjEntityId: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface EditableColor {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  usedBy: number;
  hex: string | null;
  pfsLabels: Record<string, string>;
}

interface EditableComposition {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface EditableCountry {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  pfsLabels: Record<string, string>;
}

interface EditableSeason {
  pfsName: string;
  pfsReference: string;
  bjEntityId: string | null;
  pfsLabels: Record<string, string>;
}

type Step = "idle" | "analyzing" | "validation" | "creating" | "preparing";

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export default function PfsSyncPageClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [pendingLimit, setPendingLimit] = useState<number | undefined>(undefined);
  const [customLimit, setCustomLimit] = useState("");
  const [analyzeProgress, setAnalyzeProgress] = useState("");
  const [pfsCount, setPfsCount] = useState<number | null>(null);
  const [bjCount, setBjCount] = useState<number | null>(null);

  // Analyze results (editable)
  const [editCategories, setEditCategories] = useState<EditableCategory[]>([]);
  const [editColors, setEditColors] = useState<EditableColor[]>([]);
  const [editCompositions, setEditCompositions] = useState<EditableComposition[]>([]);
  const [editCountries, setEditCountries] = useState<EditableCountry[]>([]);
  const [editSeasons, setEditSeasons] = useState<EditableSeason[]>([]);
  const [editSizes, setEditSizes] = useState<EditableSize[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [existingMappings, setExistingMappings] = useState(0);
  const [existingEntities, setExistingEntities] = useState<ExistingEntities>({
    categories: [],
    colors: [],
    compositions: [],
    countries: [],
    seasons: [],
  });

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

  // Batch create state
  const [batchCreating, setBatchCreating] = useState<string | null>(null); // which type is creating

  // ── Batch create helpers ──
  async function handleBatchCreateCategories() {
    const unresolved = editCategories.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("categories");
    try {
      for (let i = 0; i < unresolved.length; i++) {
        const cat = unresolved[i];
        const names: Record<string, string> = { fr: cat.pfsName, ...cat.pfsLabels };
        try {
          const result = await createCategoryQuick(names, cat.pfsCategoryId, cat.pfsGender, cat.pfsFamilyId);
          setExistingEntities((prev) => ({
            ...prev,
            categories: [...prev.categories, { id: result.id, name: result.name }],
          }));
          setEditCategories((prev) =>
            prev.map((c) => c.pfsCategoryId === cat.pfsCategoryId ? { ...c, bjEntityId: result.id } : c),
          );
        } catch {
          // skip duplicates or errors, continue with the rest
        }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateColors() {
    const unresolved = editColors.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("colors");
    try {
      for (let i = 0; i < unresolved.length; i++) {
        const col = unresolved[i];
        const names: Record<string, string> = { fr: col.pfsName, ...col.pfsLabels };
        try {
          const result = await createColorQuick(names, col.hex, null, col.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            colors: [...prev.colors, { id: result.id, name: result.name, hex: result.hex ?? null, patternImage: null }],
          }));
          setEditColors((prev) =>
            prev.map((c) => c.pfsReference === col.pfsReference ? { ...c, bjEntityId: result.id } : c),
          );
        } catch {
          // skip duplicates or errors
        }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateCompositions() {
    const unresolved = editCompositions.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("compositions");
    try {
      for (let i = 0; i < unresolved.length; i++) {
        const comp = unresolved[i];
        const names: Record<string, string> = { fr: comp.pfsName, ...comp.pfsLabels };
        try {
          const result = await createCompositionQuick(names, comp.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            compositions: [...prev.compositions, { id: result.id, name: result.name }],
          }));
          setEditCompositions((prev) =>
            prev.map((c) => c.pfsReference === comp.pfsReference ? { ...c, bjEntityId: result.id } : c),
          );
        } catch {
          // skip duplicates or errors
        }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateCountries() {
    const unresolved = editCountries.filter((c) => !c.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("countries");
    try {
      for (let i = 0; i < unresolved.length; i++) {
        const ctr = unresolved[i];
        const names: Record<string, string> = { fr: ctr.pfsName, ...ctr.pfsLabels };
        try {
          const result = await createManufacturingCountryQuick(names, undefined, ctr.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            countries: [...prev.countries, { id: result.id, name: result.name, isoCode: null }],
          }));
          setEditCountries((prev) =>
            prev.map((c) => c.pfsReference === ctr.pfsReference ? { ...c, bjEntityId: result.id } : c),
          );
        } catch {
          // skip duplicates or errors
        }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  async function handleBatchCreateSeasons() {
    const unresolved = editSeasons.filter((s) => !s.bjEntityId);
    if (unresolved.length === 0) return;
    setBatchCreating("seasons");
    try {
      for (let i = 0; i < unresolved.length; i++) {
        const s = unresolved[i];
        const names: Record<string, string> = { fr: s.pfsName, ...s.pfsLabels };
        try {
          const result = await createSeasonQuick(names, s.pfsReference);
          setExistingEntities((prev) => ({
            ...prev,
            seasons: [...prev.seasons, { id: result.id, name: result.name }],
          }));
          setEditSeasons((prev) =>
            prev.map((ss) => ss.pfsReference === s.pfsReference ? { ...ss, bjEntityId: result.id } : ss),
          );
        } catch {
          // skip duplicates or errors
        }
      }
    } finally {
      setBatchCreating(null);
    }
  }

  // ── Fetch PFS + BJ product counts (no cache — fresh on every visit) ──
  useEffect(() => {
    fetch("/api/admin/pfs-sync/count")
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.pfsCount === "number") setPfsCount(d.pfsCount);
        if (typeof d.bjCount === "number") setBjCount(d.bjCount);
      })
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

  // When job fails or is stopped, reset to idle
  useEffect(() => {
    if ((job?.status === "FAILED" || job?.status === "STOPPED") && step === "preparing") {
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

      // Store existing entities for dropdowns
      if (finalData.existingEntities) {
        setExistingEntities(finalData.existingEntities as ExistingEntities);
      }

      setEditCategories(
        finalData.missingEntities.categories.map((c) => ({
          pfsName: c.pfsName,
          pfsCategoryId: c.pfsCategoryId,
          pfsGender: c.pfsGender || "WOMAN",
          pfsFamilyId: c.pfsFamilyId || "",
          bjEntityId: null,
          usedBy: c.usedBy,
          pfsLabels: c.pfsLabels || {},
        })),
      );
      setEditColors(
        finalData.missingEntities.colors.map((c) => ({
          pfsName: c.pfsName,
          pfsReference: c.pfsReference,
          bjEntityId: null,
          usedBy: c.usedBy,
          hex: c.hex || null,
          pfsLabels: c.pfsLabels || {},
        })),
      );
      setEditCompositions(
        finalData.missingEntities.compositions.map((c) => ({
          pfsName: c.pfsName,
          pfsReference: c.pfsReference,
          bjEntityId: null,
          usedBy: c.usedBy,
          pfsLabels: c.pfsLabels || {},
        })),
      );
      setEditCountries(
        (finalData.missingEntities.countries ?? []).map((c) => ({
          pfsName: c.suggestedName || c.pfsReference,
          pfsReference: c.pfsReference,
          bjEntityId: null,
          pfsLabels: c.pfsLabels || {},
        })),
      );
      setEditSeasons(
        (finalData.missingEntities.seasons ?? []).map((s) => ({
          pfsName: s.suggestedName || s.pfsReference,
          pfsReference: s.pfsReference,
          bjEntityId: null,
          pfsLabels: s.pfsLabels || {},
        })),
      );
      setEditSizes(
        (finalData.missingEntities.sizes ?? []).map((s) => ({
          name: s.name,
          usedBy: s.usedBy,
          bjCategoryIds: [],
          pfsSizeRefs: [s.name], // par défaut, lier la ref PFS au nom détecté
        })),
      );

      const totalMissing =
        finalData.missingEntities.categories.length +
        finalData.missingEntities.colors.length +
        finalData.missingEntities.compositions.length +
        (finalData.missingEntities.countries?.length ?? 0) +
        (finalData.missingEntities.seasons?.length ?? 0) +
        (finalData.missingEntities.sizes?.length ?? 0);

      const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setAnalyzeLogs((prev) => [
        ...prev,
        `[${time}] Analyse terminée — ${finalData!.totalScanned} produits, ${totalMissing} entité(s) manquante(s) (dont ${finalData!.missingEntities.sizes?.length ?? 0} taille(s) à créer)`,
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

  // ── Step 2: Link entities & start prepare ──
  const validateAndPrepare = async () => {
    // Validation: every entity must be linked to a BJ entity
    const unresolved = [
      ...editCategories.filter((c) => !c.bjEntityId),
      ...editColors.filter((c) => !c.bjEntityId),
      ...editCompositions.filter((c) => !c.bjEntityId),
      ...editCountries.filter((c) => !c.bjEntityId),
      ...editSeasons.filter((s) => !s.bjEntityId),
    ];
    if (unresolved.length > 0) {
      setError(`${unresolved.length} élément(s) non lié(s). Veuillez lier ou créer chaque élément.`);
      return;
    }

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
            pfsGender: c.pfsGender,
            pfsFamilyId: c.pfsFamilyId,
            bjEntityId: c.bjEntityId,
          })),
          colors: editColors.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
            bjEntityId: c.bjEntityId,
          })),
          compositions: editCompositions.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
            bjEntityId: c.bjEntityId,
          })),
          countries: editCountries.map((c) => ({
            pfsName: c.pfsName,
            pfsReference: c.pfsReference,
            bjEntityId: c.bjEntityId,
          })),
          seasons: editSeasons.map((s) => ({
            pfsName: s.pfsName,
            pfsReference: s.pfsReference,
            bjEntityId: s.bjEntityId,
          })),
          sizes: editSizes.map((s) => ({ name: s.name, bjCategoryIds: s.bjCategoryIds, pfsSizeRefs: s.pfsSizeRefs })),
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

  const countsLoaded = pfsCount !== null && bjCount !== null;
  const countsMatch = countsLoaded && pfsCount === bjCount;

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
              Prépare et importe les produits depuis Paris Fashion Shop
            </p>
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
              <div className="px-6 py-3 bg-bg-dark text-text-inverse flex items-center gap-3">
                <svg className="w-4 h-4 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span className="font-heading font-semibold text-sm">
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
            <h2 className="font-heading font-semibold text-text-primary mb-2">
              Résultat de l&apos;analyse
            </h2>
            <div className="flex flex-wrap gap-4 text-sm text-text-secondary">
              <span>{totalScanned} produits analysés</span>
              <span>{existingMappings} mappings existants</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              {editCategories.length > 0 && (
                <span className="badge badge-warning">
                  {editCategories.length} catégorie{editCategories.length > 1 ? "s" : ""}
                </span>
              )}
              {editColors.length > 0 && (
                <span className="badge badge-info">
                  {editColors.length} couleur{editColors.length > 1 ? "s" : ""}
                </span>
              )}
              {editCompositions.length > 0 && (
                <span className="badge badge-neutral">
                  {editCompositions.length} composition{editCompositions.length > 1 ? "s" : ""}
                </span>
              )}
              {editCountries.length > 0 && (
                <span className="badge badge-purple">
                  {editCountries.length} pays
                </span>
              )}
              {editSeasons.length > 0 && (
                <span className="badge badge-info">
                  {editSeasons.length} saison{editSeasons.length > 1 ? "s" : ""}
                </span>
              )}
              {editSizes.length > 0 && (
                <span className="badge badge-neutral">
                  {editSizes.length} taille{editSizes.length > 1 ? "s" : ""}
                </span>
              )}
              {editCategories.length === 0 && editColors.length === 0 && editCompositions.length === 0 && editCountries.length === 0 && editSeasons.length === 0 && editSizes.length === 0 && (
                <span className="badge badge-success">Tout mappé</span>
              )}
            </div>
          </div>

          {editCategories.length > 0 && (
            <GridValidationSection
              title="Catégories non reconnues"
              count={editCategories.length}
              unresolvedCount={editCategories.filter((c) => !c.bjEntityId).length}
              onBatchCreate={handleBatchCreateCategories}
              batchCreating={batchCreating === "categories"}
            >
              {editCategories.map((cat, idx) => (
                <CompactEntityCard
                  key={`cat-${idx}`}
                  pfsName={cat.pfsName}
                  usedBy={cat.usedBy}
                  bjEntityId={cat.bjEntityId}
                  existingOptions={existingEntities.categories}
                  modalType="category"
                  pfsCategoryId={cat.pfsCategoryId}
                  pfsCategoryGender={cat.pfsGender}
                  pfsCategoryFamilyId={cat.pfsFamilyId}
                  onBjEntityIdChange={(id) => {
                    const updated = [...editCategories];
                    updated[idx] = { ...updated[idx], bjEntityId: id };
                    setEditCategories(updated);
                  }}
                  onEntityCreated={(entity) => {
                    setExistingEntities((prev) => ({
                      ...prev,
                      categories: [...prev.categories, { id: entity.id, name: entity.name }],
                    }));
                    const updated = [...editCategories];
                    updated[idx] = { ...updated[idx], bjEntityId: entity.id };
                    setEditCategories(updated);
                  }}
                />
              ))}
            </GridValidationSection>
          )}

          {editColors.length > 0 && (
            <GridValidationSection
              title="Couleurs non reconnues"
              count={editColors.length}
              unresolvedCount={editColors.filter((c) => !c.bjEntityId).length}
              onBatchCreate={handleBatchCreateColors}
              batchCreating={batchCreating === "colors"}
            >
              {editColors.map((col, idx) => (
                <CompactColorCard
                  key={`col-${idx}`}
                  color={col}
                  existingColors={existingEntities.colors}
                  onBjEntityIdChange={(id) => {
                    const updated = [...editColors];
                    updated[idx] = { ...updated[idx], bjEntityId: id };
                    setEditColors(updated);
                  }}
                  onEntityCreated={(entity) => {
                    setExistingEntities((prev) => ({
                      ...prev,
                      colors: [...prev.colors, {
                        id: entity.id,
                        name: entity.name,
                        hex: entity.hex ?? null,
                        patternImage: null,
                      }],
                    }));
                    const updated = [...editColors];
                    updated[idx] = { ...updated[idx], bjEntityId: entity.id };
                    setEditColors(updated);
                  }}
                />
              ))}
            </GridValidationSection>
          )}

          <GridValidationSection
            title="Compositions"
            count={editCompositions.length}
            allClearMessage="Toutes les compositions des produits analysés sont déjà présentes dans la base."
            unresolvedCount={editCompositions.filter((c) => !c.bjEntityId).length}
            onBatchCreate={handleBatchCreateCompositions}
            batchCreating={batchCreating === "compositions"}
          >
            {editCompositions.map((comp, idx) => (
              <CompactEntityCard
                key={comp.pfsReference}
                pfsName={comp.pfsName}
                pfsRef={comp.pfsReference}
                usedBy={comp.usedBy}
                bjEntityId={comp.bjEntityId}
                existingOptions={existingEntities.compositions}
                modalType="composition"
                onBjEntityIdChange={(id) => {
                  const updated = [...editCompositions];
                  updated[idx] = { ...updated[idx], bjEntityId: id };
                  setEditCompositions(updated);
                }}
                onEntityCreated={(entity) => {
                  setExistingEntities((prev) => ({
                    ...prev,
                    compositions: [...prev.compositions, { id: entity.id, name: entity.name }],
                  }));
                  const updated = [...editCompositions];
                  updated[idx] = { ...updated[idx], bjEntityId: entity.id };
                  setEditCompositions(updated);
                }}
              />
            ))}
          </GridValidationSection>

          <GridValidationSection
            title="Pays de fabrication"
            count={editCountries.length}
            allClearMessage="Tous les pays des produits analysés sont déjà présents dans la base."
            unresolvedCount={editCountries.filter((c) => !c.bjEntityId).length}
            onBatchCreate={handleBatchCreateCountries}
            batchCreating={batchCreating === "countries"}
          >
            {editCountries.map((ctr, idx) => (
              <CompactEntityCard
                key={ctr.pfsReference}
                pfsName={ctr.pfsName}
                pfsRef={ctr.pfsReference}
                bjEntityId={ctr.bjEntityId}
                existingOptions={existingEntities.countries}
                modalType="country"
                onBjEntityIdChange={(id) => {
                  const updated = [...editCountries];
                  updated[idx] = { ...updated[idx], bjEntityId: id };
                  setEditCountries(updated);
                }}
                onEntityCreated={(entity) => {
                  setExistingEntities((prev) => ({
                    ...prev,
                    countries: [...prev.countries, { id: entity.id, name: entity.name, isoCode: null }],
                  }));
                  const updated = [...editCountries];
                  updated[idx] = { ...updated[idx], bjEntityId: entity.id };
                  setEditCountries(updated);
                }}
              />
            ))}
          </GridValidationSection>

          <GridValidationSection
            title="Saisons / Collections"
            count={editSeasons.length}
            allClearMessage="Toutes les saisons des produits analysés sont déjà présentes dans la base."
            unresolvedCount={editSeasons.filter((s) => !s.bjEntityId).length}
            onBatchCreate={handleBatchCreateSeasons}
            batchCreating={batchCreating === "seasons"}
          >
            {editSeasons.map((s, idx) => (
              <CompactEntityCard
                key={s.pfsReference}
                pfsName={s.pfsName}
                pfsRef={s.pfsReference}
                bjEntityId={s.bjEntityId}
                existingOptions={existingEntities.seasons}
                modalType="season"
                onBjEntityIdChange={(id) => {
                  const updated = [...editSeasons];
                  updated[idx] = { ...updated[idx], bjEntityId: id };
                  setEditSeasons(updated);
                }}
                onEntityCreated={(entity) => {
                  setExistingEntities((prev) => ({
                    ...prev,
                    seasons: [...prev.seasons, { id: entity.id, name: entity.name }],
                  }));
                  const updated = [...editSeasons];
                  updated[idx] = { ...updated[idx], bjEntityId: entity.id };
                  setEditSeasons(updated);
                }}
              />
            ))}
          </GridValidationSection>

          <GridValidationSection
            title="Tailles"
            count={editSizes.length}
            allClearMessage="Toutes les tailles des produits analysés sont déjà présentes dans la base."
          >
            {editSizes.map((s, idx) => (
              <CompactSizeCard
                key={s.name}
                size={s}
                availableCategories={existingEntities.categories}
                onChange={(updated) => {
                  const list = [...editSizes];
                  list[idx] = updated;
                  setEditSizes(list);
                }}
              />
            ))}
          </GridValidationSection>

          {/* Progress indicator */}
          {(() => {
            const total = editCategories.length + editColors.length + editCompositions.length + editCountries.length + editSeasons.length;
            const resolved = [
              ...editCategories.filter((c) => !!c.bjEntityId),
              ...editColors.filter((c) => !!c.bjEntityId),
              ...editCompositions.filter((c) => !!c.bjEntityId),
              ...editCountries.filter((c) => !!c.bjEntityId),
              ...editSeasons.filter((s) => !!s.bjEntityId),
            ].length;
            return total > 0 ? (
              <div className="flex items-center gap-3 text-sm">
                <div className="flex-1 bg-bg-secondary rounded-full h-2">
                  <div className="h-2 bg-[#22C55E] rounded-full transition-all" style={{ width: `${(resolved / total) * 100}%` }} />
                </div>
                <span className="text-text-secondary shrink-0">{resolved}/{total} résolus</span>
              </div>
            ) : null;
          })()}

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
              <h2 className="font-heading font-semibold text-text-primary">
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
                    className="w-full flex items-center justify-between px-4 py-3 bg-bg-dark text-text-inverse hover:bg-[#2A2A2A] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      <span className="font-heading font-semibold text-sm">
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
                    className="w-full flex items-center justify-between px-4 py-3 bg-bg-dark text-text-inverse hover:bg-[#2A2A2A] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                      </svg>
                      <span className="font-heading font-semibold text-sm">
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

function GridValidationSection({
  title, count, allClearMessage, children,
  unresolvedCount, onBatchCreate, batchCreating,
}: {
  title: string;
  count: number;
  allClearMessage?: string;
  children: React.ReactNode;
  unresolvedCount?: number;
  onBatchCreate?: () => void;
  batchCreating?: boolean;
}) {
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold text-text-primary text-sm flex items-center gap-2">
          {title}
          {count > 0 ? (
            <span className="text-xs font-normal text-text-secondary">({count})</span>
          ) : (
            <span className="badge badge-success text-[10px]">✓ OK</span>
          )}
        </h3>
        {onBatchCreate && unresolvedCount !== undefined && unresolvedCount > 0 && (
          <button
            type="button"
            onClick={onBatchCreate}
            disabled={batchCreating}
            className="flex items-center gap-1.5 text-[11px] font-medium text-text-inverse bg-bg-dark hover:bg-black px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {batchCreating ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Création…
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Créer tout ({unresolvedCount})
              </>
            )}
          </button>
        )}
      </div>
      {count === 0 ? (
        <p className="text-xs text-text-secondary">{allClearMessage ?? "Aucun élément manquant dans les produits analysés."}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Compact card — categories, compositions, countries, seasons
// ─────────────────────────────────────────────
function CompactEntityCard({
  pfsName,
  pfsRef,
  usedBy,
  bjEntityId,
  existingOptions,
  modalType,
  onBjEntityIdChange,
  onEntityCreated,
  pfsCategoryId: propPfsCategoryId,
  pfsCategoryGender,
  pfsCategoryFamilyId,
}: {
  pfsName: string;
  pfsRef?: string;
  usedBy?: number;
  bjEntityId: string | null;
  existingOptions: { id: string; name: string }[];
  modalType: "category" | "composition" | "country" | "season";
  onBjEntityIdChange: (id: string | null) => void;
  onEntityCreated: (entity: { id: string; name: string; hex?: string | null }) => void;
  pfsCategoryId?: string;
  pfsCategoryGender?: string;
  pfsCategoryFamilyId?: string;
}) {
  const [showModal, setShowModal] = useState(false);
  const isResolved = !!bjEntityId;

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2.5 bg-bg-primary transition-colors ${isResolved ? "border-[#22C55E]/30 bg-[#22C55E]/[0.03]" : "border-[#F59E0B]/40"}`}>
      {/* Header */}
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text-primary truncate leading-tight" title={pfsName}>{pfsName}</p>
          {pfsRef && pfsRef !== pfsName && (
            <p className="text-[10px] text-text-secondary font-mono truncate">{pfsRef}</p>
          )}
          {usedBy !== undefined && usedBy > 0 && (
            <p className="text-[10px] text-text-secondary">{usedBy} produit{usedBy > 1 ? "s" : ""}</p>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isResolved ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]"}`}>
          {isResolved ? "✓" : "!"}
        </span>
      </div>

      {/* Dropdown pour lier */}
      {existingOptions.length > 0 ? (
        <CustomSelect
          options={existingOptions.map((opt) => ({ value: opt.id, label: opt.name }))}
          value={bjEntityId || ""}
          onChange={(val) => onBjEntityIdChange(val || null)}
          placeholder="Lier à un existant…"
          size="sm"
          searchable
        />
      ) : (
        <p className="text-[10px] text-[#F59E0B]">Aucun existant — créez-en un ci-dessous.</p>
      )}

      {/* Bouton Créer nouveau → ouvre le vrai modal admin */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="w-full flex items-center justify-center gap-1.5 text-[10px] font-medium text-text-secondary border border-dashed border-border rounded-lg px-2 py-1.5 hover:border-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Créer nouveau
      </button>

      <QuickCreateModal
        type={modalType}
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={(entity) => onEntityCreated(entity)}
        defaultName={pfsName}
        defaultPfsRef={pfsRef}
        defaultPfsCategoryId={propPfsCategoryId}
        defaultPfsCategoryGender={pfsCategoryGender}
        defaultPfsCategoryFamilyId={pfsCategoryFamilyId}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Compact color card for the grid
// ─────────────────────────────────────────────
function CompactColorCard({
  color,
  existingColors,
  onBjEntityIdChange,
  onEntityCreated,
}: {
  color: EditableColor;
  existingColors: ExistingColor[];
  onBjEntityIdChange: (id: string | null) => void;
  onEntityCreated: (entity: { id: string; name: string; hex?: string | null }) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const isResolved = !!color.bjEntityId;
  const selected = color.bjEntityId ? existingColors.find((c) => c.id === color.bjEntityId) : null;

  return (
    <div className={`border rounded-xl p-3 flex flex-col gap-2.5 bg-bg-primary transition-colors ${isResolved ? "border-[#22C55E]/30 bg-[#22C55E]/[0.03]" : "border-[#F59E0B]/40"}`}>
      {/* Header */}
      <div className="flex items-start gap-1.5 min-w-0">
        <div
          className="w-4 h-4 rounded-full border border-border shrink-0 mt-0.5"
          style={{ backgroundColor: color.hex || "#9CA3AF" }}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text-primary truncate leading-tight" title={color.pfsName}>{color.pfsName}</p>
          <p className="text-[10px] text-text-secondary font-mono truncate">{color.pfsReference}</p>
          <p className="text-[10px] text-text-secondary">{color.usedBy} produit{color.usedBy > 1 ? "s" : ""}</p>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isResolved ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]"}`}>
          {isResolved ? "✓" : "!"}
        </span>
      </div>

      {/* Link dropdown */}
      {existingColors.length === 0 ? (
        <p className="text-[10px] text-[#F59E0B]">Aucune couleur existante — créez-en une ci-dessous.</p>
      ) : (
        <div className="space-y-1.5">
          <CustomSelect
            options={existingColors.map((opt) => ({ value: opt.id, label: opt.name }))}
            value={color.bjEntityId || ""}
            onChange={(val) => onBjEntityIdChange(val || null)}
            placeholder="Lier à une couleur…"
            size="sm"
            searchable
          />
          {selected && (
            <div className="flex items-center gap-1.5">
              <div
                className="w-4 h-4 rounded-full border border-border shrink-0"
                style={
                  selected.patternImage
                    ? { backgroundImage: `url(${selected.patternImage})`, backgroundSize: "cover" }
                    : { backgroundColor: selected.hex || "#9CA3AF" }
                }
              />
              <span className="text-[10px] text-text-secondary truncate">{selected.name}</span>
            </div>
          )}
        </div>
      )}

      {/* Create button */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="w-full py-1.5 text-[10px] font-medium text-text-secondary border border-dashed border-border rounded-lg hover:border-text-secondary hover:text-text-primary transition-colors"
      >
        + Créer une nouvelle couleur
      </button>

      <QuickCreateModal
        type="color"
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={(entity) => {
          onEntityCreated(entity);
          setShowModal(false);
        }}
        defaultName={color.pfsName}
        defaultPfsRef={color.pfsReference}
        defaultHex={color.hex}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Compact size card — opens a modal to configure name, PFS refs, categories
// ─────────────────────────────────────────────
function CompactSizeCard({
  size,
  availableCategories,
  onChange,
}: {
  size: EditableSize;
  availableCategories: { id: string; name: string }[];
  onChange: (updated: EditableSize) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const isConfigured = !!size.name.trim();

  return (
    <div className="border border-border rounded-xl p-3 flex flex-col gap-2 bg-bg-primary">
      {/* Header */}
      <div className="flex items-start gap-1.5 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-sm text-text-primary bg-bg-secondary px-2 py-0.5 rounded-md shrink-0">
              {size.name}
            </span>
            {size.usedBy > 0 && (
              <span className="text-[10px] text-text-secondary">{size.usedBy} prod.</span>
            )}
          </div>
          {/* Summary */}
          <div className="mt-1 space-y-0.5">
            {size.pfsSizeRefs.length > 0 && (
              <p className="text-[10px] text-text-secondary">
                PFS : <span className="font-mono">{size.pfsSizeRefs.join(", ")}</span>
              </p>
            )}
            {size.bjCategoryIds.length > 0 && (
              <p className="text-[10px] text-text-secondary">
                {size.bjCategoryIds.length} catégorie{size.bjCategoryIds.length > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isConfigured ? "bg-[#22C55E]/15 text-[#22C55E]" : "bg-[#F59E0B]/15 text-[#F59E0B]"}`}>
          {isConfigured ? "✓" : "!"}
        </span>
      </div>

      {/* Configure button */}
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="w-full text-left text-[11px] font-medium text-text-secondary border border-border rounded-lg px-2 py-1.5 bg-bg-secondary hover:bg-bg-primary hover:text-text-primary transition-colors"
      >
        Configurer…
      </button>

      {showModal && (
        <CreateSizeModal
          size={size}
          availableCategories={availableCategories}
          onSave={(updated) => {
            onChange(updated);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Modal — Create composition / country / season
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Modal — Create size with PFS refs + category links
// ─────────────────────────────────────────────
function CreateSizeModal({
  size,
  availableCategories,
  onSave,
  onClose,
}: {
  size: EditableSize;
  availableCategories: { id: string; name: string }[];
  onSave: (updated: EditableSize) => void;
  onClose: () => void;
}) {
  const backdrop = useBackdropClose(onClose);
  const [name, setName] = useState(size.name);
  const [bjCategoryIds, setBjCategoryIds] = useState<string[]>(size.bjCategoryIds);
  const [pfsSizeRefs, setPfsSizeRefs] = useState<string[]>(size.pfsSizeRefs);
  const [newPfsRef, setNewPfsRef] = useState("");

  const addPfsRef = () => {
    const ref = newPfsRef.trim();
    if (ref && !pfsSizeRefs.includes(ref)) {
      setPfsSizeRefs((prev) => [...prev, ref]);
    }
    setNewPfsRef("");
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ ...size, name: name.trim(), bjCategoryIds, pfsSizeRefs });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="bg-bg-primary border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-heading font-semibold text-text-primary">
                Créer une taille
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Réf. PFS détectée : <span className="font-mono font-semibold">{size.name}</span>
                {size.usedBy > 0 && (
                  <span> — {size.usedBy} produit{size.usedBy > 1 ? "s" : ""}</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg-secondary transition-colors"
              aria-label="Fermer"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Nom de la taille */}
          <div className="space-y-1.5">
            <label className="field-label">
              Nom de la taille (BJ) <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex : S, M, XL, TU, 52…"
              autoFocus
            />
            <p className="text-[10px] text-text-secondary">
              Ce nom sera affiché dans les produits Boutique
            </p>
          </div>

          {/* PFS size refs */}
          <div className="space-y-2">
            <label className="field-label">Références PFS liées</label>
            <p className="text-[10px] text-text-secondary">
              Cette taille BJ sera reconnue quand PFS envoie ces codes taille
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                className="field-input flex-1"
                value={newPfsRef}
                onChange={(e) => setNewPfsRef(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addPfsRef(); }
                }}
                placeholder="Ex : XS, S, M…"
              />
              <button type="button" onClick={addPfsRef} className="btn-secondary shrink-0 text-sm px-3">
                Ajouter
              </button>
            </div>
            {pfsSizeRefs.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {pfsSizeRefs.map((ref) => (
                  <span
                    key={ref}
                    className="inline-flex items-center gap-1.5 text-xs bg-bg-secondary border border-border rounded-full px-2.5 py-1"
                  >
                    <span className="font-mono font-semibold text-text-primary">{ref}</span>
                    <button
                      type="button"
                      onClick={() => setPfsSizeRefs((prev) => prev.filter((r) => r !== ref))}
                      className="text-[#EF4444] opacity-60 hover:opacity-100 transition-opacity leading-none"
                      aria-label={`Retirer ${ref}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[#F59E0B]">
                Aucune référence PFS — la taille ne sera pas mappée automatiquement.
              </p>
            )}
          </div>

          {/* BJ categories */}
          <div className="space-y-2">
            <label className="field-label">Catégories BJ</label>
            <p className="text-[10px] text-text-secondary">
              Optionnel — restreint l&apos;affichage de cette taille aux catégories sélectionnées
            </p>
            {availableCategories.filter((c) => !bjCategoryIds.includes(c.id)).length > 0 && (
              <CustomSelect
                options={availableCategories
                  .filter((c) => !bjCategoryIds.includes(c.id))
                  .map((c) => ({ value: c.id, label: c.name }))}
                value=""
                onChange={(catId) => {
                  if (catId && !bjCategoryIds.includes(catId)) {
                    setBjCategoryIds((prev) => [...prev, catId]);
                  }
                }}
                placeholder="Ajouter une catégorie…"
                searchable
              />
            )}
            {bjCategoryIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {bjCategoryIds.map((catId) => {
                  const cat = availableCategories.find((c) => c.id === catId);
                  return (
                    <span
                      key={catId}
                      className="inline-flex items-center gap-1 text-xs bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20 rounded-full px-2.5 py-1"
                    >
                      {cat?.name ?? catId}
                      <button
                        type="button"
                        onClick={() => setBjCategoryIds((prev) => prev.filter((id) => id !== catId))}
                        className="opacity-60 hover:opacity-100 transition-opacity leading-none"
                        aria-label={`Retirer ${cat?.name ?? catId}`}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] text-text-secondary">Aucune catégorie — taille globale.</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!name.trim()}
              className="btn-primary flex-1"
            >
              Enregistrer
            </button>
          </div>
        </div>
      </div>
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
      <div className="text-2xl font-bold font-heading">
        {value.toLocaleString()}
      </div>
      <div className="text-xs mt-1 opacity-80">{label}</div>
    </div>
  );
}
