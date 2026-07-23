"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface Props {
  boutiqueCount?: number;
  /** Total cumulé PFS + eFashion + Ankorstore (et à terme Faire). */
  marketplacesCount?: number;
}

type TabKey = "boutique" | "marketplaces";

export default function OrdersTabsNav({ boutiqueCount, marketplacesCount }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawSource = searchParams?.get("source");
  // Rétrocompat : ?source=pfs redirige visuellement vers l'onglet marketplaces.
  const active: TabKey =
    rawSource === "marketplaces" || rawSource === "pfs" ? "marketplaces" : "boutique";

  const buildHref = (source: TabKey) => {
    const params = new URLSearchParams();
    if (source === "marketplaces") params.set("source", "marketplaces");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <nav className="flex gap-1 border-b border-border mb-6" role="tablist">
      <Link
        href={buildHref("boutique")}
        role="tab"
        aria-selected={active === "boutique"}
        className={`px-4 py-3 flex items-center gap-2 border-b-2 text-sm transition-colors ${
          active === "boutique"
            ? "border-text-primary text-text-primary font-semibold"
            : "border-transparent text-text-muted hover:text-text-primary"
        }`}
      >
        <span
          className="w-6 h-6 rounded-md text-white font-heading font-bold text-xs flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#64748b,#334155)" }}
        >
          B
        </span>
        Boutique
        {typeof boutiqueCount === "number" && (
          <span className="text-xs text-text-muted">({boutiqueCount})</span>
        )}
      </Link>
      <Link
        href={buildHref("marketplaces")}
        role="tab"
        aria-selected={active === "marketplaces"}
        className={`px-4 py-3 flex items-center gap-2 border-b-2 text-sm transition-colors ${
          active === "marketplaces"
            ? "border-text-primary text-text-primary font-semibold"
            : "border-transparent text-text-muted hover:text-text-primary"
        }`}
      >
        <span className="inline-flex -space-x-1.5">
          <span
            className="w-6 h-6 rounded-md text-white font-heading font-bold text-xs flex items-center justify-center ring-2 ring-white"
            style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
          >
            P
          </span>
          <span
            className="w-6 h-6 rounded-md text-white font-heading font-bold text-xs flex items-center justify-center ring-2 ring-white"
            style={{ background: "linear-gradient(135deg,#db2777,#ec4899)" }}
          >
            E
          </span>
          <span
            className="w-6 h-6 rounded-md text-white font-heading font-bold text-xs flex items-center justify-center ring-2 ring-white"
            style={{ background: "linear-gradient(135deg,#0ea5e9,#38bdf8)" }}
          >
            A
          </span>
        </span>
        Marketplaces
        {typeof marketplacesCount === "number" && (
          <span className="text-xs text-text-muted">({marketplacesCount})</span>
        )}
      </Link>
    </nav>
  );
}
