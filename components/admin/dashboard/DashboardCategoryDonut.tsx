import type { CategorySlice } from "@/lib/dashboard-overview";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Donut conic-gradient + légende latérale. */
export default function DashboardCategoryDonut({ slices, total }: { slices: CategorySlice[]; total: number }) {
  // Fallback neutre quand aucune donnée.
  const safeSlices = slices.length > 0
    ? slices
    : [{ name: "Aucune donnée", sales: 0, revenue: 0, share: 1, color: "#e4e4e7" }];

  // Construction du conic-gradient
  let cursor = 0;
  const stops = safeSlices.map((s) => {
    const start = cursor * 100;
    const end = (cursor + s.share) * 100;
    cursor += s.share;
    return `${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(",");

  return (
    <div className="flex items-center gap-4 px-4 pb-4 pt-2 flex-wrap sm:flex-nowrap">
      <div
        className="admin-fab-preserve relative rounded-full shrink-0"
        style={{
          width: 140, height: 140,
          background: `conic-gradient(${stops})`,
        }}
      >
        <div className="absolute inset-[23%] rounded-full bg-white grid place-items-center text-center">
          <div>
            <div className="text-[12px] font-bold text-text-primary tabular-nums leading-tight">
              {fmtMoney(total)} €
            </div>
            <div className="text-[9px] text-text-muted">Total</div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-w-0 grid gap-2.5 text-[10.5px]">
        {safeSlices.map((s) => (
          <div key={s.name} className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="truncate text-zinc-600">{s.name}</span>
            <strong className="ml-auto text-text-primary tabular-nums">
              {(s.share * 100).toFixed(1).replace(".", ",")}%
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
