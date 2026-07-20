"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface Props {
  boutiqueCount?: number;
  pfsCount?: number;
}

export default function OrdersTabsNav({ boutiqueCount, pfsCount }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = (searchParams?.get("source") ?? "boutique") as "boutique" | "pfs";

  const buildHref = (source: "boutique" | "pfs") => {
    const params = new URLSearchParams();
    if (source === "pfs") params.set("source", "pfs");
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
        href={buildHref("pfs")}
        role="tab"
        aria-selected={active === "pfs"}
        className={`px-4 py-3 flex items-center gap-2 border-b-2 text-sm transition-colors ${
          active === "pfs"
            ? "border-text-primary text-text-primary font-semibold"
            : "border-transparent text-text-muted hover:text-text-primary"
        }`}
      >
        <span
          className="w-6 h-6 rounded-md text-white font-heading font-bold text-xs flex items-center justify-center"
          style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
        >
          P
        </span>
        Paris Fashion Shop
        {typeof pfsCount === "number" && (
          <span className="text-xs text-text-muted">({pfsCount})</span>
        )}
      </Link>
    </nav>
  );
}
