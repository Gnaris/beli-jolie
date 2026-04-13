"use client";

import { useState, useRef } from "react";

type SyncStatus = "synced" | "pending" | "failed" | null;

interface SyncStatusBadgeProps {
  pfsSyncStatus: SyncStatus;
  pfsSyncError?: string | null;
  ankorsSyncStatus: SyncStatus;
  ankorsSyncError?: string | null;
  hasPfsConfig?: boolean;
  hasAnkorstoreConfig?: boolean;
}

type CombinedStatus = "none" | "pending" | "synced" | "failed";

function computeCombinedStatus(
  pfs: SyncStatus,
  ankors: SyncStatus,
  hasPfs: boolean,
  hasAnkors: boolean,
): CombinedStatus {
  const statuses: SyncStatus[] = [];
  if (hasPfs) statuses.push(pfs);
  if (hasAnkors) statuses.push(ankors);

  if (statuses.length === 0) return "none";
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.some((s) => s === "failed")) return "failed";
  if (statuses.some((s) => s === "synced")) return "synced";
  return "none";
}

const STATUS_CONFIG: Record<CombinedStatus, { label: string; className: string; icon: string }> = {
  none: {
    label: "Non synchronisé",
    className: "bg-bg-secondary text-text-muted border border-border",
    icon: "M20 12H4",
  },
  pending: {
    label: "Sync en cours",
    className: "bg-[#EFF6FF] text-[#2563EB] border border-[#BFDBFE]",
    icon: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  },
  synced: {
    label: "Synchronisé",
    className: "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]",
    icon: "M5 13l4 4L19 7",
  },
  failed: {
    label: "Sync échouée",
    className: "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]",
    icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z",
  },
};

export default function SyncStatusBadge({
  pfsSyncStatus,
  pfsSyncError,
  ankorsSyncStatus,
  ankorsSyncError,
  hasPfsConfig = false,
  hasAnkorstoreConfig = false,
}: SyncStatusBadgeProps) {
  const combined = computeCombinedStatus(pfsSyncStatus, ankorsSyncStatus, hasPfsConfig, hasAnkorstoreConfig);
  const config = STATUS_CONFIG[combined];

  // Don't render anything if no marketplace is configured
  if (!hasPfsConfig && !hasAnkorstoreConfig) return null;

  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Build error details for tooltip
  const errors: string[] = [];
  if (hasPfsConfig && pfsSyncStatus === "failed") {
    errors.push(`PFS : ${pfsSyncError || "Erreur inconnue"}`);
  }
  if (hasAnkorstoreConfig && ankorsSyncStatus === "failed") {
    errors.push(`Ankorstore : ${ankorsSyncError || "Erreur inconnue"}`);
  }

  const hasTooltip = combined === "failed" && errors.length > 0;

  return (
    <span
      className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body ${config.className} ${hasTooltip ? "cursor-help" : ""}`}
      onMouseEnter={() => {
        if (!hasTooltip) return;
        clearTimeout(timeoutRef.current);
        setShowTooltip(true);
      }}
      onMouseLeave={() => {
        timeoutRef.current = setTimeout(() => setShowTooltip(false), 150);
      }}
    >
      <svg className={`w-3.5 h-3.5 ${combined === "pending" ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
      </svg>
      {config.label}

      {/* Error tooltip */}
      {hasTooltip && showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-max max-w-xs">
          <div className="bg-[#1F2937] text-white text-xs rounded-lg px-3 py-2 shadow-lg font-body font-normal">
            {errors.map((err, i) => (
              <div key={i} className={i > 0 ? "mt-1 pt-1 border-t border-white/20" : ""}>
                {err}
              </div>
            ))}
          </div>
          <div className="w-2 h-2 bg-[#1F2937] rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </span>
  );
}

/** Compact version for table rows */
export function SyncStatusDot({
  pfsSyncStatus,
  pfsSyncError,
  ankorsSyncStatus,
  ankorsSyncError,
  hasPfsConfig = false,
  hasAnkorstoreConfig = false,
}: SyncStatusBadgeProps) {
  const combined = computeCombinedStatus(pfsSyncStatus, ankorsSyncStatus, hasPfsConfig, hasAnkorstoreConfig);
  const config = STATUS_CONFIG[combined];

  if (!hasPfsConfig && !hasAnkorstoreConfig) return null;

  const [showTooltip, setShowTooltip] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const errors: string[] = [];
  if (hasPfsConfig && pfsSyncStatus === "failed") {
    errors.push(`PFS : ${pfsSyncError || "Erreur inconnue"}`);
  }
  if (hasAnkorstoreConfig && ankorsSyncStatus === "failed") {
    errors.push(`Ankorstore : ${ankorsSyncError || "Erreur inconnue"}`);
  }

  const hasTooltip = combined === "failed" && errors.length > 0;

  return (
    <span
      className={`relative inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold font-body ${config.className} ${hasTooltip ? "cursor-help" : ""}`}
      onMouseEnter={() => {
        if (!hasTooltip) return;
        clearTimeout(timeoutRef.current);
        setShowTooltip(true);
      }}
      onMouseLeave={() => {
        timeoutRef.current = setTimeout(() => setShowTooltip(false), 150);
      }}
    >
      <svg className={`w-3 h-3 ${combined === "pending" ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
      </svg>
      {config.label}

      {hasTooltip && showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-max max-w-xs">
          <div className="bg-[#1F2937] text-white text-xs rounded-lg px-3 py-2 shadow-lg font-body font-normal">
            {errors.map((err, i) => (
              <div key={i} className={i > 0 ? "mt-1 pt-1 border-t border-white/20" : ""}>
                {err}
              </div>
            ))}
          </div>
          <div className="w-2 h-2 bg-[#1F2937] rotate-45 mx-auto -mt-1" />
        </div>
      )}
    </span>
  );
}
