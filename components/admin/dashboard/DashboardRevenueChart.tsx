"use client";

import { useId, useMemo, useState } from "react";
import type { RevenueBucket } from "@/lib/dashboard-overview";

/**
 * Chart CA + commandes — accepte n'importe quelle granularité (jour/semaine/mois).
 * Hover sur un bucket → tooltip détaillée (longLabel · CA · commandes).
 *
 * SVG pur (pas de lib) : le composant devient client juste pour gérer le hover
 * state. Les points sont bornés en nombre (max ~90 pour un trimestre), donc
 * aucun impact perf.
 */
export default function DashboardRevenueChart({ buckets }: { buckets: RevenueBucket[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const uid = useId();

  const W = 650, H = 220, LEFT = 45, RIGHT = 15, TOP = 20, BOTTOM = 46;
  const innerW = W - LEFT - RIGHT;
  const innerH = H - TOP - BOTTOM;

  const safeBuckets = buckets.length > 0 ? buckets : [{ label: "—", longLabel: "—", revenue: 0, orders: 0 }];

  const maxRev = Math.max(1, ...safeBuckets.map((p) => p.revenue));
  const maxOrd = Math.max(1, ...safeBuckets.map((p) => p.orders));

  const niceMax = (v: number) => {
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    if (n <= 1) return pow;
    if (n <= 2) return 2 * pow;
    if (n <= 5) return 5 * pow;
    return 10 * pow;
  };
  const yMax = niceMax(maxRev);
  const yTicks = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f), [yMax]);

  const xStep = safeBuckets.length > 1 ? innerW / (safeBuckets.length - 1) : innerW;
  const xAt = (i: number) => LEFT + i * xStep;
  const yRev = (v: number) => TOP + innerH - (v / yMax) * innerH;
  const yOrd = (v: number) => TOP + innerH - (v / Math.max(1, maxOrd)) * innerH;

  const revPath = safeBuckets.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yRev(p.revenue).toFixed(1)}`).join(" ");
  const revArea = `${revPath} L ${xAt(safeBuckets.length - 1).toFixed(1)} ${TOP + innerH} L ${LEFT} ${TOP + innerH} Z`;
  const ordPath = safeBuckets.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yOrd(p.orders).toFixed(1)}`).join(" ");

  // Labels X : limiter à ~8 étiquettes pour rester lisible, quel que soit n.
  const xLabels: { x: number; label: string }[] = [];
  const stride = Math.max(1, Math.ceil(safeBuckets.length / 8));
  for (let i = 0; i < safeBuckets.length; i += stride) {
    xLabels.push({ x: xAt(i), label: safeBuckets[i].label });
  }

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k€` : `${Math.round(n)} €`;
  const fmtMoneyFull = (n: number) =>
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

  const tooltip = hoverIdx !== null ? safeBuckets[hoverIdx] : null;
  const tooltipX = hoverIdx !== null ? xAt(hoverIdx) : 0;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Évolution du chiffre d'affaires">
        {/* Grille */}
        <g stroke="#edf1f7" strokeWidth={1}>
          {yTicks.map((_, i) => {
            const y = TOP + (innerH * i) / 4;
            return <line key={i} x1={LEFT} x2={W - RIGHT} y1={y} y2={y} />;
          })}
        </g>

        {/* Graduations Y */}
        <g fill="#8190a9" fontSize={10} fontFamily="inherit">
          {yTicks.slice().reverse().map((v, i) => {
            const y = TOP + (innerH * i) / 4 + 3;
            return <text key={i} x={LEFT - 6} y={y} textAnchor="end">{fmtMoney(v)}</text>;
          })}
        </g>

        {/* CA : aire + ligne (ligne tracée progressivement au chargement) */}
        <path d={revArea} fill="#eaf2ff" />
        <path d={revPath} fill="none" stroke="#246bfe" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="dashboard-line-draw" />

        {/* Commandes : ligne secondaire */}
        <path d={ordPath} fill="none" stroke="#08a66a" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="dashboard-line-draw" style={{ animationDelay: "300ms" }} />

        {/* Guide vertical hover */}
        {hoverIdx !== null && (
          <>
            <line
              x1={tooltipX} x2={tooltipX}
              y1={TOP} y2={TOP + innerH}
              stroke="#246bfe" strokeOpacity="0.3" strokeWidth={1} strokeDasharray="3 3"
            />
            <circle cx={tooltipX} cy={yRev(safeBuckets[hoverIdx].revenue)} r={4} fill="#246bfe" stroke="white" strokeWidth={2} />
            <circle cx={tooltipX} cy={yOrd(safeBuckets[hoverIdx].orders)} r={3.5} fill="#08a66a" stroke="white" strokeWidth={1.5} />
          </>
        )}

        {/* Zones hover transparentes — une par bucket */}
        {safeBuckets.map((_, i) => {
          const w = xStep;
          const x = xAt(i) - w / 2;
          return (
            <rect
              key={`${uid}-${i}`}
              x={x} y={TOP}
              width={w} height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              onTouchStart={() => setHoverIdx(i)}
              style={{ cursor: "pointer" }}
            />
          );
        })}

        {/* Labels X */}
        <g fill="#8190a9" fontSize={10} fontFamily="inherit" textAnchor="middle">
          {xLabels.map((l, i) => (
            <text key={i} x={l.x} y={H - 20}>{l.label}</text>
          ))}
        </g>
      </svg>

      {/* Tooltip HTML overlay (positionnée en % pour suivre le viewBox) */}
      {tooltip && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 bg-white border border-zinc-200 rounded-lg shadow-md px-3 py-2 text-[11px] min-w-[140px] z-10"
          style={{
            left: `${((tooltipX) / W) * 100}%`,
            top: `${(TOP / H) * 100}%`,
            transform: `translate(-50%, calc(-100% - 8px))`,
          }}
        >
          <div className="font-semibold text-text-primary mb-1">{tooltip.longLabel}</div>
          <div className="flex items-center justify-between gap-3 text-text-secondary">
            <span className="flex items-center gap-1.5">
              <i className="w-1.5 h-1.5 rounded-full bg-[#246bfe]" />CA
            </span>
            <strong className="text-text-primary tabular-nums">{fmtMoneyFull(tooltip.revenue)}</strong>
          </div>
          <div className="flex items-center justify-between gap-3 text-text-secondary">
            <span className="flex items-center gap-1.5">
              <i className="w-1.5 h-1.5 rounded-full bg-[#08a66a]" />Commandes
            </span>
            <strong className="text-text-primary tabular-nums">{tooltip.orders}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
