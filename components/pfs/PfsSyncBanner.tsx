"use client";

import { useState, useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { forcePfsSync } from "@/app/actions/admin/pfs-reverse-sync";

interface Props {
  productId: string;
  pfsProductId: string | null;
  pfsSyncStatus: "synced" | "pending" | "failed" | null;
  pfsSyncError: string | null;
  pfsSyncedAt: string | null;
  mappingIssues?: string[];
}

type BannerStatus = "synced" | "not_on_pfs" | "creating" | "pushing" | "error" | "mapping_issues";

export default function PfsSyncBanner({
  productId,
  pfsProductId,
  pfsSyncStatus,
  pfsSyncError,
  pfsSyncedAt,
  mappingIssues,
}: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<BannerStatus>(() => {
    if (mappingIssues && mappingIssues.length > 0) return "mapping_issues";
    if (pfsSyncStatus === "failed") return "error";
    if (pfsProductId) return "synced";
    return "not_on_pfs";
  });
  const [error, setError] = useState<string | null>(pfsSyncError);

  const handleCreateOnPfs = useCallback(async () => {
    setStatus("creating");
    setError(null);
    try {
      const result = await forcePfsSync(productId);
      if (result.success) {
        setStatus("synced");
        toast.success("Paris Fashion Shop", "Produit créé avec succès.");
        window.location.reload();
      } else {
        setError(result.error ?? "Erreur lors de la création");
        setStatus("error");
        toast.error("Paris Fashion Shop", result.error ?? "Échec de la création.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
    }
  }, [productId, toast]);

  const handleForceSync = useCallback(async () => {
    setStatus("pushing");
    setError(null);
    try {
      const result = await forcePfsSync(productId);
      if (result.success) {
        setStatus("synced");
        toast.success("Paris Fashion Shop", "Produit publié avec succès.");
      } else {
        setError(result.error ?? "Échec de la publication");
        setStatus("error");
        toast.error("Paris Fashion Shop", result.error ?? "Échec de la publication.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
    }
  }, [productId, toast]);

  // ── Render helper: relative time ──
  const relativeTime = pfsSyncedAt
    ? (() => {
        const diff = Date.now() - new Date(pfsSyncedAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "à l'instant";
        if (mins < 60) return `il y a ${mins}min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `il y a ${hours}h`;
        const days = Math.floor(hours / 24);
        return `il y a ${days}j`;
      })()
    : null;

  // ── Mapping issues ─────────────────────────────────────────
  if (status === "mapping_issues" && mappingIssues) {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-body">
        <div className="flex items-center gap-2.5">
          <svg className="w-4.5 h-4.5 text-amber-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <div>
            <span className="text-amber-800">Publication Paris Fashion Shop impossible</span>
            <span className="text-amber-600 text-xs ml-2">
              {mappingIssues.length} entit{mappingIssues.length > 1 ? "és" : "é"} sans correspondance
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Synced ─────────────────────────────────────────────────
  if (status === "synced") {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-body">
        <div className="flex items-center gap-2.5">
          <svg className="w-4.5 h-4.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-emerald-800">Produit publié sur Paris Fashion Shop</span>
          {relativeTime && (
            <span className="text-emerald-600 text-xs">— {relativeTime}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handleForceSync}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Re-publier
        </button>
      </div>
    );
  }

  // ── Not on PFS ─────────────────────────────────────────────
  if (status === "not_on_pfs") {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-body">
        <div className="flex items-center gap-2.5">
          <svg className="w-4.5 h-4.5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="text-blue-800">Produit absent de Paris Fashion Shop</span>
        </div>
        <button
          type="button"
          onClick={handleCreateOnPfs}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Publier sur Paris Fashion Shop
        </button>
      </div>
    );
  }

  // ── Creating ───────────────────────────────────────────────
  if (status === "creating") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-blue-800">Création sur Paris Fashion Shop en cours...</span>
      </div>
    );
  }

  // ── Pushing ────────────────────────────────────────────────
  if (status === "pushing") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-blue-800">Publication en cours... Cela peut prendre quelques minutes.</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm font-body space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg className="w-4.5 h-4.5 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800">Échec de la publication Paris Fashion Shop</span>
          </div>
          <button
            type="button"
            onClick={pfsProductId ? handleForceSync : handleCreateOnPfs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Réessayer
          </button>
        </div>
        {error && (
          <p className="text-xs text-red-700 bg-red-100 px-3 py-2 rounded-lg font-mono break-all">
            {error}
          </p>
        )}
      </div>
    );
  }

  return null;
}
