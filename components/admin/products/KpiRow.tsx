"use client";
import { useProductFormHeader } from "./ProductFormHeaderContext";

function formatPrice(n: number | null): string {
  if (n === null || !isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function KpiRow() {
  const { kpi, productStatus } = useProductFormHeader();

  const priceLabel = (() => {
    if (kpi.minPrice === null || kpi.maxPrice === null) return "—";
    if (kpi.minPrice === kpi.maxPrice) return formatPrice(kpi.minPrice);
    return formatPrice(kpi.minPrice) + " – " + formatPrice(kpi.maxPrice);
  })();

  const statusLabel = productStatus === "ONLINE"
    ? "En ligne"
    : productStatus === "ARCHIVED"
      ? "Archivé"
      : productStatus === "SYNCING"
        ? "En sync"
        : "Hors ligne";

  const completenessPct = Math.min(100, Math.max(0, Math.round(kpi.completeness)));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
      <div className="bg-bg-primary border border-border rounded-lg p-3">
        <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-text-muted font-body">
          Prix
        </div>
        <div className="font-heading font-extrabold text-[17px] text-text-primary mt-1 leading-tight">
          {priceLabel}
        </div>
        <div className="text-[10.5px] text-text-muted font-body mt-0.5">
          {kpi.avgPrice !== null ? "moyenne " + formatPrice(kpi.avgPrice) : "aucune variante"}
        </div>
      </div>

      <div className="bg-bg-primary border border-border rounded-lg p-3">
        <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-text-muted font-body">
          Stock total
        </div>
        <div className="font-heading font-extrabold text-[17px] text-text-primary mt-1 leading-tight">
          {kpi.totalStock}
        </div>
        <div className="text-[10.5px] text-text-muted font-body mt-0.5">
          toutes tailles confondues
        </div>
      </div>

      <div className="bg-bg-primary border border-border rounded-lg p-3">
        <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-text-muted font-body">
          Marketplaces
        </div>
        <div className="font-heading font-extrabold text-[17px] text-text-primary mt-1 leading-tight">
          {kpi.linkedMarketplaces} / {kpi.totalMarketplaces || "—"}
        </div>
        <div className="text-[10.5px] text-text-muted font-body mt-0.5">
          {kpi.linkedMarketplaces > 0 ? "publications actives" : "aucune publication"}
        </div>
      </div>

      <div className="bg-bg-primary border border-border rounded-lg p-3">
        <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-text-muted font-body">
          Statut
        </div>
        <div className="font-heading font-extrabold text-[17px] text-text-primary mt-1 leading-tight">
          {statusLabel}
        </div>
        <div className="mt-1 h-1 rounded-full bg-bg-tertiary overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#22C55E] to-[#15803D] transition-all"
            style={{ width: completenessPct + "%" }}
          />
        </div>
        <div className="text-[10.5px] text-text-muted font-body mt-0.5">
          {completenessPct}% complété
        </div>
      </div>
    </div>
  );
}
