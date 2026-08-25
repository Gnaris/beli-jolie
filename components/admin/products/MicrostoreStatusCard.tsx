"use client";

/**
 * Carte marketplace « Microstore » — variante simplifiée de MarketplaceCard.
 *
 * Depuis 2026-08-25, Microstore passe par la même file asynchrone que
 * PFS / Ankor / eFashion / Faire / Orderchamp (MarketplaceRefreshQueue) : le
 * bouton « publier / synchroniser » enqueue un job qui s'affiche dans le
 * tiroir Marketplaces à droite, avec sa timeline d'étapes. Plus de toast en
 * bas d'écran — le retour visuel se fait uniquement via le widget.
 *
 * `clearMicrostoreSyncRequired` et `unlinkMicrostoreProduct` restent des
 * appels directs : ce sont des ops 100 % locales (baisse de flag DB / reset
 * des IDs), aucune API Microstore n'est frappée.
 */

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { useRightRail } from "@/components/admin/widgets-rail";
import { useMarketplaceRefreshQueue } from "@/components/admin/products/MarketplaceRefreshContext";
import { clearMicrostoreSyncRequired } from "@/app/actions/admin/microstore-products";
import { unlinkMicrostoreProduct } from "@/app/actions/admin/microstore-linking";

const LinkMicrostoreProductModal = dynamic(() => import("./LinkMicrostoreProductModal"));

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
  Link: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  ),
  Unlink: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
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
  /** ID Microstore du produit — null tant que pas publié. Nécessaire pour délier. */
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
  const { enqueue, inFlightProductIds } = useMarketplaceRefreshQueue();
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [unlinkBusy, setUnlinkBusy] = useState(false);
  // Dernière action lancée (push). Sert uniquement à mettre le bon spinner sur
  // le bon bouton pendant que le job tourne dans la file.
  const [busyAction, setBusyAction] = useState<"push" | null>(null);
  const inFlight = inFlightProductIds.has(productId);
  const busy = inFlight;
  useEffect(() => {
    if (!inFlight) setBusyAction(null);
  }, [inFlight]);

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

    setBusyAction("push");
    // Prévient le widget « Photos Microstore » de repasser en poll rapide :
    // le fire-and-forget photos qui suit dure ~5 s, invisible sinon avec le
    // poll idle 60 s. Nudge posé AVANT l'enqueue pour couvrir la fenêtre
    // PENDING dès la création du job côté serveur.
    nudgeWidget("microstore-upload");
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage: null,
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: false, orderchamp: false, microstore: true },
        mode: "publish",
        marketplace: "microstore",
        intent: microstoreProductId != null ? "update" : "create",
      },
    ]);
  }

  async function handleUnlink() {
    if (disabled || busy || unlinkBusy || microstoreProductId == null) return;
    const ok = await confirm({
      type: "warning",
      title: "Délier de Microstore ?",
      message:
        "Le lien entre ce produit et sa fiche Microstore sera effacé côté site. " +
        "Aucune action n'est faite sur Microstore : la fiche existante y restera telle quelle. " +
        "Prochain envoi = création d'une nouvelle fiche Microstore (avec risque de doublon).",
      confirmLabel: "Oui, délier",
    });
    if (!ok) return;
    setUnlinkBusy(true);
    try {
      const res = await unlinkMicrostoreProduct(productId);
      if (res.success) {
        toast.success("Produit délié de Microstore");
        router.refresh();
      } else {
        toast.error("Impossible de délier", res.error ?? "Erreur inconnue.");
      }
    } catch (err) {
      toast.error("Échec du déliage", err instanceof Error ? err.message : String(err));
    } finally {
      setUnlinkBusy(false);
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
    if (!res.success) {
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
      {!disabled && (
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

        {/* Bouton Lier / Délier — ouvre la modale de liaison manuelle. Toujours
            visible tant que Microstore est configuré : permet de rattacher un
            produit BJ à une fiche Microstore existante (avant premier push) ou
            de délier un produit déjà lié. */}
        {hasMicrostoreConfig && (
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            disabled={busy}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors bg-white ${
              microstoreProductId != null
                ? "text-[#15803D] border-[#BBF7D0] hover:bg-[#F0FDF4]"
                : "text-[#0e7490] border-[#a5f3fc] hover:bg-[#ecfeff]"
            } ${busy ? "opacity-50 cursor-wait" : ""}`}
            title={
              microstoreProductId != null
                ? `Lié à Microstore #${microstoreProductId} — cliquez pour délier ou re-rattacher`
                : "Lier à une fiche Microstore existante (sans re-publier)"
            }
            aria-label="Liaison Microstore"
          >
            {Icon.Link}
          </button>
        )}

        {/* Bouton Délier — visible uniquement si publié sur Microstore
            (microstoreProductId connu). Efface la liaison côté site sans
            toucher à la fiche Microstore, comme les autres marketplaces. */}
        {microstoreProductId != null && (
          <button
            type="button"
            onClick={handleUnlink}
            disabled={disabled || busy || unlinkBusy}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full border transition-colors bg-white text-[#B91C1C] border-[#FECACA] hover:bg-[#FEF2F2] ${
              disabled || unlinkBusy ? "opacity-50 cursor-wait" : ""
            }`}
            title="Délier ce produit de sa fiche Microstore (efface la liaison côté site sans toucher à Microstore)"
            aria-label="Délier ce produit de Microstore"
          >
            {unlinkBusy ? Icon.Spinner : Icon.Unlink}
          </button>
        )}
      </div>
      )}
    </div>
  );

  const disabledTooltip = disabledReason;

  return (
    <span className="group relative inline-flex">
      {disabled ? <Tooltip content={disabledTooltip}>{cardEl}</Tooltip> : cardEl}
      {syncRequired && !disabled && (
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
      {linkModalOpen && (
        <LinkMicrostoreProductModal
          open={linkModalOpen}
          onClose={() => setLinkModalOpen(false)}
          productId={productId}
          reference={reference}
          productName={productName}
          currentMicrostoreProductId={microstoreProductId ?? null}
          microstoreLastPushedAt={microstoreLastPushedAt}
        />
      )}
    </span>
  );
}
