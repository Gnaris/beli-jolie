"use client";

import { useState, useCallback, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { forcePfsSync, checkPfsProductExists } from "@/app/actions/admin/pfs-reverse-sync";
import { markMarketplaceSyncPending } from "@/app/actions/admin/products";
import { useMarketplaceSync } from "@/components/admin/marketplace/MarketplaceSyncOverlay";
import { useProductFormHeader } from "@/components/admin/products/ProductFormHeaderContext";
import { subscribeSSE } from "@/lib/shared-sse";

interface Props {
  productId: string;
  pfsProductId: string | null;
  pfsSyncStatus: "synced" | "pending" | "failed" | "not_found" | null;
  pfsSyncError: string | null;
  pfsSyncedAt: string | null;
  mappingIssues?: string[];
}

type BannerStatus = "synced" | "not_on_pfs" | "creating" | "pushing" | "error" | "mapping_issues" | "checking" | "pending_sync";

export default function PfsSyncBanner({
  productId,
  pfsProductId,
  pfsSyncStatus,
  pfsSyncError,
  pfsSyncedAt,
  mappingIssues,
}: Props) {
  const toast = useToast();
  const { startSync } = useMarketplaceSync();
  const { updateHeader, marketplaceSync: currentSync } = useProductFormHeader();
  const [status, setStatus] = useState<BannerStatus>(() => {
    if (mappingIssues && mappingIssues.length > 0) return "mapping_issues";
    if (pfsSyncStatus === "failed") return "error";
    if (pfsSyncStatus === "synced") return "synced";
    // Already linked in DB → synced
    if (pfsProductId) return "synced";
    // Background sync in progress (just created) → show "syncing" with auto-poll
    if (pfsSyncStatus === "pending") return "pending_sync";
    // Already checked and not found → show "not found" immediately (no API call)
    if (pfsSyncStatus === "not_found") return "not_on_pfs";
    // Never checked → auto-check on mount
    return "checking";
  });
  const [error, setError] = useState<string | null>(pfsSyncError);

  // React to header state changes (e.g. form save triggers sync)
  useEffect(() => {
    if (currentSync?.pfsSyncStatus === "pending" && status !== "pending_sync" && status !== "checking") {
      setStatus("pending_sync");
      setError(null);
    }
  }, [currentSync?.pfsSyncStatus, status]);

  // Auto-check on mount: verify if product exists on PFS
  useEffect(() => {
    if (status !== "checking") return;
    let cancelled = false;
    checkPfsProductExists(productId).then((result) => {
      if (cancelled) return;
      if (result.exists) {
        setStatus("synced");
      } else if (result.error) {
        setError(result.error);
        setStatus("error");
      } else {
        setStatus("not_on_pfs");
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
        const result = await checkPfsProductExists(productId);
        if (cancelled) return;
        if (result.exists) {
          setStatus("synced");
        } else if (result.error) {
          // API error but sync may still be running — keep polling
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [productId, status]);

  // Listen for SSE marketplace sync events (triggered by product save or external sync)
  useEffect(() => {
    const unsub = subscribeSSE((data) => {
      const event = data as {
        type?: string;
        productId?: string;
        marketplaceSync?: { marketplace: string; status: string; error?: string };
      };
      if (event.type !== "MARKETPLACE_SYNC" || event.productId !== productId) return;
      const mp = event.marketplaceSync;
      if (!mp || mp.marketplace !== "pfs") return;

      if (mp.status === "pending" || mp.status === "in_progress") {
        setStatus("pending_sync");
        setError(null);
      } else if (mp.status === "success") {
        setStatus("synced");
        setError(null);
      } else if (mp.status === "error") {
        setError(mp.error ?? "Erreur inconnue");
        setStatus("error");
      }
    });
    return unsub;
  }, [productId]);

  // Helper: update only PFS fields in header badge, preserving Ankorstore state
  const updatePfsSync = useCallback((pfsSyncStatus: "synced" | "pending" | "failed" | null, pfsSyncError: string | null = null) => {
    updateHeader({
      marketplaceSync: {
        ...(currentSync ?? { ankorsSyncStatus: null, ankorsSyncError: null, hasAnkorstoreConfig: false }),
        pfsSyncStatus,
        pfsSyncError,
        hasPfsConfig: true,
      } as import("@/components/admin/products/ProductFormHeaderContext").MarketplaceSyncInfo,
    });
  }, [updateHeader, currentSync]);

  // Créer = activate overlay for real-time progress, then fire sync in background
  const handleCreateOnPfs = useCallback(async () => {
    setStatus("pending_sync");
    setError(null);
    updatePfsSync("pending");
    // Persist "pending" to DB immediately so other pages (product list) see it
    markMarketplaceSyncPending(productId, "pfs").catch(() => {});

    // Start overlay (SSE listener) BEFORE server action — catches early events
    startSync(productId, ["pfs"]);

    try {
      // Step 1: Re-check if product now exists on PFS
      const check = await checkPfsProductExists(productId);
      if (check.exists) {
        const result = await forcePfsSync(productId);
        if (result.success) {
          setStatus("synced");
          updatePfsSync("synced");
        } else {
          setError(result.error ?? "Échec de la mise à jour");
          setStatus("error");
          updatePfsSync("failed", result.error ?? null);
        }
        return;
      }

      // Step 2: Confirmed not found → create (overlay tracks progress via SSE)
      const result = await forcePfsSync(productId, { forceCreate: true });
      if (result.success) {
        setStatus("synced");
        updatePfsSync("synced");
        toast.success("Paris Fashion Shop", "Produit créé avec succès.");
      } else {
        setError(result.error ?? "Erreur lors de la création");
        setStatus("error");
        updatePfsSync("failed", result.error ?? null);
        toast.error("Paris Fashion Shop", result.error ?? "Échec de la création.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setStatus("error");
      updatePfsSync("failed", err instanceof Error ? err.message : "Erreur");
    }
  }, [productId, toast, startSync, updatePfsSync]);

  const handleForceSync = useCallback(async () => {
    setStatus("pending_sync");
    setError(null);
    markMarketplaceSyncPending(productId, "pfs").catch(() => {});
    startSync(productId, ["pfs"]);
    try {
      // Step 1: Check if product exists on PFS
      const check = await checkPfsProductExists(productId);
      if (!check.exists) {
        setError("Le produit n'existe pas sur Paris Fashion Shop. Vous pouvez le créer.");
        setStatus("not_on_pfs");
        toast.error("Paris Fashion Shop", "Produit introuvable sur PFS.");
        return;
      }

      // Step 2: Product exists → sync (overlay tracks progress via SSE)
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
  }, [productId, toast, startSync]);

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

  // ── Checking ───────────────────────────────────────────────
  if (status === "checking") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-gray-600">Vérification sur Paris Fashion Shop...</span>
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
        <span className="text-blue-800">Publication sur Paris Fashion Shop en cours...</span>
      </div>
    );
  }

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
      <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-body space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg className="w-4.5 h-4.5 text-amber-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <span className="text-amber-800">Produit non publié sur Paris Fashion Shop</span>
          </div>
          <button
            type="button"
            onClick={handleCreateOnPfs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Créer sur Paris Fashion Shop
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
