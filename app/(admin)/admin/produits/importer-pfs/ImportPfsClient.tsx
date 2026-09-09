"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useProductStream } from "@/hooks/useProductStream";
import type { ImportablePfsProduct } from "@/lib/pfs-import";
import { PfsImportMarkupCard } from "./PfsImportMarkupCard";
import type { MarkupState } from "@/components/admin/settings/MarkupRow";

const NO_MARKUP: MarkupState = { type: "percent", value: 0, rounding: "none" };

type Step = "products" | "import";
type ImportMode = "browse" | "byRef";

interface ValidatedRef {
  pfsId: string;
  reference: string;
  name: string;
  defaultImage: string | null;
}

// ─────────────────────────────────────────
// Job types (mirror server-side)
// ─────────────────────────────────────────

interface PfsJobResult {
  pfsId: string;
  reference: string;
  name: string;
  status: "ok" | "error";
  productId?: string;
  error?: string;
}

interface PfsJob {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  /** Nombre de produits traités en parallèle côté serveur — transmis par
   *  SSE pour que l'UI sache combien d'items afficher en « en cours » à la
   *  fois. Par défaut 1 si non reçu (affichage séquentiel). */
  concurrency?: number;
  resultDetails: {
    items: { pfsId: string; reference: string; name: string }[];
    results?: PfsJobResult[];
  } | null;
}

