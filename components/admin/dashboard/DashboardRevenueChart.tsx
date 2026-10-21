import type { DailyRevenuePoint } from "@/lib/dashboard-overview";

/**
 * Évolution CA + commandes sur le mois courant (SVG inline).
 * Axe X : jours du mois (1..n).
 * Axe Y gauche : CA (ligne bleue + area).
 * Axe Y droit  : commandes (ligne verte, échelle indépendante).
 */
export default function DashboardRevenueChart({ points }: { points: DailyRevenuePoint[] }) {
  const W = 650, H = 200, LEFT = 45, RIGHT = 15, TOP = 20, BOTTOM = 40;
  const innerW = W - LEFT - RIGHT;
  const innerH = H - TOP - BOTTOM;

  const maxRev = Math.max(1, ...points.map((p) => p.revenue));
  const maxOrd = Math.max(1, ...points.map((p) => p.orders));

  // Arrondi "joli" pour la graduation Y
  const niceMax = (v: number) => {
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    if (n <= 1) return pow;
    if (n <= 2) return 2 * pow;
    if (n <= 5) return 5 * pow;
    return 10 * pow;
  };
  const yMax = niceMax(maxRev);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f);

  const xStep = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const xAt = (i: number) => LEFT + i * xStep;
  const yRev = (v: number) => TOP + innerH - (v / yMax) * innerH;
  const yOrd = (v: number) => TOP + innerH - (v / Math.max(1, maxOrd)) * innerH;

  const revPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yRev(p.revenue).toFixed(1)}`).join(" ");
  const revArea = `${revPath} L ${xAt(points.length - 1).toFixed(1)} ${TOP + innerH} L ${LEFT} ${TOP + innerH} Z`;
  const ordPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yOrd(p.orders).toFixed(1)}`).join(" ");

  const xLabels: { x: number; label: string }[] = [];
  for (let d = 1; d <= points.length; d += Math.max(1, Math.ceil(points.length / 7))) {
    xLabels.push({ x: xAt(d - 1), label: `${d}` });
  }

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k€` : `${Math.round(n)} €`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
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

      {/* CA : aire + ligne */}
      <path d={revArea} fill="#eaf2ff" />
      <path d={revPath} fill="none" stroke="#246bfe" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* Commandes : ligne secondaire */}
      <path d={ordPath} fill="none" stroke="#08a66a" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0" />

      {/* Labels X */}
      <g fill="#8190a9" fontSize={10} fontFamily="inherit" textAnchor="middle">
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={H - 15}>{l.label}</text>
        ))}
      </g>
    </svg>
  );
}
