"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import type { PfsAttribute, PfsAttributeType, ImportablePfsProduct } from "@/lib/pfs-import";

type Step = "scan" | "products" | "import";

interface ImportTask {
  pfsId: string;
  reference: string;
  name: string;
  image: string | null;
  status: "pending" | "running" | "ready" | "error";
  productId?: string;
  error?: string;
  warnings?: string[];
}

export default function ImportPfsClient() {
  const toast = useToast();
  const [step, setStep] = useState<Step>("scan");

  // Step 1 — scan
  const [scanning, setScanning] = useState(false);
  const [attributes, setAttributes] = useState<PfsAttribute[]>([]);
  const [scanMeta, setScanMeta] = useState<{ scannedProducts: number; deepScannedProducts: number } | null>(null);

  // Step 2 — products
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<ImportablePfsProduct[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Step 3 — import
  const [tasks, setTasks] = useState<ImportTask[]>([]);

  // ── Step 1 actions
  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/admin/pfs-import/scan-attributes");
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur scan");
      const data = await res.json();
      setAttributes(data.attributes);
      setScanMeta({ scannedProducts: data.scannedProducts, deepScannedProducts: data.deepScannedProducts });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [toast]);

  const handleCreateMapping = useCallback(
    async (attr: PfsAttribute) => {
      try {
        const res = await fetch("/api/admin/pfs-import/create-mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: attr.type, pfsRef: attr.pfsRef, label: attr.label }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Erreur création");
        const data = await res.json();
        setAttributes((prev) =>
          prev.map((a) =>
            a.type === attr.type && a.pfsRef === attr.pfsRef
              ? { ...a, mapped: true, localId: data.id, localName: data.name }
              : a
          )
        );
        toast.success(`${data.name} créé`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [toast]
  );

  const missingCount = attributes.filter((a) => !a.mapped).length;
  const canGoToProducts = attributes.length > 0 && missingCount === 0;

  // ── Step 2 actions
  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/admin/pfs-import/importable-products");
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur produits");
      const data = await res.json();
      setProducts(data.products);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingProducts(false);
    }
  }, [toast]);

  useEffect(() => {
    if (step === "products" && products.length === 0 && !loadingProducts) {
      loadProducts();
    }
  }, [step, products.length, loadingProducts, loadProducts]);

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

  // ── Step 3 — import sequential
  const startImport = useCallback(() => {
    const initial: ImportTask[] = products
      .filter((p) => selected.has(p.pfsId))
      .map((p) => ({
        pfsId: p.pfsId,
        reference: p.reference,
        name: p.name,
        image: p.defaultImage,
        status: "pending",
      }));
    setTasks(initial);
    setStep("import");
  }, [products, selected]);

  // Traite les tâches une par une en fond
  useEffect(() => {
    if (step !== "import") return;
    const pending = tasks.find((t) => t.status === "pending");
    const running = tasks.find((t) => t.status === "running");
    if (running || !pending) return;

    let cancelled = false;
    (async () => {
      setTasks((prev) => prev.map((t) => (t.pfsId === pending.pfsId ? { ...t, status: "running" } : t)));
      try {
        const res = await fetch("/api/admin/pfs-import/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pfsId: pending.pfsId }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Erreur import");
        setTasks((prev) =>
          prev.map((t) =>
            t.pfsId === pending.pfsId
              ? { ...t, status: "ready", productId: data.productId, warnings: data.warnings }
              : t
          )
        );
      } catch (err) {
        if (cancelled) return;
        setTasks((prev) =>
          prev.map((t) =>
            t.pfsId === pending.pfsId ? { ...t, status: "error", error: (err as Error).message } : t
          )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, tasks]);

  // ─────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/admin/produits" className="text-[#666] hover:text-text-primary transition-colors text-sm">
          ← Retour aux produits
        </Link>
      </div>

      <div>
        <h1 className="page-title">Importer depuis Paris Fashion Shop</h1>
        <p className="page-subtitle font-body">Récupérez les produits PFS qui ne sont pas encore dans votre catalogue</p>
      </div>

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

      {step === "import" && (
        <ImportStep tasks={tasks} onBack={() => setStep("products")} />
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
  onRunScan,
  onCreateMapping,
  onNext,
}: {
  scanning: boolean;
  attributes: PfsAttribute[];
  scanMeta: { scannedProducts: number; deepScannedProducts: number } | null;
  missingCount: number;
  canGoToProducts: boolean;
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
        <div className="text-center py-10">
          <p className="text-text-muted mb-4">
            Lancez un scan du catalogue PFS pour vérifier que toutes les correspondances existent chez vous.
          </p>
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
                          <td className="px-4 py-2 w-1/3">
                            <code className="text-xs bg-bg-muted px-2 py-0.5 rounded">{a.pfsRef}</code>
                          </td>
                          <td className="px-4 py-2">{a.label}</td>
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
                  {p.family} · {p.colorCount} coul. · {p.variantCount} var.
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

function ImportStep({ tasks, onBack }: { tasks: ImportTask[]; onBack: () => void }) {
  const done = tasks.filter((t) => t.status === "ready").length;
  const errored = tasks.filter((t) => t.status === "error").length;
  const total = tasks.length;

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">
            {done}/{total} produit(s) importé(s){errored > 0 ? ` · ${errored} erreur(s)` : ""}
          </p>
          <p className="text-sm text-text-muted">
            Les produits prêts sont créés avec le statut « Importation en cours ». Les images finissent de se télécharger
            en arrière-plan. Vous pouvez déjà aller les voir sur la page Produits.
          </p>
        </div>
        {done === total && (
          <Link href="/admin/produits" className="btn-primary">
            Aller aux produits
          </Link>
        )}
      </div>

      <div className="space-y-2">
        {tasks.map((t) => (
          <div key={t.pfsId} className="flex items-center gap-3 border border-border rounded-xl p-3">
            <div className="w-12 h-12 bg-bg-muted rounded-lg overflow-hidden flex-shrink-0">
              {t.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.image} alt="" className="w-full h-full object-cover" loading="lazy" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-text-muted">{t.reference}</div>
              <div className="text-sm font-medium truncate">{t.name}</div>
              {t.warnings && t.warnings.length > 0 && (
                <div className="text-xs text-[#b45309] mt-1">{t.warnings.join(" · ")}</div>
              )}
              {t.error && <div className="text-xs text-[#b91c1c] mt-1">{t.error}</div>}
            </div>
            <div>
              {t.status === "pending" && <span className="badge badge-neutral">En attente</span>}
              {t.status === "running" && <span className="badge badge-info">Import…</span>}
              {t.status === "ready" && (
                <div className="flex items-center gap-2">
                  <span className="badge badge-success">Prêt</span>
                  {t.productId && (
                    <Link href={`/admin/produits/${t.productId}/modifier`} className="btn-ghost text-xs px-2 py-1">
                      Voir
                    </Link>
                  )}
                </div>
              )}
              {t.status === "error" && <span className="badge badge-error">Erreur</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-start pt-2">
        <button onClick={onBack} className="btn-secondary">← Retour à la sélection</button>
      </div>
    </div>
  );
}
