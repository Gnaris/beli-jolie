"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PfsLiveCompareModal from "./PfsLiveCompareModal";

interface PfsLiveSyncBadgeProps {
  productId: string;
}

export default function PfsLiveSyncBadge({ productId }: PfsLiveSyncBadgeProps) {
  const [checking, setChecking] = useState(false);
  const [hasDifferences, setHasDifferences] = useState(false);
  const [diffCount, setDiffCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedData = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkSync = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChecking(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/pfs-sync/live-check/${productId}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      cachedData.current = data;
      setHasDifferences(data.hasDifferences);
      setDiffCount(data.differences?.length ?? 0);
      setChecked(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setChecked(true);
    } finally {
      setChecking(false);
    }
  }, [productId]);

  useEffect(() => {
    checkSync();
    return () => abortRef.current?.abort();
  }, [checkSync]);

  // --- Checking state (initial) ---
  if (checking && !checked) {
    return (
      <span className="badge badge-warning animate-fadeIn">
        Synchronisation PFS…
      </span>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 animate-fadeIn">
        <span className="badge badge-error" title={error}>PFS erreur</span>
        <button
          onClick={checkSync}
          disabled={checking}
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary border border-border transition-all"
          aria-label="Réessayer la synchronisation PFS"
        >
          <svg className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </button>
      </span>
    );
  }

  // --- Synced (no differences) ---
  if (checked && !hasDifferences) {
    return (
      <span className="inline-flex items-center gap-1.5 animate-fadeIn">
        <span className="badge badge-success">PFS synchronisé</span>
        <button
          onClick={checkSync}
          disabled={checking}
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary border border-border transition-all"
          aria-label="Revérifier la synchronisation PFS"
        >
          <svg className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </button>
      </span>
    );
  }

  // --- Differences found ---
  if (checked && hasDifferences) {
    return (
      <>
        <span className="inline-flex items-center gap-1.5 animate-fadeIn">
          <button
            onClick={() => setModalOpen(true)}
            className="badge badge-warning cursor-pointer hover:opacity-80 transition-opacity"
            title={`${diffCount} différence${diffCount > 1 ? "s" : ""} avec PFS — cliquer pour comparer`}
          >
            {diffCount} diff. PFS
          </button>
          <button
            onClick={checkSync}
            disabled={checking}
            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-secondary border border-border transition-all"
            aria-label="Revérifier la synchronisation PFS"
          >
            <svg className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        </span>

        <PfsLiveCompareModal
          productId={productId}
          initialData={cachedData.current}
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            checkSync();
          }}
        />
      </>
    );
  }

  return null;
}
