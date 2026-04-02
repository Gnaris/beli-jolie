"use client";

import React, { useState, useEffect } from "react";
import { usePfsRefresh, type PfsRefreshItem } from "./PfsRefreshContext";

export default function PfsRefreshWidget() {
  const ctx = usePfsRefresh();
  const queue = ctx?.queue ?? [];
  const clearCompleted = ctx?.clearCompleted ?? (() => {});
  const [minimized, setMinimized] = useState(false);
  const [visible, setVisible] = useState(false);

  // Show widget when queue has items, auto-hide 8s after all done
  useEffect(() => {
    if (queue.length === 0) {
      setVisible(false);
      return;
    }

    setVisible(true);

    const allDone = queue.every((item) => item.status === "success" || item.status === "error");
    if (allDone) {
      const timer = setTimeout(() => setVisible(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [queue]);

  if (!visible || queue.length === 0) return null;

  const inProgress = queue.filter((i) => i.status === "in_progress").length;
  const completed = queue.filter((i) => i.status === "success").length;
  const errors = queue.filter((i) => i.status === "error").length;
  const total = queue.length;
  const allDone = inProgress === 0 && queue.every((i) => i.status !== "queued");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-bg-primary border border-border rounded-2xl shadow-lg overflow-hidden font-body">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 bg-bg-secondary border-b border-border cursor-pointer select-none"
        onClick={() => setMinimized(!minimized)}
      >
        {/* Refresh icon */}
        <svg
          className={`w-4 h-4 text-text-secondary shrink-0 ${inProgress > 0 ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992"
          />
        </svg>
        <span className="text-sm font-medium text-text-primary flex-1">
          Rafraîchissement Paris Fashion Shop
        </span>
        <span className="text-xs text-text-muted">
          {allDone ? `${completed + errors}/${total}` : `${completed}/${total}`}
        </span>
        {/* Minimize chevron */}
        <svg
          className={`w-3.5 h-3.5 text-text-muted transition-transform ${minimized ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Body */}
      {!minimized && (
        <div className="max-h-60 overflow-y-auto">
          {queue.map((item) => (
            <QueueItem key={item.productId} item={item} />
          ))}
        </div>
      )}

      {/* Footer: clear button when all done */}
      {!minimized && allDone && (
        <div className="px-4 py-2 border-t border-border flex justify-end">
          <button
            onClick={() => {
              clearCompleted();
              setVisible(false);
            }}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            Fermer
          </button>
        </div>
      )}
    </div>
  );
}

function QueueItem({ item }: { item: PfsRefreshItem }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-b-0">
      {/* Status icon */}
      <div className="shrink-0">
        {item.status === "queued" && (
          <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {item.status === "in_progress" && (
          <svg className="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {item.status === "success" && (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        {item.status === "error" && (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{item.reference}</p>
        <p className="text-xs text-text-muted truncate">
          {item.status === "queued" && "En attente..."}
          {item.status === "in_progress" && (item.step || "En cours...")}
          {item.status === "success" && "Terminé"}
          {item.status === "error" && (item.error || "Erreur")}
        </p>
      </div>
    </div>
  );
}
