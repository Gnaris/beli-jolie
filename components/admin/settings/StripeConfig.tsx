"use client";

import { useState, useTransition, useEffect } from "react";
import { updateStripeConfig, validateStripeSecretKey, deleteStripeConfig } from "@/app/actions/admin/site-config";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasKeys: boolean;
  hasConnect: boolean;
  connectEnabled: boolean;
}

export default function StripeConfig({ hasKeys, hasConnect, connectEnabled }: Props) {
  // ─── Connect state ───────────────────────────────────────────────────────
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isResetting, startResetting] = useTransition();
  const [isLinking, startLinking] = useTransition();
  const [connectStatus, setConnectStatus] = useState<"connected" | "none">(
    hasConnect ? "connected" : "none"
  );
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkAccountId, setLinkAccountId] = useState("");

  // ─── Manual state ────────────────────────────────────────────────────────
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [keyStatus, setKeyStatus] = useState<"none" | "valid" | "invalid" | "checking">(
    hasKeys ? "valid" : "none"
  );
  const [isSaving, startSaving] = useTransition();
  const [isValidating, startValidating] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [editing, setEditing] = useState(!hasKeys);
  const [showManual, setShowManual] = useState(!connectEnabled && hasKeys);

  const toast = useToast();
  const { confirm } = useConfirm();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Détecter les query params de retour OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      setConnectStatus("connected");
      toast.success("Stripe connecté", "Votre compte Stripe a été connecté avec succès.");
      // Nettoyer l'URL
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      window.history.replaceState({}, "", url.toString());
    }
    const connectError = params.get("connect_error");
    if (connectError) {
      toast.error("Erreur Stripe Connect", decodeURIComponent(connectError));
      const url = new URL(window.location.href);
      url.searchParams.delete("connect_error");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Connect handlers ────────────────────────────────────────────────────

  function handleConnect() {
    window.location.href = "/api/stripe/connect";
  }

  async function handleDisconnect() {
    const ok = await confirm({
      title: "Déconnecter Stripe ?",
      message: "Les paiements ne seront plus possibles tant qu'un nouveau compte n'est pas connecté ou que des clés manuelles ne sont pas configurées.",
      confirmLabel: "Déconnecter",
      type: "danger",
    });
    if (!ok) return;

    showLoading();
    startDisconnecting(async () => {
      try {
        const res = await fetch("/api/stripe/disconnect", { method: "POST" });
        const data = await res.json();
        if (data.success) {
          setConnectStatus("none");
          toast.success("Déconnecté", "Compte Stripe déconnecté.");
        } else {
          toast.error("Erreur", data.error ?? "Impossible de déconnecter.");
        }
      } catch {
        toast.error("Erreur", "Impossible de déconnecter.");
      } finally {
        hideLoading();
      }
    });
  }

  async function handleReset() {
    const ok = await confirm({
      title: "Recréer le compte Stripe ?",
      message: "Le compte Stripe actuel sera supprimé définitivement. Un nouveau compte sera créé et devra être configuré depuis zéro.",
      confirmLabel: "Supprimer et recréer",
      type: "danger",
    });
    if (!ok) return;

    showLoading();
    startResetting(async () => {
      try {
        const res = await fetch("/api/stripe/reset", { method: "POST" });
        const data = await res.json();
        if (data.success) {
          setConnectStatus("none");
          toast.success("Compte supprimé", "Vous pouvez maintenant créer un nouveau compte.");
        } else {
          toast.error("Erreur", data.error ?? "Impossible de supprimer le compte.");
        }
      } catch {
        toast.error("Erreur", "Impossible de supprimer le compte.");
      } finally {
        hideLoading();
      }
    });
  }

  // ─── Manual handlers ─────────────────────────────────────────────────────

  function handleValidate() {
    if (!secretKey.trim()) return;
    showLoading();
    startValidating(async () => {
      try {
        setKeyStatus("checking");
        const result = await validateStripeSecretKey(secretKey.trim());
        if (result.valid) {
          setKeyStatus("valid");
          toast.success("Clé valide", "La connexion avec Stripe fonctionne.");
        } else {
          setKeyStatus("invalid");
          toast.error("Clé invalide", result.error ?? "Impossible de se connecter à Stripe.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleSave() {
    if (!secretKey.trim() || !publishableKey.trim()) return;
    showLoading();
    startSaving(async () => {
      try {
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
      } finally {
        hideLoading();
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
    showLoading();
    startDeleting(async () => {
      try {
        const result = await deleteStripeConfig();
        if (result.success) {
          toast.success("Supprimé", "Configuration Stripe supprimée.");
          setKeyStatus("none");
          setEditing(true);
        } else {
          toast.error("Erreur", result.error ?? "Une erreur est survenue.");
        }
      } finally {
        hideLoading();
      }
    });
  }

  function handleLinkExisting() {
    const id = linkAccountId.trim();
    if (!id.startsWith("acct_")) {
      toast.error("ID invalide", "L'identifiant doit commencer par acct_");
      return;
    }
    startLinking(() => {
      window.location.href = `/api/stripe/connect?account_id=${encodeURIComponent(id)}`;
    });
  }

  const isPending = isSaving || isValidating || isDeleting || isDisconnecting || isResetting || isLinking;
  const canSave = keyStatus === "valid" && secretKey.trim() && publishableKey.trim();
  const isConfigured = connectStatus === "connected" || (hasKeys && keyStatus === "valid");

  return (
    <div className="space-y-6">
      {/* ═══ Status global ═══ */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            isConfigured ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
          }`}
        />
        <span className="font-body text-sm text-text-secondary">
          {connectStatus === "connected"
            ? "Connecté via Stripe Connect"
            : keyStatus === "valid"
              ? "Configuré (clés manuelles)"
              : "Non configuré"}
        </span>
      </div>

      {/* ═══ Section 1 : Stripe Connect (recommandé) ═══ */}
      {connectEnabled && (
        <div className="border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#635BFF]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
            </svg>
            <h4 className="font-heading text-sm font-semibold text-text-primary">
              Stripe Connect
            </h4>
            <span className="badge badge-info text-[10px]">Recommandé</span>
          </div>
          <p className="text-xs text-text-secondary font-body">
            Connectez-vous directement avec votre compte Stripe en un clic. Pas besoin de copier de clés API.
          </p>

          {connectStatus === "connected" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-[#ECFDF5] border border-[#A7F3D0] rounded-lg px-3 py-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#059669]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                <span className="text-sm font-body text-[#065F46] font-medium">Compte Stripe connecté</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isPending}
                  className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
                >
                  {isDisconnecting ? "Déconnexion..." : "Déconnecter"}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isPending}
                  className="h-9 px-4 rounded-lg border border-[#EF4444]/30 text-sm font-body font-medium text-[#EF4444] hover:bg-[#EF4444]/5 transition-colors disabled:opacity-50"
                >
                  {isResetting ? "Suppression..." : "Recréer le compte"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleConnect}
                disabled={isPending}
                className="h-10 px-5 rounded-lg bg-[#635BFF] text-white text-sm font-body font-medium hover:bg-[#5851EA] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                Créer un nouveau compte Stripe
              </button>

              <div className="relative flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-text-secondary font-body">ou</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <button
                type="button"
                onClick={() => setShowLinkForm((v) => !v)}
                disabled={isPending}
                className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.04a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364L4.25 8.81" />
                </svg>
                Relier un compte existant
              </button>

              {showLinkForm && (
                <div className="space-y-2 bg-bg-secondary/50 rounded-lg p-3">
                  <label className="text-xs font-body text-text-secondary">
                    ID du compte connecté (visible dans le dashboard Stripe)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={linkAccountId}
                      onChange={(e) => setLinkAccountId(e.target.value)}
                      placeholder="acct_xxxxxxxxxx"
                      className="flex-1 h-9 px-3 rounded-lg border border-border bg-bg-primary text-sm font-body text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30 focus:border-[#635BFF]"
                    />
                    <button
                      type="button"
                      onClick={handleLinkExisting}
                      disabled={isPending || !linkAccountId.trim()}
                      className="h-9 px-4 rounded-lg bg-[#635BFF] text-white text-sm font-body font-medium hover:bg-[#5851EA] transition-colors disabled:opacity-50"
                    >
                      {isLinking ? "Connexion..." : "Relier"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 2 : Configuration manuelle ═══ */}
      {connectStatus !== "connected" && (
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
              </svg>
              <span className="text-sm font-body font-medium text-text-primary">
                Configuration manuelle {connectEnabled && <span className="text-text-secondary font-normal">(avancé)</span>}
              </span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`w-4 h-4 text-text-secondary transition-transform ${showManual ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {showManual && (
            <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
              {/* Status badge manuel */}
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    keyStatus === "valid" ? "bg-[#22C55E]" :
                    keyStatus === "invalid" ? "bg-[#EF4444]" :
                    keyStatus === "checking" ? "bg-[#F59E0B] animate-pulse" :
                    "bg-[#D1D1D1]"
                  }`}
                />
                <span className="font-body text-xs text-text-secondary">
                  {keyStatus === "valid" && "Clés configurées"}
                  {keyStatus === "invalid" && "Clé invalide"}
                  {keyStatus === "checking" && "Vérification..."}
                  {keyStatus === "none" && "Non configuré"}
                </span>
              </div>

              {!editing && hasKeys ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-body text-text-secondary">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                    </svg>
                    Clés Stripe configurées
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isPending}
                      className="h-9 px-4 rounded-lg border border-[#EF4444]/30 text-sm font-body font-medium text-[#EF4444] hover:bg-[#EF4444]/5 transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? "Suppression..." : "Supprimer"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Clé secrète */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium font-body text-text-primary">
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
                      className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                      disabled={isPending}
                      autoComplete="off"
                    />
                  </div>

                  {/* Clé publique */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium font-body text-text-primary">
                      Clé publique <span className="text-[#EF4444]">*</span>
                    </label>
                    <input
                      type="text"
                      value={publishableKey}
                      onChange={(e) => setPublishableKey(e.target.value)}
                      placeholder="pk_live_... ou pk_test_..."
                      className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                      disabled={isPending}
                      autoComplete="off"
                    />
                  </div>

                  {/* Webhook secret */}
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium font-body text-text-primary">
                      Webhook secret <span className="text-text-secondary font-normal">(optionnel)</span>
                    </label>
                    <input
                      type="password"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      placeholder="whsec_..."
                      className="w-full h-10 px-3 rounded-lg border border-border bg-bg-primary text-text-primary text-sm font-body placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/20"
                      disabled={isPending}
                      autoComplete="off"
                    />
                    <p className="text-xs text-text-secondary font-body">
                      Endpoint webhook : <code className="bg-bg-secondary px-1 py-0.5 rounded text-[11px]">/api/payments/webhook</code>
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleValidate}
                      disabled={isPending || !secretKey.trim()}
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
                        className="h-9 px-3 text-sm font-body text-text-secondary hover:text-text-primary"
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
