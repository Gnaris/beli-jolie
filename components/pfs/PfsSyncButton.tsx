"use client";

import { useState, useCallback, useRef } from "react";
import PfsLiveCompareModal from "./PfsLiveCompareModal";
import { forcePfsSync } from "@/app/actions/admin/pfs-reverse-sync";

interface PfsSyncButtonProps {
  productId: string;
  pfsProductId: string | null;
  pfsSyncStatus: "synced" | "pending" | "failed" | null;
  pfsSyncError: string | null;
  pfsSyncedAt: string | null;
}

export default function PfsSyncButton({
  productId,
  pfsProductId,
  pfsSyncStatus,
  pfsSyncError,
}: PfsSyncButtonProps) {
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notOnPfs, setNotOnPfs] = useState(false);
  const [noDiffs, setNoDiffs] = useState(false);
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

      if (data.hasDifferences) {
        setModalOpen(true);
      } else {
        setNoDiffs(true);
        setSyncStatus("synced");
        // Auto-hide after 3s
        setTimeout(() => setNoDiffs(false), 3000);
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

  // ── Badge + button rendering ──
  const getBadge = () => {
    if (noDiffs) {
      return (
        <span className="badge badge-success text-[11px] animate-fadeIn">
          PFS synchronisé
        </span>
      );
    }
    if (syncStatus === "failed" && syncError) {
      return (
        <span
          className="badge badge-error text-[11px] cursor-help"
          title={syncError}
        >
          PFS erreur
        </span>
      );
    }
    if (syncStatus === "synced" && !pfsProductId) {
      return (
        <span className="badge badge-success text-[11px]">
          PFS sync
        </span>
      );
    }
    return null;
  };

  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        {getBadge()}

        <button
          onClick={handleSync}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium border border-border bg-bg-secondary text-text-secondary hover:bg-border hover:text-text-primary transition-all disabled:opacity-50 min-h-[36px]"
          title="Comparer avec PFS et synchroniser"
          aria-label="Synchroniser avec PFS"
        >
          <SyncIcon className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Vérification..." : "Sync PFS"}
        </button>

        {error && (
          <span className="text-[10px] text-red-500 max-w-xs truncate animate-fadeIn" title={error}>
            {error.slice(0, 60)}
          </span>
        )}
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
