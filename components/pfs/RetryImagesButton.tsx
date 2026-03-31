"use client";

import { useState } from "react";
import { retryProductImages } from "@/app/actions/admin/products";
import { useToast } from "@/components/ui/Toast";

export default function RetryImagesButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false);
  const toastCtx = useToast();

  const handleRetry = async () => {
    setLoading(true);
    try {
      const result = await retryProductImages(productId);
      if (result.success) {
        toastCtx.success(`${result.downloaded} image(s) téléchargée(s) avec succès`);
        // Reload page to show new images
        window.location.reload();
      } else if (result.error) {
        toastCtx.error(result.error);
      } else {
        toastCtx.info("Aucune image manquante trouvée sur PFS");
      }
    } catch {
      toastCtx.error("Erreur lors du téléchargement");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleRetry}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F59E0B] bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 border border-[#F59E0B]/20 rounded-lg transition-colors disabled:opacity-50"
    >
      {loading ? (
        <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
      )}
      {loading ? "Téléchargement..." : "Retenter les images PFS"}
    </button>
  );
}
