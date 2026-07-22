"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { PfsStatsBundle } from "@/app/actions/admin/pfs-orders";
import TopPager from "./TopPager";

interface Props {
  stats: PfsStatsBundle | null;
}

const SORT_OVERLAY_MS = 250;

function formatEur(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n)) + " €";
}

// Pastille couleur avec badge quantité et légende flottante au survol.
// Légende portée dans document.body pour éviter tout clipping.
function ColorPill({
  name,
  hex,
  patternImage,
  quantity,
}: {
  name: string;
  hex: string | null;
  patternImage: string | null;
  quantity: number;
}) {
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

  const bg: CSSProperties = patternImage
    ? {
        backgroundImage: `url(${patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: hex ?? "#9CA3AF" };

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
        aria-label={`${name} — ${quantity} pièce${quantity > 1 ? "s" : ""}`}
        className="relative inline-block w-[26px] h-[26px] rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.14)] cursor-default outline-none focus:ring-2 focus:ring-emerald-400/60"
        style={bg}
      >
        <span className="absolute -bottom-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center border border-white shadow-sm">
          {quantity}
        </span>
      </span>
      {hovered && coords && createPortal(
        <div
          role="tooltip"
          className="fixed z-[9999] pointer-events-none px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-medium whitespace-nowrap shadow-lg -translate-x-1/2 -translate-y-full"
          style={{ left: coords.x, top: coords.y - 6 }}
        >
          {name} — {quantity} pièce{quantity > 1 ? "s" : ""}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-slate-900" />
        </div>,
        document.body,
      )}
    </>
  );
}

const PER_PAGE = 10;

export default function PfsTopProducts({ stats }: Props) {
  // uiSort = highlight du bouton (immédiat), sort = tri effectif (frame suivant).
  const [uiSort, setUiSort] = useState<"quantity" | "totalHT">("quantity");
  const [sort, setSort] = useState<"quantity" | "totalHT">("quantity");
  const [switching, setSwitching] = useState(false);
  const [page, setPage] = useState(1);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const allRows = useMemo(() => {
    if (!stats) return [];
    return [...stats.topProducts].sort((a, b) =>
      sort === "quantity" ? b.quantitySold - a.quantitySold : b.totalHT - a.totalHT,
    );
  }, [stats, sort]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const startOffset = (safePage - 1) * PER_PAGE;
  const rows = allRows.slice(startOffset, startOffset + PER_PAGE);

  // Reset à la 1ère page dès que le tri change ou que la période change.
  useEffect(() => {
    setPage(1);
  }, [sort, stats]);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const changeSort = (next: "quantity" | "totalHT") => {
    if (next === uiSort) return;
    setUiSort(next);
    setSwitching(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setSort(next);
    });
    if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    switchTimerRef.current = setTimeout(() => setSwitching(false), SORT_OVERLAY_MS);
  };

  return (
    <div className="relative rounded-2xl bg-bg-primary border border-border shadow-sm p-5 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted font-medium">Top produits vendus</div>
        <div className="ml-auto flex gap-1">
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
        <p className="text-sm text-text-muted py-6 text-center">Aucun produit vendu sur la période.</p>
      )}
      <ul className="divide-y divide-border flex-1 flex flex-col">
        {rows.map((p, i) => {
          const rank = startOffset + i + 1;
          const missing = !p.productId;
          const label = missing
            ? "Produit non présent sur notre site"
            : p.productName || p.pfsProductRef;
          const inner = (
            <>
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
                <div className={`font-semibold truncate ${missing ? "italic text-text-muted" : "text-text-primary"}`}>
                  {label}
                </div>
                <div className="text-xs text-text-muted truncate">
                  {p.pfsProductRef}
                  {sort === "totalHT" ? ` · ${p.quantitySold} pièce${p.quantitySold > 1 ? "s" : ""}` : ""}
                </div>
                {p.colors.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-3 pl-1">
                    {p.colors.map((c, idx) => (
                      <ColorPill
                        key={`${c.productColorId ?? c.colorCodePfs ?? "x"}-${idx}`}
                        name={c.colorLabelFr || c.colorCodePfs || "—"}
                        hex={c.hex}
                        patternImage={c.patternImage}
                        quantity={c.quantitySold}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="font-heading font-semibold text-text-primary">
                  {sort === "quantity" ? p.quantitySold : formatEur(p.totalHT)}
                </div>
                <div className="text-xs text-text-muted">{sort === "quantity" ? "pièces" : "HT"}</div>
              </div>
            </>
          );
          return (
            <li key={`${p.pfsProductRef}-${p.productId ?? "none"}`} className="flex-1 flex">
              {p.productId ? (
                <Link
                  href={`/admin/produits/${p.productId}/modifier`}
                  className="flex items-center gap-3 py-3 -mx-2 px-2 hover:bg-bg-secondary rounded-lg w-full h-full"
                >
                  {inner}
                </Link>
              ) : (
                <div className="flex items-center gap-3 py-3 -mx-2 px-2 w-full h-full">{inner}</div>
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
