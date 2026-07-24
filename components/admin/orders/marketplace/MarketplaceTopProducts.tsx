"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type {
  MarketplaceStatsBundle,
  MarketplaceSource,
  MarketplaceTopProductColor,
} from "@/app/actions/admin/marketplace-orders";
import TopPager from "@/components/admin/orders/pfs/TopPager";
import MarketplaceBadge, { MARKETPLACE_META } from "./MarketplaceBadge";
import MarketplaceSourceFilter from "./MarketplaceSourceFilter";

interface Props {
  stats: MarketplaceStatsBundle | null;
}

const SORT_OVERLAY_MS = 250;
const PER_PAGE = 5;

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}

/**
 * Pastille couleur avec badge quantité totale et légende flottante au survol
 * qui détaille la répartition par marketplace (« 12 sur PFS, 5 sur eFashion »).
 */
function ColorPill({ color }: { color: MarketplaceTopProductColor }) {
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const showTip = () => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setCoords({ x: r.left + r.width / 2, y: r.top });
    }
    setHovered(true);
  };
  const hideTip = () => setHovered(false);

  const bg: CSSProperties = color.patternImage
    ? {
        backgroundImage: `url(${color.patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: color.hex ?? "#9CA3AF" };

  const name = color.colorLabel ?? "—";

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
        aria-label={`${name} — ${color.quantitySold} pièce${color.quantitySold > 1 ? "s" : ""}`}
        className="relative inline-block w-[26px] h-[26px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.14)] cursor-default outline-none focus:ring-2 focus:ring-emerald-400/60"
        style={bg}
      >
        <span className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center border border-white shadow-sm">
          {color.quantitySold}
        </span>
      </span>
      {hovered && coords && createPortal(
        <div
          role="tooltip"
          className="fixed z-[9999] pointer-events-none rounded-md bg-slate-900 text-white text-[11px] font-medium shadow-lg -translate-x-1/2 -translate-y-full px-2.5 py-1.5"
          style={{ left: coords.x, top: coords.y - 6 }}
        >
          <div className="whitespace-nowrap font-semibold mb-1">
            {name} — {color.quantitySold} pièce{color.quantitySold > 1 ? "s" : ""}
          </div>
          {color.bySource.length > 0 && (
            <div className="flex flex-col gap-0.5 min-w-[130px]">
              {color.bySource.map((s) => (
                <div key={s.source} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ background: MARKETPLACE_META[s.source].gradient }}
                    />
                    {MARKETPLACE_META[s.source].label}
                  </span>
                  <span className="tabular-nums text-white/90">{s.quantitySold}</span>
                </div>
              ))}
            </div>
          )}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-slate-900" />
        </div>,
        document.body,
      )}
    </>
  );
}

export default function MarketplaceTopProducts({ stats }: Props) {
  const [uiSort, setUiSort] = useState<"quantity" | "totalHT">("quantity");
  const [sort, setSort] = useState<"quantity" | "totalHT">("quantity");
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSource[]>([]);
  const [switching, setSwitching] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const allRows = useMemo(() => {
    if (!stats) return [];
    // Intersection : le produit doit avoir été vendu sur toutes les marketplaces cochées.
    const filtered = sourceFilter.length === 0
      ? stats.topProducts
      : stats.topProducts.filter((p) => {
          const soldOn = new Set(p.bySource.map((s) => s.source));
          return sourceFilter.every((src) => soldOn.has(src));
        });
    return [...filtered].sort((a, b) =>
      sort === "quantity" ? b.quantitySold - a.quantitySold : b.totalHT - a.totalHT,
    );
  }, [stats, sort, sourceFilter]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startOffset = (safePage - 1) * PER_PAGE;
  const rows = allRows.slice(startOffset, startOffset + PER_PAGE);

  useEffect(() => setPage(1), [sort, stats, sourceFilter]);
  useEffect(() => () => {
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const changeSort = (next: "quantity" | "totalHT") => {
    if (next === uiSort) return;
    setUiSort(next);
    setSwitching(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setSort(next));
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => setSwitching(false), SORT_OVERLAY_MS);
  };

  return (
    <div className="relative rounded-2xl bg-bg-primary border border-border shadow-sm p-5 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">
          Top produits vendus
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <MarketplaceSourceFilter selected={sourceFilter} onChange={setSourceFilter} />
          <button
            type="button"
            onClick={() => changeSort("quantity")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              uiSort === "quantity" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            Quantité ↓
          </button>
          <button
            type="button"
            onClick={() => changeSort("totalHT")}
            className={`text-xs rounded-full px-2.5 py-1 ${
              uiSort === "totalHT" ? "bg-slate-900 text-white" : "bg-bg-secondary text-text-secondary"
            }`}
          >
            CA ↓
          </button>
        </div>
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-text-muted py-6 text-center">
          {sourceFilter.length > 0
            ? sourceFilter.length === 1
              ? "Aucun produit vendu sur cette marketplace pour la période."
              : `Aucun produit vendu sur les ${sourceFilter.length} marketplaces cochées pour la période.`
            : "Aucun produit vendu sur la période."}
        </p>
      )}
      <ul className="divide-y divide-border flex-1 flex flex-col">
        {rows.map((p, i) => {
          const rank = startOffset + i + 1;
          const missing = !p.productId;
          const label = missing
            ? "Produit non présent sur notre site"
            : p.productName || p.productReference;
          const isExpanded = expandedId === (p.productId ?? p.productReference);
          return (
            <li
              key={`${p.productReference}-${p.productId ?? "none"}`}
              className="flex-1 flex flex-col"
            >
              <div className="flex items-center gap-3 py-3 -mx-2 px-2 hover:bg-bg-secondary rounded-lg">
                <span className="w-8 shrink-0 text-center font-heading font-bold text-sm text-text-muted tabular-nums self-start pt-1">
                  #{rank}
                </span>
                <div className="w-11 h-11 rounded-md bg-bg-secondary border border-border flex items-center justify-center text-xs text-text-muted shrink-0 overflow-hidden">
                  {missing ? (
                    "?"
                  ) : p.productImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.productImage}
                      alt={label}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    "IMG"
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {p.productId ? (
                    <Link
                      href={`/admin/produits/${p.productId}/modifier`}
                      className="font-semibold text-text-primary hover:underline truncate block"
                    >
                      {label}
                    </Link>
                  ) : (
                    <div className="font-semibold italic text-text-muted truncate">{label}</div>
                  )}
                  <div className="text-xs text-text-muted truncate flex items-center gap-1">
                    <span>{p.productReference}</span>
                    <span className="opacity-40">·</span>
                    {p.bySource.map((s) => (
                      <span key={s.source} className="inline-flex items-center gap-1">
                        <MarketplaceBadge source={s.source as MarketplaceSource} size="xs" />
                        <span className="tabular-nums">{s.quantitySold}</span>
                      </span>
                    ))}
                  </div>
                  {p.colors.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-3 pl-1">
                      {p.colors.map((c, idx) => (
                        <ColorPill key={`${c.productColorId ?? c.colorLabel ?? "x"}-${idx}`} color={c} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 self-start">
                  <div className="font-heading font-semibold text-text-primary tabular-nums">
                    {sort === "quantity" ? p.quantitySold : formatEur(p.totalHT)}
                  </div>
                  <div className="text-xs text-text-muted">
                    {sort === "quantity" ? "pièces" : "HT"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : p.productId ?? p.productReference)}
                    className="mt-1 text-[10.5px] text-text-muted hover:text-text-primary underline"
                  >
                    {isExpanded ? "Masquer" : "Détails"}
                  </button>
                </div>
              </div>
              {isExpanded && p.colors.length > 0 && (
                <div className="mx-2 mb-3 rounded-lg border border-border bg-bg-secondary/60 p-3">
                  <div className="text-[10.5px] uppercase tracking-[0.14em] text-text-muted mb-2">
                    Répartition détaillée par couleur × marketplace
                  </div>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead className="text-text-muted uppercase tracking-wider">
                        <tr>
                          <th className="text-left py-1 pr-2">Couleur</th>
                          <th className="text-right py-1 px-2">PFS</th>
                          <th className="text-right py-1 px-2">eFashion</th>
                          <th className="text-right py-1 px-2">Ankor</th>
                          <th className="text-right py-1 px-2">Faire</th>
                          <th className="text-right py-1 px-2 font-semibold">Total</th>
                          <th className="text-right py-1 pl-2">CA HT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.colors.map((c, idx) => {
                          const bySrc: Record<MarketplaceSource, number> = {
                            PFS: 0,
                            EFASHION: 0,
                            ANKORSTORE: 0,
                            FAIRE: 0,
                            MICROSTORE: 0,
                          };
                          for (const b of c.bySource) bySrc[b.source] = b.quantitySold;
                          return (
                            <tr
                              key={`row-${c.productColorId ?? c.colorLabel ?? idx}-${idx}`}
                              className="border-t border-border/60"
                            >
                              <td className="py-1.5 pr-2 text-text-primary flex items-center gap-2">
                                <span
                                  className="inline-block w-3 h-3 rounded-full border border-border"
                                  style={
                                    c.patternImage
                                      ? {
                                          backgroundImage: `url(${c.patternImage})`,
                                          backgroundSize: "cover",
                                        }
                                      : { backgroundColor: c.hex ?? "#9CA3AF" }
                                  }
                                />
                                {c.colorLabel ?? "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums">
                                {bySrc.PFS || "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums">
                                {bySrc.EFASHION || "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums">
                                {bySrc.ANKORSTORE || "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums">
                                {bySrc.FAIRE || "—"}
                              </td>
                              <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-text-primary">
                                {c.quantitySold}
                              </td>
                              <td className="py-1.5 pl-2 text-right tabular-nums text-text-secondary">
                                {formatEur(c.totalHT)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {allRows.length > 0 && (
        <TopPager
          page={safePage}
          totalPages={totalPages}
          startIndex={startOffset + 1}
          endIndex={Math.min(safePage * PER_PAGE, allRows.length)}
          total={allRows.length}
          onChange={setPage}
        />
      )}
      {switching && (
        <div
          className="absolute inset-0 rounded-2xl bg-slate-900/10 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-10"
          aria-hidden
        >
          <div className="rounded-full bg-slate-900/80 text-white text-xs font-medium px-3 py-1.5 flex items-center gap-2 shadow-lg">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Chargement…
          </div>
        </div>
      )}
    </div>
  );
}
