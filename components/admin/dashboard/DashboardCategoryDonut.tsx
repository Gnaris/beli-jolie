"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CategorySlice } from "@/lib/dashboard-overview";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n));
}
function fmtInt(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

/**
 * Donut CA par catégorie — slices SVG avec hover précis + clic drill-down.
 *
 * Hover d'un slice → tooltip (nom · CA · ventes · %) + agrandissement subtil.
 * Clic → navigation vers `/admin/categories` (page de gestion catégories).
 */
export default function DashboardCategoryDonut({
  slices,
  total,
}: {
  slices: CategorySlice[];
  total: number;
}) {
  const router = useRouter();
  const [hoverName, setHoverName] = useState<string | null>(null);

  const safe = slices.length > 0
    ? slices
    : [{ name: "Aucune donnée", sales: 0, revenue: 0, share: 1, color: "#e4e4e7" }];
  const isEmpty = slices.length === 0;

  const SIZE = 140;
  const CENTER = SIZE / 2;
  const OUTER = 68;
  const INNER = 42;
  const HOVER_OUTER = 72;

  const arcs = buildArcs(safe, CENTER, OUTER, INNER, HOVER_OUTER);

  function handleClick() {
    if (isEmpty) return;
    router.push("/admin/categories");
  }

  const hovered = hoverName ? safe.find((s) => s.name === hoverName) : null;

  return (
    <div className="flex items-center gap-4 px-4 pb-4 pt-2 flex-wrap sm:flex-nowrap">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="w-full h-full admin-fab-preserve"
          role="img"
          aria-label="Répartition du chiffre d'affaires par catégorie"
        >
          <g>
            {arcs.map((a) => (
              <path
                key={a.name}
                d={hoverName === a.name ? a.pathHover : a.path}
                fill={a.color}
                stroke="white"
                strokeWidth={1}
                className="transition-all duration-150"
                style={{ cursor: isEmpty ? "default" : "pointer" }}
                onMouseEnter={() => !isEmpty && setHoverName(a.name)}
                onMouseLeave={() => setHoverName(null)}
                onClick={handleClick}
              />
            ))}
          </g>
        </svg>
        <div
          className="absolute inset-0 grid place-items-center pointer-events-none text-center"
          style={{ padding: `${INNER - 10}px` }}
        >
          {hovered ? (
            <div>
              <div className="text-[11px] font-bold text-text-primary tabular-nums leading-tight">
                {fmtMoney(hovered.revenue)} €
              </div>
              <div className="text-[8.5px] text-text-muted truncate max-w-[72px]" title={hovered.name}>
                {hovered.name}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[12px] font-bold text-text-primary tabular-nums leading-tight">
                {fmtMoney(total)} €
              </div>
              <div className="text-[9px] text-text-muted">Total</div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 grid gap-2.5 text-[10.5px]">
        {safe.map((s) => {
          const active = hoverName === s.name;
          return (
            <button
              key={s.name}
              type="button"
              onClick={handleClick}
              onMouseEnter={() => !isEmpty && setHoverName(s.name)}
              onMouseLeave={() => setHoverName(null)}
              disabled={isEmpty}
              className={[
                "flex items-center gap-2 min-w-0 rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors",
                isEmpty ? "cursor-default" : "cursor-pointer hover:bg-zinc-50",
                active ? "bg-zinc-50" : "",
              ].join(" ")}
              title={isEmpty ? undefined : `${s.name} · ${fmtMoney(s.revenue)} € · ${fmtInt(s.sales)} ventes`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="truncate text-zinc-600">{s.name}</span>
              <strong className="ml-auto text-text-primary tabular-nums">
                {(s.share * 100).toFixed(1).replace(".", ",")}%
              </strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Arc {
  name: string;
  color: string;
  path: string;
  pathHover: string;
}

function buildArcs(
  slices: Array<{ name: string; color: string; share: number }>,
  center: number,
  outer: number,
  inner: number,
  hoverOuter: number,
): Arc[] {
  // Cas 1 slice qui fait 100% : les SVG arcs se dégradent (le point de départ
  // = point d'arrivée). On tombe en fallback cercle plein.
  if (slices.length === 1 && slices[0].share >= 0.999) {
    const s = slices[0];
    return [{
      name: s.name,
      color: s.color,
      path: fullDonut(center, outer, inner),
      pathHover: fullDonut(center, hoverOuter, inner),
    }];
  }

  const arcs: Arc[] = [];
  let cursor = -Math.PI / 2; // commencer en haut
  for (const s of slices) {
    const sweep = s.share * 2 * Math.PI;
    const nextCursor = cursor + sweep;
    arcs.push({
      name: s.name,
      color: s.color,
      path: donutSlice(center, inner, outer, cursor, nextCursor),
      pathHover: donutSlice(center, inner, hoverOuter, cursor, nextCursor),
    });
    cursor = nextCursor;
  }
  return arcs;
}

function donutSlice(c: number, inner: number, outer: number, a0: number, a1: number): string {
  const largeArc = a1 - a0 > Math.PI ? 1 : 0;
  const x0out = c + outer * Math.cos(a0);
  const y0out = c + outer * Math.sin(a0);
  const x1out = c + outer * Math.cos(a1);
  const y1out = c + outer * Math.sin(a1);
  const x0in = c + inner * Math.cos(a1);
  const y0in = c + inner * Math.sin(a1);
  const x1in = c + inner * Math.cos(a0);
  const y1in = c + inner * Math.sin(a0);
  return [
    `M ${x0out} ${y0out}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${x1out} ${y1out}`,
    `L ${x0in} ${y0in}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${x1in} ${y1in}`,
    "Z",
  ].join(" ");
}

function fullDonut(c: number, outer: number, inner: number): string {
  return [
    `M ${c - outer} ${c}`,
    `A ${outer} ${outer} 0 1 0 ${c + outer} ${c}`,
    `A ${outer} ${outer} 0 1 0 ${c - outer} ${c}`,
    `M ${c - inner} ${c}`,
    `A ${inner} ${inner} 0 1 1 ${c + inner} ${c}`,
    `A ${inner} ${inner} 0 1 1 ${c - inner} ${c}`,
    "Z",
  ].join(" ");
}
