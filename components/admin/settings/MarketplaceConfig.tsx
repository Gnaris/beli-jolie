"use client";

import { useState, useTransition } from "react";
import {
  updatePfsCredentials,
  validatePfsCredentials,
  togglePfsEnabled,
} from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasPfsConfig: boolean;
  pfsEnabled: boolean;
}

export default function MarketplaceConfig({
  hasPfsConfig,
  pfsEnabled: initialPfsEnabled,
}: Props) {
  const [pfsEmail, setPfsEmail] = useState("");
  const [pfsPassword, setPfsPassword] = useState("");
  const [pfsStatus, setPfsStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasPfsConfig ? "valid" : "none"
  );
  const [pfsEnabled, setPfsEnabled] = useState(initialPfsEnabled);
  const [pfsEditing, setPfsEditing] = useState(!hasPfsConfig);
  const [isSavingPfs, startSavingPfs] = useTransition();
  const [isValidatingPfs, startValidatingPfs] = useTransition();
  const [isTogglingPfs, startTogglingPfs] = useTransition();

  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();

  const isPendingPfs = isSavingPfs || isValidatingPfs || isTogglingPfs;

  function handlePfsValidate() {
    if (!pfsEmail.trim() || !pfsPassword.trim()) return;
    showLoading();
    startValidatingPfs(async () => {
      try {
        setPfsStatus("checking");
        const result = await validatePfsCredentials({
          email: pfsEmail.trim(),
          password: pfsPassword.trim(),
        });
        if (result.valid) {
          setPfsStatus("valid");
          toast.success("Connexion réussie", "Identifiants Paris Fashion Shops valides.");
        } else {
          setPfsStatus("invalid");
          toast.error("Connexion échouée", result.error ?? "Identifiants invalides.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handlePfsSave() {
    showLoading();
    startSavingPfs(async () => {
      try {
        const result = await updatePfsCredentials({
          email: pfsEmail.trim(),
          password: pfsPassword.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Identifiants PFS sauvegardés.");
          setPfsEditing(false);
          setPfsEmail("");
          setPfsPassword("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handlePfsToggle() {
    const newValue = !pfsEnabled;
    startTogglingPfs(async () => {
      const result = await togglePfsEnabled(newValue);
      if (result.success) {
        setPfsEnabled(newValue);
        toast.success(
          newValue ? "PFS activé" : "PFS désactivé",
          newValue
            ? "La synchronisation Paris Fashion Shops est maintenant active."
            : "Les fonctionnalités Paris Fashion Shops sont désactivées."
        );
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="font-heading text-sm font-semibold text-text-primary">Paris Fashion Shops</h4>
            <span
              className={`w-2 h-2 rounded-full ${
                pfsStatus === "valid" ? "bg-[#22C55E]" :
                pfsStatus === "invalid" ? "bg-[#EF4444]" :
                pfsStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                "bg-[#D1D1D1]"
              }`}
            />
            <span className="font-body text-xs text-text-secondary">
              {pfsStatus === "valid" && "Connecté"}
              {pfsStatus === "invalid" && "Invalide"}
              {pfsStatus === "checking" && "Vérification..."}
              {pfsStatus === "none" && "Non configuré"}
            </span>
          </div>

          {hasPfsConfig && (
            <button
              type="button"
              role="switch"
              aria-checked={pfsEnabled}
              aria-label="Activer Paris Fashion Shops"
              disabled={isPendingPfs}
              onClick={handlePfsToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20 focus:ring-offset-2 disabled:opacity-50 ${
                pfsEnabled ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  pfsEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {!pfsEditing && hasPfsConfig ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 font-body text-sm text-text-secondary tracking-widest">
              ••••••••••••••••
            </div>
            <button
              type="button"
              onClick={() => setPfsEditing(true)}
              className="text-sm font-body text-text-secondary hover:text-text-primary underline"
            >
              Modifier
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <input
                type="email"
                value={pfsEmail}
                onChange={(e) => {
                  setPfsEmail(e.target.value);
                  if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                }}
                placeholder="Email PFS"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingPfs}
                autoComplete="off"
              />
              <input
                type="password"
                value={pfsPassword}
                onChange={(e) => {
                  setPfsPassword(e.target.value);
                  if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                }}
                placeholder="Mot de passe PFS"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPendingPfs}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePfsValidate}
                disabled={isPendingPfs || !pfsEmail.trim() || !pfsPassword.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidatingPfs ? "Vérification..." : "Tester la connexion"}
              </button>
              <button
                type="button"
                onClick={handlePfsSave}
                disabled={isPendingPfs || !pfsEmail.trim() || !pfsPassword.trim() || pfsStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {isSavingPfs ? "Enregistrement..." : "Sauvegarder"}
              </button>
              {hasPfsConfig && (
                <button
                  type="button"
                  onClick={() => { setPfsEditing(false); setPfsEmail(""); setPfsPassword(""); setPfsStatus("valid"); }}
                  disabled={isPendingPfs}
                  className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                >
                  Annuler
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
