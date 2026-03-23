"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import PfsLiveCompareModal from "./PfsLiveCompareModal";

interface PfsLiveSyncBannerProps {
  productId: string;
}

export default function PfsLiveSyncBanner({ productId }: PfsLiveSyncBannerProps) {
  const [checking, setChecking] = useState(false);
  const [hasDifferences, setHasDifferences] = useState(false);
  const [diffCount, setDiffCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  // Cache API response to avoid double fetch when modal opens
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedData = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const checkSync = useCallback(async () => {
    // Abort any in-flight request
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

  // Auto-check on mount
  useEffect(() => {
    checkSync();
    return () => abortRef.current?.abort();
  }, [checkSync]);

  // Don't render anything while initial check is running
  if (checking && !checked) {
    return (
      <div className="mb-4 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 px-4 py-3 flex items-center gap-3 animate-fadeIn">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#F59E0B]/30 border-t-[#F59E0B] shrink-0" />
        <span className="text-sm text-[#F59E0B] font-[family-name:var(--font-roboto)]">
          Vérification de la synchronisation PFS...
        </span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="mb-4 rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/5 px-4 py-3 flex items-center justify-between gap-3 animate-fadeIn">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 text-[#EF4444] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="text-sm text-[#EF4444] font-[family-name:var(--font-roboto)]">
            Synchronisation PFS : {error}
          </span>
        </div>
        <button
          onClick={checkSync}
          disabled={checking}
          className="text-xs font-medium text-[#EF4444] hover:text-[#DC2626] transition-colors shrink-0 underline underline-offset-2"
        >
          Réessayer
        </button>
      </div>
    );
  }

  // No differences — show success briefly then hide
  if (checked && !hasDifferences) {
    return (
      <div className="mb-4 rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-4 py-3 flex items-center gap-3 animate-fadeIn">
        <svg className="h-5 w-5 text-[#22C55E] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="22 4 12 14.01 9 11.01" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-sm text-[#22C55E] font-[family-name:var(--font-roboto)]">
          Produit synchronisé avec PFS — aucune différence détectée
        </span>
      </div>
    );
  }

  // Differences found — show warning banner
  if (checked && hasDifferences) {
    return (
      <>
        <div className="mb-4 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/5 px-4 py-3 flex items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-3">
            <svg className="h-5 w-5 text-[#F59E0B] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <span className="text-sm font-medium text-[#F59E0B] font-[family-name:var(--font-roboto)]">
                {diffCount} différence{diffCount > 1 ? "s" : ""} détectée{diffCount > 1 ? "s" : ""} avec PFS
              </span>
              <p className="text-xs text-text-secondary mt-0.5">
                Ce produit a des données différentes sur Paris Fashion Shop
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={checkSync}
              disabled={checking}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-text-secondary border border-border hover:bg-border transition-all min-h-[36px]"
              aria-label="Revérifier"
            >
              <svg className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
              </svg>
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium bg-[#F59E0B] text-white border border-[#F59E0B] hover:bg-[#D97706] transition-all min-h-[36px]"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Comparer
            </button>
          </div>
        </div>

        <PfsLiveCompareModal
          productId={productId}
          initialData={cachedData.current}
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            // Re-check after closing modal (changes may have been applied)
            checkSync();
          }}
        />
      </>
    );
  }

  return null;
}
