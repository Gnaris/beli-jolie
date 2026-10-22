"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { PERIOD_OPTIONS, periodLabel, type PeriodKey } from "@/lib/dashboard-period";

/**
 * Sélecteur de période affiché en haut du tableau de bord admin.
 *
 * Pose `?period=X` en URL (searchParam). La page RSC relit le param et refetch.
 * `useTransition` évite le scroll-jump et donne un feedback visuel pendant
 * le round-trip serveur.
 */
export default function DashboardPeriodPicker({
  current,
  periodLabel: rangeLabel,
}: {
  current: PeriodKey;
  periodLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function selectPeriod(next: PeriodKey) {
    if (next === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "month") params.delete("period");
    else params.set("period", next);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="inline-flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-text-muted hidden sm:inline">{rangeLabel}</span>
      <div
        role="radiogroup"
        aria-label="Période du tableau de bord"
        className={`inline-flex items-center bg-white border border-zinc-200 rounded-xl p-1 shadow-sm transition-opacity ${isPending ? "opacity-60" : ""}`}
      >
        {PERIOD_OPTIONS.map((p) => {
          const active = p === current;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => selectPeriod(p)}
              disabled={isPending}
              className={[
                "px-2.5 py-1 text-[11.5px] font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer",
                active
                  ? "bg-[#246bfe] text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-100",
              ].join(" ")}
            >
              {periodLabel(p)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
