"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  checkAnkorstoreProduct,
  pushSingleProductToAnkorstore,
} from "@/app/actions/admin/ankorstore";

interface Props {
  productId: string;
  productReference: string;
  ankorsProductId: string | null;
  ankorsSyncStatus: "synced" | "pending" | "failed" | null;
  ankorsSyncError: string | null;
}

type SyncStatus =
  | "checking"
  | "linked"
  | "found_not_linked"
  | "not_found"
  | "pushing"
  | "push_success"
  | "push_error"
  | "error";

export default function AnkorstoreSyncBanner({
  productId,
  productReference,
  ankorsProductId: initialAnkorsId,
  ankorsSyncStatus,
  ankorsSyncError,
}: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<SyncStatus>(() => {
    if (ankorsSyncStatus === "failed") return "push_error";
    return initialAnkorsId ? "linked" : "checking";
  });
  const [variantCount, setVariantCount] = useState(0);
  const [pushError, setPushError] = useState<string | null>(ankorsSyncError);
  const [ankorsId, setAnkorsId] = useState(initialAnkorsId);
  const [isPushing, startPush] = useTransition();

  const runCheck = useCallback(async () => {
    setStatus("checking");
    setPushError(null);
    try {
      const result = await checkAnkorstoreProduct(productId);
      setVariantCount(result.variantCount);
      if (result.status === "linked") {
        setAnkorsId(result.ankorsProductId);
        setStatus("linked");
      } else if (result.status === "found_not_linked") {
        setStatus("found_not_linked");
      } else if (result.status === "not_found") {
        setStatus("not_found");
      } else {
        setPushError(result.error ?? "Erreur inconnue");
        setStatus("error");
      }
    } catch {
      setStatus("error");
      setPushError("Impossible de contacter Ankorstore");
    }
  }, [productId]);

  useEffect(() => {
    if (!initialAnkorsId && ankorsSyncStatus !== "failed") {
      runCheck();
    }
  }, [initialAnkorsId, ankorsSyncStatus, runCheck]);

  function handlePush() {
    setStatus("pushing");
    setPushError(null);
    startPush(async () => {
      const result = await pushSingleProductToAnkorstore(productId);
      if (result.success) {
        setStatus("push_success");
        setAnkorsId(productReference);
        toast.success("Ankorstore", "Produit synchronisé avec succès.");
      } else {
        setPushError(result.error ?? "Échec du push");
        setStatus("push_error");
        toast.error("Ankorstore", result.error ?? "Échec de la synchronisation.");
      }
    });
  }

  // ── Checking state ──────────────────────────────────────────
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

  // ── Linked / Success ────────────────────────────────────────
  if (status === "linked" || status === "push_success") {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-body">
        <div className="flex items-center gap-2.5">
          <svg className="w-4.5 h-4.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-emerald-800">
            Produit synchronisé sur Ankorstore
            {variantCount > 0 && <span className="text-emerald-600"> — {variantCount} variante{variantCount > 1 ? "s" : ""}</span>}
          </span>
        </div>
        <button
          type="button"
          onClick={handlePush}
          disabled={isPushing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          {isPushing ? "Sync..." : "Re-synchroniser"}
        </button>
      </div>
    );
  }

  // ── Pushing ─────────────────────────────────────────────────
  if (status === "pushing") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-body">
        <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-blue-800">Synchronisation en cours... Cela peut prendre quelques minutes.</span>
      </div>
    );
  }

  // ── Not found on Ankorstore ─────────────────────────────────
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
            disabled={isPushing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors disabled:opacity-50"
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

  // ── Found but not linked ────────────────────────────────────
  if (status === "found_not_linked") {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-body">
        <div className="flex items-center gap-2.5">
          <svg className="w-4.5 h-4.5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.04a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364L16.28 8.688" />
          </svg>
          <span className="text-blue-800">
            Produit trouvé sur Ankorstore ({variantCount} variante{variantCount > 1 ? "s" : ""}) mais pas encore lié
          </span>
        </div>
        <button
          type="button"
          onClick={handlePush}
          disabled={isPushing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
          Synchroniser
        </button>
      </div>
    );
  }

  // ── Push error ──────────────────────────────────────────────
  if (status === "push_error" || status === "error") {
    return (
      <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm font-body space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg className="w-4.5 h-4.5 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            <span className="text-red-800">Échec de la synchronisation Ankorstore</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePush}
              disabled={isPushing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1A1A1A] hover:bg-black rounded-lg transition-colors disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
              Réessayer
            </button>
            <button
              type="button"
              onClick={runCheck}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:text-red-900 border border-red-300 bg-red-100 hover:bg-red-200 rounded-lg transition-colors"
            >
              Vérifier
            </button>
          </div>
        </div>
        {pushError && (
          <p className="text-xs text-red-700 bg-red-100 px-3 py-2 rounded-lg font-mono break-all">
            {pushError}
          </p>
        )}
      </div>
    );
  }

  return null;
}
