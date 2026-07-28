"use client";

/**
 * Carte marketplace « Microstore » — variante simplifiée de MarketplaceCard.
 *
 * Contrairement à PFS / Ankorstore / eFashion / Faire qui passent par une file
 * d'attente asynchrone (MarketplaceRefreshQueue) avec cases à cocher et modale
 * de bulk-push, Microstore fait un appel HTTP direct et court à
 * `POST /goods/import_v1` : pas besoin d'op recent-sticky, ni de callback, ni
 * de gestion de liaison manuelle (Microstore identifie les produits par
 * `item_ref` = Product.reference, aucun ID marketplace à mapper).
 *
 * Ce composant gère donc son propre état local (`busy`, confirm) et appelle
 * directement les server actions `pushProductToMicrostore` /
 * `setProductMicrostoreEnabled` / `clearMicrostoreSyncRequired`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  pushProductToMicrostore,
  clearMicrostoreSyncRequired,
  setProductMicrostoreEnabled,
} from "@/app/actions/admin/microstore-products";

const GRADIENT = "linear-gradient(135deg,#0891b2,#22d3ee)";

const Icon = {
  Send: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  ),
  Spinner: (
    <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
    </svg>
  ),
  Close: (
    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Toggle: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  ),
};

interface MicrostoreStatusCardProps {
  productId: string;
  reference: string;
  productName: string;
  hasMicrostoreConfig: boolean;
  /** Kill switch global Microstore depuis Paramètres. */
  microstoreEnabled: boolean;
  /** null = jamais poussé ; Date = déjà poussé au moins une fois. */
  microstoreLastPushedAt: Date | string | null;
  microstoreSyncRequired: boolean;
  /** Microstore activée pour ce produit (Product.microstoreEnabled). */
  microstoreEnabledForProduct: boolean;
}

