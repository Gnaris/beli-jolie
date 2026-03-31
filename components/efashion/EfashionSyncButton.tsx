"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { forceEfashionSync } from "@/app/actions/admin/efashion-reverse-sync";

interface EfashionSyncButtonProps {
  productId: string;
  efashionProductId: number | null;
}

export default function EfashionSyncButton({
  productId,
  efashionProductId,
}: EfashionSyncButtonProps) {
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notOnEfashion, setNotOnEfashion] = useState(false);
  const [noDiffs, setNoDiffs] = useState(false);
  const [hasDiffs, setHasDiffs] = useState(false);
  const [autoChecked, setAutoChecked] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChecking(true);
    setError(null);
    setNotOnEfashion(false);
    setNoDiffs(false);
    setHasDiffs(false);

    try {
      const res = await fetch(
        `/api/admin/efashion-sync/live-check/${productId}`,
        { signal: controller.signal }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }

      const data = await res.json();

      if (!data.exists) {
        setNotOnEfashion(true);
        return;
      }

      if (!data.hasDifferences) {
        setNoDiffs(true);
        setHasDiffs(false);
      } else {
        setHasDiffs(true);
        setNoDiffs(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) {
        setChecking(false);
      }
    }
  }, [productId]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await forceEfashionSync(productId);
      if (result.success) {
        // Re-check after sync
        await handleCheck();
      } else {
        setError(result.error ?? "Erreur lors de la synchronisation");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSyncing(false);
    }
  }, [productId, handleCheck]);

  // Auto-check on mount
  useEffect(() => {
    if (!efashionProductId) return;

    const timer = setTimeout(() => {
      setAutoChecked(false);
      handleCheck().then(() => setAutoChecked(true));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, efashionProductId]);

  // ── Checking in progress ──
  if (checking) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium bg-bg-secondary text-text-muted border border-border min-h-[36px]">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted/30 border-t-text-muted" />
          Vérification eFashion…
        </span>
      </span>
    );
  }

  // ── No differences — synced ──
  if (noDiffs) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#22C55E]/10 text-[#16A34A] border border-[#22C55E]/30 min-h-[36px]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22C55E]" />
          </span>
          eFashion synchronisé
        </span>
        <button
          onClick={() => {
            setNoDiffs(false);
            setAutoChecked(false);
            handleCheck().then(() => setAutoChecked(true));
          }}
          disabled={checking}
          className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
          aria-label="Revérifier"
          title="Revérifier la synchronisation eFashion"
        >
          <SyncIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // ── Differences found ──
  if (hasDiffs) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] border border-[#F59E0B]/30 min-h-[36px]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F59E0B] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F59E0B]" />
          </span>
          Sync eFashion nécessaire
        </span>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#8B5CF6] text-white hover:bg-[#7C3AED] transition-colors disabled:opacity-50 min-h-[36px]"
          title="Forcer la synchronisation vers eFashion"
        >
          {syncing ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-white" />
          ) : (
            <SyncIcon className="h-3 w-3" />
          )}
          {syncing ? "Sync…" : "Forcer la sync"}
        </button>
        <button
          onClick={() => {
            setHasDiffs(false);
            setAutoChecked(false);
            handleCheck().then(() => setAutoChecked(true));
          }}
          className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
          aria-label="Revérifier"
          title="Revérifier la synchronisation eFashion"
        >
          <SyncIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // ── Not on eFashion ──
  if (notOnEfashion) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="badge badge-neutral text-[11px]">Absent d&apos;eFashion</span>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#8B5CF6] text-white hover:bg-[#7C3AED] transition-colors disabled:opacity-50 min-h-[36px]"
        >
          {syncing ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-white" />
          ) : (
            <PlusIcon className="h-3 w-3" />
          )}
          {syncing ? "Création…" : "Créer sur eFashion"}
        </button>
      </span>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-red-500/10 text-red-600 border border-red-500/30 min-h-[36px]"
          title={error}
        >
          <XIcon className="h-3 w-3" />
          Erreur eFashion
        </span>
        <button
          onClick={() => {
            setError(null);
            setAutoChecked(false);
            handleCheck().then(() => setAutoChecked(true));
          }}
          className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
          aria-label="Réessayer"
          title="Réessayer la vérification eFashion"
        >
          <SyncIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // ── Initial state / waiting for auto-check ──
  if (!autoChecked && efashionProductId) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium bg-bg-secondary text-text-muted border border-border min-h-[36px]">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted/30 border-t-text-muted" />
          Vérification eFashion…
        </span>
      </span>
    );
  }

  // ── Fallback: no efashionProductId ──
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={() => {
          setAutoChecked(false);
          handleCheck().then(() => setAutoChecked(true));
        }}
        disabled={checking}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium border border-border bg-bg-secondary text-text-secondary hover:bg-border hover:text-text-primary transition-all disabled:opacity-50 min-h-[36px]"
        title="Comparer avec eFashion et synchroniser"
        aria-label="Synchroniser avec eFashion"
      >
        <SyncIcon className="h-3.5 w-3.5" />
        Sync eFashion
      </button>
    </span>
  );
}

// ── Icons ──

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
