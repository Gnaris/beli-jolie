"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { LOCALE_FULL_NAMES } from "@/i18n/locales";
import { useDeeplEnabled } from "@/components/admin/DeeplConfigContext";

interface TranslateButtonProps {
  /** French text to translate */
  text: string;
  /** Callback with translations for all 6 non-fr locales */
  onTranslated: (translations: Record<string, string>) => void;
  /** Optional: smaller variant */
  size?: "sm" | "md";
  /** Optional: disable the button */
  disabled?: boolean;
}

export default function TranslateButton({
  text,
  onTranslated,
  size = "sm",
  disabled = false,
}: TranslateButtonProps) {
  const deeplEnabled = useDeeplEnabled();
  const [loading, setLoading] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const { confirm } = useConfirm();

  const localeList = Object.entries(LOCALE_FULL_NAMES)
    .filter(([k]) => k !== "fr")
    .map(([, v]) => v)
    .join(", ");

  async function handleClick() {
    if (!text.trim()) return;
    setQuotaError(null);

    // Fetch current quota
    let remaining: number;
    let resetDate: string;
    try {
      const res = await fetch("/api/admin/translate");
      const data = await res.json();
      remaining = data.remaining;
      resetDate = data.resetDate;
    } catch {
      setQuotaError("Impossible de vérifier le quota.");
      return;
    }

    const charsNeeded = text.length * 6;

    // Check if quota exhausted
    if (remaining < charsNeeded) {
      const formatted = new Date(resetDate).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      setQuotaError(
        `Vous avez atteint le nombre maximum de caractères traductibles. Réinitialisation le ${formatted}.`
      );
      return;
    }

    // Show confirmation with remaining chars
    const confirmed = await confirm({
      type: "info",
      title: "Traduire vers toutes les langues",
      message: `${localeList}.\n\nCaractères nécessaires : ${charsNeeded.toLocaleString("fr-FR")} (${text.length} × 6 langues)\nCaractères restants : ${remaining.toLocaleString("fr-FR")} / 500 000`,
      confirmLabel: "Traduire",
      cancelLabel: "Annuler",
    });

    if (!confirmed) return;

    // Perform translation
    setLoading(true);
    try {
      const res = await fetch("/api/admin/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setQuotaError(data.message);
        return;
      }

      if (!res.ok) throw new Error("Erreur traduction");

      const data = await res.json();
      onTranslated(data.translations);
    } catch {
      setQuotaError("Erreur lors de la traduction.");
    } finally {
      setLoading(false);
    }
  }

  if (!deeplEnabled) return null;

  const isSm = size === "sm";

  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading || !text.trim() || !!quotaError}
        title={quotaError ?? "Traduire vers toutes les langues"}
        className={`inline-flex items-center gap-1 font-body font-medium transition-colors rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${
          isSm
            ? "text-xs px-2 py-1 bg-bg-secondary hover:bg-[#E5E5E5] text-text-primary border border-border"
            : "text-sm px-3 py-1.5 bg-bg-dark hover:bg-black text-text-inverse"
        }`}
      >
        {loading ? (
          <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        ) : (
          <svg
            className={isSm ? "w-3 h-3" : "w-3.5 h-3.5"}
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
        )}
        Traduire
      </button>

      {quotaError && (
        <p className="text-xs text-[#EF4444] font-body mt-1 max-w-[250px]">
          {quotaError}
        </p>
      )}
    </div>
  );
}
