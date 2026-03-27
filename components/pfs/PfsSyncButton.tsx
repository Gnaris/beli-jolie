"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import PfsLiveCompareModal from "./PfsLiveCompareModal";
import { forcePfsSync } from "@/app/actions/admin/pfs-reverse-sync";

interface PfsSyncButtonProps {
  productId: string;
  pfsProductId: string | null;
  pfsSyncStatus: "synced" | "pending" | "failed" | null;
  pfsSyncError: string | null;
  pfsSyncedAt: string | null;
  mappingIssues?: string[];
}

export default function PfsSyncButton({
  productId,
  pfsProductId,
  pfsSyncStatus,
  pfsSyncError,
  mappingIssues,
}: PfsSyncButtonProps) {
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notOnPfs, setNotOnPfs] = useState(false);
  const [noDiffs, setNoDiffs] = useState(false);
  const [hasDiffs, setHasDiffs] = useState(false);
  const [autoChecked, setAutoChecked] = useState(false);
  const [syncStatus, setSyncStatus] = useState(pfsSyncStatus);
  const [syncError, setSyncError] = useState(pfsSyncError);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedData = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSync = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChecking(true);
    setError(null);
    setNotOnPfs(false);
    setNoDiffs(false);

    try {
      const res = await fetch(`/api/admin/pfs-sync/live-check/${productId}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        // Product not on PFS
        if (res.status === 400 && data?.notOnPfs) {
          setNotOnPfs(true);
          setChecking(false);
          return;
        }
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }

      const data = await res.json();
      cachedData.current = data;

      if (!data.hasDifferences) {
        // No differences — show green status, don't open modal
        setNoDiffs(true);
        setHasDiffs(false);
        setSyncStatus("synced");
      } else {
        setHasDiffs(true);
        setNoDiffs(false);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Only update state if this controller is still the active one
      if (abortRef.current === controller) {
        setChecking(false);
      }
    }
  }, [productId]);

  const handleCreateOnPfs = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const result = await forcePfsSync(productId);
      if (result.success) {
        setSyncStatus("synced");
        setNotOnPfs(false);
        // After creation, reload to get pfsProductId
        window.location.reload();
      } else {
        setSyncStatus("failed");
        setSyncError(result.error ?? "Erreur inconnue");
        setError(result.error ?? "Erreur lors de la création sur PFS");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  }, [productId]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    cachedData.current = null;
  }, []);

  // ── Auto-check on mount (always) ──
  useEffect(() => {
    if (!pfsProductId || (mappingIssues && mappingIssues.length > 0)) return;

    // Small delay to not block page render
    const timer = setTimeout(() => {
      setAutoChecked(false);
      handleSync().then(() => setAutoChecked(true));
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, pfsProductId]);

  // ── Mappings PFS absents — synchronisation bloquée ──
  if (mappingIssues && mappingIssues.length > 0) {
    const tooltip = `Synchronisation PFS impossible.\n\nEntité(s) sans mapping :\n${mappingIssues.map((i) => `• ${i}`).join("\n")}`;
    return (
      <span className="inline-flex items-center gap-1.5 animate-fadeIn" title={tooltip}>
        <span className="badge badge-warning text-[11px]">Sync PFS impossible</span>
        <span className="text-[10px] text-text-muted cursor-help">
          — {mappingIssues.length} entité{mappingIssues.length > 1 ? "s" : ""} non mappée{mappingIssues.length > 1 ? "s" : ""}
        </span>
      </span>
    );
  }

  // ── "Create on PFS" state ──
  if (notOnPfs) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="badge badge-neutral text-[11px]">Absent de PFS</span>
        <button
          onClick={handleCreateOnPfs}
          disabled={creating}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#22C55E] text-white hover:bg-[#16A34A] transition-colors disabled:opacity-50 min-h-[36px]"
        >
          {creating ? (
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/50 border-t-white" />
          ) : (
            <PlusIcon className="h-3 w-3" />
          )}
          {creating ? "Création..." : "Créer sur PFS"}
        </button>
        <button
          onClick={() => { setNotOnPfs(false); setError(null); }}
          className="p-2 -m-1 text-text-muted hover:text-text-primary transition-colors rounded-lg"
          aria-label="Fermer"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // ── Rendering ──

  // Checking in progress — show spinner animation
  if (checking) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium bg-bg-secondary text-text-muted border border-border min-h-[36px]">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted/30 border-t-text-muted" />
          Vérification PFS…
        </span>
      </span>
    );
  }

  // No differences — show green synced status
  if (noDiffs) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#22C55E]/10 text-[#16A34A] border border-[#22C55E]/30 min-h-[36px]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22C55E]" />
          </span>
          PFS synchronisé
        </span>
        <button
          onClick={() => { setNoDiffs(false); setAutoChecked(false); handleSync().then(() => setAutoChecked(true)); }}
          disabled={checking}
          className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
          aria-label="Revérifier"
          title="Revérifier la synchronisation"
        >
          <SyncIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // Differences found — show yellow "Synchronisation nécessaire"
  if (hasDiffs) {
    return (
      <>
        <span className="inline-flex items-center gap-2 animate-fadeIn">
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-[#F59E0B]/10 text-[#D97706] border border-[#F59E0B]/30 hover:bg-[#F59E0B]/20 transition-colors cursor-pointer min-h-[36px]"
            title="Cliquer pour voir les différences"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F59E0B] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F59E0B]" />
            </span>
            Synchronisation nécessaire
          </button>
          <button
            onClick={() => { setHasDiffs(false); setAutoChecked(false); handleSync().then(() => setAutoChecked(true)); }}
            className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
            aria-label="Revérifier"
            title="Revérifier la synchronisation"
          >
            <SyncIcon className="h-3.5 w-3.5" />
          </button>
        </span>

        <PfsLiveCompareModal
          productId={productId}
          initialData={cachedData.current}
          open={modalOpen}
          onClose={handleModalClose}
        />
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium bg-red-500/10 text-red-600 border border-red-500/30 min-h-[36px]" title={error}>
          <XIcon className="h-3 w-3" />
          Erreur PFS
        </span>
        <button
          onClick={() => { setError(null); setAutoChecked(false); handleSync().then(() => setAutoChecked(true)); }}
          className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
          aria-label="Réessayer"
          title="Réessayer la vérification"
        >
          <SyncIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // Failed sync status from DB
  if (syncStatus === "failed" && syncError) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="badge badge-error text-[11px] cursor-help" title={syncError}>
          PFS erreur
        </span>
        <button
          onClick={() => { setAutoChecked(false); handleSync().then(() => setAutoChecked(true)); }}
          className="p-1 text-text-muted hover:text-text-primary transition-colors rounded"
          aria-label="Revérifier"
        >
          <SyncIcon className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  // Initial state before auto-check completes (or no pfsProductId)
  if (!autoChecked && pfsProductId) {
    return (
      <span className="inline-flex items-center gap-2 animate-fadeIn">
        <span className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium bg-bg-secondary text-text-muted border border-border min-h-[36px]">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted/30 border-t-text-muted" />
          Vérification PFS…
        </span>
      </span>
    );
  }

  // Fallback: no pfsProductId or synced without pfsProductId
  return (
    <span className="inline-flex items-center gap-1.5">
      {syncStatus === "synced" && !pfsProductId && (
        <span className="badge badge-success text-[11px]">PFS sync</span>
      )}
      <button
        onClick={() => { setAutoChecked(false); handleSync().then(() => setAutoChecked(true)); }}
        disabled={checking}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium border border-border bg-bg-secondary text-text-secondary hover:bg-border hover:text-text-primary transition-all disabled:opacity-50 min-h-[36px]"
        title="Comparer avec PFS et synchroniser"
        aria-label="Synchroniser avec PFS"
      >
        <SyncIcon className="h-3.5 w-3.5" />
        Sync PFS
      </button>
    </span>
  );
}

// ── Icons ──

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
