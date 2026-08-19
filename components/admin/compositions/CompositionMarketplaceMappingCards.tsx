"use client";

type Marketplace = "pfs" | "efashion" | "orderchamp";

type Props = {
  pfsLabel: string | null;
  efashionLabel: string | null;
  orderchampLabel: string | null;
  onEditMapping: (mp: Marketplace) => void;
};

const ITEMS: { key: Marketplace; label: string }[] = [
  { key: "pfs", label: "Paris Fashion Shop" },
  { key: "efashion", label: "eFashion" },
  { key: "orderchamp", label: "Orderchamp" },
];

export default function CompositionMarketplaceMappingCards({
  pfsLabel,
  efashionLabel,
  orderchampLabel,
  onEditMapping,
}: Props) {
  const values: Record<Marketplace, string | null> = {
    pfs: pfsLabel,
    efashion: efashionLabel,
    orderchamp: orderchampLabel,
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {ITEMS.map((m) => {
        const value = values[m.key];
        const mapped = !!value;
        return (
          <div
            key={m.key}
            className="relative bg-bg-primary border border-border rounded-2xl p-4 flex flex-col gap-2.5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-card)] hover:-translate-y-px transition-all overflow-hidden"
          >
            <span
              aria-hidden
              className={`absolute top-0 inset-x-0 h-[3px] ${
                mapped
                  ? "bg-gradient-to-r from-emerald-300 to-emerald-600"
                  : "bg-gradient-to-r from-amber-300 to-amber-600"
              }`}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-primary">{m.label}</span>
              <span
                className={`w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[11px] font-bold ${
                  mapped
                    ? "bg-emerald-100 text-emerald-600 ring-[3px] ring-emerald-50"
                    : "bg-amber-100 text-amber-600 ring-[3px] ring-amber-50"
                }`}
              >
                {mapped ? "✓" : "!"}
              </span>
            </div>
            <div className={`text-[12.5px] leading-snug min-h-[18px] flex items-center gap-1.5 flex-wrap ${mapped ? "text-text-primary font-medium" : "text-text-muted italic"}`}>
              <span>{value ?? "Non mappé"}</span>
            </div>
            <button
              type="button"
              onClick={() => onEditMapping(m.key)}
              aria-label={`Modifier le mapping ${m.label}`}
              className="text-[11px] text-text-secondary hover:text-text-primary border-t border-border pt-2.5 text-left inline-flex items-center gap-1 font-medium"
            >
              {mapped ? "Modifier le mapping" : "Choisir un mapping"} <span aria-hidden>→</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
