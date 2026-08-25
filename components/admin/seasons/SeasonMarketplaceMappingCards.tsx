"use client";

type Marketplace = "pfs" | "efashion" | "microstore";

type Props = {
  pfsLabel: string | null;
  efashionLabel: string | null;
  microstoreLabel: string | null;
  onEditMapping: (mp: Marketplace) => void;
};

const ITEMS: { key: Marketplace; label: string }[] = [
  { key: "pfs", label: "Paris Fashion Shop" },
  { key: "efashion", label: "eFashion" },
  { key: "microstore", label: "Microstore" },
];

export default function SeasonMarketplaceMappingCards({
  pfsLabel,
  efashionLabel,
  microstoreLabel,
  onEditMapping,
}: Props) {
  const values: Record<Marketplace, string | null> = {
    pfs: pfsLabel,
    efashion: efashionLabel,
    microstore: microstoreLabel,
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3 [&>:last-child]:col-span-2 md:[&>:last-child]:col-span-1">
      {ITEMS.map((m) => {
        const value = values[m.key];
        const mapped = !!value;
        return (
          <div
            key={m.key}
            className="relative bg-bg-primary border border-border rounded-xl md:rounded-2xl p-3 md:p-4 flex flex-col gap-2 md:gap-2.5 shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-card)] hover:-translate-y-px transition-all overflow-hidden"
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
              <span className="text-[10.5px] md:text-[11px] font-bold uppercase tracking-[0.06em] md:tracking-[0.08em] text-text-primary truncate">{m.label}</span>
              <span
                className={`shrink-0 w-5 h-5 md:w-[22px] md:h-[22px] rounded-full inline-flex items-center justify-center text-[10px] md:text-[11px] font-bold ${
                  mapped
                    ? "bg-emerald-100 text-emerald-600 ring-[3px] ring-emerald-50"
                    : "bg-amber-100 text-amber-600 ring-[3px] ring-amber-50"
                }`}
              >
                {mapped ? "✓" : "!"}
              </span>
            </div>
            <div className={`text-[11.5px] md:text-[12.5px] leading-snug min-h-[26px] md:min-h-[18px] flex items-center gap-1.5 flex-wrap ${mapped ? "text-text-primary font-medium" : "text-text-muted italic"}`}>
              <span className="line-clamp-2 md:line-clamp-none">{value ?? "Non mappé"}</span>
            </div>
            <button
              type="button"
              onClick={() => onEditMapping(m.key)}
              aria-label={`Modifier le mapping ${m.label}`}
              className="text-[10.5px] md:text-[11px] text-text-secondary hover:text-text-primary border-t border-border pt-2 md:pt-2.5 text-left inline-flex items-center gap-1 font-medium"
            >
              <span className="md:hidden">{mapped ? "Modifier" : "Choisir"}</span>
              <span className="hidden md:inline">{mapped ? "Modifier le mapping" : "Choisir un mapping"}</span>
              <span aria-hidden>→</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
