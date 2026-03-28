"use client";

import { useState, useTransition } from "react";
import { updateEasyExpressApiKey, validateEasyExpressApiKey } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  hasKey: boolean;
}

export default function EasyExpressApiKeyConfig({ hasKey }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasKey ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const toast = useToast();
  const [editing, setEditing] = useState(!hasKey);

  function handleValidate() {
    if (!apiKey.trim()) return;
    startValidating(async () => {
      setKeyStatus("checking");
      const result = await validateEasyExpressApiKey(apiKey.trim());
      if (result.valid) {
        setKeyStatus("valid");
        toast.success("Clé valide", "La clé API Easy-Express est fonctionnelle.");
      } else {
        setKeyStatus("invalid");
        toast.error("Clé invalide", result.error ?? "La clé API Easy-Express n'est pas reconnue.");
      }
    });
  }

  function handleSave() {
    startSaving(async () => {
      const result = await updateEasyExpressApiKey(apiKey.trim());
      if (result.success) {
        toast.success("Enregistré", apiKey.trim() ? "Clé API sauvegardée." : "Clé API supprimée.");
        if (apiKey.trim()) {
          setEditing(false);
          setApiKey("");
        } else {
          setKeyStatus("none");
        }
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  const isPending = isSaving || isValidating;

  return (
    <div className="space-y-3">
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
        <span className="font-[family-name:var(--font-roboto)] text-sm text-text-secondary">
          {keyStatus === "valid" && "Clé API configurée"}
          {keyStatus === "invalid" && "Clé API invalide"}
          {keyStatus === "checking" && "Vérification..."}
          {keyStatus === "none" && "Aucune clé configurée"}
        </span>
      </div>

      {!editing && hasKey ? (
        <div className="flex items-center gap-3">
          <div className="flex-1 font-[family-name:var(--font-roboto)] text-sm text-text-secondary tracking-widest">
            ••••••••••••••••
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary underline"
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
              placeholder="Coller la clé API Easy-Express"
              className="flex-1 h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleValidate}
              disabled={isPending || !apiKey.trim()}
              className="h-9 px-4 rounded-lg border border-border text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isValidating ? "Vérification..." : "Vérifier"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !apiKey.trim() || keyStatus !== "valid"}
              className="h-9 px-4 rounded-lg bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={() => { setEditing(false); setApiKey(""); setKeyStatus("valid"); }}
                disabled={isPending}
                className="h-9 px-3 text-sm font-[family-name:var(--font-roboto)] text-text-secondary hover:text-text-primary"
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
