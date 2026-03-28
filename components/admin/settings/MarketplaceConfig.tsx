"use client";

import { useState, useTransition } from "react";
import { updatePfsCredentials, validatePfsCredentials } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";

interface Props {
  hasPfsConfig: boolean;
}

export default function MarketplaceConfig({ hasPfsConfig }: Props) {
  const [pfsEmail, setPfsEmail] = useState("");
  const [pfsPassword, setPfsPassword] = useState("");
  const [pfsStatus, setPfsStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasPfsConfig ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const toast = useToast();
  const [editing, setEditing] = useState(!hasPfsConfig);

  function handleValidate() {
    if (!pfsEmail.trim() || !pfsPassword.trim()) return;
    startValidating(async () => {
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
    });
  }

  function handleSave() {
    startSaving(async () => {
      const result = await updatePfsCredentials({
        email: pfsEmail.trim(),
        password: pfsPassword.trim(),
      });
      if (result.success) {
        toast.success("Enregistré", "Identifiants PFS sauvegardés.");
        setEditing(false);
        setPfsEmail("");
        setPfsPassword("");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  const isPending = isSaving || isValidating;

  return (
    <div className="space-y-4">
      {/* PFS Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h4 className="font-[family-name:var(--font-poppins)] text-sm font-semibold text-text-primary">Paris Fashion Shops</h4>
          <span
            className={`w-2 h-2 rounded-full ${
              pfsStatus === "valid" ? "bg-[#22C55E]" :
              pfsStatus === "invalid" ? "bg-[#EF4444]" :
              pfsStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
              "bg-[#D1D1D1]"
            }`}
          />
          <span className="font-[family-name:var(--font-roboto)] text-xs text-text-secondary">
            {pfsStatus === "valid" && "Connecté"}
            {pfsStatus === "invalid" && "Invalide"}
            {pfsStatus === "checking" && "Vérification..."}
            {pfsStatus === "none" && "Non configuré"}
          </span>
        </div>

        {!editing && hasPfsConfig ? (
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
            <div className="space-y-2">
              <input
                type="email"
                value={pfsEmail}
                onChange={(e) => {
                  setPfsEmail(e.target.value);
                  if (pfsStatus === "valid" || pfsStatus === "invalid") setPfsStatus("none");
                }}
                placeholder="Email PFS"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
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
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleValidate}
                disabled={isPending || !pfsEmail.trim() || !pfsPassword.trim()}
                className="h-9 px-4 rounded-lg border border-border text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
              >
                {isValidating ? "Vérification..." : "Vérifier"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || !pfsEmail.trim() || !pfsPassword.trim() || pfsStatus !== "valid"}
                className="h-9 px-4 rounded-lg bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
              >
                {isSaving ? "Enregistrement..." : "Enregistrer"}
              </button>
              {hasPfsConfig && (
                <button
                  type="button"
                  onClick={() => { setEditing(false); setPfsEmail(""); setPfsPassword(""); setPfsStatus("valid"); }}
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
    </div>
  );
}
