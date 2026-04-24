"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useProductStream } from "@/hooks/useProductStream";
import QuickCreateModal, { type QuickCreateType } from "@/components/admin/products/QuickCreateModal";
import QuickCreateSizeModal from "@/components/admin/products/QuickCreateSizeModal";
import type { PfsAttribute, PfsAttributeType, ImportablePfsProduct } from "@/lib/pfs-import";

type Step = "scan" | "products" | "import";

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

export default function ImportPfsClient({ embedded }: { embedded?: boolean }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("scan");
  const [productLimit, setProductLimit] = useState<string>("");
  const [checkingJob, setCheckingJob] = useState(true);

  // Step 1 — scan
  const [scanning, setScanning] = useState(false);
  const [attributes, setAttributes] = useState<PfsAttribute[]>([]);
  const [scanMeta, setScanMeta] = useState<{ scannedProducts: number; deepScannedProducts: number } | null>(null);
  // Attribut actuellement en cours de création (ouvre le modal correspondant)
  const [creatingAttr, setCreatingAttr] = useState<PfsAttribute | null>(null);

  // Step 2 — products
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [products, setProducts] = useState<ImportablePfsProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 3 — import (server-side job)
  const [activeJob, setActiveJob] = useState<PfsJob | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // ── Check for active job on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/pfs-import/active-job");
        if (res.ok) {
          const data = await res.json();
          if (data.job) {
            setActiveJob(data.job);
            setStep("import");
          }
        }
      } catch {
        // ignore
      } finally {
        setCheckingJob(false);
      }
    })();
  }, []);

  // ── Listen for SSE progress updates
  useProductStream(useCallback((event) => {
    if (event.type === "IMPORT_PROGRESS" && event.importProgress) {
      const p = event.importProgress;
      setActiveJob((prev) => {
        if (!prev || prev.id !== p.jobId) return prev;
        // On fusionne les résultats par pfsId : l'événement SSE porte les
        // produits déjà terminés (Prêt / Erreur). La liste côté client est
        // rafraîchie pour que les badges s'actualisent même en mode parallèle.
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

  // ── Step 1 actions
  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const params = productLimit ? `?limit=${productLimit}` : "";
      const res = await fetch(`/api/admin/pfs-import/scan-attributes${params}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur scan");
      const data = await res.json();
      setAttributes(data.attributes);
      setScanMeta({ scannedProducts: data.scannedProducts, deepScannedProducts: data.deepScannedProducts });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [toast, productLimit]);

  /** Ouvre le modal de création approprié pour un attribut non mappé. */
  const handleCreateMapping = useCallback((attr: PfsAttribute) => {
    setCreatingAttr(attr);
  }, []);

  /** Appelé par le modal après création réussie : on met à jour la ligne
   *  correspondante pour passer en "✓ mappé" sans re-scanner. */
  const handleCreatedMapping = useCallback(
    (id: string, name: string) => {
      if (!creatingAttr) return;
      const attr = creatingAttr;
      setAttributes((prev) =>
        prev.map((a) =>
          a.type === attr.type && a.pfsRef === attr.pfsRef
            ? { ...a, mapped: true, localId: id, localName: name }
            : a
        )
      );
      toast.success(`${name} créé`);
      setCreatingAttr(null);
    },
    [creatingAttr, toast]
  );

  const missingCount = attributes.filter((a) => !a.mapped).length;
  const canGoToProducts = attributes.length > 0 && missingCount === 0;

  // ── Step 2 actions
  const loadProducts = useCallback(async () => {
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

  useEffect(() => {
    if (step === "products" && !productsLoaded && !loadingProducts) {
      loadProducts();
    }
  }, [step, productsLoaded, loadingProducts, loadProducts]);

  const toggleSelect = (pfsId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pfsId)) next.delete(pfsId);
      else next.add(pfsId);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.size === products.length ? new Set() : new Set(products.map((p) => p.pfsId))));
  };

  // ── Step 3 — start server-side import
  const startImport = useCallback(async () => {
    const items = products
      .filter((p) => selected.has(p.pfsId))
      .map((p) => ({ pfsId: p.pfsId, reference: p.reference, name: p.name }));

    try {
      const res = await fetch("/api/admin/pfs-import/start-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
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
    }
  }, [products, selected, toast]);

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
    setStep("scan");
    setAttributes([]);
    setScanMeta(null);
    setProducts([]);
    setProductsLoaded(false);
    setSelected(new Set());
  }, []);

  if (checkingJob) {
    return <div className="p-10 text-center text-text-muted">Chargement…</div>;
  }

  // ─────────────────────────────────────────
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

      {/* Stepper */}
      <div className="flex items-center gap-2 text-sm">
        <StepIndicator active={step === "scan"} done={step !== "scan"} label="1. Correspondances" />
        <StepArrow />
        <StepIndicator active={step === "products"} done={step === "import"} label="2. Sélection" />
        <StepArrow />
        <StepIndicator active={step === "import"} done={false} label="3. Import" />
      </div>

      {/* Step content */}
      {step === "scan" && (
        <ScanStep
          scanning={scanning}
          attributes={attributes}
          scanMeta={scanMeta}
          missingCount={missingCount}
          canGoToProducts={canGoToProducts}
          productLimit={productLimit}
          onProductLimitChange={setProductLimit}
          onRunScan={runScan}
          onCreateMapping={handleCreateMapping}
          onNext={() => setStep("products")}
        />
      )}

      {step === "products" && (
        <ProductsStep
          loading={loadingProducts}
          products={products}
          selected={selected}
          onToggle={toggleSelect}
          onToggleAll={toggleAll}
          onBack={() => setStep("scan")}
          onNext={startImport}
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

      <PfsCreateMappingModals
        attr={creatingAttr}
        onClose={() => setCreatingAttr(null)}
        onCreated={handleCreatedMapping}
      />
    </div>
  );
}

/**
 * Route l'attribut PFS non mappé vers le bon modal de création : tailles →
 * modal taille dédié, tous les autres → QuickCreateModal (catégorie / couleur /
 * matière / pays / saison). La correspondance PFS est pré-remplie et verrouillée
 * : l'admin ne peut modifier que le nom et les traductions.
 */
function PfsCreateMappingModals({
  attr,
  onClose,
  onCreated,
}: {
  attr: PfsAttribute | null;
  onClose: () => void;
  onCreated: (id: string, name: string) => void;
}) {
  const open = !!attr;
  const modalKey = attr ? `${attr.type}_${attr.pfsRef}` : "closed";
  // Type size → modal taille dédié
  if (open && attr!.type === "size") {
    return (
      <QuickCreateSizeModal
        key={modalKey}
        open={open}
        onClose={onClose}
        pfsSizes={[{ reference: attr!.pfsRef, label: attr!.label }]}
        defaultName={attr!.label}
        defaultPfsRef={attr!.pfsRef}
        lockPfsRef
        onCreated={(s) => onCreated(s.id, s.name)}
      />
    );
  }
  // Autres types → QuickCreateModal
  const pfsType: QuickCreateType | null = attr
    ? (attr.type as Exclude<PfsAttributeType, "size"> as QuickCreateType)
    : null;
  // Import PFS = on verrouille toujours la correspondance : l'admin ne doit
  // jamais pouvoir toucher aux champs Genre / Famille / Catégorie PFS lors
  // de l'import — les valeurs proviennent du produit PFS scanné. Si une
  // valeur manque côté PFS, le verrou montre « — » et le bouton « + Créer »
  // reste désactivé tant que genre + famille ne sont pas présents.
  return (
    <QuickCreateModal
      key={modalKey}
      type={pfsType ?? "color"}
      open={open}
      onClose={onClose}
      onCreated={(item) => onCreated(item.id, item.name)}
      defaultName={attr?.label}
      defaultPfsRef={attr && attr.type !== "category" ? attr.pfsRef : undefined}
      defaultPfsCategoryId={attr?.type === "category" ? attr.pfsRef : undefined}
      defaultPfsGender={attr?.type === "category" ? attr.meta?.pfsGender ?? undefined : undefined}
      defaultPfsFamilyName={attr?.type === "category" ? attr.meta?.pfsFamilyName ?? undefined : undefined}
      defaultPfsCategoryName={attr?.type === "category" ? attr.meta?.pfsCategoryName ?? undefined : undefined}
      defaultHex={attr?.type === "color" ? attr.meta?.hex ?? undefined : undefined}
      lockPfs={!!attr}
    />
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
          ? "bg-text-primary text-white border-text-primary"
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

function ScanStep({
  scanning,
  attributes,
  scanMeta,
  missingCount,
  canGoToProducts,
  productLimit,
  onProductLimitChange,
  onRunScan,
  onCreateMapping,
  onNext,
}: {
  scanning: boolean;
  attributes: PfsAttribute[];
  scanMeta: { scannedProducts: number; deepScannedProducts: number } | null;
  missingCount: number;
  canGoToProducts: boolean;
  productLimit: string;
  onProductLimitChange: (v: string) => void;
  onRunScan: () => void;
  onCreateMapping: (a: PfsAttribute) => void;
  onNext: () => void;
}) {
  const groups: Record<PfsAttributeType, PfsAttribute[]> = {
    category: [],
    color: [],
    composition: [],
    country: [],
    season: [],
    size: [],
  };
  for (const a of attributes) groups[a.type].push(a);

  const labels: Record<PfsAttributeType, string> = {
    category: "Catégories",
    color: "Couleurs",
    composition: "Compositions",
    country: "Pays de fabrication",
    season: "Saisons",
    size: "Tailles",
  };

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
      {attributes.length === 0 ? (
        <div className="text-center py-10 space-y-4">
          <p className="text-text-muted">
            Lancez un scan du catalogue PFS pour vérifier que toutes les correspondances existent chez vous.
          </p>
          <div className="flex items-center justify-center gap-3">
            <label className="text-sm text-text-secondary">Nombre de produits :</label>
            <input
              type="number"
              min={1}
              placeholder="Tous"
              value={productLimit}
              onChange={(e) => onProductLimitChange(e.target.value)}
              className="border border-border rounded-lg px-3 py-2 text-sm bg-bg-primary w-24 text-center"
            />
            <span className="text-xs text-text-muted">Laissez vide pour tout récupérer</span>
          </div>
          <button onClick={onRunScan} disabled={scanning} className="btn-primary">
            {scanning ? "Scan en cours…" : "Scanner PFS"}
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-text-muted">
              {scanMeta && (
                <>
                  {scanMeta.scannedProducts} produits scannés · {scanMeta.deepScannedProducts} en détail
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {missingCount > 0 ? (
                <span className="badge badge-warning">{missingCount} correspondance(s) à créer</span>
              ) : (
                <span className="badge badge-success">Toutes les correspondances existent</span>
              )}
              <input
                type="number"
                min={1}
                placeholder="Tous"
                value={productLimit}
                onChange={(e) => onProductLimitChange(e.target.value)}
                className="border border-border rounded-lg px-2 py-1.5 text-sm bg-bg-primary w-20 text-center"
              />
              <button onClick={onRunScan} disabled={scanning} className="btn-secondary">
                {scanning ? "Scan…" : "Re-scanner"}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {(Object.keys(groups) as PfsAttributeType[]).map((type) => {
              const list = groups[type];
              if (list.length === 0) return null;
              const missing = list.filter((a) => !a.mapped).length;
              return (
                <div key={type} className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-2 bg-bg-muted flex items-center justify-between">
                    <span className="font-medium text-sm">{labels[type]}</span>
                    <span className="text-xs text-text-muted">
                      {list.length - missing}/{list.length} mappés
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {list.map((a) => (
                        <tr key={`${a.type}_${a.pfsRef}`} className="border-t border-border">
                          <td className="px-4 py-2">
                            <span className="text-sm">{a.label}</span>
                            {a.label !== a.pfsRef && (
                              <span className="text-xs text-text-muted ml-2">({a.pfsRef})</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {a.mapped ? (
                              <span className="text-[#15803D] text-sm">✓ {a.localName}</span>
                            ) : (
                              <button
                                onClick={() => onCreateMapping(a)}
                                className="btn-ghost text-sm px-3 py-1.5"
                              >
                                + Créer
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button onClick={onNext} disabled={!canGoToProducts} className="btn-primary">
              Suivant — Choisir les produits →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProductsStep({
  loading,
  products,
  selected,
  onToggle,
  onToggleAll,
  onBack,
  onNext,
}: {
  loading: boolean;
  products: ImportablePfsProduct[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  if (loading) return <div className="p-10 text-center text-text-muted">Chargement des produits PFS…</div>;

  if (products.length === 0) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-10 shadow-sm text-center">
        <p className="text-text-primary font-medium mb-2">Aucun nouveau produit à importer</p>
        <p className="text-text-muted text-sm">Tous les produits PFS sont déjà dans votre catalogue.</p>
        <button onClick={onBack} className="btn-secondary mt-6">← Retour</button>
      </div>
    );
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-text-muted">
          {products.length} produits disponibles · {selected.size} sélectionné(s)
        </div>
        <button onClick={onToggleAll} className="btn-ghost text-sm">
          {selected.size === products.length ? "Tout décocher" : "Tout cocher"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.map((p) => {
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

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="btn-secondary">← Retour</button>
        <button onClick={onNext} disabled={selected.size === 0} className="btn-primary">
          Importer les {selected.size} produit(s) →
        </button>
      </div>
    </div>
  );
}

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
  const isRunning = job.status === "PENDING" || job.status === "PROCESSING";
  const isDone = job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED";
  const results = job.resultDetails?.results ?? [];
  const items = job.resultDetails?.items ?? [];
  const progressPercent = job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0;
  // Concurrence effective du worker : combien d'items affichent « en cours »
  // en même temps. Côté serveur IMPORT_CONCURRENCY = 5 ; si l'info n'est
  // pas reçue on retombe sur 1 (comportement séquentiel historique).
  const concurrency = Math.max(1, job.concurrency ?? 1);
  const resultIds = new Set(results.map((r) => r.pfsId));
  // Ensemble des pfsId actuellement en cours d'import : on prend simplement
  // les `concurrency` premiers items qui n'ont pas encore de résultat —
  // c'est exactement ce que les workers sont en train de travailler.
  const inFlightIds = new Set<string>();
  if (isRunning) {
    for (const it of items) {
      if (resultIds.has(it.pfsId)) continue;
      inFlightIds.add(it.pfsId);
      if (inFlightIds.size >= concurrency) break;
    }
  }

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
            {isRunning && "L\u2019import tourne en arrière-plan. Vous pouvez naviguer ailleurs et revenir ici pour suivre l\u2019avancement."}
            {job.status === "COMPLETED" && "Import terminé. Les images finissent de se télécharger en arrière-plan."}
            {job.status === "FAILED" && "L\u2019import a rencontré des erreurs."}
            {job.status === "CANCELLED" && "L\u2019import a été annulé."}
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

      {/* Product list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {items.map((item) => {
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
