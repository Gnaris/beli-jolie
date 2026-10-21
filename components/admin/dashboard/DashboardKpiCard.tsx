import type { KpiBlock } from "@/lib/dashboard-overview";

const ACCENTS: Record<KpiBlock["accent"], { bg: string; fg: string; line: string; fill: string }> = {
  blue:   { bg: "#eaf2ff", fg: "#246bfe", line: "#246bfe", fill: "#eaf2ff" },
  green:  { bg: "#e4f8ef", fg: "#08a66a", line: "#08a66a", fill: "#e4f8ef" },
  purple: { bg: "#f0eaff", fg: "#8055f6", line: "#8055f6", fill: "#f0eaff" },
  cyan:   { bg: "#e2f9fc", fg: "#078ca2", line: "#08b8ce", fill: "#e2f9fc" },
};

function fmtValue(value: number, format: KpiBlock["format"]): string {
  if (format === "money") {
    const str = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    return `${str} €`;
  }
  return new Intl.NumberFormat("fr-FR").format(value);
}

function fmtDelta(d: number): string {
  const sign = d >= 0 ? "↑ +" : "↓ ";
  const abs = Math.abs(d * 100);
  return `${sign}${abs.toFixed(1).replace(".", ",")} %`;
}

/** SVG sparkline en area + ligne. Normalise sur min/max local. */
function Spark({ data, color, fill }: { data: number[]; color: string; fill: string }) {
  if (data.length < 2) {
    return <svg className="w-full h-[36px] block" viewBox="0 0 220 40" preserveAspectRatio="none" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 220, h = 40, pad = 2;
  const step = (w - pad * 2) / (data.length - 1);

  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L ${w - pad} ${h} L ${pad} ${h} Z`;

  return (
    <svg className="w-full h-[36px] block" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSvg({ icon }: { icon: KpiBlock["iconKey"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  switch (icon) {
    case "cart":
      return (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" {...common}>
          <path d="M3 3h2l2.4 11.4a2 2 0 002 1.6h8.6a2 2 0 002-1.6L21 7H6" />
          <circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" />
        </svg>
      );
    case "receipt":
      return (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" {...common}>
          <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      );
    case "box":
      return (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" {...common}>
          <path d="M21 8l-9-5-9 5 9 5 9-5z" />
          <path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" />
        </svg>
      );
    case "users":
      return (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" {...common}>
          <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13A4 4 0 0116 11" />
        </svg>
      );
  }
}

export default function DashboardKpiCard({ kpi }: { kpi: KpiBlock }) {
  const a = ACCENTS[kpi.accent];
  const positive = (kpi.deltaPct ?? 0) >= 0;

  return (
    <article className="bg-white border border-zinc-200/70 rounded-xl shadow-sm p-4 overflow-hidden">
      <div className="flex items-center gap-3">
        <div
          className="admin-fab-preserve w-9 h-9 rounded-xl grid place-items-center shrink-0"
          style={{ background: a.bg, color: a.fg }}
        >
          <IconSvg icon={kpi.iconKey} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500 truncate">{kpi.label}</div>
          <div className="text-[18px] md:text-[20px] font-bold text-text-primary tabular-nums tracking-tight whitespace-nowrap mt-0.5">
            {fmtValue(kpi.value, kpi.format)}
          </div>
          <div className={`text-[10.5px] font-semibold mt-0.5 ${positive ? "text-emerald-600" : "text-rose-600"}`}>
            {kpi.deltaPct === null ? "—" : fmtDelta(kpi.deltaPct)}
            <span className="text-zinc-400 font-normal ml-1">{kpi.deltaReference}</span>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <Spark data={kpi.spark.map((p) => p.value)} color={a.line} fill={a.fill} />
      </div>
    </article>
  );
}
