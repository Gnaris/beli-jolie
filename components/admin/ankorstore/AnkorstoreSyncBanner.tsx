"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { pushSingleProductToAnkorstore } from "@/app/actions/admin/ankorstore";
import AnkorstoreLiveCompareModal from "./AnkorstoreLiveCompareModal";

interface Props {
  productId: string;
  productReference: string;
  ankorsProductId: string | null;
  ankorsSyncStatus: "synced" | "pending" | "failed" | null;
  ankorsSyncError: string | null;
  ankorsSyncedAt?: string | null;
}

type BannerStatus =
  | "checking"
  | "synced"
  | "has_diffs"
  | "not_found"
  | "pushing"
  | "error";

export default function AnkorstoreSyncBanner({
  productId,
  productReference: _productReference,
  ankorsProductId: initialAnkorsId,
  ankorsSyncStatus,
  ankorsSyncError,
  ankorsSyncedAt,
}: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<BannerStatus>(() => {
    if (ankorsSyncStatus === "failed") return "error";
    return initialAnkorsId ? "checking" : "not_found";
  });
  const [error, setError] = useState<string | null>(ankorsSyncError);
  const [diffCount, setDiffCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cachedData = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runCheck = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("checking");
    setError(null);

    try {
      const res = await fetch(`/api/admin/ankorstore/live-check/${productId}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 400 && (data?.notLinked || data?.notOnAnkorstore)) {
          setStatus("not_found");
          return;
        }
        throw new Error(data?.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json();
      cachedData.current = data;
      if (!data.hasDifferences) {
        setStatus("synced");
        setDiffCount(0);
      } else {
        setDiffCount(data.differences?.length ?? 0);
        setStatus("has_diffs");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [productId]);

  const handlePush = useCallback(async () => {
    setStatus("pushing");
    setError(null);
    try {
      const result = await pushSingleProductToAnkorstore(productId);
      if (result.success) {
        setStatus("synced");
        setDiffCount(0);
        cachedData.current = null;
        toast.success("Ankorstore", "Produit publié sur Ankorstore avec succès.");
      } else {
        setError(result.error ?? "Échec de la publication");
        setStatus("error");
        toast.error("Ankorstore", result.error ?? "Échec de la publication sur Ankorstore.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
    }
  }, [productId, toast]);

  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    cachedData.current = null;
    if (initialAnkorsId) runCheck();
  }, [initialAnkorsId, runCheck]);

  // Auto-check on mount if product is on Ankorstore
  useEffect(() => {
    if (!initialAnkorsId) return;
    if (ankorsSyncStatus === "failed") return;
    const timer = setTimeout(() => runCheck(), 300);
    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, initialAnkorsId]);

  // ── Render helper: relative time ──
  const relativeTime = ankorsSyncedAt
    ? (() => {
        const diff = Date.now() - new Date(ankorsSyncedAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "à l'instant";
        if (mins < 60) return `il y a ${mins}min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `il y a ${hours}h`;
        const days = Math.floor(hours / 24);
        return `il y a ${days}j`;
      })()
    : null;

  // ── Checking ───────────────────────────────────────────────
  if (status === "checking") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border border-border rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-text-muted" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-text-secondary">Vérification du statut Ankorstore...</span>
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
          <span className="text-emerald-800">Produit publié sur Ankorstore</span>
          {relativeTime && (
            <span className="text-emerald-600 text-xs">— sync {relativeTime}</span>
          )}
        </div>
        <button
          type="button"
          onClick={handlePush}
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

  // ── Has differences ────────────────────────────────────────
  if (status === "has_diffs") {
    return (
      <>
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-body">
          <div className="flex items-center gap-2.5">
            <svg className="w-4.5 h-4.5 text-amber-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="text-amber-800">Des différences détectées avec Ankorstore</span>
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-amber-200 text-amber-800 rounded-full">
              {diffCount} différence{diffCount > 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Voir les différences
            </button>
            <button
              type="button"
              onClick={handlePush}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
              Re-publier tout
            </button>
          </div>
        </div>

        <AnkorstoreLiveCompareModal
          productId={productId}
          initialData={cachedData.current}
          open={modalOpen}
          onClose={handleModalClose}
        />
      </>
    );
  }

  // ── Not found on Ankorstore ────────────────────────────────
  if (status === "not_found") {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-body">
        <div className="flex items-center gap-2.5">
          <svg className="w-4.5 h-4.5 text-amber-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <span className="text-amber-800">Produit non trouvé sur Ankorstore</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePush}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Créer sur Ankorstore
          </button>
          <button
            type="button"
            onClick={runCheck}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 border border-amber-300 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            title="Re-vérifier"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
            Vérifier
          </button>
        </div>
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
        <span className="text-blue-800">Publication sur Ankorstore en cours... Cela peut prendre quelques minutes.</span>
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
            <span className="text-red-800">Échec de la publication sur Ankorstore</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={initialAnkorsId ? runCheck : handlePush}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Réessayer
            </button>
          </div>
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
