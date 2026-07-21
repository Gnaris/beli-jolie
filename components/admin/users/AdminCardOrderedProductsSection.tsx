"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import CustomSelect from "@/components/ui/CustomSelect";
import { Tooltip } from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  listOrderedProductsForClientCard,
  addPurchaseToClientCard,
  updatePurchase,
  deletePurchase,
  lookupProductByReference,
  searchProductsForClientCard,
  type ClientCardOrderedProduct,
  type ClientCardProductPurchaseSource,
  type ColorBreakdown,
  type ProductLookupResult,
  type ProductSearchResult,
} from "@/app/actions/admin/admin-client-card-products";

// ─────────────────────────────────────────────
// Constantes de style — provenances marketplaces
// (gradients figés cf. CLAUDE.md — ne pas modifier)
// ─────────────────────────────────────────────

interface SourceMeta {
  key: ClientCardProductPurchaseSource;
  label: string;
  short: string;
  initial: string;
  gradient: string;
}

const SOURCES: readonly SourceMeta[] = [
  { key: "PFS", label: "PFS", short: "PFS", initial: "P", gradient: "linear-gradient(135deg,#4f46e5,#6366f1)" },
  { key: "ANKORSTORE", label: "Ankorstore", short: "Ankor", initial: "A", gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)" },
  { key: "EFASHION", label: "eFashion", short: "eFash", initial: "E", gradient: "linear-gradient(135deg,#db2777,#ec4899)" },
  { key: "FAIRE", label: "Faire", short: "Faire", initial: "F", gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)" },
  { key: "MICROSTORE", label: "Microstore", short: "Micro", initial: "M", gradient: "linear-gradient(135deg,#64748b,#334155)" },
  { key: "PASSAGE", label: "Passage", short: "Passage", initial: "Pa", gradient: "linear-gradient(135deg,#0d9488,#14b8a6)" },
] as const;

function sourceMeta(source: ClientCardProductPurchaseSource): SourceMeta {
  return SOURCES.find((s) => s.key === source) ?? SOURCES[0];
}

// ─────────────────────────────────────────────
// Props & état
// ─────────────────────────────────────────────

interface Props {
  cardId: string;
}

type SortBy = "quantity_desc" | "quantity_asc" | "recent";

