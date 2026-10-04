"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import { buildPriceFilterHref, normalizePriceInput } from "@/components/issyma/price-filter-url";

const P = ISSYMA_PALETTE;

export interface IssymaPriceFilterProps {
  title: string;
  minLabel: string;
  maxLabel: string;
  applyLabel: string;
  clearLabel: string;
  initialMin: string;
  initialMax: string;
  preserveParams: Record<string, string | undefined>;
}

export default function IssymaPriceFilter({
  title,
  minLabel,
  maxLabel,
  applyLabel,
  clearLabel,
  initialMin,
  initialMax,
  preserveParams,
}: IssymaPriceFilterProps) {
  const router = useRouter();
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);

  useEffect(() => {
    setMin(initialMin);
    setMax(initialMax);
  }, [initialMin, initialMax]);

  const buildHref = (nextMin: string, nextMax: string) =>
    buildPriceFilterHref(preserveParams, nextMin, nextMax);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(buildHref(normalizePriceInput(min), normalizePriceInput(max)));
  };

  const clear = () => {
    setMin("");
    setMax("");
    router.push(buildHref("", ""));
  };

  const hasAnyBound = !!(initialMin || initialMax);

  const inputStyle: React.CSSProperties = {
    background: P.paper,
    border: `1px solid ${P.borderSoft}`,
    color: P.ink,
  };

  return (
    <div className="py-4" style={{ borderTop: `1px solid ${P.borderSoft}` }}>
      <p
        className="text-[10px] tracking-[0.28em] uppercase font-semibold mb-3"
        style={{ color: P.wine700 }}
      >
        {title}
      </p>
      <form onSubmit={apply} className="flex items-center gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          placeholder={minLabel}
          aria-label={minLabel}
          className="w-full min-w-0 px-2 py-1.5 rounded-md text-[12px] tabular-nums outline-none"
          style={inputStyle}
        />
        <span className="text-[11px]" style={{ color: P.muted }} aria-hidden>
          —
        </span>
        <input
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          placeholder={maxLabel}
          aria-label={maxLabel}
          className="w-full min-w-0 px-2 py-1.5 rounded-md text-[12px] tabular-nums outline-none"
          style={inputStyle}
        />
        <button
          type="submit"
          className="shrink-0 inline-flex items-center justify-center rounded-full w-7 h-7 text-[12px] font-semibold transition"
          style={{ background: P.wine700, color: P.cream }}
          aria-label={applyLabel}
          title={applyLabel}
        >
          →
        </button>
      </form>
      {hasAnyBound && (
        <button
          type="button"
          onClick={clear}
          className="mt-2 text-[10px] tracking-[0.18em] uppercase"
          style={{ color: P.wine700 }}
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}
