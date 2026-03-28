"use client";

import { useState, useTransition } from "react";
import { updateStripeConfig, validateStripeSecretKey, deleteStripeConfig } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props {
  hasKeys: boolean;
}

export default function StripeConfig({ hasKeys }: Props) {
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [keyStatus, setKeyStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasKeys ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState(!hasKeys);

  function handleValidate() {
    if (!secretKey.trim()) return;
    startValidating(async () => {
      setKeyStatus("checking");
      const result = await validateStripeSecretKey(secretKey.trim());
      if (result.valid) {
        setKeyStatus("valid");
        toast.success("Clé valide", "La connexion avec Stripe fonctionne.");
      } else {
        setKeyStatus("invalid");
        toast.error("Clé invalide", result.error ?? "Impossible de se connecter à Stripe.");
      }
    });
  }

  function handleSave() {
    if (!secretKey.trim() || !publishableKey.trim()) return;
    startSaving(async () => {
      const result = await updateStripeConfig({
        secretKey: secretKey.trim(),
        publishableKey: publishableKey.trim(),
        webhookSecret: webhookSecret.trim(),
      });
      if (result.success) {
        toast.success("Enregistré", "Configuration Stripe sauvegardée.");
        setEditing(false);
        setSecretKey("");
        setPublishableKey("");
        setWebhookSecret("");
        setKeyStatus("valid");
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer la configuration Stripe ?",
      message: "Les paiements ne seront plus possibles tant qu'une nouvelle configuration n'est pas ajoutée.",
      confirmLabel: "Supprimer",
      type: "danger",
    });
    if (!ok) return;
    startDeleting(async () => {
      const result = await deleteStripeConfig();
      if (result.success) {
        toast.success("Supprimé", "Configuration Stripe supprimée.");
        setKeyStatus("none");
        setEditing(true);
      } else {
        toast.error("Erreur", result.error ?? "Une erreur est survenue.");
      }
    });
  }

  const isPending = isSaving || isValidating || isDeleting;

  const canSave = keyStatus === "valid" && secretKey.trim() && publishableKey.trim();

  return (
    <div className="space-y-4">
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
          {keyStatus === "valid" && "Stripe connecté"}
          {keyStatus === "invalid" && "Clé invalide"}
          {keyStatus === "checking" && "Vérification..."}
          {keyStatus === "none" && "Non configuré"}
        </span>
      </div>

      {!editing && hasKeys ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 font-[family-name:var(--font-roboto)] text-sm text-text-secondary">
              <span className="inline-flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                Clés Stripe configurées
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-9 px-4 rounded-lg border border-border text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary hover:bg-bg-secondary transition-colors"
            >
              Modifier
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="h-9 px-4 rounded-lg border border-[#EF4444]/30 text-sm font-[family-name:var(--font-roboto)] font-medium text-[#EF4444] hover:bg-[#EF4444]/5 transition-colors disabled:opacity-50"
            >
              {isDeleting ? "Suppression..." : "Supprimer"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Clé secrète */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium font-[family-name:var(--font-roboto)] text-text-primary">
              Clé secrète <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => {
                setSecretKey(e.target.value);
                if (keyStatus === "valid" || keyStatus === "invalid") setKeyStatus("none");
              }}
              placeholder="sk_live_... ou sk_test_..."
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
          </div>

          {/* Clé publique */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium font-[family-name:var(--font-roboto)] text-text-primary">
              Clé publique <span className="text-[#EF4444]">*</span>
            </label>
            <input
              type="text"
              value={publishableKey}
              onChange={(e) => setPublishableKey(e.target.value)}
              placeholder="pk_live_... ou pk_test_..."
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
          </div>

          {/* Webhook secret */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium font-[family-name:var(--font-roboto)] text-text-primary">
              Webhook secret <span className="text-text-secondary font-normal">(optionnel)</span>
            </label>
            <input
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="whsec_..."
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-[family-name:var(--font-roboto)] placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
              disabled={isPending}
              autoComplete="off"
            />
            <p className="text-xs text-text-secondary font-[family-name:var(--font-roboto)]">
              Nécessaire pour les virements bancaires. Endpoint webhook : <code className="bg-bg-secondary px-1 py-0.5 rounded text-[11px]">/api/payments/webhook</code>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleValidate}
              disabled={isPending || !secretKey.trim()}
              className="h-9 px-4 rounded-lg border border-border text-sm font-[family-name:var(--font-roboto)] font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isValidating ? "Vérification..." : "Vérifier la clé"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !canSave}
              className="h-9 px-4 rounded-lg bg-[#1A1A1A] text-white text-sm font-[family-name:var(--font-roboto)] font-medium hover:bg-[#333] transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {hasKeys && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setSecretKey("");
                  setPublishableKey("");
                  setWebhookSecret("");
                  setKeyStatus("valid");
                }}
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