export default function AdminCardOrderedProductsSection({ cardId }: Props) {
  const [rows, setRows] = useState<ClientCardOrderedProduct[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortBy>("recent");
  const [isAddOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ClientCardOrderedProduct | null>(null);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  const reload = useCallback(async () => {
    try {
      const res = await listOrderedProductsForClientCard({
        adminClientCardId: cardId,
        page,
        perPage: 10,
        sortBy,
      });
      setRows(res.rows);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
      if (res.page > res.totalPages && res.totalPages > 0) {
        setPage(res.totalPages);
      }
    } catch {
      setRows([]);
      setTotalCount(0);
      setTotalPages(1);
    }
  }, [cardId, page, sortBy]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDeleteRow = async (row: ClientCardOrderedProduct) => {
    // Supprime toutes les entrées manuelles de ce produit (les items PFS restent)
    const purchases = row.colors.flatMap((c) => c.purchases);
    const manualCount = purchases.length;
    if (manualCount === 0) {
      toast.info(
        "Rien à retirer",
        "Ce produit n'a que des lignes issues des commandes PFS. Elles restent tant qu'une commande PFS les référence.",
      );
      return;
    }
    const ok = await confirm({
      type: "danger",
      title: "Retirer ce produit ?",
      message: `Retirer les ${manualCount} entrée${manualCount > 1 ? "s" : ""} saisies à la main pour « ${row.name} » ? Les commandes PFS restent visibles.`,
      confirmLabel: "Retirer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await Promise.all(
          purchases
            .filter((p) => p.purchaseId)
            .map((p) => deletePurchase(p.purchaseId!)),
        );
        toast.success("Produit retiré");
        await reload();
      } catch (err) {
        toast.error(
          "Erreur",
          err instanceof Error ? err.message : "Impossible de retirer.",
        );
      }
    });
  };

  const sortOptions = [
    { value: "recent", label: "Récents d'abord" },
    { value: "quantity_desc", label: "Plus commandés" },
    { value: "quantity_asc", label: "Moins commandés" },
  ];

  return (
    <section className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-50 via-bg-primary to-bg-primary px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded-full bg-emerald-500" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-muted">
            Produits commandés
          </h3>
          {totalCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full bg-bg-secondary text-text-muted text-[11px] font-semibold">
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[180px]">
            <CustomSelect
              value={sortBy}
              onChange={(v) => {
                setPage(1);
                setSortBy(v as SortBy);
              }}
              options={sortOptions}
              size="sm"
              aria-label="Trier"
            />
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-bg-dark text-text-inverse px-2.5 py-1.5 text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Ajouter un produit
          </button>
        </div>
      </div>

      {rows === null && <p className="text-xs text-text-muted p-5">Chargement…</p>}

      {rows && rows.length === 0 && (
        <div className="p-8 text-center">
          <p className="text-xs text-text-muted">
            Aucun produit encore associé. Les commandes PFS importées apparaîtront ici, ou ajoutez-en un à la main.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-secondary">
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Produit</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Catégorie</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Couleurs achetées</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Provenances</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.12em]">Total</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-body font-bold text-text-muted uppercase tracking-[0.12em]"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className={`border-b border-border last:border-0 transition-colors ${row.unmappedProduct ? "" : "hover:bg-bg-secondary/50 cursor-pointer"}`}
                    onClick={() => {
                      if (!row.unmappedProduct) setEditing(row);
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-lg bg-bg-tertiary overflow-hidden shrink-0 border border-border">
                          {row.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-text-muted">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-body font-semibold text-text-primary truncate max-w-[220px]">
                            {row.name}
                          </p>
                          <p className="text-[11px] text-text-muted font-mono truncate">
                            {row.reference}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {row.category ? (
                        <span className="text-[12px] text-text-secondary">{row.category}</span>
                      ) : (
                        <span className="text-[11.5px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.unmappedProduct ? (
                        <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800">
                          Hors catalogue
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 gap-y-3 max-w-[260px] items-center py-1 pr-2">
                          {row.colors.map((c) => (
                            <ColorChip key={c.colorId} color={c} />
                          ))}
                          {row.pfsUnmappedColorQuantity > 0 && (
                            <span
                              className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                              title="Quantité PFS agrégée sur ce produit sans couleur reconnue"
                            >
                              +{row.pfsUnmappedColorQuantity} sans couleur
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.sources.map((s) => (
                          <SourceDot key={s} source={s} />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <span className="text-[13px] font-body font-bold text-text-primary">
                        {row.totalQuantity}
                      </span>
                      <span className="text-[11px] text-text-muted ml-1">pcs</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {!row.unmappedProduct && (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditing(row)}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-bg-primary text-text-muted hover:bg-bg-secondary hover:text-text-primary transition-colors"
                              title="Modifier"
                              aria-label="Modifier"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row)}
                              disabled={isPending}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-bg-primary text-text-muted hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors disabled:opacity-50"
                              title="Retirer les entrées manuelles"
                              aria-label="Retirer"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border bg-bg-secondary/40">
              <span className="text-[11.5px] text-text-muted">
                Page {page} sur {totalPages} — {totalCount} produit{totalCount > 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Précédent
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1 text-[12px] text-text-secondary hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {isAddOpen && (
        <AddPurchaseModal
          cardId={cardId}
          onClose={() => setAddOpen(false)}
          onAdded={async () => {
            setAddOpen(false);
            await reload();
          }}
        />
      )}

      {editing && (
        <EditPurchaseModal
          cardId={cardId}
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────
// Pastille couleur + qté
// ─────────────────────────────────────────────

function ColorChip({ color }: { color: ColorBreakdown }) {
  const zero = color.totalQuantity === 0;
  // Construit une map source → qté (toutes les 6 provenances, 0 si absent)
  const qtyBySource = new Map<ClientCardProductPurchaseSource, number>();
  for (const sq of color.sourceQuantities) qtyBySource.set(sq.source, sq.quantity);

  const tooltipContent = (
    <div className="text-left">
      <div className="flex items-center gap-1.5 pb-1 mb-1 border-b border-white/15">
        <span
          className="inline-block rounded-full border border-white/30 shrink-0"
          style={{
            width: 10,
            height: 10,
            background: color.colorPatternImage
              ? `center/cover url(${color.colorPatternImage})`
              : color.colorHex ?? "#e5e7eb",
          }}
        />
        <span className="text-[11px] font-bold">{color.colorName}</span>
        <span className="ml-auto text-[10px] text-white/70">total ×{color.totalQuantity}</span>
      </div>
      <ul className="space-y-0.5">
        {SOURCES.map((s) => {
          const q = qtyBySource.get(s.key) ?? 0;
          return (
            <li key={s.key} className="flex items-center gap-2 text-[10.5px]">
              <span
                className="inline-flex items-center justify-center rounded-[5px] text-white font-bold shrink-0 leading-none"
                style={{
                  background: s.gradient,
                  width: 20,
                  height: 20,
                  fontSize: 10,
                }}
              >
                {s.initial}
              </span>
              <span className="font-medium flex-1">{s.label}</span>
              <span className={`tabular-nums font-semibold ${q === 0 ? "text-white/40" : ""}`}>
                ×{q}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} placement="top" delayMs={150}>
      <div
        className={`relative inline-block rounded-full border border-border shrink-0 ${zero ? "opacity-40" : ""}`}
        style={{
          width: 28,
          height: 28,
          background: color.colorPatternImage
            ? `center/cover no-repeat url(${color.colorPatternImage})`
            : color.colorHex ?? "#e5e7eb",
        }}
      >
        <span
          className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-bg-primary border border-border text-[9px] font-bold text-text-primary shadow-sm tabular-nums"
        >
          {color.totalQuantity}
        </span>
      </div>
    </Tooltip>
  );
}

function ColorPatternDot({
  color,
  size = 14,
}: {
  color: {
    colorHex: string | null;
    colorPatternImage: string | null;
  };
  size?: number;
}) {
  if (color.colorPatternImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={color.colorPatternImage}
        alt=""
        className="rounded-full border border-border object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full border border-border shrink-0"
      style={{
        width: size,
        height: size,
        background: color.colorHex ?? "#e5e7eb",
      }}
    />
  );
}

function SourceDot({ source }: { source: ClientCardProductPurchaseSource }) {
  const meta = sourceMeta(source);
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[9px] font-bold shadow-sm"
      style={{ background: meta.gradient }}
      title={meta.label}
    >
      {meta.initial}
    </span>
  );
}

// ─────────────────────────────────────────────
// Modale d'ajout
// ─────────────────────────────────────────────

interface AddModalProps {
  cardId: string;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}

function AddPurchaseModal({ cardId, onClose, onAdded }: AddModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProductLookupResult | null>(null);
  const [selectedColorId, setSelectedColorId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] =
    useState<ClientCardProductPurchaseSource>("MICROSTORE");
  const [quantity, setQuantity] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (selected) return;
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const items = await searchProductsForClientCard(query);
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected]);

  const handleSelect = async (ref: string) => {
    try {
      const p = await lookupProductByReference(ref);
      if (!p) {
        toast.error("Produit introuvable", `Référence « ${ref} » inconnue.`);
        return;
      }
      setSelected(p);
      setSelectedColorId(p.colors[0]?.id ?? null);
      setQuery(p.reference);
    } catch (err) {
      toast.error(
        "Erreur",
        err instanceof Error ? err.message : "Impossible de charger le produit.",
      );
    }
  };

  const handleChange = () => {
    setSelected(null);
    setSelectedColorId(null);
    setQuery("");
    setResults([]);
  };

  const handleSubmit = async () => {
    if (!selected) return;
    if (!selectedColorId) {
      toast.error("Sélection requise", "Choisissez une couleur.");
      return;
    }
    if (!quantity || quantity <= 0) {
      toast.error("Quantité invalide", "Renseignez au moins 1 pièce.");
      return;
    }
    setSubmitting(true);
    try {
      await addPurchaseToClientCard({
        adminClientCardId: cardId,
        reference: selected.reference,
        colorId: selectedColorId,
        source: selectedSource,
        quantity,
      });
      toast.success("Produit ajouté à la fiche");
      await onAdded();
    } catch (err) {
      toast.error(
        "Ajout impossible",
        err instanceof Error ? err.message : "Erreur inconnue.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const modal = (
    <div
      className="fixed inset-0 z-[9700] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-heading text-base font-bold text-text-primary">
            Ajouter un produit acheté
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Choisissez le produit, la couleur, la provenance et la quantité.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selected && (
            <div className="p-4">
              <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1.5">
                Référence du produit
              </label>
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ex : A1623E"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-sm text-text-primary outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-200"
              />

              <div className="mt-3">
                {query.trim().length < 2 && (
                  <p className="text-xs text-text-muted text-center py-6">
                    Tapez au moins 2 caractères pour lancer la recherche.
                  </p>
                )}
                {query.trim().length >= 2 && searching && (
                  <p className="text-xs text-text-muted text-center py-6">
                    Recherche…
                  </p>
                )}
                {query.trim().length >= 2 && !searching && results.length === 0 && (
                  <p className="text-xs text-text-muted text-center py-6">
                    Aucun produit trouvé.
                  </p>
                )}
                {results.length > 0 && (
                  <ul className="space-y-1.5">
                    {results.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(p.reference)}
                          className="w-full flex items-center gap-3 rounded-lg border border-border bg-bg-primary p-2 hover:bg-bg-secondary transition-colors text-left"
                        >
                          <div className="w-11 h-11 rounded-md bg-bg-tertiary overflow-hidden shrink-0">
                            {p.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.image} alt="" className="w-full h-full object-cover" loading="lazy" />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-text-primary truncate">
                              {p.name}
                            </p>
                            <p className="text-[11px] text-text-muted font-mono">
                              {p.reference} · {p.category}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {selected && (
            <div className="p-4 space-y-4">
              {/* Bandeau produit sélectionné */}
              <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary/40 p-2.5">
                <div className="w-12 h-12 rounded-md bg-bg-tertiary overflow-hidden shrink-0 border border-border">
                  {selected.colors[0]?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selected.colors[0].image} alt="" className="w-full h-full object-cover" />
                  ) : null}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary truncate">
                    {selected.name}
                  </p>
                  <p className="text-[11px] text-text-muted font-mono">
                    {selected.reference} · {selected.category}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleChange}
                  className="text-[11.5px] font-medium text-text-secondary hover:text-text-primary underline underline-offset-2"
                >
                  Changer
                </button>
              </div>

              {/* Couleurs */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">
                  Couleur
                </label>
                {selected.colors.length === 0 ? (
                  <p className="text-xs text-text-muted">Ce produit n'a aucune couleur active.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selected.colors.map((c) => {
                      const active = c.id === selectedColorId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedColorId(c.id)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 transition-all ${
                            active
                              ? "border-text-primary ring-2 ring-text-primary/25 bg-bg-primary"
                              : "border-border bg-bg-primary hover:bg-bg-secondary"
                          }`}
                          title={c.name}
                        >
                          <ColorPatternDot
                            color={{
                              colorHex: c.hex,
                              colorPatternImage: c.patternImage,
                            }}
                            size={16}
                          />
                          <span className="text-[11.5px] font-body font-medium text-text-primary">
                            {c.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Provenance */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-2">
                  Provenance
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {SOURCES.map((s) => {
                    const active = s.key === selectedSource;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setSelectedSource(s.key)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px] font-body font-medium transition-all ${
                          active
                            ? "border-text-primary ring-2 ring-text-primary/25 bg-bg-primary text-text-primary"
                            : "border-border bg-bg-primary text-text-secondary hover:bg-bg-secondary"
                        }`}
                      >
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[8px] font-bold"
                          style={{ background: s.gradient }}
                        >
                          {s.initial}
                        </span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quantité */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-1.5">
                  Quantité (en pièces)
                </label>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 0)))
                  }
                  className="w-32 h-10 px-3 rounded-lg border border-border bg-bg-primary text-sm text-text-primary outline-none focus:border-border-strong focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-medium text-text-secondary hover:text-text-primary px-3 py-1.5"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selected || !selectedColorId || submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-bg-dark text-text-inverse px-3 py-1.5 text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Ajout…" : "Ajouter à la fiche"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

// ─────────────────────────────────────────────
// Modale d'édition
// ─────────────────────────────────────────────

interface EditModalProps {
  cardId: string;
  product: ClientCardOrderedProduct;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface DraftPurchase {
  key: string; // stable local key
  purchaseId: string | null; // null = nouvelle ligne
  originalSource: ClientCardProductPurchaseSource | null; // null si nouvelle
  originalQuantity: number | null; // null si nouvelle
  source: ClientCardProductPurchaseSource;
  quantity: number;
  deleted: boolean;
}

function buildInitialDrafts(
  product: ClientCardOrderedProduct,
): Map<string, DraftPurchase[]> {
  const map = new Map<string, DraftPurchase[]>();
  for (const c of product.colors) {
    const drafts: DraftPurchase[] = c.purchases
      .filter((p) => p.purchaseId)
      .map((p) => ({
        key: p.purchaseId!,
        purchaseId: p.purchaseId,
        originalSource: p.source,
        originalQuantity: p.quantity,
        source: p.source,
        quantity: p.quantity,
        deleted: false,
      }));
    map.set(c.colorId, drafts);
  }
  return map;
}

function EditPurchaseModal({ cardId, product, onClose, onSaved }: EditModalProps) {
  const [drafts, setDrafts] = useState<Map<string, DraftPurchase[]>>(() =>
    buildInitialDrafts(product),
  );
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const sourceOptions = useMemo(
    () => SOURCES.map((s) => ({ value: s.key, label: s.label })),
    [],
  );

  const updateDraft = (
    colorId: string,
    key: string,
    patch: Partial<DraftPurchase>,
  ) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      const list = (next.get(colorId) ?? []).map((d) =>
        d.key === key ? { ...d, ...patch } : d,
      );
      next.set(colorId, list);
      return next;
    });
  };

  const removeDraft = (colorId: string, key: string) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      const list = (next.get(colorId) ?? [])
        .map((d) => (d.key === key ? { ...d, deleted: true } : d))
        // Si c'était une nouvelle ligne (pas de purchaseId), on la supprime tout court.
        .filter((d) => d.purchaseId !== null || !d.deleted);
      next.set(colorId, list);
      return next;
    });
  };

  const addDraft = (colorId: string) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      const list = next.get(colorId) ?? [];
      const newDraft: DraftPurchase = {
        key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        purchaseId: null,
        originalSource: null,
        originalQuantity: null,
        source: "MICROSTORE",
        quantity: 1,
        deleted: false,
      };
      next.set(colorId, [...list, newDraft]);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const errors: string[] = [];

    for (const color of product.colors) {
      const list = drafts.get(color.colorId) ?? [];
      for (const d of list) {
        try {
          if (d.deleted && d.purchaseId) {
            await deletePurchase(d.purchaseId);
            continue;
          }
          if (d.deleted) continue;
          if (!d.purchaseId) {
            // Nouvelle ligne
            await addPurchaseToClientCard({
              adminClientCardId: cardId,
              reference: product.reference,
              colorId: color.colorId,
              source: d.source,
              quantity: d.quantity,
            });
            continue;
          }
          // Modif : ne fait rien si rien n'a changé
          if (
            d.originalSource === d.source &&
            d.originalQuantity === d.quantity
          ) {
            continue;
          }
          await updatePurchase({
            purchaseId: d.purchaseId,
            source: d.source,
            quantity: d.quantity,
          });
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : "Erreur inconnue.",
          );
        }
      }
    }

    setSaving(false);

    if (errors.length > 0) {
      toast.error(
        "Certaines modifications ont échoué",
        errors.slice(0, 3).join(" · "),
      );
      // Recharge quand même pour refléter ce qui est passé
      await onSaved();
      return;
    }

    toast.success("Fiche mise à jour");
    await onSaved();
  };

  const modal = (
    <div
      className="fixed inset-0 z-[9700] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-md bg-bg-tertiary overflow-hidden shrink-0 border border-border">
              {product.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-heading text-base font-bold text-text-primary truncate">
                {product.name}
              </h3>
              <p className="text-[11px] text-text-muted font-mono">
                {product.reference}
                {product.category ? ` · ${product.category}` : ""}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {product.colors.length === 0 && (
            <p className="text-xs text-text-muted text-center py-6">
              Aucune couleur active sur ce produit.
            </p>
          )}
          {product.colors.map((color) => {
            const list = drafts.get(color.colorId) ?? [];
            const visible = list.filter((d) => !d.deleted);
            return (
              <div
                key={color.colorId}
                className="rounded-xl border border-border bg-bg-primary p-3"
              >
                <div className="flex items-center gap-2 min-w-0 mb-2">
                  <ColorPatternDot
                    color={{
                      colorHex: color.colorHex,
                      colorPatternImage: color.colorPatternImage,
                    }}
                    size={20}
                  />
                  <span className="text-[13px] font-body font-semibold text-text-primary truncate">
                    {color.colorName}
                  </span>
                  <span className="ml-auto text-[11px] text-text-muted whitespace-nowrap">
                    Total : <span className="font-semibold text-text-primary">{color.totalQuantity} pcs</span>
                  </span>
                </div>

                {/* Ligne PFS auto (lecture seule) — toujours affichée si qté PFS > 0 */}
                {color.pfsQuantity > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-2 mb-1.5">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-white text-[10px] font-bold shrink-0"
                      style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
                    >
                      P
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-body font-semibold text-indigo-900">
                        PFS (calculé auto)
                      </p>
                      <p className="text-[10.5px] text-indigo-700/80">
                        Depuis les commandes PFS importées — non modifiable ici
                      </p>
                    </div>
                    <span className="text-[13px] font-body font-bold text-indigo-900 tabular-nums">
                      {color.pfsQuantity}
                    </span>
                    <span className="text-[11px] text-indigo-700/80">pcs</span>
                  </div>
                )}

                {visible.length === 0 && color.pfsQuantity === 0 && (
                  <p className="text-[11.5px] text-text-muted italic px-1 py-2">
                    Aucune saisie manuelle sur cette couleur.
                  </p>
                )}

                {visible.length > 0 && (
                  <div className="space-y-1.5">
                    {visible.map((d) => (
                      <div
                        key={d.key}
                        className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary/30 p-2"
                      >
                        <div className="w-[140px] shrink-0">
                          <CustomSelect
                            value={d.source}
                            onChange={(v) =>
                              updateDraft(color.colorId, d.key, {
                                source: v as ClientCardProductPurchaseSource,
                              })
                            }
                            options={sourceOptions}
                            size="sm"
                            aria-label="Provenance"
                          />
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={d.quantity}
                          onChange={(e) =>
                            updateDraft(color.colorId, d.key, {
                              quantity: Math.max(
                                1,
                                Math.floor(Number(e.target.value) || 0),
                              ),
                            })
                          }
                          className="w-20 h-8 px-2 rounded-lg border border-border bg-bg-primary text-[13px] text-text-primary outline-none focus:border-border-strong"
                        />
                        <span className="text-[11px] text-text-muted">pcs</span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => removeDraft(color.colorId, d.key)}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border bg-bg-primary text-text-muted hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200"
                          title="Retirer cette ligne"
                          aria-label="Retirer"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => addDraft(color.colorId)}
                  className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-text-secondary hover:text-text-primary underline underline-offset-2"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Ajouter une provenance
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-medium text-text-secondary hover:text-text-primary px-3 py-1.5"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-bg-dark text-text-inverse px-3 py-1.5 text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
