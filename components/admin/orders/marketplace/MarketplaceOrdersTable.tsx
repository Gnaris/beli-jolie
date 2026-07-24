"use client";

import { useMemo } from "react";
import type {
  MarketplaceOrderListItem,
  MarketplaceSource,
  MarketplaceStockFilter,
  MarketplaceUnifiedStatus,
} from "@/app/actions/admin/marketplace-orders";
import CustomSelect from "@/components/ui/CustomSelect";
import MarketplaceBadge, { MARKETPLACE_META } from "./MarketplaceBadge";

const STATUS_META: Record<
  MarketplaceUnifiedStatus,
  { label: string; className: string }
> = {
  NEW: { label: "Nouveau", className: "bg-amber-50 text-amber-700 border-amber-200" },
  VALIDATED: { label: "Validé", className: "bg-slate-100 text-slate-700 border-slate-200" },
  SHIPPED: { label: "Expédié", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Annulé", className: "bg-rose-50 text-rose-700 border-rose-200" },
};

const STOCK_META: Record<
  MarketplaceOrderListItem["stockDeductionState"],
  { label: string; className: string; tooltip: string }
> = {
  NOT_APPLICABLE: {
    label: "—",
    className: "bg-bg-secondary text-text-muted border-border",
    tooltip: "Non concerné (nouveau ou annulé).",
  },
  NOTHING_TO_DEDUCT: {
    label: "Rien à déduire",
    className: "bg-bg-secondary text-text-muted border-border",
    tooltip: "Aucun produit rattaché.",
  },
  PENDING: {
    label: "À déduire",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    tooltip: "Cliquez pour prévisualiser puis déduire le stock.",
  },
  DONE: {
    label: "Déduit",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    tooltip: "Stock déjà déduit.",
  },
};

interface Props {
  items: MarketplaceOrderListItem[] | null;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  q: string;
  onQChange: (v: string) => void;
  statusFilter: MarketplaceUnifiedStatus | "";
  onStatusChange: (s: MarketplaceUnifiedStatus | "") => void;
  sourceFilter: MarketplaceSource | "";
  onSourceChange: (s: MarketplaceSource | "") => void;
  stockFilter: MarketplaceStockFilter;
  onStockFilterChange: (v: MarketplaceStockFilter) => void;
  onPageChange: (n: number) => void;
  onOpen: (row: MarketplaceOrderListItem) => void;
  onDeductClick: (row: MarketplaceOrderListItem) => void;
  statusCounts: Record<MarketplaceUnifiedStatus, number> | null;
  countsBySource: {
    PFS: number;
    EFASHION: number;
    ANKORSTORE: number;
    FAIRE: number;
    MICROSTORE: number;
  };
  /** IDs sélectionnés (id de commande — attention aux collisions inter-source :
   *  ici on suit les IDs Prisma qui sont uniques cross-marketplace). */
  selectedIds: Set<string>;
  onToggleSelect: (row: MarketplaceOrderListItem, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onClearSelection: () => void;
  onBulkDeduct: () => void;
  onBulkMarkDeducted: () => void;
  bulkRunning: boolean;
}

export default function MarketplaceOrdersTable(props: Props) {
  const {
    items,
    total,
    page,
    perPage,
    totalPages,
    q,
    onQChange,
    statusFilter,
    onStatusChange,
    sourceFilter,
    onSourceChange,
    stockFilter,
    onStockFilterChange,
    onPageChange,
    onOpen,
    onDeductClick,
    statusCounts,
    countsBySource,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    onClearSelection,
    onBulkDeduct,
    onBulkMarkDeducted,
    bulkRunning,
  } = props;

  const statusOptions = useMemo(
    () => [
      { value: "", label: `Tous statuts (${total})` },
      { value: "NEW", label: `Nouveau (${statusCounts?.NEW ?? 0})` },
      { value: "VALIDATED", label: `Validé (${statusCounts?.VALIDATED ?? 0})` },
      { value: "SHIPPED", label: `Expédié (${statusCounts?.SHIPPED ?? 0})` },
      { value: "CANCELLED", label: `Annulé (${statusCounts?.CANCELLED ?? 0})` },
    ],
    [statusCounts, total],
  );

  const sourceOptions = useMemo(
    () => [
      {
        value: "",
        label: `Toutes marketplaces (${countsBySource.PFS + countsBySource.EFASHION + countsBySource.ANKORSTORE + countsBySource.FAIRE + countsBySource.MICROSTORE})`,
      },
      { value: "PFS", label: `Paris Fashion Shop (${countsBySource.PFS})` },
      { value: "EFASHION", label: `eFashion Paris (${countsBySource.EFASHION})` },
      { value: "ANKORSTORE", label: `Ankorstore (${countsBySource.ANKORSTORE})` },
      { value: "FAIRE", label: `Faire (${countsBySource.FAIRE})` },
      { value: "MICROSTORE", label: `Microstore (${countsBySource.MICROSTORE})` },
    ],
    [countsBySource],
  );

  const stockOptions = useMemo(
    () => [
      { value: "all", label: "Stock : Tout" },
      { value: "pending", label: "Stock : À déduire" },
      { value: "done", label: "Stock : Déduit" },
      { value: "nothing", label: "Stock : Rien à déduire" },
    ],
    [],
  );

  /** Lignes de la page courante éligibles à une action bulk (état PENDING). */
  const selectableItems = useMemo(
    () => (items ?? []).filter((r) => r.stockDeductionState === "PENDING"),
    [items],
  );
  const allPageSelected =
    selectableItems.length > 0 && selectableItems.every((r) => selectedIds.has(r.id));
  const somePageSelected =
    selectableItems.length > 0 && selectableItems.some((r) => selectedIds.has(r.id));

  /** Détermine si au moins une commande sélectionnée est en attente de déduction. */
  const anySelectedPending = useMemo(() => {
    if (!items) return false;
    return items.some((r) => selectedIds.has(r.id) && r.stockDeductionState === "PENDING");
  }, [items, selectedIds]);

  const selectedCount = selectedIds.size;

  return (
    <section className="rounded-2xl bg-bg-primary border border-border shadow-sm overflow-hidden">
      {/* Barre de filtres — titre sur sa propre ligne, filtres alignés à
       *  l'horizontale en dessous, avec retour à la ligne si vraiment étroit. */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">
          Commandes marketplaces
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="search"
            value={q}
            onChange={(e) => onQChange(e.target.value)}
            placeholder="N° commande, société, pays…"
            className="text-sm rounded-lg border border-border px-3 py-1.5 flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <CustomSelect
            value={sourceFilter}
            onChange={(v) => onSourceChange(v as MarketplaceSource | "")}
            options={sourceOptions}
            size="sm"
            aria-label="Filtrer par marketplace"
            className="min-w-[190px]"
          />
          <CustomSelect
            value={statusFilter}
            onChange={(v) => onStatusChange(v as MarketplaceUnifiedStatus | "")}
            options={statusOptions}
            size="sm"
            aria-label="Filtrer par statut"
            className="min-w-[170px]"
          />
          <CustomSelect
            value={stockFilter}
            onChange={(v) => onStockFilterChange(v as MarketplaceStockFilter)}
            options={stockOptions}
            size="sm"
            aria-label="Filtrer par état de déduction"
            className="min-w-[170px]"
          />
        </div>
      </div>

      {/* Barre d'actions bulk — visible dès qu'au moins 1 commande est cochée */}
      {selectedCount > 0 && (
        <div className="px-4 py-3 border-b border-border bg-slate-50 flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium text-text-primary">
            {selectedCount} sélectionnée{selectedCount > 1 ? "s" : ""}
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onClearSelection}
              disabled={bulkRunning}
              className="text-xs rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-bg-secondary disabled:opacity-50"
            >
              Désélectionner
            </button>
            <button
              type="button"
              onClick={onBulkDeduct}
              disabled={!anySelectedPending || bulkRunning}
              title={
                anySelectedPending
                  ? "Décrémente le stock des articles rattachés à votre boutique."
                  : "Aucune commande « À déduire » dans la sélection."
              }
              className="text-xs font-medium rounded-lg bg-emerald-600 text-white px-3 py-1.5 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {bulkRunning && (
                <span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
              )}
              Déduire le stock
            </button>
            <button
              type="button"
              onClick={onBulkMarkDeducted}
              disabled={!anySelectedPending || bulkRunning}
              title={
                anySelectedPending
                  ? "Marque les commandes comme déjà déduites sans toucher au stock. Irréversible."
                  : "Aucune commande « À déduire » dans la sélection."
              }
              className="text-xs font-medium rounded-lg bg-slate-900 text-white px-3 py-1.5 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Marquer comme déjà déduites
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary text-xs uppercase tracking-wider text-text-muted">
            <tr>
              <th className="text-center px-3 py-3 font-medium w-10">
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allPageSelected && somePageSelected;
                  }}
                  disabled={selectableItems.length === 0 || bulkRunning}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  className="w-4 h-4 accent-slate-900 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </th>
              <th className="text-center px-3 py-3 font-medium w-12">#</th>
              <th className="text-left px-3 py-3 font-medium w-10"></th>
              <th className="text-left px-5 py-3 font-medium">N° commande</th>
              <th className="text-left px-5 py-3 font-medium">Date</th>
              <th className="text-left px-5 py-3 font-medium">Client</th>
              <th className="text-right px-5 py-3 font-medium">Montant HT</th>
              <th className="text-center px-5 py-3 font-medium">Stock</th>
              <th className="text-center px-5 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items?.map((row, i) => {
              const st = STATUS_META[row.status] ?? STATUS_META.NEW;
              const stock = STOCK_META[row.stockDeductionState];
              const isClickableStock = row.stockDeductionState === "PENDING";
              const rank = (page - 1) * perPage + i + 1;
              const checked = selectedIds.has(row.id);
              const selectable = row.stockDeductionState === "PENDING";
              return (
                <tr
                  key={`${row.source}-${row.id}`}
                  onClick={() => onOpen(row)}
                  className={`hover:bg-bg-secondary cursor-pointer ${checked ? "bg-slate-50" : ""}`}
                >
                  <td
                    className="px-3 py-3 text-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${row.orderNumber}`}
                      checked={checked}
                      disabled={!selectable || bulkRunning}
                      onChange={(e) => onToggleSelect(row, e.target.checked)}
                      title={
                        selectable
                          ? undefined
                          : "Sélection réservée aux commandes « À déduire »."
                      }
                      className="w-4 h-4 accent-slate-900 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-3 py-3 text-center font-heading font-bold text-sm text-text-muted tabular-nums">
                    #{rank}
                  </td>
                  <td className="px-3 py-3">
                    <MarketplaceBadge source={row.source} size="sm" />
                  </td>
                  <td className="px-5 py-3 font-mono text-text-primary font-semibold">
                    {row.orderNumber}
                  </td>
                  <td className="px-5 py-3 text-text-secondary">
                    {new Date(row.createdAt).toLocaleString("fr-FR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-text-primary truncate max-w-[220px]">
                      {row.customerShop || row.customerName}
                    </div>
                    <div className="text-xs text-text-muted truncate max-w-[220px]">
                      {row.customerShop ? row.customerName : ""}
                      {row.customerCountry ? ` · ${row.customerCountry}` : ""}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-text-primary">
                    {row.totalHT.toFixed(2).replace(".", ",")} €
                  </td>
                  <td className="px-5 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {isClickableStock ? (
                      <button
                        type="button"
                        onClick={() => onDeductClick(row)}
                        title="Prévisualiser puis déduire le stock."
                        className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border cursor-pointer hover:brightness-95 hover:shadow-sm transition-all ${stock.className}`}
                      >
                        {stock.label}
                      </button>
                    ) : (
                      <span
                        className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${stock.className}`}
                        title={stock.tooltip}
                      >
                        {stock.label}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span
                      className={`inline-block rounded-full text-xs px-3 py-0.5 font-medium border ${st.className}`}
                      title={row.statusRawLabel}
                    >
                      {st.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {items && items.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-text-muted text-sm">
                  Aucune commande sur la période sélectionnée.
                </td>
              </tr>
            )}
            {items === null && (
              <tr>
                <td colSpan={9} className="text-center py-10 text-text-muted text-sm">
                  Chargement…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-border flex justify-between items-center text-xs text-text-muted">
        <div>
          {items?.length ?? 0} commandes affichées sur {total.toLocaleString("fr-FR")} ·{" "}
          <span className="inline-flex items-center gap-1">
            <MarketplaceBadge source="PFS" size="xs" /> {countsBySource.PFS}
          </span>
          {"  "}
          <span className="inline-flex items-center gap-1 ml-2">
            <MarketplaceBadge source="EFASHION" size="xs" /> {countsBySource.EFASHION}
          </span>
          {"  "}
          <span className="inline-flex items-center gap-1 ml-2">
            <MarketplaceBadge source="ANKORSTORE" size="xs" /> {countsBySource.ANKORSTORE}
          </span>
          {"  "}
          <span className="inline-flex items-center gap-1 ml-2">
            <MarketplaceBadge source="FAIRE" size="xs" /> {countsBySource.FAIRE}
          </span>
          {"  "}
          <span className="inline-flex items-center gap-1 ml-2">
            <MarketplaceBadge source="MICROSTORE" size="xs" /> {countsBySource.MICROSTORE}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded border border-border px-2 py-1 hover:bg-bg-secondary disabled:opacity-40"
          >
            ‹ Précédent
          </button>
          <span className="px-2 py-1">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded border border-border px-2 py-1 hover:bg-bg-secondary disabled:opacity-40"
          >
            Suivant ›
          </button>
        </div>
      </div>
    </section>
  );
}

const _keepImport = MARKETPLACE_META;
void _keepImport;
