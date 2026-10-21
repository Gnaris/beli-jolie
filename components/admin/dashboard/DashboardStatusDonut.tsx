import type { OrderStatusSlice } from "@/lib/dashboard-overview";

export default function DashboardStatusDonut({ slices, total }: { slices: OrderStatusSlice[]; total: number }) {
  const safe = total > 0 ? slices : [{ key: "PENDING" as const, label: "Aucune commande", count: 0, share: 1, color: "#e4e4e7" }];

  let cursor = 0;
  const stops = safe.map((s) => {
    const start = cursor * 100;
    const end = (cursor + s.share) * 100;
    cursor += s.share;
    return `${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(",");

  return (
    <div className="px-4 pb-5 pt-1">
      <div
        className="admin-fab-preserve relative rounded-full mx-auto mb-4"
        style={{ width: 118, height: 118, background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-[23%] rounded-full bg-white grid place-items-center text-center">
          <div>
            <div className="text-[13px] font-bold text-text-primary tabular-nums">{total}</div>
            <div className="text-[9px] text-text-muted">Total</div>
          </div>
        </div>
      </div>
      <div className="grid gap-2 text-[10.5px]">
        {total === 0 ? (
          <p className="text-text-muted text-center">Aucune commande.</p>
        ) : slices.map((s) => (
          <div key={s.key} className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="truncate text-zinc-600">{s.label}</span>
            <strong className="ml-auto text-text-primary tabular-nums">
              {(s.share * 100).toFixed(1).replace(".", ",")}%
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
