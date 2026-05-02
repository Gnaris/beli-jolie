"use client";

import { useState, useEffect } from "react";
import { getImageSrc } from "@/lib/image-utils";
import {
  usePfsRefreshQueue,
  hasError,
  type PfsRefreshItem,
  type TargetOutcome,
} from "@/components/admin/products/PfsRefreshContext";

function targetStatusDot(outcome: TargetOutcome | undefined): { color: string; label: string } | null {
  if (!outcome) return null;
  if (outcome.ok) return { color: "bg-[#22C55E]", label: "Terminé" };
  if (outcome.kind === "not_found") return { color: "bg-[#F59E0B]", label: outcome.message };
  return { color: "bg-[#EF4444]", label: outcome.message };
}

function MainStatusIcon({ item }: { item: PfsRefreshItem }) {
  if (item.status === "queued") {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-bg-tertiary text-text-muted" aria-label="En attente">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5" />
          <circle cx="12" cy="12" r="9" strokeWidth={1.5} />
        </svg>
      </span>
    );
  }
  if (item.status === "in_progress") {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#EEF2FF] text-[#4F46E5]" aria-label="En cours">
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
      </span>
    );
  }
  // Done
  const err = hasError(item);
  if (err) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#FEF3C7] text-[#B45309]" aria-label="Terminé avec erreurs">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#DCFCE7] text-[#15803D]" aria-label="Terminé">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function TargetBadge({ label, outcome }: { label: string; outcome: TargetOutcome | undefined }) {
  const dot = targetStatusDot(outcome);
  if (!dot) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-body text-text-muted"
      title={dot.label}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot.color}`} aria-hidden="true" />
      <span className="font-semibold">{label}</span>
    </span>
  );
}

export function PfsRefreshWidget() {
  const { items, clear, stop, isAllFinished, runningCount, queuedCount } = usePfsRefreshQueue();
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (items.length === 1 && items[0].status === "queued") {
      setMinimized(false);
    }
  }, [items.length]);

  if (items.length === 0) return null;

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const errorsCount = items.filter((i) => i.status === "done" && hasError(i)).length;
  const barPercent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className="fixed bottom-4 right-4 z-[9000] animate-fadeIn"
      style={{ maxWidth: "calc(100vw - 2rem)" }}
      role="region"
      aria-label="Marketplace en cours"
    >
      {minimized ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2.5 bg-bg-primary border border-border rounded-full px-4 py-2.5 shadow-lg hover:shadow-xl transition-all font-body"
        >
          {!isAllFinished && (
            <svg className="w-4 h-4 text-[#4F46E5] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
          )}
          {isAllFinished && errorsCount === 0 && (
            <svg className="w-4 h-4 text-[#15803D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isAllFinished && errorsCount > 0 && (
            <svg className="w-4 h-4 text-[#B45309]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01" />
              <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
            </svg>
          )}
          <span className="text-[13px] font-medium text-text-primary tabular-nums">
            {done}/{total} traité{total > 1 ? "s" : ""}
          </span>
          {errorsCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold tabular-nums">
              {errorsCount}
            </span>
          )}
        </button>
      ) : (
        <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-[380px] max-w-full overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-secondary">
            {!isAllFinished ? (
              <svg className="w-4 h-4 text-[#4F46E5] animate-spin shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
              </svg>
            ) : errorsCount > 0 ? (
              <svg className="w-4 h-4 text-[#B45309] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M4.93 19h14.14a2 2 0 001.73-3L13.73 4a2 2 0 00-3.46 0L3.2 16a2 2 0 001.73 3z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[#15803D] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-[13px] font-semibold font-heading text-text-primary leading-tight truncate">
                {isAllFinished
                  ? errorsCount > 0
                    ? "Terminé avec des erreurs"
                    : "Marketplace — terminé"
                  : "Marketplace — en cours"}
              </h3>
              <p className="text-[11px] font-body text-text-muted tabular-nums mt-0.5">
                {done}/{total} produit{total > 1 ? "s" : ""}
                {queuedCount > 0 ? ` · ${queuedCount} en attente` : ""}
                {runningCount > 0 ? ` · ${runningCount} en cours` : ""}
              </p>
            </div>
            {queuedCount > 0 && (
              <button
                type="button"
                onClick={stop}
                className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Arrêter les produits en attente"
                aria-label="Arrêter les produits en attente"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMinimized(true)}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-md transition-colors"
              title="Réduire"
              aria-label="Réduire"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14H5" />
              </svg>
            </button>
            {isAllFinished && (
              <button
                type="button"
                onClick={clear}
                className="p-1.5 text-text-muted hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Fermer"
                aria-label="Fermer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-bg-tertiary relative overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${isAllFinished ? (errorsCount > 0 ? "bg-[#F59E0B]" : "bg-[#22C55E]") : "bg-[#4F46E5]"}`}
              style={{ width: `${barPercent}%` }}
            />
          </div>

          {/* Items list */}
          <ul className="flex-1 overflow-y-auto max-h-[360px] divide-y divide-border-light">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-10 h-10 rounded-lg bg-bg-tertiary overflow-hidden shrink-0 flex items-center justify-center">
                  {item.firstImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getImageSrc(item.firstImage, "thumb")}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-mono font-semibold text-text-primary truncate">
                    {item.reference}
                  </p>
                  <p className="text-[11px] font-body text-text-muted truncate">
                    {item.productName}
                  </p>
                  {item.status === "done" && (
                    <div className="flex items-center gap-3 mt-1">
                      {item.options.local && (
                        <TargetBadge label="Boutique" outcome={item.localOutcome} />
                      )}
                      {item.options.pfs && (
                        <TargetBadge label="PFS" outcome={item.pfsOutcome} />
                      )}
                    </div>
                  )}
                  {item.status === "done" && item.pfsOutcome?.ok && item.pfsOutcome.archived && (
                    <p className="text-[10px] font-body text-[#B45309] mt-0.5">
                      PFS archivé (rupture de stock)
                    </p>
                  )}
                  {item.status === "done" && item.pfsOutcome && !item.pfsOutcome.ok && (
                    <p className="text-[10px] font-body text-red-600 mt-0.5 truncate" title={item.pfsOutcome.message}>
                      PFS · {item.pfsOutcome.message}
                    </p>
                  )}
                  {item.status === "in_progress" && (
                    <p className="text-[10px] font-body text-[#4F46E5] mt-0.5">En cours...</p>
                  )}
                </div>
                <MainStatusIcon item={item} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
