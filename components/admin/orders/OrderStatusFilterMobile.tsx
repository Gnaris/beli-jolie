"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type OrderStatusOption = {
  key: string | null; // null = "Toutes"
  label: string;
  count: number;
  dotClass?: string;
};

export default function OrderStatusFilterMobile({
  options,
  currentStatus,
  currentQ,
}: {
  options: OrderStatusOption[];
  currentStatus?: string;
  currentQ?: string;
}) {
  const [open, setOpen] = useState(false);
  const current =
    options.find((o) => (o.key ?? "") === (currentStatus ?? "")) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const makeHref = (key: string | null) => {
    const params = new URLSearchParams();
    if (key) params.set("status", key);
    if (currentQ) params.set("q", currentQ);
    const qs = params.toString();
    return `/admin/commandes${qs ? "?" + qs : ""}`;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden inline-flex items-center gap-2 w-full px-4 py-2.5 rounded-xl bg-white border border-border text-sm font-medium text-text-primary hover:border-border-dark transition-colors"
      >
        {current.dotClass ? (
          <span className={`w-2 h-2 rounded-full ${current.dotClass} shrink-0`} />
        ) : (
          <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
        )}
        <span className="text-text-muted">Statut&nbsp;:</span>
        <span className="font-semibold text-text-primary truncate">
          {current.label}
        </span>
        <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-bold bg-bg-secondary text-text-secondary">
          {current.count}
        </span>
        <svg
          className="w-4 h-4 text-text-muted ml-auto shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-status-filter-title"
        >
          <button
            type="button"
            aria-label="Fermer"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3
                id="order-status-filter-title"
                className="font-heading text-base font-bold text-text-primary"
              >
                Filtrer par statut
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
                aria-label="Fermer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="py-1 max-h-[70vh] overflow-y-auto">
              {options.map((opt) => {
                const isActive = (opt.key ?? "") === (currentStatus ?? "");
                return (
                  <Link
                    key={opt.key ?? "all"}
                    href={makeHref(opt.key)}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-5 py-3.5 transition-colors ${
                      isActive
                        ? "bg-bg-secondary"
                        : "hover:bg-bg-secondary"
                    }`}
                  >
                    {opt.dotClass ? (
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${opt.dotClass} shrink-0`}
                      />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                    )}
                    <span
                      className={`flex-1 text-sm ${
                        isActive
                          ? "font-semibold text-text-primary"
                          : "text-text-secondary"
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span
                      className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-[11px] font-bold ${
                        isActive
                          ? "bg-text-primary text-text-inverse"
                          : "bg-bg-secondary text-text-secondary"
                      }`}
                    >
                      {opt.count}
                    </span>
                    {isActive && (
                      <svg
                        className="w-4 h-4 text-text-primary shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2.5"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