export default function ImportPfsClient({
  embedded,
  initialImportMarkup = NO_MARKUP,
}: {
  embedded?: boolean;
  initialImportMarkup?: MarkupState;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("products");
  const [productLimit, setProductLimit] = useState<string>("");
  const [checkingJob, setCheckingJob] = useState(true);

  // Import mode: browse catalog or by specific references
  const [importMode, setImportMode] = useState<ImportMode>("browse");
  const [validatedRefs, setValidatedRefs] = useState<ValidatedRef[]>([]);

  // Phase produits (chargement + sélection)
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [products, setProducts] = useState<ImportablePfsProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Phase import (job côté serveur)
  const [activeJob, setActiveJob] = useState<PfsJob | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [submittingImport, setSubmittingImport] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);

  /**
   * Interroge le serveur pour savoir si un job PFS est en cours
   * (lancé par n'importe quel admin) ou récemment terminé. Si un job
   * actif est trouvé, bascule l'UI sur la phase « import ».
   */
  const checkActiveJob = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/pfs-import/active-job");
      if (res.ok) {
        const data = await res.json();
        if (data.job) {
          setActiveJob(data.job);
          setStep("import");
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  // ── Check for active job on mount
  useEffect(() => {
    (async () => {
      await checkActiveJob();
      setCheckingJob(false);
    })();
  }, [checkActiveJob]);

  const handleRefreshStatus = useCallback(async () => {
    setRefreshingStatus(true);
    try {
      const found = await checkActiveJob();
      if (!found) {
        toast.success("Aucun import PFS en cours.");
      }
    } finally {
      setRefreshingStatus(false);
    }
  }, [checkActiveJob, toast]);

  // ── Listen for SSE progress updates
  useProductStream(useCallback((event) => {
    if (event.type === "IMPORT_PROGRESS" && event.importProgress) {
      const p = event.importProgress;
      setActiveJob((prev) => {
        if (!prev || prev.id !== p.jobId) return prev;
        const items = prev.resultDetails?.items ?? [];
        const prevResults = prev.resultDetails?.results ?? [];
        let mergedResults = prevResults;
        if (p.results && p.results.length > 0) {
          const byId = new Map<string, PfsJobResult>();
          for (const r of prevResults) byId.set(r.pfsId, r);
          for (const r of p.results) {
            const item = items.find((i) => i.pfsId === r.pfsId);
            byId.set(r.pfsId, {
              pfsId: r.pfsId,
              reference: item?.reference ?? "",
              name: item?.name ?? "",
              status: r.status === "cancelled" ? "error" : r.status,
              productId: r.productId,
              error: r.error,
            });
          }
          mergedResults = Array.from(byId.values());
        }
        return {
          ...prev,
          processedItems: p.processed,
          successItems: p.success,
          errorItems: p.errors,
          concurrency: p.concurrency ?? prev.concurrency,
          status: p.status === "COMPLETED" ? "COMPLETED" : p.status === "FAILED" ? "FAILED" : prev.status,
          resultDetails: { items, results: mergedResults },
        };
      });
    }
  }, []));

  // ── When job completes/fails, refresh the full details from server
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status !== "COMPLETED" && activeJob.status !== "FAILED" && activeJob.status !== "CANCELLED") return;

    (async () => {
      try {
        const res = await fetch("/api/admin/pfs-import/active-job");
        if (res.ok) {
          const data = await res.json();
          if (data.job) setActiveJob(data.job);
        }
      } catch { /* ignore */ }
    })();
  }, [activeJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chargement des produits importables (mode browse)
  const loadBrowseProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const params = productLimit ? `?limit=${productLimit}` : "";
      const res = await fetch(`/api/admin/pfs-import/importable-products${params}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur produits");
      const data = await res.json();
      setProducts(data.products);
      setProductsLoaded(true);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingProducts(false);
    }
  }, [toast, productLimit]);

  // ── Charge les produits depuis les références validées (mode byRef)
  const loadByRefProducts = useCallback(() => {
    setProducts(
      validatedRefs.map((r) => ({
        pfsId: r.pfsId,
        reference: r.reference,
        name: r.name,
        category: "",
        family: "",
        colorCount: 0,
        variantCount: 0,
        defaultImage: r.defaultImage ?? null,
      }))
    );
    setSelected(new Set(validatedRefs.map((r) => r.pfsId)));
    setProductsLoaded(true);
  }, [validatedRefs]);

  const handleModeChange = useCallback((m: ImportMode) => {
    setImportMode(m);
    setProductsLoaded(false);
    setProducts([]);
    setSelected(new Set());
    setValidatedRefs([]);
  }, []);

  const toggleSelect = (pfsId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pfsId)) next.delete(pfsId);
      else next.add(pfsId);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === products.length || prev.size > 0) return new Set();
      return new Set(products.map((p) => p.pfsId));
    });
  };

  // ── Start server-side import
  const startImport = useCallback(async () => {
    if (submittingImport) return;
    const items = products
      .filter((p) => selected.has(p.pfsId))
      .map((p) => ({ pfsId: p.pfsId, reference: p.reference, name: p.name }));

    setSubmittingImport(true);
    try {
      const res = await fetch("/api/admin/pfs-import/start-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Un import PFS est déjà en cours.");
        await checkActiveJob();
        return;
      }
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
      const data = await res.json();
      setActiveJob({
        id: data.jobId,
        status: "PENDING",
        totalItems: items.length,
        processedItems: 0,
        successItems: 0,
        errorItems: 0,
        resultDetails: { items },
      });
      setStep("import");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmittingImport(false);
    }
  }, [products, selected, toast, submittingImport, checkActiveJob]);

  // ── Cancel job
  const cancelJob = useCallback(async () => {
    if (!activeJob) return;
    setCancelling(true);
    try {
      const res = await fetch("/api/admin/pfs-import/cancel-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJob.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
      setActiveJob((prev) => prev ? { ...prev, status: "CANCELLED" } : null);
      toast.success("Import annulé");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCancelling(false);
    }
  }, [activeJob, toast]);

  // ── Reset to start over
  const resetAll = useCallback(() => {
    setActiveJob(null);
    setStep("products");
    setProducts([]);
    setProductsLoaded(false);
    setSelected(new Set());
    setValidatedRefs([]);
  }, []);

  if (checkingJob) {
    return <div className="p-10 text-center text-text-muted">Chargement…</div>;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      {!embedded && (
        <>
          <div className="flex items-center justify-between">
            <Link href="/admin/produits" className="text-[#666] hover:text-text-primary transition-colors text-sm">
              ← Retour aux produits
            </Link>
          </div>

          <div>
            <h1 className="page-title">Importer depuis Paris Fashion Shop</h1>
            <p className="page-subtitle font-body">Récupérez les produits PFS qui ne sont pas encore dans votre catalogue</p>
          </div>
        </>
      )}

      {/* Carte majoration — visible en haut, sauf pendant un import en cours */}
      {step === "products" && (
        <PfsImportMarkupCard initial={initialImportMarkup} />
      )}

      {/* Stepper — 2 étapes */}
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <StepIndicator active={step === "products"} done={step === "import"} label="1. Sélection" />
          <StepArrow />
          <StepIndicator active={step === "import"} done={false} label="2. Import" />
        </div>
        {step !== "import" && (
          <button
            type="button"
            onClick={handleRefreshStatus}
            disabled={refreshingStatus}
            className="flex items-center gap-1.5 text-xs text-[#666] hover:text-text-primary border border-border hover:border-bg-dark rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
            title="Vérifier si un import PFS est déjà en cours"
          >
            <svg className={`w-3.5 h-3.5 ${refreshingStatus ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0011.667 0l3.181-3.183m0-4.991V8.485m0 4.992h-4.99m4.99-4.992l-3.181-3.183a8.25 8.25 0 00-11.667 0L2.985 8.485" />
            </svg>
            {refreshingStatus ? "Vérification..." : "Rafraîchir le statut"}
          </button>
        )}
      </div>

      {/* Step content */}
      {step === "products" && (
        <ProductsStep
          importMode={importMode}
          onImportModeChange={handleModeChange}
          productLimit={productLimit}
          onProductLimitChange={setProductLimit}
          validatedRefs={validatedRefs}
          onValidatedRefsChange={setValidatedRefs}
          loading={loadingProducts}
          productsLoaded={productsLoaded}
          products={products}
          selected={selected}
          onToggle={toggleSelect}
          onToggleAll={toggleAll}
          onLoadBrowse={loadBrowseProducts}
          onLoadByRef={loadByRefProducts}
          onResetLoaded={() => {
            setProductsLoaded(false);
            setProducts([]);
            setSelected(new Set());
          }}
          onNext={startImport}
          submitting={submittingImport}
        />
      )}

      {step === "import" && activeJob && (
        <ImportJobStep
          job={activeJob}
          onCancel={cancelJob}
          cancelling={cancelling}
          onReset={resetAll}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────

function StepIndicator({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`px-3 py-1.5 rounded-lg border ${
        active
          ? "bg-bg-dark text-text-inverse border-bg-dark"
          : done
            ? "bg-[#16a34a] text-white border-[#16a34a]"
            : "bg-bg-primary text-text-muted border-border"
      }`}
    >
      {label}
    </span>
  );
}
function StepArrow() {
  return <span className="text-text-muted">→</span>;
}

/** Tag input for entering references one by one. */
function RefTagInput({
  validatedRefs,
  onValidatedRefsChange,
  onLoad,
  loading,
}: {
  validatedRefs: ValidatedRef[];
  onValidatedRefsChange: (refs: ValidatedRef[]) => void;
  onLoad: () => void;
  loading: boolean;
}) {
  const toast = useToast();
  const [inputValue, setInputValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addReference = useCallback(async () => {
    const ref = inputValue.trim().toUpperCase();
    if (!ref) return;

    if (validatedRefs.some((r) => r.reference === ref)) {
      setError(`La référence ${ref} est déjà dans la liste`);
      return;
    }

    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pfs-import/check-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: ref }),
      });
      const data = await res.json();
      if (!data.valid) {
        setError(data.error || "Référence invalide");
        return;
      }
      onValidatedRefsChange([...validatedRefs, data.product]);
      setInputValue("");
      setError(null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setChecking(false);
    }
  }, [inputValue, validatedRefs, onValidatedRefsChange, toast]);

  const removeRef = useCallback(
    (reference: string) => {
      onValidatedRefsChange(validatedRefs.filter((r) => r.reference !== reference));
    },
    [validatedRefs, onValidatedRefsChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addReference();
      }
    },
    [addReference]
  );

  return (
    <div className="space-y-4">
      <p className="text-text-muted text-sm">
        Tapez une référence produit PFS et appuyez sur Entrée pour l&apos;ajouter.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder="Ex : A2018"
          disabled={checking}
          className="field-input flex-1 text-sm uppercase"
        />
        <button
          onClick={addReference}
          disabled={checking || !inputValue.trim()}
          className="btn-secondary whitespace-nowrap"
        >
          {checking ? "Vérification…" : "Ajouter"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded-lg px-3 py-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          {error}
        </div>
      )}

      {validatedRefs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {validatedRefs.map((r) => (
            <span
              key={r.reference}
              className="inline-flex items-center gap-1.5 bg-[#4b5563] text-white text-sm px-3 py-1.5 rounded-lg"
            >
              <span className="font-mono text-xs">{r.reference}</span>
              <span className="hidden sm:inline">— {r.name}</span>
              <button
                onClick={() => removeRef(r.reference)}
                className="ml-1 hover:text-[#fca5a5] transition-colors"
                title="Retirer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <span className="text-sm text-text-muted">
          {validatedRefs.length} référence(s) ajoutée(s)
        </span>
        <button
          onClick={onLoad}
          disabled={validatedRefs.length === 0 || loading}
          className="btn-primary"
        >
          {loading ? "Chargement…" : "Charger les produits →"}
        </button>
      </div>
    </div>
  );
}

const PRODUCTS_PER_PAGE = 40;

function ProductsStep({
  importMode,
  onImportModeChange,
  productLimit,
  onProductLimitChange,
  validatedRefs,
  onValidatedRefsChange,
  loading,
  productsLoaded,
  products,
  selected,
  onToggle,
  onToggleAll,
  onLoadBrowse,
  onLoadByRef,
  onResetLoaded,
  onNext,
  submitting,
}: {
  importMode: ImportMode;
  onImportModeChange: (m: ImportMode) => void;
  productLimit: string;
  onProductLimitChange: (v: string) => void;
  validatedRefs: ValidatedRef[];
  onValidatedRefsChange: (refs: ValidatedRef[]) => void;
  loading: boolean;
  productsLoaded: boolean;
  products: ImportablePfsProduct[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onLoadBrowse: () => void;
  onLoadByRef: () => void;
  onResetLoaded: () => void;
  onNext: () => void;
  submitting: boolean;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  // Filtrer par recherche (nom ou référence)
  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.reference.toLowerCase().includes(q) ||
        (p.category || "").toLowerCase().includes(q)
    );
  }, [products, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageProducts = filtered.slice((safePage - 1) * PRODUCTS_PER_PAGE, safePage * PRODUCTS_PER_PAGE);

  // Sélection par page ou tout
  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.pfsId));
  const pageIds = useMemo(() => new Set(pageProducts.map((p) => p.pfsId)), [pageProducts]);
  const allPageSelected = pageProducts.length > 0 && pageProducts.every((p) => selected.has(p.pfsId));

  useEffect(() => { setPage(1); }, [search]);

  // Phase 1 : pas encore chargé → mode selector + bouton de chargement
  if (!productsLoaded) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => onImportModeChange("browse")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              importMode === "browse"
                ? "bg-bg-dark text-text-inverse"
                : "bg-bg-muted text-text-secondary hover:bg-bg-muted/80"
            }`}
          >
            Parcourir le catalogue
          </button>
          <button
            onClick={() => onImportModeChange("byRef")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              importMode === "byRef"
                ? "bg-bg-dark text-text-inverse"
                : "bg-bg-muted text-text-secondary hover:bg-bg-muted/80"
            }`}
          >
            Par référence
          </button>
        </div>

        {importMode === "browse" ? (
          <div className="text-center py-10 space-y-4">
            <p className="text-text-muted">
              Chargez la liste des produits Paris Fashion Shop qui ne sont pas encore dans votre catalogue.
              Les nouvelles matières, couleurs, tailles, pays, saisons et catégories seront créées automatiquement à l&apos;import.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <label className="text-sm text-text-secondary">Nombre maximum de produits :</label>
              <input
                type="number"
                min={1}
                placeholder="Tous"
                value={productLimit}
                onChange={(e) => onProductLimitChange(e.target.value)}
                className="border border-border rounded-lg px-3 py-2 text-sm bg-bg-primary w-28 text-center"
              />
              <span className="text-xs text-text-muted">Vide = tout le catalogue</span>
            </div>
            <button onClick={onLoadBrowse} disabled={loading} className="btn-primary">
              {loading ? "Chargement…" : "Charger les produits"}
            </button>
          </div>
        ) : (
          <RefTagInput
            validatedRefs={validatedRefs}
            onValidatedRefsChange={onValidatedRefsChange}
            onLoad={onLoadByRef}
            loading={loading}
          />
        )}
      </div>
    );
  }

  // Phase 2 : produits chargés mais aucun à importer
  if (products.length === 0) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-10 shadow-sm text-center space-y-4">
        <p className="text-text-primary font-medium mb-2">Aucun nouveau produit à importer</p>
        <p className="text-text-muted text-sm">
          {importMode === "browse"
            ? "Tous les produits Paris Fashion Shop de votre marque sont déjà dans votre catalogue."
            : "Aucune des références saisies n'a été trouvée sur Paris Fashion Shop, ou elles sont déjà toutes importées."}
        </p>
        <button onClick={onResetLoaded} className="btn-secondary">← Retour</button>
      </div>
    );
  }

  // Phase 3 : grille de sélection
  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
      {/* Barre de recherche + compteurs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, référence ou catégorie…"
            className="field-input w-full text-sm"
            style={{ paddingLeft: "2.25rem" }}
          />
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>
        <div className="text-sm text-text-muted whitespace-nowrap">
          {filtered.length === products.length
            ? `${products.length} produits`
            : `${filtered.length} / ${products.length} produits`}
          {selected.size > 0 && <> · <span className="text-text-primary font-medium">{selected.size} sélectionné(s)</span></>}
        </div>
      </div>

      {/* Actions de sélection */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => {
            for (const p of pageProducts) {
              if (allPageSelected && selected.has(p.pfsId)) onToggle(p.pfsId);
              else if (!allPageSelected && !selected.has(p.pfsId)) onToggle(p.pfsId);
            }
          }}
          className="btn-ghost text-sm"
        >
          {allPageSelected ? "Décocher cette page" : "Cocher cette page"}
        </button>
        <button
          onClick={onToggleAll}
          className="btn-ghost text-sm"
        >
          {allFilteredSelected ? "Tout décocher" : `Tout cocher (${filtered.length})`}
        </button>
        {selected.size > 0 && (
          <button
            onClick={() => {
              for (const p of products) {
                if (selected.has(p.pfsId)) onToggle(p.pfsId);
              }
            }}
            className="btn-ghost text-sm text-[#b91c1c]"
          >
            Vider la sélection
          </button>
        )}
      </div>

      {/* Grille produits */}
      {pageProducts.length === 0 ? (
        <div className="py-10 text-center text-text-muted text-sm">
          Aucun produit ne correspond à votre recherche.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {pageProducts.map((p) => {
            const isSel = selected.has(p.pfsId);
            return (
              <button
                key={p.pfsId}
                onClick={() => onToggle(p.pfsId)}
                className={`text-left border rounded-xl overflow-hidden transition-all ${
                  isSel ? "border-text-primary shadow-md" : "border-border hover:border-text-primary/50"
                }`}
              >
                <div className="aspect-square bg-bg-muted relative">
                  {p.defaultImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.defaultImage} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                      pas d&apos;image
                    </div>
                  )}
                  {isSel && (
                    <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-text-primary text-white text-xs flex items-center justify-center">
                      ✓
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="text-xs text-text-muted font-mono truncate">{p.reference}</div>
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {p.category || p.family} · {p.colorCount} coul. · {p.variantCount} var.
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(1)}
            disabled={safePage <= 1}
            className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"
          >
            ««
          </button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"
          >
            ‹
          </button>
          <span className="text-sm text-text-muted px-3">
            Page {safePage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"
          >
            ›
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={safePage >= totalPages}
            className="btn-ghost text-xs px-2 py-1 disabled:opacity-30"
          >
            »»
          </button>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onResetLoaded} className="btn-secondary" disabled={submitting}>← Retour</button>
        <button
          onClick={onNext}
          disabled={selected.size === 0 || submitting}
          className="btn-primary inline-flex items-center gap-2"
        >
          {submitting ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Préparation de l&apos;import…
            </>
          ) : (
            <>Importer les {selected.size} produit(s) →</>
          )}
        </button>
      </div>
    </div>
  );
}

type ImportItemState = "pending" | "running" | "ready" | "error" | "cancelled";

type ImportFilter = "all" | ImportItemState;

function ImportJobStep({
  job,
  onCancel,
  cancelling,
  onReset,
}: {
  job: PfsJob;
  onCancel: () => void;
  cancelling: boolean;
  onReset: () => void;
}) {
  const [filter, setFilter] = useState<ImportFilter>("all");
  const isRunning = job.status === "PENDING" || job.status === "PROCESSING";
  const results = useMemo(() => job.resultDetails?.results ?? [], [job.resultDetails?.results]);
  const items = useMemo(() => job.resultDetails?.items ?? [], [job.resultDetails?.items]);
  const progressPercent = job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0;
  const concurrency = Math.max(1, job.concurrency ?? 1);
  const inFlightIds = useMemo(() => {
    const set = new Set<string>();
    if (!isRunning) return set;
    const resultIds = new Set(results.map((r) => r.pfsId));
    for (const it of items) {
      if (resultIds.has(it.pfsId)) continue;
      set.add(it.pfsId);
      if (set.size >= concurrency) break;
    }
    return set;
  }, [isRunning, results, items, concurrency]);

  const itemStates = useMemo(() => {
    const map = new Map<string, ImportItemState>();
    for (const it of items) {
      const result = results.find((r) => r.pfsId === it.pfsId);
      if (result?.status === "ok") {
        map.set(it.pfsId, "ready");
      } else if (result?.status === "error") {
        map.set(it.pfsId, "error");
      } else if (inFlightIds.has(it.pfsId)) {
        map.set(it.pfsId, "running");
      } else if (isRunning) {
        map.set(it.pfsId, "pending");
      } else if (job.status === "CANCELLED") {
        map.set(it.pfsId, "cancelled");
      } else {
        map.set(it.pfsId, "pending");
      }
    }
    return map;
  }, [items, results, inFlightIds, isRunning, job.status]);

  const counts = useMemo(() => {
    const c: Record<ImportItemState, number> = {
      pending: 0, running: 0, ready: 0, error: 0, cancelled: 0,
    };
    for (const state of itemStates.values()) c[state]++;
    return c;
  }, [itemStates]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((it) => itemStates.get(it.pfsId) === filter);
  }, [items, itemStates, filter]);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">
            {job.processedItems}/{job.totalItems} produit(s) importé(s)
            {job.errorItems > 0 ? ` · ${job.errorItems} erreur(s)` : ""}
          </p>
          <p className="text-sm text-text-muted">
            {isRunning && "L’import tourne en arrière-plan. Vous pouvez naviguer ailleurs et revenir ici pour suivre l’avancement."}
            {job.status === "COMPLETED" && "Import terminé. Les images finissent de se télécharger en arrière-plan."}
            {job.status === "FAILED" && "L’import a rencontré des erreurs."}
            {job.status === "CANCELLED" && "L’import a été annulé."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {job.status === "COMPLETED" && (
            <span className="badge badge-success">Terminé</span>
          )}
          {job.status === "FAILED" && (
            <span className="badge badge-error">Erreur</span>
          )}
          {job.status === "CANCELLED" && (
            <span className="badge badge-neutral">Annulé</span>
          )}
          {isRunning && (
            <span className="badge badge-info">En cours…</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="space-y-1">
          <div className="w-full bg-bg-muted rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-text-primary rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-text-muted">
            <span>{job.successItems} importé(s){job.errorItems > 0 ? ` · ${job.errorItems} erreur(s)` : ""}</span>
            <span>{progressPercent}%</span>
          </div>
        </div>
      )}

      {/* Filtres par état */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <FilterChip
          label="Tous"
          count={items.length}
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {counts.pending > 0 && (
          <FilterChip
            label="En attente"
            count={counts.pending}
            active={filter === "pending"}
            onClick={() => setFilter(filter === "pending" ? "all" : "pending")}
            tone="neutral"
          />
        )}
        {counts.running > 0 && (
          <FilterChip
            label="En cours"
            count={counts.running}
            active={filter === "running"}
            onClick={() => setFilter(filter === "running" ? "all" : "running")}
            tone="info"
          />
        )}
        {counts.ready > 0 && (
          <FilterChip
            label="Prêt"
            count={counts.ready}
            active={filter === "ready"}
            onClick={() => setFilter(filter === "ready" ? "all" : "ready")}
            tone="success"
          />
        )}
        {counts.error > 0 && (
          <FilterChip
            label="Erreur"
            count={counts.error}
            active={filter === "error"}
            onClick={() => setFilter(filter === "error" ? "all" : "error")}
            tone="error"
          />
        )}
        {counts.cancelled > 0 && (
          <FilterChip
            label="Annulé"
            count={counts.cancelled}
            active={filter === "cancelled"}
            onClick={() => setFilter(filter === "cancelled" ? "all" : "cancelled")}
            tone="neutral"
          />
        )}
      </div>

      {/* Product list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {filteredItems.length === 0 && (
          <div className="py-8 text-center text-sm text-text-muted">
            Aucun produit dans cette catégorie.
          </div>
        )}
        {filteredItems.map((item) => {
          const result = results.find((r) => r.pfsId === item.pfsId);
          const isCurrentlyRunning = !result && inFlightIds.has(item.pfsId);
          const isPending = !result && !isCurrentlyRunning && isRunning;

          return (
            <div key={item.pfsId} className="flex items-center gap-3 border border-border rounded-xl p-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-text-muted">{item.reference}</div>
                <div className="text-sm font-medium truncate">{item.name}</div>
                {result?.error && <div className="text-xs text-[#b91c1c] mt-1">{result.error}</div>}
              </div>
              <div>
                {isPending && <span className="badge badge-neutral">En attente</span>}
                {isCurrentlyRunning && <span className="badge badge-info">Importation en cours depuis Paris Fashion Shop</span>}
                {result?.status === "ok" && (
                  <div className="flex items-center gap-2">
                    <span className="badge badge-success">Prêt</span>
                    {result.productId && (
                      <Link href={`/admin/produits/${result.productId}/modifier`} className="btn-ghost text-xs px-2 py-1">
                        Voir
                      </Link>
                    )}
                  </div>
                )}
                {result?.status === "error" && <span className="badge badge-error">Erreur</span>}
                {!result && !isCurrentlyRunning && !isPending && job.status === "CANCELLED" && (
                  <span className="badge badge-neutral">Annulé</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-2">
        {isRunning ? (
          <>
            <Link href="/admin/produits" className="btn-secondary">
              ← Aller aux produits
            </Link>
            <button onClick={onCancel} disabled={cancelling} className="btn-secondary text-[#b91c1c] border-[#b91c1c] hover:bg-[#b91c1c]/5">
              {cancelling ? "Annulation…" : "Tout arrêter"}
            </button>
          </>
        ) : (
          <>
            <button onClick={onReset} className="btn-secondary">
              Recommencer un import
            </button>
            <Link href="/admin/produits" className="btn-primary">
              Aller aux produits
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/** Pastille de filtre (Tous / En attente / Prêt / Erreur…) avec compteur. */
function FilterChip({
  label,
  count,
  active,
  onClick,
  tone = "neutral",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: "neutral" | "info" | "success" | "error";
}) {
  const palette: Record<string, { bg: string; text: string; border: string; activeBg: string; activeText: string; activeBorder: string }> = {
    neutral: {
      bg: "bg-bg-muted", text: "text-text-secondary", border: "border-border",
      activeBg: "bg-text-primary", activeText: "text-white", activeBorder: "border-text-primary",
    },
    info: {
      bg: "bg-[#dbeafe]", text: "text-[#1e40af]", border: "border-[#bfdbfe]",
      activeBg: "bg-[#1d4ed8]", activeText: "text-white", activeBorder: "border-[#1d4ed8]",
    },
    success: {
      bg: "bg-[#dcfce7]", text: "text-[#15803d]", border: "border-[#bbf7d0]",
      activeBg: "bg-[#15803d]", activeText: "text-white", activeBorder: "border-[#15803d]",
    },
    error: {
      bg: "bg-[#fee2e2]", text: "text-[#b91c1c]", border: "border-[#fecaca]",
      activeBg: "bg-[#b91c1c]", activeText: "text-white", activeBorder: "border-[#b91c1c]",
    },
  };
  const p = palette[tone];
  const cls = active
    ? `${p.activeBg} ${p.activeText} ${p.activeBorder}`
    : `${p.bg} ${p.text} ${p.border} hover:opacity-80`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${cls}`}
    >
      <span>{label}</span>
      <span className={`text-xs ${active ? "opacity-90" : "opacity-70"}`}>({count})</span>
    </button>
  );
}
