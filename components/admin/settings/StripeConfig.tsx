"use client";

import { useState, useTransition, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";

interface Props {
  hasConnect: boolean;
}

export default function StripeConfig({ hasConnect }: Props) {
  // ─── Connect state ───────────────────────────────────────────────────────
  const [isDisconnecting, startDisconnecting] = useTransition();
  const [isResetting, startResetting] = useTransition();
  const [isLinking, startLinking] = useTransition();
  const [connectStatus, setConnectStatus] = useState<"connected" | "none">(
    hasConnect ? "connected" : "none"
  );
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkAccountId, setLinkAccountId] = useState("");

  const toast = useToast();
  const { confirm } = useConfirm();
  const { showLoading, hideLoading } = useLoadingOverlay();

  // Détecter les query params de retour OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      setConnectStatus("connected");
      toast.success("Stripe connecté", "Votre compte Stripe a été connecté avec succès.");
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
      message: "Les paiements ne seront plus possibles tant qu'un nouveau compte n'est pas connecté.",
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

  const isPending = isDisconnecting || isResetting || isLinking;

  return (
    <div className="space-y-6">
      {/* ═══ Status global ═══ */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            connectStatus === "connected" ? "bg-[#22C55E]" : "bg-[#D1D1D1]"
          }`}
        />
        <span className="font-body text-sm text-text-secondary">
          {connectStatus === "connected"
            ? "Connecté via Stripe Connect"
            : "Non configuré"}
        </span>
      </div>

      {/* ═══ Stripe Connect ═══ */}
      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#635BFF]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
          </svg>
          <h4 className="font-heading text-sm font-semibold text-text-primary">
            Stripe Connect
          </h4>
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
    </div>
  );
}
