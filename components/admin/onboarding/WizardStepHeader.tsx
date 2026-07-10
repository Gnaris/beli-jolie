import React from "react";

type Accent = "violet" | "emerald" | "amber" | "sky" | "rose" | "slate";

const ACCENT_MAP: Record<Accent, { chipBg: string; chipText: string; iconGrad: string; iconRing: string }> = {
  violet:  { chipBg: "bg-violet-100",  chipText: "text-violet-700",  iconGrad: "from-violet-100 to-indigo-100",   iconRing: "ring-violet-200"  },
  emerald: { chipBg: "bg-emerald-100", chipText: "text-emerald-700", iconGrad: "from-emerald-100 to-teal-100",    iconRing: "ring-emerald-200" },
  amber:   { chipBg: "bg-amber-100",   chipText: "text-amber-700",   iconGrad: "from-amber-100 to-orange-100",    iconRing: "ring-amber-200"   },
  sky:     { chipBg: "bg-sky-100",     chipText: "text-sky-700",     iconGrad: "from-sky-100 to-blue-100",        iconRing: "ring-sky-200"     },
  rose:    { chipBg: "bg-rose-100",    chipText: "text-rose-700",    iconGrad: "from-rose-100 to-pink-100",       iconRing: "ring-rose-200"    },
  slate:   { chipBg: "bg-slate-100",   chipText: "text-slate-700",   iconGrad: "from-slate-100 to-zinc-100",      iconRing: "ring-slate-200"   },
};

export default function WizardStepHeader({
  emoji,
  eyebrow,
  title,
  description,
  accent = "violet",
}: {
  emoji: string;
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  accent?: Accent;
}) {
  const a = ACCENT_MAP[accent];
  return (
    <div className="text-center mb-8">
      <div
        className={`inline-flex w-20 h-20 items-center justify-center rounded-3xl bg-gradient-to-br ${a.iconGrad} text-5xl mb-6 shadow-sm ring-1 ${a.iconRing}`}
      >
        {emoji}
      </div>
      <p className={`text-[11px] uppercase tracking-[0.18em] ${a.chipText} font-semibold mb-3`}>
        {eyebrow}
      </p>
      <h1 className="font-heading text-3xl md:text-4xl font-bold text-text-primary mb-3">
        {title}
      </h1>
      <p className="text-lg text-text-secondary max-w-xl mx-auto">
        {description}
      </p>
    </div>
  );
}
