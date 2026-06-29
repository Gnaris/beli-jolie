import React from "react";
import { formatRelativeDate } from "@/lib/format-date";

export type MarketplaceChipState = "live" | "sync" | "err" | "empty";

interface Props {
  name: string;
  state: MarketplaceChipState;
  lastExportedAt?: string | null;
  onClick?: () => void;
}

const STATE_CLS: Record<MarketplaceChipState, string> = {
  live: "bg-success-bg text-success border-[#bbf7d0]",
  sync: "bg-warning-bg text-warning border-[#fde68a]",
  err: "bg-error-bg text-error border-[#fecaca]",
  empty: "bg-bg-tertiary text-text-muted border-border",
};

export default function MarketplaceDateChip({
  name,
  state,
  lastExportedAt,
  onClick,
}: Props) {
  const showDate = state !== "empty" && !!lastExportedAt;
  const dateLabel =
    state === "err" && lastExportedAt
      ? `échec ${formatRelativeDate(lastExportedAt)}`
      : showDate
        ? formatRelativeDate(lastExportedAt!)
        : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-col items-start gap-px px-2 py-1 rounded-md border leading-tight min-w-0 ${STATE_CLS[state]}`}
    >
      <span className="inline-flex items-center gap-1 text-[10.5px] font-bold whitespace-nowrap">
        <span
          className={`w-1 h-1 rounded-full ${
            state === "empty" ? "bg-border-dark" : "bg-current opacity-85"
          }`}
          aria-hidden
        />
        {name}
      </span>
      {dateLabel && (
        <span className="text-[9px] opacity-65 font-medium tabular-nums whitespace-nowrap ml-2 leading-none">
          {dateLabel}
        </span>
      )}
    </button>
  );
}
