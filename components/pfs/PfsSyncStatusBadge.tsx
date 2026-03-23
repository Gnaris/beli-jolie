"use client";

import { useState, useCallback } from "react";
import { forcePfsSync } from "@/app/actions/admin/pfs-reverse-sync";

interface Props {
  productId: string;
  pfsSyncStatus: "synced" | "pending" | "failed" | null;
  pfsSyncError: string | null;
  pfsSyncedAt: string | null;
}

export default function PfsSyncStatusBadge({ productId, pfsSyncStatus, pfsSyncError, pfsSyncedAt }: Props) {
  const [status, setStatus] = useState(pfsSyncStatus);
  const [error, setError] = useState(pfsSyncError);
  const [syncing, setSyncing] = useState(false);
  const [showError, setShowError] = useState(false);

  const handleForceSync = useCallback(async () => {
    setSyncing(true);
    setStatus("pending");
    setError(null);
    try {
      const result = await forcePfsSync(productId);
      if (result.success) {
        setStatus("synced");
        setError(null);
      } else {
        setStatus("failed");
        setError(result.error ?? "Erreur inconnue");
      }
    } catch (err) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Erreur");
    }
    setSyncing(false);
  }, [productId]);

  if (status === null) {
    // Never synced
    return (
      <button
        onClick={handleForceSync}
        disabled={syncing}
        className="badge badge-neutral text-[11px] cursor-pointer hover:opacity-80 transition-opacity"
        title="Ce produit n'a jamais été synchronisé vers PFS. Cliquez pour synchroniser."
      >
        {syncing ? "Sync PFS..." : "PFS non sync"}
      </button>
    );
  }

  if (status === "pending") {
    return (
      <span className="badge badge-info text-[11px]" title="Synchronisation PFS en cours...">
        PFS sync...
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          onClick={() => setShowError(!showError)}
          className="badge badge-error text-[11px] cursor-pointer hover:opacity-80"
          title={error ?? "Erreur de synchronisation PFS"}
        >
          PFS erreur
        </button>
        <button
          onClick={handleForceSync}
          disabled={syncing}
          className="text-[11px] text-text-secondary hover:text-text-primary transition-colors underline"
          title="Relancer la synchronisation PFS"
        >
          {syncing ? "..." : "Retry"}
        </button>
        {showError && error && (
          <span className="text-[10px] text-red-500 max-w-xs truncate" title={error}>
            {error.slice(0, 80)}
          </span>
        )}
      </span>
    );
  }

  // synced
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="badge badge-success text-[11px]"
        title={pfsSyncedAt ? `Dernière sync : ${new Date(pfsSyncedAt).toLocaleString("fr-FR")}` : "Synchronisé avec PFS"}
      >
        PFS sync
      </span>
      <button
        onClick={handleForceSync}
        disabled={syncing}
        className="text-text-secondary hover:text-text-primary transition-colors"
        title="Forcer la resynchronisation PFS"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </span>
  );
}
