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
import { useRightRail } from "@/components/admin/widgets-rail";
import {
  pushProductToMicrostore,
  clearMicrostoreSyncRequired,
  toggleMicrostoreProductDisabled,
  deleteProductFromMicrostore,
} from "@/app/actions/admin/microstore-products";

const GRADIENT = "linear-gradient(135deg,#0891b2,#22d3ee)";

const Icon = {
  // Icône Refresh identique à celle des autres MarketplaceCard (rotation).
  Refresh: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
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
  EyeOff: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  ),
  Eye: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Trash: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
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
  /** Session BOSS/QR Microstore expirée (ou jamais renouvelée) — bloque tout push. */
  microstoreSessionExpired?: boolean;
  /** ID Microstore du produit — null tant que pas publié. Nécessaire pour disable/delete. */
  microstoreProductId?: number | null;
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
  microstoreSessionExpired = false,
  microstoreProductId = null,
}: MicrostoreStatusCardProps) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();
  const { nudgeWidget } = useRightRail();
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"push" | "toggle" | "delete" | null>(null);
  const [locallyDisabled, setLocallyDisabled] = useState(false);

  const online = microstoreLastPushedAt !== null;
  const syncRequired = online && microstoreSyncRequired;
  // Session expirée = même effet qu'un kill switch, mais cas exceptionnel signalé
  // en rouge + libellé « expiré » (à distinguer visuellement de « désactivé »).
  const expired = hasMicrostoreConfig && microstoreSessionExpired;
  const disabled = expired || !microstoreEnabled || !microstoreEnabledForProduct || !hasMicrostoreConfig;
  const disabledReason = expired
    ? "Session Microstore expirée — renouvelez-la dans Paramètres › Marketplaces › Microstore avant d'envoyer."
    : !hasMicrostoreConfig
      ? "Microstore n'est pas configuré. Ajoutez la connexion dans Paramètres › Marketplaces › Microstore."
      : !microstoreEnabled
        ? "Microstore désactivé dans Paramètres."
        : "Microstore désactivé pour ce produit.";

  const cardClasses = expired
    ? "bg-[#FEF2F2] border-[#FECACA]"
    : disabled
      ? "bg-[#FAFAFA] border-border-dark"
      : syncRequired
        ? "sync-required-card bg-[#FEF3C7] border-[#FDE68A]"
        : online
          ? "mp-online-card bg-[#DCFCE7] border-[#BBF7D0]"
          : "mp-offline-card bg-[#f3f4f6] border-[#e5e7eb]";
  const textColor = expired
    ? "text-[#B91C1C]"
    : disabled
      ? "text-text-muted"
      : syncRequired
        ? "sync-required-text text-[#92400E]"
        : online
          ? "mp-online-text text-[#15803D]"
          : "mp-offline-text text-text-secondary";
  const dividerClass = expired
    ? "border-[#FECACA]"
    : disabled
      ? "border-border-dark/60"
      : syncRequired
        ? "sync-required-divider border-[#FDE68A]"
        : online
          ? "mp-online-divide border-[#BBF7D0]"
          : "mp-offline-divide border-[#e5e7eb]";

  // Hachures rouges pour la session expirée (cas exceptionnel), sinon hachures
  // beiges pour l'état désactivé « classique ».
  const disabledStyle: React.CSSProperties | undefined = expired
    ? {
        background:
          "repeating-linear-gradient(45deg,#FEF2F2,#FEF2F2 6px,#FEE2E2 6px,#FEE2E2 12px)",
      }
    : disabled
      ? {
          background:
            "repeating-linear-gradient(45deg,#FAFAFA,#FAFAFA 6px,#F4F4F5 6px,#F4F4F5 12px)",
        }
      : undefined;

  const secondaryLabel = expired
    ? "expiré"
    : disabled
      ? "désactivé"
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
    // Prévient le widget « Photos Microstore » de repasser en poll rapide :
    // le fire-and-forget photos qui suit dure ~5 s, invisible sinon avec le
    // poll idle 60 s. Nudge posé AVANT l'appel pour couvrir la fenêtre
    // PENDING dès la création du job côté serveur.
    nudgeWidget("microstore-upload");
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

  async function handleToggleDisabled() {
    if (disabled || busy || microstoreProductId == null) return;
    const willDisable = !locallyDisabled;
    const ok = await confirm({
      type: "warning",
      title: willDisable
        ? "Masquer ce produit sur Microstore ?"
        : "Réafficher ce produit sur Microstore ?",
      message: willDisable
        ? "La fiche disparaîtra de la vitrine acheteur sur Microstore. Elle reste en base — tu pourras la réafficher d'un clic. Ton stock côté BJ n'est pas touché."
        : "La fiche redeviendra visible sur la vitrine acheteur Microstore, avec ses infos actuelles.",
      confirmLabel: willDisable ? "Oui, masquer" : "Oui, réafficher",
    });
    if (!ok) return;

    setBusy(true);
    setBusyAction("toggle");
    try {
      const res = await toggleMicrostoreProductDisabled(productId, willDisable);
      if (res.success) {
        setLocallyDisabled(willDisable);
        toast.success(willDisable ? "Produit masqué sur Microstore" : "Produit réaffiché sur Microstore");
        router.refresh();
      } else {
        toast.error("Impossible de mettre à jour Microstore", res.error ?? "Erreur inconnue.");
      }
    } finally {
      setBusy(false);
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    if (disabled || busy || microstoreProductId == null) return;
    const ok = await confirm({
      type: "warning",
      title: "Supprimer définitivement ce produit sur Microstore ?",
      message:
        "La fiche sera EFFACÉE côté Microstore (l'ID sera perdu). Le produit reste en base chez toi et pourra être re-publié plus tard (avec un nouvel ID). Ton stock BJ n'est pas touché.",
      confirmLabel: "Oui, supprimer",
    });
    if (!ok) return;

    setBusy(true);
    setBusyAction("delete");
    try {
      const res = await deleteProductFromMicrostore(productId);
      if (res.success) {
        toast.success("Produit supprimé sur Microstore");
        router.refresh();
      } else {
        toast.error("Suppression Microstore échouée", res.error ?? "Erreur inconnue.");
      }
    } finally {
      setBusy(false);
      setBusyAction(null);
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

  // Header non cliquable — l'action « Synchroniser » se fait uniquement via le
  // bouton rond ↻ sous le divider, à l'identique des cartes PFS/Ankor/eFa/Faire.
  const headerEl = (
    <div
      className={`flex flex-col items-center justify-center gap-0.5 py-0.5 text-[11px] font-semibold font-body w-full ${textColor}`}
      title={disabled ? undefined : title}
      aria-label={`Statut Microstore de ${productName}`}
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

        {busy && !disabled ? (
          <span className="inline-flex items-center gap-1.5">{Icon.Spinner}Envoi Microstore…</span>
        ) : (
          <span>Microstore</span>
        )}
      </span>

      {secondaryLabel && (
        <span className="text-[10px] font-bold leading-tight">{secondaryLabel}</span>
      )}
    </div>
  );

  const cardEl = (
    <div
      className={`inline-flex flex-col items-stretch rounded-2xl border pt-1 pb-1.5 px-2.5 w-44 transition-colors ${cardClasses}`}
      style={disabledStyle}
    >
      {headerEl}
      <div className={`flex items-center justify-center gap-1 pt-1 mt-0.5 border-t ${dividerClass}`}>
        {/* Bouton Synchroniser / Publier — inchangé. */}
        <button
          type="button"
          onClick={handlePush}
          disabled={disabled || busy}
          className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors bg-white ${
            online
              ? "text-[#15803D] border-[#BBF7D0] hover:bg-[#F0FDF4]"
              : "text-[#0e7490] border-[#a5f3fc] hover:bg-[#ecfeff]"
          } ${disabled || (busy && busyAction === "push") ? "opacity-50 cursor-wait" : ""}`}
          title={
            busy && busyAction === "push"
              ? "Envoi Microstore en cours…"
              : online
                ? "Synchroniser vers Microstore"
                : "Envoyer vers Microstore (première publication)"
          }
          aria-label="Synchroniser vers Microstore"
        >
          {busy && busyAction === "push" ? Icon.Spinner : Icon.Refresh}
        </button>

        {/* Boutons Masquer/Afficher + Supprimer — visibles uniquement si publié
            sur Microstore (microstoreProductId connu). */}
        {online && microstoreProductId != null && (
          <>
            <button
              type="button"
              onClick={handleToggleDisabled}
              disabled={disabled || busy}
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors bg-white text-[#0e7490] border-[#a5f3fc] hover:bg-[#ecfeff] ${
                disabled || (busy && busyAction === "toggle") ? "opacity-50 cursor-wait" : ""
              }`}
              title={
                busy && busyAction === "toggle"
                  ? "Mise à jour Microstore…"
                  : locallyDisabled
                    ? "Réafficher sur Microstore"
                    : "Masquer sur Microstore"
              }
              aria-label={locallyDisabled ? "Réafficher sur Microstore" : "Masquer sur Microstore"}
            >
              {busy && busyAction === "toggle"
                ? Icon.Spinner
                : locallyDisabled
                  ? Icon.Eye
                  : Icon.EyeOff}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={disabled || busy}
              className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors bg-white text-[#B91C1C] border-[#FECACA] hover:bg-[#FEF2F2] ${
                disabled || (busy && busyAction === "delete") ? "opacity-50 cursor-wait" : ""
              }`}
              title={
                busy && busyAction === "delete"
                  ? "Suppression Microstore…"
                  : "Supprimer définitivement sur Microstore"
              }
              aria-label="Supprimer sur Microstore"
            >
              {busy && busyAction === "delete" ? Icon.Spinner : Icon.Trash}
            </button>
          </>
        )}
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
