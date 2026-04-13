"use client";

import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { pushSingleProductToAnkorstore, checkAnkorstoreProductExists } from "@/app/actions/admin/ankorstore";
import { markMarketplaceSyncPending } from "@/app/actions/admin/products";
import { useMarketplaceSync } from "@/components/admin/marketplace/MarketplaceSyncOverlay";
import { useProductFormHeader } from "@/components/admin/products/ProductFormHeaderContext";

interface Props {
  productId: string;
  productReference: string;
  ankorsProductId: string | null;
  ankorsSyncStatus: "synced" | "pending" | "failed" | "not_found" | null;
  ankorsSyncError: string | null;
  ankorsSyncedAt?: string | null;
}

type BannerStatus = "synced" | "not_found" | "pushing" | "error" | "checking" | "pending_sync";

export default function AnkorstoreSyncBanner({
  productId,
  ankorsProductId,
  ankorsSyncStatus,
  ankorsSyncError,
  ankorsSyncedAt,
}: Props) {
  const toast = useToast();
  const { startSync } = useMarketplaceSync();
  const { updateHeader, marketplaceSync: currentSync } = useProductFormHeader();
  const [status, setStatus] = useState<BannerStatus>(() => {
    if (ankorsSyncStatus === "failed") return "error";
    if (ankorsSyncStatus === "synced") return "synced";
    // Already linked in DB → synced
    if (ankorsProductId) return "synced";
    // Background sync in progress (just created) → show "syncing" with auto-poll
    if (ankorsSyncStatus === "pending") return "pending_sync";
    // Already checked and not found → show "not found" immediately (no API call)
    if (ankorsSyncStatus === "not_found") return "not_found";
    // Never checked → auto-check on mount
    return "checking";
  });
  const [error, setError] = useState<string | null>(ankorsSyncError);

  // Auto-check on mount: verify if product exists on Ankorstore
  useEffect(() => {
    if (status !== "checking") return;
    let cancelled = false;
    checkAnkorstoreProductExists(productId).then((result) => {
      if (cancelled) return;
      if (result.exists) {
        setStatus("synced");
      } else if (result.error) {
        // API error (auth, network, etc.) — show error, not "not found"
        setError(result.error);
        setStatus("error");
      } else {
        setStatus("not_found");
      }
    }).catch((err) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : "Erreur de vérification");
      setStatus("error");
    });
    return () => { cancelled = true; };
  }, [productId, status]);

  // Poll while pending_sync: check every 3s until sync completes
  useEffect(() => {
    if (status !== "pending_sync") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const result = await checkAnkorstoreProductExists(productId);
        if (cancelled) return;
        if (result.exists) {
          setStatus("synced");
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [productId, status]);

  // Helper: update only Ankorstore fields in header badge, preserving PFS state
  const updateAnkorsSync = useCallback((ankorsSyncStatus: "synced" | "pending" | "failed" | null, ankorsSyncError: string | null = null) => {
    updateHeader({
      marketplaceSync: {
        ...(currentSync ?? { pfsSyncStatus: null, pfsSyncError: null, hasPfsConfig: false }),
        ankorsSyncStatus,
        ankorsSyncError,
        hasAnkorstoreConfig: true,
      } as import("@/components/admin/products/ProductFormHeaderContext").MarketplaceSyncInfo,
    });
  }, [updateHeader, currentSync]);

  // Re-publier = activate overlay, then sync in background
  const handlePush = useCallback(async () => {
    setStatus("pending_sync");
    setError(null);
    updateAnkorsSync("pending");
    // Persist "pending" to DB immediately so other pages see it
    markMarketplaceSyncPending(productId, "ankorstore").catch(() => {});
    startSync(productId, ["ankorstore"]);
    try {
      const check = await checkAnkorstoreProductExists(productId);
      if (!check.exists) {
        setError("Le produit n'existe pas sur Ankorstore. Vous pouvez le créer.");
        setStatus("not_found");
        updateAnkorsSync(null);
        toast.error("Ankorstore", "Produit introuvable sur Ankorstore.");
        return;
      }

      const result = await pushSingleProductToAnkorstore(productId);
      if (result.success) {
        setStatus("synced");
        updateAnkorsSync("synced");
        toast.success("Ankorstore", "Produit publié sur Ankorstore avec succès.");
      } else {
        setError(result.error ?? "Échec de la publication");
        setStatus("error");
        updateAnkorsSync("failed", result.error ?? null);
        toast.error("Ankorstore", result.error ?? "Échec de la publication sur Ankorstore.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
      updateAnkorsSync("failed", err instanceof Error ? err.message : "Erreur");
    }
  }, [productId, toast, startSync, updateAnkorsSync]);

  // Créer = activate overlay for real-time progress, then fire sync in background
  const handleCreate = useCallback(async () => {
    setStatus("pending_sync");
    setError(null);
    updateAnkorsSync("pending");
    // Persist "pending" to DB immediately so other pages (product list) see it
    markMarketplaceSyncPending(productId, "ankorstore").catch(() => {});

    // Start overlay (SSE listener) BEFORE server action
    startSync(productId, ["ankorstore"]);

    try {
      const check = await checkAnkorstoreProductExists(productId);
      if (check.exists) {
        const result = await pushSingleProductToAnkorstore(productId);
        if (result.success) {
          setStatus("synced");
          updateAnkorsSync("synced");
          toast.success("Ankorstore", "Produit trouvé et mis à jour sur Ankorstore.");
        } else {
          setError(result.error ?? "Échec de la mise à jour");
          setStatus("error");
          updateAnkorsSync("failed", result.error ?? null);
        }
        return;
      }

      const result = await pushSingleProductToAnkorstore(productId, { forceCreate: true });
      if (result.success) {
        setStatus("synced");
        updateAnkorsSync("synced");
        toast.success("Ankorstore", "Produit créé sur Ankorstore avec succès.");
      } else {
        setError(result.error ?? "Échec de la création");
        setStatus("error");
        updateAnkorsSync("failed", result.error ?? null);
        toast.error("Ankorstore", result.error ?? "Échec de la création sur Ankorstore.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
      updateAnkorsSync("failed", err instanceof Error ? err.message : "Erreur");
    }
  }, [productId, toast, startSync, updateAnkorsSync]);

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
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-gray-600">Vérification sur Ankorstore...</span>
      </div>
    );
  }

  // ── Pending sync (background task in progress) ─────────────
  if (status === "pending_sync") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-blue-800">Publication sur Ankorstore en cours...</span>
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
            <span className="text-emerald-600 text-xs">— {relativeTime}</span>
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

  // ── Not found ──────────────────────────────────────────────
  if (status === "not_found") {
    return (
      <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-body space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg className="w-4.5 h-4.5 text-amber-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="text-amber-800">Produit non publié sur Ankorstore</span>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Créer sur Ankorstore
          </button>
        </div>
        {error && (
          <p className="text-xs text-amber-700 bg-amber-100 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}
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
          <button
            type="button"
            onClick={handlePush}
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
