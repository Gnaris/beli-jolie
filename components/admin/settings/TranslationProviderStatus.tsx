"use client";

import { useState, useTransition } from "react";
import { pingTranslationProvider } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  configured: boolean;
}

export default function TranslationProviderStatus({ configured }: Props) {
  const [isTesting, startTest] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleTest() {
    showLoading("Test en cours…");
    startTest(async () => {
      try {
        const result = await pingTranslationProvider();
        setLastResult(result);
        if (result.ok) toast.success("Connexion OK", result.message);
        else toast.error("Échec", result.message);
      } finally {
        hideLoading();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            configured ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
          }`}
        />
        <span className="font-body text-sm text-text-secondary">
          {configured
            ? "Identifiants Paris Fashion Shop détectés"
            : "Aucun identifiant PFS — la traduction automatique est inactive"}
        </span>
      </div>

      {configured && (
        <>
          <div>
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isTesting ? "Test en cours…" : "Tester la traduction"}
            </button>
          </div>
          {lastResult && (
            <p
              className={`text-sm font-body ${
                lastResult.ok ? "text-[#15803D]" : "text-[#B91C1C]"
              }`}
            >
              {lastResult.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
