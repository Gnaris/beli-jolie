"use client";

const ITEMS = [
  "Qualité Garantie",
  "Catalogue Pro",
  "Nouveautés",
  "Collections",
  "Grossiste B2B",
  "Livraison Rapide",
  "Service Dédié",
  "Tendance",
  "Qualité Premium",
  "Prix Compétitifs",
];

function MarqueeRow({ reverse }: { reverse?: boolean }) {
  return (
    <div className={`flex shrink-0 gap-6 ${reverse ? "animate-marquee-reverse" : "animate-marquee"}`}>
      {ITEMS.map((item, i) => (
        <span key={i} className="flex items-center gap-6 whitespace-nowrap">
          <span className="font-[family-name:var(--font-poppins)] text-xs sm:text-sm font-medium text-text-secondary/70 tracking-wide uppercase">
            {item}
          </span>
          <span className="w-1 h-1 rounded-full bg-accent/60 shrink-0" />
        </span>
      ))}
    </div>
  );
}

export default function MarqueeBand() {
  return (
    <div className="py-3 sm:py-4 bg-bg-primary border-y border-border/50 overflow-hidden">
      <div className="flex gap-6">
        <MarqueeRow />
        <MarqueeRow />
        <MarqueeRow />
      </div>
    </div>
  );
}
