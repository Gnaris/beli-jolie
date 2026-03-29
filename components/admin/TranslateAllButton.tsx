"use client";

import { useState } from "react";
import { useDeeplEnabled, useDeeplQuota } from "@/components/admin/DeeplConfigContext";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface TranslateAllItem {
  /** Unique identifier (entity id) */
  id: string;
  /** French text to translate */
  text: string;
  /** Whether this item already has translations */
  hasTranslations: boolean;
}

interface TranslateAllButtonProps {
  /** Items to translate */
  items: TranslateAllItem[];
  /** Called with translations for each item: Record<id, Record<locale, string>> */
  onTranslated: (translations: Record<string, Record<string, string>>) => void;
  /** Label override */
  label?: string;
  /** Only translate items that are missing translations */
  onlyMissing?: boolean;
}

export default function TranslateAllButton({
  items,
  onTranslated,
  label = "Tout traduire",
  onlyMissing = false,
}: TranslateAllButtonProps) {
  const deeplEnabled = useDeeplEnabled();
  const { quotaExhausted, setQuotaExhausted } = useDeeplQuota();
  const [loading, setLoading] = useState(false);
  const { showLoading, hideLoading } = useLoadingOverlay();

  const toTranslate = onlyMissing
    ? items.filter((i) => !i.hasTranslations && i.text.trim())
    : items.filter((i) => i.text.trim());

  const missingCount = items.filter((i) => !i.hasTranslations && i.text.trim()).length;

  async function handleClick() {
    if (toTranslate.length === 0) return;

    setLoading(true);
    showLoading(`Traduction de ${toTranslate.length} élément${toTranslate.length > 1 ? "s" : ""}…`);

    try {
      // Pre-check quota
      const quotaRes = await fetch("/api/admin/translate");
      const quotaData = await quotaRes.json();
      const totalChars = toTranslate.reduce((sum, i) => sum + i.text.length, 0) * 6;

      if (quotaData.remaining < totalChars) {
        setQuotaExhausted(true);
        return;
      }

      // Batch in groups of 10 to avoid timeout
      const BATCH_SIZE = 10;
      const allResults: Record<string, Record<string, string>> = {};
      let completed = 0;

      for (let i = 0; i < toTranslate.length; i += BATCH_SIZE) {
        const batch = toTranslate.slice(i, i + BATCH_SIZE);
        const texts = batch.map((item) => item.text);

        const res = await fetch("/api/admin/translate-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts }),
        });

        if (res.status === 429) {
          setQuotaExhausted(true);
          if (Object.keys(allResults).length > 0) {
            onTranslated(allResults);
          }
          return;
        }

        if (!res.ok) throw new Error("Erreur traduction");

        const data = await res.json();
        const results: Record<string, string>[] = data.results;

        for (let j = 0; j < batch.length; j++) {
          if (results[j] && Object.keys(results[j]).length > 0) {
            allResults[batch[j].id] = results[j];
          }
        }

        completed += batch.length;
        showLoading(`Traduction… ${completed}/${toTranslate.length}`);
      }

      onTranslated(allResults);
    } catch {
      // Silent — button remains usable for retry
    } finally {
      setLoading(false);
      hideLoading();
    }
  }

  if (!deeplEnabled) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || toTranslate.length === 0 || quotaExhausted}
      title={quotaExhausted ? "Quota mensuel de traduction épuisé" : undefined}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-dark hover:bg-black text-text-inverse text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
    >
      {loading ? (
        <>
          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Traduction…
        </>
      ) : (
        <>
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802"
            />
          </svg>
          {label}
          {missingCount > 0 && (
            <span className="bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              {missingCount}
            </span>
          )}
        </>
      )}
    </button>
  );
}
