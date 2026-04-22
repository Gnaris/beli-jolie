"use client";

import { useState, useTransition } from "react";
import { updateResendConfig, validateResendConfig } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasConfig: boolean;
}

export default function ResendConfig({ hasConfig }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [status, setStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasConfig ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const toast = useToast();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const [editing, setEditing] = useState(!hasConfig);

  function handleValidate() {
    if (!apiKey.trim()) return;
    showLoading();
    startValidating(async () => {
      try {
        setStatus("checking");
        const result = await validateResendConfig({ apiKey: apiKey.trim() });
        if (result.valid) {
          setStatus("valid");
          toast.success("Clé valide", "La clé API Resend fonctionne.");
        } else {
          setStatus("invalid");
          toast.error("Clé invalide", result.error ?? "Clé API Resend invalide.");
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
        const result = await updateResendConfig({
          apiKey: apiKey.trim(),
          fromEmail: fromEmail.trim(),
          fromName: fromName.trim(),
          notifyEmail: notifyEmail.trim(),
        });
        if (result.success) {
          toast.success("Enregistré", "Configuration Resend sauvegardée.");
          setEditing(false);
          setApiKey("");
          setFromEmail("");
          setFromName("");
          setNotifyEmail("");
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  const isPending = isSaving || isValidating;
  const canSave = apiKey.trim() && fromEmail.trim() && status === "valid";

  return (
    <div className="space-y-4">
      {/* Aide non-technique */}
      <div className="rounded-lg bg-bg-secondary border border-border px-4 py-3 text-sm font-body text-text-secondary">
        <p className="mb-1">
          <strong className="text-text-primary">Comment obtenir ces informations ?</strong>
        </p>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li>Créez un compte gratuit sur <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline">resend.com</a> (3 000 emails/mois offerts).</li>
          <li>Ajoutez votre nom de domaine (ex. <em>maboutique.com</em>) dans « Domains » et validez-le.</li>
          <li>Dans « API Keys », créez une clé — elle commence par <code>re_</code>.</li>
          <li>Collez-la ici, puis indiquez l&apos;adresse d&apos;envoi (<em>contact@maboutique.com</em>).</li>
        </ol>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            status === "valid" ? "bg-[#22C55E]" :
            status === "invalid" ? "bg-[#EF4444]" :
            status === "checking" ? "bg-[#F59E0B] animate-pulse" :
            "bg-[#D1D1D1]"
          }`}
        />
        <span className="font-body text-sm text-text-secondary">
          {status === "valid" && "Envoi d'emails actif (Resend)"}
          {status === "invalid" && "Clé API invalide"}
          {status === "checking" && "Vérification..."}
          {status === "none" && "Non configuré"}
        </span>
      </div>

      {!editing && hasConfig ? (
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
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Clé API Resend (commence par <code>re_</code>)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (status === "valid" || status === "invalid") setStatus("none");
                }}
                placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Adresse d&apos;envoi (ex. contact@maboutique.com)
              </label>
              <input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="contact@votredomaine.com"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Nom affiché (optionnel — défaut : nom de la boutique)
              </label>
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Ma Boutique"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-body text-text-secondary mb-1">
                Email de notifications admin (optionnel — défaut : email société)
              </label>
              <input
                type="email"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder="admin@votredomaine.com"
                className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                disabled={isPending}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleValidate}
              disabled={isPending || !apiKey.trim()}
              className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
            >
              {isValidating ? "Vérification..." : "Vérifier la clé"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending || !canSave}
              className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {isSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {hasConfig && (
              <button
                type="button"
                onClick={() => { setEditing(false); setApiKey(""); setFromEmail(""); setFromName(""); setNotifyEmail(""); setStatus("valid"); }}
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
