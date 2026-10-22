"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderStatusSlice } from "@/lib/dashboard-overview";

function fmtInt(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

/** Mapping clé statut Prisma → `?status=` du listing commandes admin. */
const STATUS_FILTER_KEY: Record<OrderStatusSlice["key"], string> = {
  SHIPPED: "SHIPPED",
  VALIDATED: "VALIDATED",
  PENDING: "PENDING",
  CANCELLED: "CANCELLED",
};

/**
 * Donut statut commandes — hover précis + clic drill-down vers la liste
 * commandes filtrée (`/admin/commandes?status=X`).
 */
export default function DashboardStatusDonut({
  slices,
  total,
}: {
  slices: OrderStatusSlice[];
  total: number;
}) {
  const router = useRouter();
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const isEmpty = total === 0;
  const safe = !isEmpty
    ? slices
    : [{ key: "PENDING" as const, label: "Aucune commande", count: 0, share: 1, color: "#e4e4e7" }];

  const SIZE = 118;
  const CENTER = SIZE / 2;
  const OUTER = 56;
  const INNER = 36;
  const HOVER_OUTER = 60;

  const arcs = buildArcs(safe, CENTER, OUTER, INNER, HOVER_OUTER);

  function handleClick(key: string) {
    if (isEmpty) return;
    router.push(`/admin/commandes?status=${STATUS_FILTER_KEY[key as OrderStatusSlice["key"]]}`);
  }

  const hovered = hoverKey ? safe.find((s) => s.key === hoverKey) : null;

  return (
    <div className="px-4 pb-5 pt-1">
      <div className="relative mx-auto mb-4" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="w-full h-full admin-fab-preserve"
          role="img"
          aria-label="Répartition des commandes par statut"
        >
          <g>
            {arcs.map((a) => (
              <path
                key={a.key}
                d={hoverKey === a.key ? a.pathHover : a.path}
                fill={a.color}
                stroke="white"
                strokeWidth={1}
                className="transition-all duration-150"
                style={{ cursor: isEmpty ? "default" : "pointer" }}
                onMouseEnter={() => !isEmpty && setHoverKey(a.key)}
                onMouseLeave={() => setHoverKey(null)}
                onClick={() => handleClick(a.key)}
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
              <div className="text-[13px] font-bold text-text-primary tabular-nums leading-tight">
                {fmtInt(hovered.count)}
              </div>
              <div className="text-[8.5px] text-text-muted truncate max-w-[64px]" title={hovered.label}>
                {hovered.label}
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[13px] font-bold text-text-primary tabular-nums">{total}</div>
              <div className="text-[9px] text-text-muted">Total</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-2 text-[10.5px]">
        {isEmpty ? (
          <p className="text-text-muted text-center">Aucune commande.</p>
        ) : (
          slices.map((s) => {
            const active = hoverKey === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => handleClick(s.key)}
                onMouseEnter={() => setHoverKey(s.key)}
                onMouseLeave={() => setHoverKey(null)}
                className={[
                  "flex items-center gap-2 min-w-0 rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors cursor-pointer hover:bg-zinc-50",
                  active ? "bg-zinc-50" : "",
                ].join(" ")}
                title={`${s.label} · ${fmtInt(s.count)} commandes`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="truncate text-zinc-600">{s.label}</span>
                <strong className="ml-auto text-text-primary tabular-nums">
                  {(s.share * 100).toFixed(1).replace(".", ",")}%
                </strong>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

interface Arc {
  key: string;
  color: string;
  path: string;
  pathHover: string;
}

function buildArcs(
  slices: Array<{ key: string; color: string; share: number }>,
  center: number,
  outer: number,
  inner: number,
  hoverOuter: number,
): Arc[] {
  if (slices.length === 1 && slices[0].share >= 0.999) {
    const s = slices[0];
    return [{
      key: s.key,
      color: s.color,
      path: fullDonut(center, outer, inner),
      pathHover: fullDonut(center, hoverOuter, inner),
    }];
  }

  const arcs: Arc[] = [];
  let cursor = -Math.PI / 2;
  for (const s of slices) {
    if (s.share <= 0) continue;
    const sweep = s.share * 2 * Math.PI;
    const nextCursor = cursor + sweep;
    arcs.push({
      key: s.key,
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