export function MicrostoreStatusCard({
  productId,
  reference,
  productName,
  hasMicrostoreConfig,
  microstoreEnabled,
  microstoreLastPushedAt,
  microstoreSyncRequired,
  microstoreEnabledForProduct,
}: MicrostoreStatusCardProps) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const online = microstoreLastPushedAt !== null;
  const syncRequired = online && microstoreSyncRequired;
  const disabled = !microstoreEnabled || !microstoreEnabledForProduct || !hasMicrostoreConfig;
  const disabledReason = !hasMicrostoreConfig
    ? "Microstore n'est pas configuré. Ajoutez la connexion dans Paramètres › Marketplaces › Microstore."
    : !microstoreEnabled
      ? "Microstore désactivé dans Paramètres."
      : "Microstore désactivé pour ce produit.";

  const cardClasses = disabled
    ? "bg-[#FAFAFA] border-border-dark"
    : syncRequired
      ? "bg-[#FEF3C7] border-[#FDE68A]"
      : online
        ? "bg-[#DCFCE7] border-[#BBF7D0]"
        : "bg-[#f3f4f6] border-[#e5e7eb]";
  const textColor = disabled
    ? "text-text-muted"
    : syncRequired
      ? "text-[#92400E]"
      : online
        ? "text-[#15803D]"
        : "text-text-secondary";
  const dividerClass = disabled
    ? "border-border-dark/60"
    : syncRequired
      ? "border-[#FDE68A]"
      : online
        ? "border-[#BBF7D0]"
        : "border-[#e5e7eb]";

  const disabledStyle: React.CSSProperties | undefined = disabled
    ? {
        background:
          "repeating-linear-gradient(45deg,#FAFAFA,#FAFAFA 6px,#F4F4F5 6px,#F4F4F5 12px)",
      }
    : undefined;

  const secondaryLabel = disabled
    ? null
    : busy
      ? null
      : syncRequired
        ? "synchro nécessaire"
        : null;

  const title = disabled
    ? disabledReason
    : busy
      ? "Envoi Microstore en cours…"
      : syncRequired
        ? "Synchronisation nécessaire — cliquez pour renvoyer vers Microstore"
        : online
          ? "Envoyé à Microstore — cliquez pour renvoyer"
          : "Pas encore envoyé — cliquez pour créer cette fiche sur Microstore";

  async function handlePush() {
    if (disabled || busy) return;
    const isFirstTime = !online;
    const ok = await confirm({
      type: syncRequired ? "warning" : "info",
      title: isFirstTime
        ? "Créer cette fiche sur Microstore ?"
        : "Renvoyer les infos à Microstore ?",
      message: isFirstTime
        ? "Ce produit n'existe pas encore sur Microstore. Une nouvelle fiche y sera créée (nom, prix, poids, stock, couleurs, catégorie, description). Les photos seront à ajouter manuellement côté Microstore ensuite."
        : "La fiche existante sur Microstore sera mise à jour avec vos dernières modifications (nom, prix, poids, stock, couleurs, catégorie, description). Les photos ne sont pas concernées.",
      confirmLabel: "Envoyer maintenant",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await pushProductToMicrostore(productId);
      if (res.success) {
        toast.success(isFirstTime ? "Fiche créée sur Microstore" : "Fiche mise à jour sur Microstore");
        router.refresh();
      } else {
        toast.error("Envoi Microstore échoué", res.error ?? "Erreur inconnue.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleEnabled() {
    const nextEnabled = !microstoreEnabledForProduct;
    const label = nextEnabled ? "Réactiver Microstore pour ce produit ?" : "Désactiver Microstore pour ce produit ?";
    const message = nextEnabled
      ? "Le produit pourra à nouveau être envoyé à Microstore (individuellement ou en bulk) et son stock sera à nouveau poussé automatiquement lors des ventes."
      : "Le produit ne sera plus envoyé à Microstore (ni manuellement ni lors des ventes). Sa fiche existante sur Microstore n'est pas supprimée.";
    const ok = await confirm({
      type: nextEnabled ? "info" : "warning",
      title: label,
      message,
      confirmLabel: nextEnabled ? "Réactiver" : "Désactiver",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await setProductMicrostoreEnabled(productId, nextEnabled);
      if (res.success) {
        toast.success(nextEnabled ? "Microstore réactivé pour ce produit" : "Microstore désactivé pour ce produit");
        router.refresh();
      } else {
        toast.error("Impossible de changer l'état", res.error ?? "Erreur inconnue.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSyncRequired() {
    const ok = await confirm({
      type: "warning",
      title: "Ignorer cette synchronisation Microstore ?",
      message:
        "Le badge orange disparaîtra et vos dernières modifications NE seront pas envoyées à Microstore. Vous pourrez toujours renvoyer plus tard en cliquant sur la carte.",
      confirmLabel: "Oui, ignorer",
    });
    if (!ok) return;
    const res = await clearMicrostoreSyncRequired(productId);
    if (res.success) {
      toast.success("Synchronisation ignorée");
      router.refresh();
    } else {
      toast.error("Impossible d'ignorer", res.error ?? "Erreur inconnue.");
    }
  }

  const headerEl = (
    <button
      type="button"
      onClick={handlePush}
      disabled={disabled || busy}
      className={`flex flex-col items-center justify-center gap-0.5 py-0.5 text-[11px] font-semibold font-body bg-transparent border-0 w-full ${textColor} ${
        disabled ? "cursor-not-allowed" : busy ? "cursor-wait" : "cursor-pointer"
      }`}
      title={disabled ? undefined : title}
      aria-label={`Envoyer ${productName} vers Microstore`}
    >
      <span className="inline-flex items-center justify-center gap-1.5">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[8.5px] font-extrabold flex-shrink-0"
          style={{
            background: GRADIENT,
            ...(disabled ? { filter: "grayscale(1) brightness(0.85)" } : {}),
          }}
          aria-hidden
        >
          M
        </span>

        {disabled ? (
          <span className="line-through decoration-[1.5px] decoration-text-muted">Microstore</span>
        ) : busy ? (
          <span className="inline-flex items-center gap-1.5">{Icon.Spinner}Envoi Microstore…</span>
        ) : (
          <span>Microstore</span>
        )}

        {!busy && !disabled && (
          syncRequired ? (
            <span className="relative inline-flex">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-[#F59E0B] opacity-60 animate-ping" />
            </span>
          ) : (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                online ? "bg-[#22C55E] animate-pulse" : "bg-border-dark"
              }`}
            />
          )
        )}
        {disabled && <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />}
      </span>

      {secondaryLabel && (
        <span className="text-[10px] font-bold leading-tight">{secondaryLabel}</span>
      )}
    </button>
  );

  const cardEl = (
    <div
      className={`inline-flex flex-col items-stretch rounded-2xl border pt-1 pb-1.5 px-2.5 w-44 transition-colors ${cardClasses}`}
      style={disabledStyle}
    >
      {headerEl}
      <div className={`flex items-center justify-center gap-1 pt-1 mt-0.5 border-t ${dividerClass}`}>
        <button
          type="button"
          onClick={handleToggleEnabled}
          disabled={busy || !hasMicrostoreConfig}
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors bg-white text-text-secondary border-border hover:bg-bg-secondary ${
            busy || !hasMicrostoreConfig ? "opacity-50 cursor-wait" : ""
          }`}
          title={
            microstoreEnabledForProduct
              ? "Désactiver Microstore pour ce produit"
              : "Réactiver Microstore pour ce produit"
          }
          aria-label={
            microstoreEnabledForProduct
              ? "Désactiver Microstore pour ce produit"
              : "Réactiver Microstore pour ce produit"
          }
        >
          {Icon.Toggle}
        </button>
      </div>
    </div>
  );

  const disabledTooltip = disabledReason;

  return (
    <span className="group relative inline-flex">
      {disabled ? <Tooltip content={disabledTooltip}>{cardEl}</Tooltip> : cardEl}
      {syncRequired && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCancelSyncRequired();
          }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-[#B45309] border border-[#FDE68A] shadow-sm flex items-center justify-center hover:bg-[#FDE68A] hover:text-[#78350F] transition-colors"
          title="Ignorer cette synchronisation (le badge orange disparaîtra et le produit repassera en état « à jour » sans rien envoyer)"
          aria-label="Ignorer cette synchronisation"
        >
          {Icon.Close}
        </button>
      )}
    </span>
  );
}
