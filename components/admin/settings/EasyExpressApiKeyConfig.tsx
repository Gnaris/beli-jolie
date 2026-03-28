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
  const [guideOpen, setGuideOpen] = useState(false);

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
            <span className="text-sm font-body font-medium text-text-primary">Comment obtenir ma cle API ?</span>
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
                <span>Rendez-vous sur <a href="https://easy-express.fr/membre/me" target="_blank" rel="noopener noreferrer" className="text-text-primary underline hover:no-underline">easy-express.fr/membre/me</a> et connectez-vous si besoin</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-dark text-text-inverse text-xs font-semibold flex items-center justify-center">2</span>
                <span>En bas de la page <strong className="text-text-primary">Mes informations</strong>, cliquez sur <strong className="text-text-primary">&laquo; Afficher mon jeton d&apos;acces (AccessToken) &raquo;</strong></span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-dark text-text-inverse text-xs font-semibold flex items-center justify-center">3</span>
                <span>Saisissez le mot de passe de votre compte Easy Express puis copiez le jeton affiche</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-bg-dark text-text-inverse text-xs font-semibold flex items-center justify-center">4</span>
                <span>Collez-le dans le champ ci-dessous, verifiez puis enregistrez</span>
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
          {keyStatus === "valid" && "Clé API configurée"}
          {keyStatus === "invalid" && "Clé API invalide"}
          {keyStatus === "checking" && "Vérification..."}
          {keyStatus === "none" && "Aucune clé configurée"}
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
              placeholder="Coller la clé API Easy-Express"
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
              {isValidating ? "Vérification..." : "Vérifier"}
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
