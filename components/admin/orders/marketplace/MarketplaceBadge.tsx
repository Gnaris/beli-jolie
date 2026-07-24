"use client";

import type { MarketplaceSource } from "@/app/actions/admin/marketplace-orders";

/**
 * Rond avec l'initiale colorée de la marketplace. Palettes figées définies
 * dans CLAUDE.md (gradients réutilisés partout — bandeau, top clients, etc.).
 */
export const MARKETPLACE_META: Record<
  MarketplaceSource,
  { letter: string; label: string; gradient: string }
> = {
  PFS: {
    letter: "P",
    label: "Paris Fashion Shop",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
  },
  EFASHION: {
    letter: "E",
    label: "eFashion Paris",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
  },
  ANKORSTORE: {
    letter: "A",
    label: "Ankorstore",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  },
  FAIRE: {
    letter: "F",
    label: "Faire",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  },
  MICROSTORE: {
    letter: "M",
    label: "Microstore",
    gradient: "linear-gradient(135deg,#0891b2,#22d3ee)",
  },
};

interface Props {
  source: MarketplaceSource;
  size?: "xs" | "sm" | "md";
  title?: string;
}

export default function MarketplaceBadge({ source, size = "sm", title }: Props) {
  const meta = MARKETPLACE_META[source];
  const dim =
    size === "xs" ? "w-5 h-5 text-[10px]" : size === "md" ? "w-8 h-8 text-sm" : "w-6 h-6 text-xs";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md text-white font-heading font-bold ${dim}`}
      style={{ background: meta.gradient }}
      title={title ?? meta.label}
      aria-label={meta.label}
    >
      {meta.letter}
    </span>
  );
}
