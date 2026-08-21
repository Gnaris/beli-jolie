"use client";

import { useState, useTransition } from "react";
import { updateSmarty365ApiKey, validateSmarty365ApiKey } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasKey: boolean;
}

export default function Smarty365ApiKeyConfig({ hasKey }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasKey ? "valid" : "none",
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [editing, setEditing] = useState(!hasKey);
  const [guideOpen, setGuideOpen] = useState(false);

  function handleValidate() {
    if (!apiKey.trim()) return;
    showLoading();
    startValidating(async () => {
      try {
        setKeyStatus("checking");
        const result = await validateSmarty365ApiKey(apiKey.trim());
        if (result.valid) {
          setKeyStatus("valid");
          toast.success("Cle valide", "La cle Smarty365 est reconnue.");
        } else {
          setKeyStatus("invalid");
          toast.error("Cle invalide", result.error ?? "Cle Smarty365 non reconnue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleSave() {
    showLoading();
    startSaving(async () => {
      try {
        const result = await updateSmarty365ApiKey(apiKey.trim());
        if (result.success) {
          toast.success("Enregistre", apiKey.trim() ? "Cle Smarty365 sauvegardee." : "Cle supprimee.");
          if (apiKey.trim()) {
            setEditing(false);
            setApiKey("");
          } else {
            setKeyStatus("none");
          }
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  const isPending = isSaving || isValidating;

  return (
    <div className="space-y-4">
      {/* Guide */}
      <div className="rounded-xl border border-border overflow-hidden">
        <button
          type="button"
          onClick={() => setGuideOpen(!guideOpen)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
            </svg>
            <span className="text-sm font-body font-medium text-text-primary">Comment obtenir ma cle Smarty365 ?</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className={`w-4 h-4 text-text-secondary transition-transform ${guideOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {guideOpen && (
          <div className="px-4 pb-4 border-t border-border pt-3">
            <ol className="space-y-3 text-sm font-body text-text-secondary">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-dark text-text-inverse text-xs font-semibold flex items-center justify-center">1</span>
                <span>Rendez-vous sur <a href="https://www.smarty365.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-text-primary underline hover:no-underline">smarty365.com/dashboard</a> et connectez-vous</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-dark text-text-inverse text-xs font-semibold flex items-center justify-center">2</span>
                <span>Ouvrez la page <strong className="text-text-primary">Developer Center</strong> (menu Smarty API) et copiez votre jeton d&apos;acces</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-dark text-text-inverse text-xs font-semibold flex items-center justify-center">3</span>
                <span>Collez-le ci-dessous, cliquez sur <strong className="text-text-primary">Verifier</strong> puis sur <strong className="text-text-primary">Enregistrer</strong></span>
              </li>
            </ol>
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            keyStatus === "valid" ? "bg-[#22C55E]" :
            keyStatus === "invalid" ? "bg-[#EF4444]" :
            keyStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
            "bg-[#D1D1D1]"
          }`}
        />
        <span className="font-body text-sm text-text-secondary">
          {keyStatus === "valid" && "Cle Smarty365 configuree"}
          {keyStatus === "invalid" && "Cle Smarty365 invalide"}
          {keyStatus === "checking" && "Verification..."}
          {keyStatus === "none" && "Aucune cle configuree"}
        </span>
      </div>

      {!editing && hasKey ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
            ••••••••••••••••
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-body text-text-secondary hover:text-text-primary underline"
          >
            Modifier
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (keyStatus === "valid" || keyStatus === "invalid") setKeyStatus("none");
              }}
              placeholder="Coller le jeton Smarty365"
              className="flex-1 h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleValidate}
              disabled={isPending || !apiKey.trim()}
              className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isValidating ? "Verification..." : "Verifier"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !apiKey.trim() || keyStatus !== "valid"}
              className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={() => { setEditing(false); setApiKey(""); setKeyStatus("valid"); }}
                disabled={isPending}
                className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
              >
                Annuler
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
