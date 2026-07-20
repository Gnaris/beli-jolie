"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";

const DEFAULT_CHOICES = [20, 50, 100, 200, 500] as const;

interface PerPageSelectProps {
  value: number;
  /** URL param key. Defaults to "per". Distinct keys allow multiple selects on the same page. */
  paramKey?: string;
  /** Also reset a related param (e.g. "page") to 1 when per-page changes. Defaults to "page". */
  resetParamKey?: string | null;
  choices?: readonly number[];
}

export default function PerPageSelect({
  value,
  paramKey = "per",
  resetParamKey = "page",
  choices = DEFAULT_CHOICES,
}: PerPageSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const options: SelectOption[] = choices.map((n) => ({
    value: String(n),
    label: n === 500 ? `${n} par page (max)` : `${n} par page`,
  }));

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramKey, next);
    if (resetParamKey) params.delete(resetParamKey);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="inline-flex items-center gap-2 h-10 px-1">
      <span className="text-[11px] font-body font-bold uppercase tracking-[0.12em] text-text-muted">
        Par page
      </span>
      <div className="min-w-[140px]">
        <CustomSelect
          value={String(value)}
          onChange={handleChange}
          options={options}
          size="sm"
          aria-label="Nombre d'éléments par page"
        />
      </div>
    </div>
  );
}
