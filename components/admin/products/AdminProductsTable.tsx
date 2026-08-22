"use client";

import React, { useState, useTransition, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  bulkUpdateProductStatus,
  bulkUpdateProductAttributes,
  bulkDeleteProducts,
  bulkTranslateProducts,
  bulkAddTagsToProducts,
  bulkRemoveTagsFromProducts,
  previewProductDeletion,
  updateVariantQuick,
} from "@/app/actions/admin/products";
import { bulkAddProductsToCollection } from "@/app/actions/admin/collections";
import { deleteProductsOnPfs, deleteProductsOnAnkorstore, deleteProductsOnEfashion, deleteProductsOnFaire, deleteProductsOnOrderchamp } from "@/app/actions/admin/marketplace-delete";
import { clearSyncRequiredFlag } from "@/app/actions/admin/marketplace-sync-flags";
import { bulkAddToEfashionShootingBatch } from "@/app/actions/admin/efashion-shooting-batch";
import BulkEditAttributesModal, { type BulkEditOptions, type BulkEditPayload } from "@/components/admin/products/BulkEditAttributesModal";
import BulkTagsModal, { type BulkTagsOption } from "@/components/admin/products/BulkTagsModal";
import BulkAddToCollectionModal, { type BulkCollectionOption } from "@/components/admin/products/BulkAddToCollectionModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useOtpConfirm } from "@/components/ui/OtpConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useRefreshMarketplaceDialog } from "@/components/admin/products/useRefreshMarketplaceDialog";
import { useRefreshMarketplacePrompt } from "@/components/admin/products/RefreshMarketplaceDialog";
import {
  allCandidateIds,
  buildMarketplaceInputs,
  hasAnyCandidate,
  type MarketplaceCandidates,
} from "@/lib/marketplace-propagation";
import { Tooltip } from "@/components/ui/Tooltip";
import { ProductLockToggle } from "@/components/admin/products/ProductLockToggle";
import { ProductImportantToggle } from "@/components/admin/products/ProductImportantToggle";
import { useMarketplaceRefreshQueue } from "@/components/admin/products/MarketplaceRefreshContext";
import { useMarketplaceLinkJobs } from "@/components/admin/products/MarketplaceLinkContext";
import { useEfashionShootingBatch } from "@/components/admin/products/EfashionShootingBatchContext";
import { useRightRail } from "@/components/admin/widgets-rail/RightRailContext";
import { useFilterPending } from "@/components/admin/products/FilterPendingContext";
import { findLatestOpForProduct, computeMarketplaceBadgeState } from "@/components/admin/products/marketplaceBadgeState";
import { useMarketplaceMaintenance } from "@/components/admin/products/MarketplaceMaintenanceContext";
import { computeBulkVariantMarketplaceTargets } from "@/lib/bulk-variant-marketplace-targets";
import { isMicrostorePropagationEligible } from "@/lib/microstore-propagation-eligibility";
import { isOrderchampPropagationEligible } from "@/lib/orderchamp-propagation-eligibility";
import {
  MISSING_FIELD_LABELS,
  MISSING_FIELD_TITLES,
  type MissingField,
} from "@/lib/product-missing-fields";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import { formatRelativeDate } from "@/lib/format-date";
import { buildProductHandle } from "@/lib/product-url";
import { MarketplacePushModal } from "@/components/admin/products/MarketplacePushModal";
import BulkActionBar, { type MarketplaceKey } from "@/components/admin/products/BulkActionBar";
import PfsVerifyBadge, { type PfsVerifyIssue } from "@/components/admin/products/PfsVerifyBadge";

const MARKETPLACE_LABEL: Record<MarketplaceKey, string> = {
  pfs: "Paris Fashion Shop",
  ankorstore: "Ankorstore",
  efashion: "eFashion Paris",
  faire: "Faire",
  orderchamp: "Orderchamp",
  microstore: "Microstore",
};

// Modales lourdes — chargées à l'ouverture seulement pour alléger le bundle
// initial de la table produits (cf. audit perf 2026-05-31).
const LinkPfsProductModal = dynamic(
  () => import("@/components/admin/products/LinkMarketplaceModal"),
);
// Ankorstore utilise sa propre modale (nouveau flow back-office reverse), pas le modale unifié.
const LinkAnkorstoreProductModal = dynamic(
  () => import("@/components/admin/products/LinkAnkorstoreProductModal"),
);
const LinkEfashionProductModal = LinkPfsProductModal;
const LinkFaireProductModal = LinkPfsProductModal;
const LinkOrderchampProductModal = LinkPfsProductModal;
const BulkPublishDraftsModal = dynamic(
  () => import("@/components/admin/products/BulkPublishDraftsModal"),
);

// ─── Rule helpers ──────────────────────────────────────────────────────────────

/**
 * Drafts (OFFLINE ou isIncomplete) n'exposent jamais de signal de stock.
 * Produits ARCHIVÉS : on affiche le badge "Rupture" (utile pour repérer ceux
 * auto-archivés à stock=0) mais pas "Stock partiel" (signal sans valeur car
 * non vendable). Exporté pour les tests unitaires.
 */
export function computeShowStockBadges(
  p: { status: string; isIncomplete: boolean },
  kind: "rupture" | "partial" = "partial",
): boolean {
  if (p.isIncomplete) return false;
  if (p.status === "OFFLINE") return false;
  if (p.status === "ARCHIVED") return kind === "rupture";
  return true;
}

/**
 * Éligibilité des actions par ligne dans le menu "Actions" — exporté pour tests.
 *
 * - `canPutOnline` : false si déjà ONLINE ou si le produit est incomplet
 *   (la mise en ligne échouerait côté serveur faute d'image obligatoire).
 * - `canPutOffline` / `canArchive` : false si le produit est déjà dans ce statut.
 * - `canSync` : true si publié sur au moins une marketplace active (PFS et/ou
 *   Ankorstore avec kill-switch ON), sinon il n'y a rien à resynchroniser.
 */
export interface RowActionContext {
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  /** Optionnels pour rétro-compat des tests : on les traite comme false si absents. */
  hasEfashionConfig?: boolean;
  efashionEnabled?: boolean;
  hasFaireConfig?: boolean;
  faireEnabled?: boolean;
  hasOrderchampConfig?: boolean;
  orderchampEnabled?: boolean;
  hasMicrostoreConfig?: boolean;
}

export interface RowActionEligibility {
  canPutOnline: boolean;
  putOnlineReason?: string;
  canPutOffline: boolean;
  canArchive: boolean;
  canSync: boolean;
  /**
   * `canPublishPfs` : true si PFS est configuré, que le produit n'y est pas
   * encore (pas de `pfsProductId`), et que la fiche locale n'est pas
   * incomplète. Conditionne l'affichage du bouton "Publier sur PFS" dans le
   * badge et le menu Actions.
   */
  canPublishPfs: boolean;
  publishPfsReason?: string;
  /**
   * `canPublishAnkorstore` : true si Ankorstore est configuré + activé,
   * que le produit n'y est pas encore (pas d'`ankorsProductId`), et que la
   * fiche locale n'est pas incomplète. Sert à conditionner l'affichage du
   * bouton "Publier sur Ankorstore" dans le badge et le menu Actions.
   */
  canPublishAnkorstore: boolean;
  publishAnkorstoreReason?: string;
  /**
   * `canPublishEfashion` : true si eFashion est configuré + activé, que le
   * produit n'y est pas encore lié (aucune variante avec efashionProductId)
   * et que la fiche locale n'est pas incomplète.
   */
  canPublishEfashion: boolean;
  publishEfashionReason?: string;
  /** `canPublishFaire` : true si Faire est configuré + activé, que le produit
   * n'y est pas encore publié, et que la fiche locale n'est pas incomplète. */
  canPublishFaire: boolean;
  publishFaireReason?: string;
  /** `canPublishOrderchamp` : true si Orderchamp est configuré + activé, que le
   * produit n'y est pas encore publié, et que la fiche locale n'est pas incomplète. */
  canPublishOrderchamp: boolean;
  publishOrderchampReason?: string;
}

export function computeRowActionEligibility(
  product: {
    status: string;
    isIncomplete: boolean;
    pfsProductId: string | null;
    ankorsProductId: string | null;
    efashionLinked?: boolean;
    fairePublished?: boolean;
    orderchampPublished?: boolean;
  },
  ctx: RowActionContext,
): RowActionEligibility {
  const showAnkorstore = ctx.hasAnkorstoreConfig && ctx.ankorstoreEnabled;
  const showEfashion = !!(ctx.hasEfashionConfig && ctx.efashionEnabled);
  const syncPfs = ctx.hasPfsConfig && !!product.pfsProductId;
  const syncAnkors = showAnkorstore && !!product.ankorsProductId;
  const syncEfashion = showEfashion && !!product.efashionLinked;

  let putOnlineReason: string | undefined;
  if (product.status === "ONLINE") putOnlineReason = "Déjà en ligne";
  else if (product.isIncomplete) putOnlineReason = "Produit incomplet — complétez la fiche d'abord";

  let publishPfsReason: string | undefined;
  let canPublishPfs = false;
  if (!ctx.hasPfsConfig) {
    publishPfsReason = "Paris Fashion Shop n'est pas configuré";
  } else if (product.pfsProductId) {
    publishPfsReason = "Déjà publié sur Paris Fashion Shop";
  } else if (product.isIncomplete) {
    publishPfsReason = "Produit incomplet — complétez la fiche d'abord";
  } else {
    canPublishPfs = true;
  }

  let publishAnkorstoreReason: string | undefined;
  let canPublishAnkorstore = false;
  if (!showAnkorstore) {
    publishAnkorstoreReason = "Ankorstore n'est pas configuré ou est désactivé";
  } else if (product.ankorsProductId) {
    publishAnkorstoreReason = "Déjà publié sur Ankorstore";
  } else if (product.isIncomplete) {
    publishAnkorstoreReason = "Produit incomplet — complétez la fiche d'abord";
  } else {
    canPublishAnkorstore = true;
  }

  let publishEfashionReason: string | undefined;
  let canPublishEfashion = false;
  if (!showEfashion) {
    publishEfashionReason = "eFashion Paris n'est pas configuré ou est désactivé";
  } else if (product.efashionLinked) {
    publishEfashionReason = "Déjà lié à eFashion Paris";
  } else if (product.isIncomplete) {
    publishEfashionReason = "Produit incomplet — complétez la fiche d'abord";
  } else {
    canPublishEfashion = true;
  }

  const showFaire = !!(ctx.hasFaireConfig && ctx.faireEnabled);
  let publishFaireReason: string | undefined;
  let canPublishFaire = false;
  if (!showFaire) {
    publishFaireReason = "Faire n'est pas configuré ou est désactivé";
  } else if (product.fairePublished) {
    publishFaireReason = "Déjà publié sur Faire";
  } else if (product.isIncomplete) {
    publishFaireReason = "Produit incomplet — complétez la fiche d'abord";
  } else {
    canPublishFaire = true;
  }

  const showOrderchamp = !!(ctx.hasOrderchampConfig && ctx.orderchampEnabled);
  let publishOrderchampReason: string | undefined;
  let canPublishOrderchamp = false;
  if (!showOrderchamp) {
    publishOrderchampReason = "Orderchamp n'est pas configuré ou est désactivé";
  } else if (product.orderchampPublished) {
    publishOrderchampReason = "Déjà publié sur Orderchamp";
  } else if (product.isIncomplete) {
    publishOrderchampReason = "Produit incomplet — complétez la fiche d'abord";
  } else {
    canPublishOrderchamp = true;
  }

  return {
    canPutOnline: product.status !== "ONLINE" && !product.isIncomplete,
    putOnlineReason,
    canPutOffline: product.status !== "OFFLINE",
    canArchive: product.status !== "ARCHIVED",
    canSync: !!(syncPfs || syncAnkors || syncEfashion),
    canPublishPfs,
    publishPfsReason,
    canPublishAnkorstore,
    publishAnkorstoreReason,
    canPublishEfashion,
    publishEfashionReason,
    canPublishFaire,
    publishFaireReason,
    canPublishOrderchamp,
    publishOrderchampReason,
  };
}

/**
 * Vrai si la colonne « Marketplaces » doit afficher un message « impossible de
 * lier » à la place des badges PFS / Ankorstore / eFashion. C'est le cas pour
 * un produit en brouillon (fiche incomplète) qui n'a encore été publié ou lié
 * sur aucune marketplace — afficher 3 badges grisés ne dit rien à l'utilisateur,
 * un message clair est plus utile. Exporté pour les tests unitaires.
 */
export function shouldShowDraftMarketplaceNotice(p: {
  isIncomplete: boolean;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  efashionLinked: boolean;
}): boolean {
  return p.isIncomplete && !p.pfsProductId && !p.ankorsProductId && !p.efashionLinked;
}

/**
 * Renvoie les IDs des produits sélectionnés qui sont de VRAIS brouillons —
 * càd `status === "OFFLINE"` ET `isIncomplete === true`. Utilisé par le bouton
 * « Publier brouillons » de la barre d'actions bulk : un produit simplement mis
 * hors ligne par l'admin (fiche complète, ex T166E) ne doit PAS déclencher ce
 * bouton, car il n'y a rien à finaliser. Exporté pour les tests unitaires.
 */
export function computeSelectedDraftIds<
  T extends { id: string; status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING"; isIncomplete: boolean },
>(products: readonly T[], selectedIds: ReadonlySet<string>): string[] {
  return products
    .filter((p) => selectedIds.has(p.id) && p.status === "OFFLINE" && p.isIncomplete)
    .map((p) => p.id);
}

// ─── Marketplace publish badge ─────────────────────────────────────────────────

function DisabledMarketplaceBadge({
  label,
  reason = "product",
}: {
  label: string;
  /** "maintenance" = coupure plateforme, "global" = kill switch Paramètres OFF, "product" = case décochée par la cliente. */
  reason?: "product" | "maintenance" | "global";
}) {
  const tooltip =
    reason === "maintenance"
      ? `${label} · en maintenance sur la plateforme`
      : reason === "global"
        ? `${label} · marketplace désactivée dans Paramètres`
        : `${label} · désactivée pour ce produit`;
  return (
    <Tooltip content={tooltip}>
      <span
        className="inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold text-text-muted border border-border-dark cursor-not-allowed"
        style={{
          background:
            "repeating-linear-gradient(45deg,#FAFAFA,#FAFAFA 6px,#F4F4F5 6px,#F4F4F5 12px)",
        }}
      >
        <span className="line-through decoration-[1.5px] decoration-text-muted">
          {label}
        </span>
      </span>
    </Tooltip>
  );
}

// Petite croix affichée en haut à droite d'un badge orange « Synchro nécessaire ».
// Un clic annule la synchro (le drapeau syncRequired est effacé, aucun envoi
// n'est fait vers la marketplace). Le parent est responsable de la confirmation
// et du toast — ici, on ne fait qu'appeler la callback.
function SyncCancelCross({ onClick, marketplaceLabel }: { onClick: () => void; marketplaceLabel: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-[#B45309] border border-[#FED7AA] shadow-sm flex items-center justify-center hover:bg-[#FED7AA] hover:text-[#78350F] transition-colors z-10"
      title={`Ignorer cette synchronisation ${marketplaceLabel} (le badge orange disparaîtra et le produit repassera en état « en ligne » sans rien envoyer)`}
      aria-label={`Ignorer la synchronisation ${marketplaceLabel}`}
    >
      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

function MarketplaceBadge({
  published,
  publishing = false,
  syncRequired = false,
  lastExportedAt = null,
  onActionClick,
  onSyncClick,
  onCancelSyncRequired,
  disabledForProduct = false,
  disabledReason,
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  /** Ouvre la modale Publier/Lier (le parent gère ensuite les actions). */
  onActionClick?: () => void;
  onSyncClick?: () => void;
  onCancelSyncRequired?: () => void;
  disabledForProduct?: boolean;
  disabledReason?: "product" | "maintenance";
}) {
  if (disabledForProduct) return <DisabledMarketplaceBadge label="PFS" reason={disabledReason} />;
  if (publishing) {
    return (
      <span
        className="inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE] leading-tight"
        title="Publication PFS en cours…"
      >
        <svg
          className="w-3 h-3 animate-spin shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        <span>PFS</span>
      </span>
    );
  }
  if (published && syncRequired) {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick?.();
          }}
          className="inline-flex flex-row items-center justify-center gap-1.5 w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold sync-required-badge bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
          title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Paris Fashion Shop"
        >
          <span className="relative inline-flex">
            <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse pointer-coarse:animate-none" />
            <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping pointer-coarse:animate-none" />
          </span>
          PFS
        </button>
        {onCancelSyncRequired && (
          <SyncCancelCross onClick={onCancelSyncRequired} marketplaceLabel="Paris Fashion Shop" />
        )}
      </span>
    );
  }
  if (published) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (!onSyncClick) return;
          e.stopPropagation();
          onSyncClick();
        }}
        disabled={!onSyncClick}
        className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] ${
          onSyncClick ? "hover:bg-[#DCFCE7] hover:border-[#86EFAC] cursor-pointer transition-colors" : "cursor-default"
        }`}
        title={
          onSyncClick
            ? `Cliquer pour synchroniser sur Paris Fashion Shop${lastExportedAt ? ` — dernier export ${formatRelativeDate(lastExportedAt)}` : ""}`
            : lastExportedAt
              ? `Publié sur Paris Fashion Shop — dernier export ${formatRelativeDate(lastExportedAt)}`
              : "Publié sur Paris Fashion Shop"
        }
      >
        PFS
      </button>
    );
  }
  // Non publié : badge entièrement cliquable qui ouvre la modale (Publier/Lier)
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!onActionClick) return;
        e.stopPropagation();
        onActionClick();
      }}
      disabled={!onActionClick}
      className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold transition-colors ${
        onActionClick
          ? "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] cursor-pointer"
          : "bg-bg-secondary text-text-muted border border-border opacity-60 cursor-not-allowed"
      }`}
      title={onActionClick ? "Cliquer pour publier ou lier ce produit sur Paris Fashion Shop" : "Non publié sur Paris Fashion Shop"}
    >
      PFS
    </button>
  );
}

function AnkorstoreBadge({
  published,
  publishing = false,
  syncRequired = false,
  lastExportedAt = null,
  onActionClick,
  onSyncClick,
  onCancelSyncRequired,
  disabledForProduct = false,
  disabledReason,
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
  onCancelSyncRequired?: () => void;
  disabledForProduct?: boolean;
  disabledReason?: "product" | "maintenance";
}) {
  if (disabledForProduct) return <DisabledMarketplaceBadge label="ANKOR" reason={disabledReason} />;
  if (publishing) {
    return (
      <span
        className="inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE] leading-tight"
        title="Publication Ankorstore en cours… (1 à 5 minutes)"
      >
        <svg
          className="w-3 h-3 animate-spin shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        <span>ANKOR</span>
      </span>
    );
  }
  if (published && syncRequired) {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick?.();
          }}
          className="inline-flex flex-row items-center justify-center gap-1.5 w-[62px] h-[36px] rounded-md text-[11px] font-semibold sync-required-badge bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
          title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Ankorstore"
        >
          <span className="relative inline-flex">
            <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse pointer-coarse:animate-none" />
            <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping pointer-coarse:animate-none" />
          </span>
          ANKOR
        </button>
        {onCancelSyncRequired && (
          <SyncCancelCross onClick={onCancelSyncRequired} marketplaceLabel="Ankorstore" />
        )}
      </span>
    );
  }
  if (published) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (!onSyncClick) return;
          e.stopPropagation();
          onSyncClick();
        }}
        disabled={!onSyncClick}
        className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] ${
          onSyncClick ? "hover:bg-[#DCFCE7] hover:border-[#86EFAC] cursor-pointer transition-colors" : "cursor-default"
        }`}
        title={
          onSyncClick
            ? `Cliquer pour synchroniser sur Ankorstore${lastExportedAt ? ` — dernier export ${formatRelativeDate(lastExportedAt)}` : ""}`
            : lastExportedAt
              ? `Publié sur Ankorstore — dernier export ${formatRelativeDate(lastExportedAt)}`
              : "Publié sur Ankorstore"
        }
      >
        ANKOR
      </button>
    );
  }
  // Non publié : badge cliquable qui ouvre la modale (Publier/Lier)
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!onActionClick) return;
        e.stopPropagation();
        onActionClick();
      }}
      disabled={!onActionClick}
      className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11px] font-semibold transition-colors ${
        onActionClick
          ? "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] cursor-pointer"
          : "bg-bg-secondary text-text-muted border border-border opacity-60 cursor-not-allowed"
      }`}
      title={onActionClick ? "Cliquer pour publier ou lier ce produit sur Ankorstore" : "Non publié sur Ankorstore"}
    >
      ANKOR
    </button>
  );
}

function EfashionBadge({
  linked,
  publishing = false,
  syncRequired = false,
  lastExportedAt = null,
  onActionClick,
  onSyncClick,
  onCancelSyncRequired,
  disabledForProduct = false,
  disabledReason,
  shootingPending = null,
  onShootingClick,
}: {
  linked: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
  onCancelSyncRequired?: () => void;
  disabledForProduct?: boolean;
  disabledReason?: "product" | "maintenance";
  shootingPending?: "PUBLISH" | "REFRESH" | null;
  onShootingClick?: () => void;
}) {
  if (disabledForProduct) return <DisabledMarketplaceBadge label="EF" reason={disabledReason} />;
  if (publishing) {
    return (
      <span
        className="inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE] leading-tight"
        title="Publication eFashion Paris en cours…"
      >
        <svg
          className="w-3 h-3 animate-spin shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        <span>EF</span>
      </span>
    );
  }
  if (shootingPending) {
    const tooltip =
      shootingPending === "PUBLISH"
        ? "Ajouté au shooting eFashion (Publication) — cliquez pour ouvrir la fenêtre Shooting"
        : "Ajouté au shooting eFashion (Rafraîchissement) — cliquez pour ouvrir la fenêtre Shooting";
    return (
      <button
        type="button"
        onClick={(e) => {
          if (!onShootingClick) return;
          e.stopPropagation();
          onShootingClick();
        }}
        disabled={!onShootingClick}
        className={`inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10.5px] font-semibold bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] leading-tight ${
          onShootingClick ? "hover:bg-[#FDE68A] hover:border-[#FCD34D] cursor-pointer transition-colors" : "cursor-default"
        }`}
        title={tooltip}
      >
        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.822 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
        <span>EF</span>
      </button>
    );
  }
  if (linked && syncRequired) {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick?.();
          }}
          className="inline-flex flex-row items-center justify-center gap-1.5 w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold sync-required-badge bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
          title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à eFashion Paris"
        >
          <span className="relative inline-flex">
            <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse pointer-coarse:animate-none" />
            <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping pointer-coarse:animate-none" />
          </span>
          EF
        </button>
        {onCancelSyncRequired && (
          <SyncCancelCross onClick={onCancelSyncRequired} marketplaceLabel="eFashion Paris" />
        )}
      </span>
    );
  }
  if (linked) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (!onSyncClick) return;
          e.stopPropagation();
          onSyncClick();
        }}
        disabled={!onSyncClick}
        className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] ${
          onSyncClick ? "hover:bg-[#DCFCE7] hover:border-[#86EFAC] cursor-pointer transition-colors" : "cursor-default"
        }`}
        title={
          onSyncClick
            ? `Cliquer pour synchroniser sur eFashion Paris${lastExportedAt ? ` — dernier export ${formatRelativeDate(lastExportedAt)}` : ""}`
            : lastExportedAt
              ? `Lié à eFashion Paris — dernier export ${formatRelativeDate(lastExportedAt)}`
              : "Lié à eFashion Paris"
        }
      >
        EF
      </button>
    );
  }
  // Non lié : badge cliquable qui ouvre la modale (Publier/Lier)
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!onActionClick) return;
        e.stopPropagation();
        onActionClick();
      }}
      disabled={!onActionClick}
      className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold transition-colors ${
        onActionClick
          ? "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] cursor-pointer"
          : "bg-bg-secondary text-text-muted border border-border opacity-60 cursor-not-allowed"
      }`}
      title={onActionClick ? "Cliquer pour publier ou lier ce produit sur eFashion Paris" : "Non lié à eFashion Paris"}
    >
      EF
    </button>
  );
}

function FaireBadge({
  published,
  publishing = false,
  syncRequired = false,
  lastExportedAt = null,
  onActionClick,
  onSyncClick,
  onCancelSyncRequired,
  disabledForProduct = false,
  disabledReason,
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
  onCancelSyncRequired?: () => void;
  disabledForProduct?: boolean;
  disabledReason?: "product" | "maintenance";
}) {
  if (disabledForProduct) return <DisabledMarketplaceBadge label="Faire" reason={disabledReason} />;
  if (publishing) {
    return (
      <span
        className="inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE] leading-tight"
        title="Publication Faire en cours…"
      >
        <svg
          className="w-3 h-3 animate-spin shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        <span>Faire</span>
      </span>
    );
  }
  if (published && syncRequired) {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick?.();
          }}
          className="inline-flex flex-row items-center justify-center gap-1.5 w-[62px] h-[36px] rounded-md text-[11px] font-semibold sync-required-badge bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
          title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Faire"
        >
          <span className="relative inline-flex">
            <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse pointer-coarse:animate-none" />
            <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping pointer-coarse:animate-none" />
          </span>
          Faire
        </button>
        {onCancelSyncRequired && (
          <SyncCancelCross onClick={onCancelSyncRequired} marketplaceLabel="Faire" />
        )}
      </span>
    );
  }
  if (published) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (!onSyncClick) return;
          e.stopPropagation();
          onSyncClick();
        }}
        disabled={!onSyncClick}
        className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] ${
          onSyncClick ? "hover:bg-[#DCFCE7] hover:border-[#86EFAC] cursor-pointer transition-colors" : "cursor-default"
        }`}
        title={
          onSyncClick
            ? `Cliquer pour synchroniser sur Faire${lastExportedAt ? ` — dernier export ${formatRelativeDate(lastExportedAt)}` : ""}`
            : lastExportedAt
              ? `Publié sur Faire — dernier export ${formatRelativeDate(lastExportedAt)}`
              : "Publié sur Faire"
        }
      >
        Faire
      </button>
    );
  }
  // Non publié : badge cliquable qui ouvre la modale (Publier/Lier)
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!onActionClick) return;
        e.stopPropagation();
        onActionClick();
      }}
      disabled={!onActionClick}
      className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11px] font-semibold transition-colors ${
        onActionClick
          ? "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] cursor-pointer"
          : "bg-bg-secondary text-text-muted border border-border opacity-60 cursor-not-allowed"
      }`}
      title={onActionClick ? "Cliquer pour publier ou lier ce produit sur Faire" : "Non publié sur Faire"}
    >
      Faire
    </button>
  );
}

function OrderchampBadge({
  published,
  publishing = false,
  syncRequired = false,
  lastExportedAt = null,
  onActionClick,
  onSyncClick,
  onCancelSyncRequired,
  disabledForProduct = false,
  disabledReason,
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
  onCancelSyncRequired?: () => void;
  disabledForProduct?: boolean;
  disabledReason?: "product" | "maintenance";
}) {
  if (disabledForProduct) return <DisabledMarketplaceBadge label="OC" reason={disabledReason} />;
  if (publishing) {
    return (
      <span
        className="inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE] leading-tight"
        title="Publication Orderchamp en cours…"
      >
        <svg
          className="w-3 h-3 animate-spin shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        <span>OC</span>
      </span>
    );
  }
  if (published && syncRequired) {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick?.();
          }}
          className="inline-flex flex-row items-center justify-center gap-1.5 w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold sync-required-badge bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
          title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Orderchamp"
        >
          <span className="relative inline-flex">
            <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse pointer-coarse:animate-none" />
            <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping pointer-coarse:animate-none" />
          </span>
          OC
        </button>
        {onCancelSyncRequired && (
          <SyncCancelCross onClick={onCancelSyncRequired} marketplaceLabel="Orderchamp" />
        )}
      </span>
    );
  }
  if (published) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (!onSyncClick) return;
          e.stopPropagation();
          onSyncClick();
        }}
        disabled={!onSyncClick}
        className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] ${
          onSyncClick ? "hover:bg-[#DCFCE7] hover:border-[#86EFAC] cursor-pointer transition-colors" : "cursor-default"
        }`}
        title={
          onSyncClick
            ? `Cliquer pour synchroniser sur Orderchamp${lastExportedAt ? ` — dernier export ${formatRelativeDate(lastExportedAt)}` : ""}`
            : lastExportedAt
              ? `Publié sur Orderchamp — dernier export ${formatRelativeDate(lastExportedAt)}`
              : "Publié sur Orderchamp"
        }
        aria-label="Publié sur Orderchamp"
      >
        OC
      </button>
    );
  }
  // Non publié : badge cliquable qui ouvre la modale (Publier/Lier)
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!onActionClick) return;
        e.stopPropagation();
        onActionClick();
      }}
      disabled={!onActionClick}
      className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold transition-colors ${
        onActionClick
          ? "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] cursor-pointer"
          : "bg-bg-secondary text-text-muted border border-border opacity-60 cursor-not-allowed"
      }`}
      title={onActionClick ? "Cliquer pour publier ou lier ce produit sur Orderchamp" : "Non publié sur Orderchamp"}
      aria-label="Publier ou lier sur Orderchamp"
    >
      OC
    </button>
  );
}

function MicrostoreBadge({
  configured,
  syncRequired = false,
  onSyncClick,
  onCancelSyncRequired,
  disabledForProduct = false,
  disabledGlobally = false,
}: {
  /** Microstore n'a pas d'ID marketplace côté produit — on considère qu'il est
   *  actif dès qu'il est configuré globalement ET pas décoché pour le produit. */
  configured: boolean;
  syncRequired?: boolean;
  onSyncClick?: () => void;
  onCancelSyncRequired?: () => void;
  disabledForProduct?: boolean;
  /** Kill switch global (Paramètres → Marketplaces → Gestion Produits OFF). */
  disabledGlobally?: boolean;
}) {
  if (!configured) {
    return (
      <Tooltip content="Microstore n'est pas connecté — configurez-le dans Paramètres › Marketplaces">
        <span className="inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold text-text-muted border border-border cursor-not-allowed bg-bg-secondary">
          MC
        </span>
      </Tooltip>
    );
  }
  if (disabledGlobally) return <DisabledMarketplaceBadge label="MC" reason="global" />;
  if (disabledForProduct) return <DisabledMarketplaceBadge label="MC" reason="product" />;
  if (syncRequired) {
    return (
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSyncClick?.();
          }}
          className="inline-flex flex-row items-center justify-center gap-1.5 w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold sync-required-badge bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
          title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Microstore"
        >
          <span className="relative inline-flex">
            <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse pointer-coarse:animate-none" />
            <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping pointer-coarse:animate-none" />
          </span>
          MC
        </button>
        {onCancelSyncRequired && (
          <SyncCancelCross onClick={onCancelSyncRequired} marketplaceLabel="Microstore" />
        )}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!onSyncClick) return;
        e.stopPropagation();
        onSyncClick();
      }}
      disabled={!onSyncClick}
      className={`inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] ${
        onSyncClick ? "hover:bg-[#DCFCE7] hover:border-[#86EFAC] cursor-pointer transition-colors" : "cursor-default"
      }`}
      title={onSyncClick ? "Cliquer pour synchroniser sur Microstore" : "Microstore configuré"}
    >
      MC
    </button>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VariantSizeEntry {
  quantity: number;
  size: { name: string };
}

interface ColorVariant {
  id: string;
  colorId: string | null;
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  /** Variante masquée côté client (bouton « Désactiver » dans l'édition complète). */
  disabled: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes?: VariantSizeEntry[];
  color: { name: string; hex: string | null; patternImage?: string | null };
  efashionProductId?: number | null;
}

// Une couleur (au sens palette produit) est en rupture quand TOUTES les variantes
// qui partagent son colorId ont un stock à 0. Exporté pour permettre les tests
// unitaires ainsi que la réutilisation ailleurs (ex. cartes mobiles).
export function isColorOutOfStock(colors: Pick<ColorVariant, "colorId" | "stock">[], colorId: string | null): boolean {
  if (!colorId) return false;
  const sameColor = colors.filter((c) => c.colorId === colorId);
  if (sameColor.length === 0) return false;
  return sameColor.every((c) => c.stock === 0);
}

// Une couleur est « toutes désactivées » quand TOUTES les variantes qui
// partagent son colorId ont `disabled = true`. Même règle que la rupture stock
// pour rester cohérent : la palette ne devient rouge que si AUCUNE variante de
// cette couleur n'est encore utilisable côté client.
export function isColorAllDisabled(colors: Pick<ColorVariant, "colorId" | "disabled">[], colorId: string | null): boolean {
  if (!colorId) return false;
  const sameColor = colors.filter((c) => c.colorId === colorId);
  if (sameColor.length === 0) return false;
  return sameColor.every((c) => c.disabled === true);
}

// Pastille de couleur avec légende flottante instantanée au survol.
// La légende est portée dans `document.body` pour éviter les clipping de
// `overflow-hidden` sur la table (cf. conteneur rounded-2xl overflow-hidden).
export function ColorSwatch({
  color,
  outOfStock = false,
  allDisabled = false,
}: {
  color: { name: string; hex: string | null; patternImage?: string | null };
  /** Encadre la pastille en rouge quand toutes les variantes de cette couleur sont à 0. */
  outOfStock?: boolean;
  /** Même encadré rouge quand toutes les variantes de cette couleur sont désactivées. */
  allDisabled?: boolean;
}) {
  const red = outOfStock || allDisabled;
  const ariaSuffix = allDisabled
    ? " — variantes désactivées"
    : outOfStock
    ? " — rupture de stock"
    : "";
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const showTip = () => {
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setCoords({ x: r.left + r.width / 2, y: r.top });
    }
    setHovered(true);
  };
  const hideTip = () => setHovered(false);

  const bg: React.CSSProperties = color.patternImage
    ? {
        backgroundImage: `url(${color.patternImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: color.hex ?? "#9CA3AF" };

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        tabIndex={0}
        aria-label={`${color.name}${ariaSuffix}`}
        data-out-of-stock={outOfStock ? "true" : undefined}
        data-all-disabled={allDisabled ? "true" : undefined}
        className={
          red
            ? "inline-block w-[18px] h-[18px] rounded-full border-[1.5px] border-white shadow-[0_0_0_2px_#DC2626] cursor-default outline-none focus:ring-2 focus:ring-red-500/60"
            : "inline-block w-[18px] h-[18px] rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.14)] cursor-default outline-none focus:ring-2 focus:ring-emerald-400/60"
        }
        style={bg}
      />
      {hovered && coords && createPortal(
        <div
          role="tooltip"
          className="fixed z-[9999] pointer-events-none px-2 py-1 rounded-md bg-slate-900 text-white text-[11px] font-medium whitespace-nowrap shadow-lg -translate-x-1/2 -translate-y-full"
          style={{ left: coords.x, top: coords.y - 6 }}
        >
          {color.name}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-4 border-transparent border-t-slate-900" />
        </div>,
        document.body,
      )}
    </>
  );
}

interface ProductTranslation {
  locale: string;
}

interface AdminProduct {
  id: string;
  reference: string;
  name: string;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  isIncomplete: boolean;
  /** Nombre de couleurs actives (non désactivées) sans aucune image.
   *  Calculé côté serveur. 0 pour les produits archivés. */
  colorsMissingImageCount: number;
  /** Remise fiche produit (Product.discountPercent) — 0..100. Sert à afficher
   *  le prix barré + prix rouge sur la ligne admin quand le produit est remisé. */
  discountPercent: number | null;
  /** Champs manquants dérivés côté serveur (catégorie, description trop courte,
   *  compo, pays, saison, prix, poids, stock, tailles). Rendus en badges ambre
   *  sous le badge de statut. [] pour ARCHIVED. */
  missingFields: MissingField[];
  /** Verrou manuel : si true, désactive le bouton « Rafraîchir ». */
  locked: boolean;
  /** Marqueur « Important » (favori admin partagé) — étoile visible sur la ligne. */
  important: boolean;
  categoryName: string;
  subCategoryName: string | null;
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  firstImage: string | null;
  pfsProductId: string | null;
  ankorsProductId: string | null;
  efashionReferenceBase: string | null;
  faireProductId: string | null;
  orderchampProductId: string | null;
  /** Drapeaux « Synchronisation nécessaire » pilotés par le save produit et le
   *  worker image. Affiche un badge orange cliquable pour pousser la modif. */
  pfsSyncRequired: boolean;
  ankorsSyncRequired: boolean;
  efashionSyncRequired: boolean;
  faireSyncRequired: boolean;
  orderchampSyncRequired: boolean;
  microstoreSyncRequired: boolean;
  /** Microstore n'a pas d'ID marketplace : `microstoreLastPushedAt != null` sert
   *  d'équivalent « déjà publié ». Null = jamais poussé (la modale bulk peut
   *  quand même proposer un premier push si Microstore est configuré). */
  microstoreLastPushedAt: string | null;
  /** Drapeaux « Marketplace activée pour ce produit » — quand false, aucune
   *  action ne partira vers ce marketplace et le badge s'affiche barré. */
  pfsEnabled: boolean;
  ankorsEnabled: boolean;
  efashionEnabled: boolean;
  faireEnabled: boolean;
  orderchampEnabled: boolean;
  microstoreEnabled: boolean;
  /** Dates du dernier export Excel/ZIP réussi par marketplace (null = jamais
   *  exporté). Affichées dans la colonne « Dates » avec une puce d'initiales
   *  par marketplace — visibles aussi pour les brouillons. */
  pfsLastExportedAt: string | null;
  efashionLastExportedAt: string | null;
  microstoreLastExportedAt: string | null;
  ankorstoreLastExportedAt: string | null;
  faireLastExportedAt: string | null;
  orderchampLastExportedAt: string | null;
  /** Résultat de la dernière vérification PFS (lib/pfs-verify.ts). Alimente
   *  la pastille affichée à côté du nom du produit dans la colonne Produit. */
  pfsCheckedAt: string | null;
  pfsCheckStatus: "ok" | "diff" | null;
  pfsCheckIssues: unknown | null; // typé côté PfsVerifyBadge (PfsVerifyIssue[])
  /** Couleur principale du produit (source de vérité pour le badge « Couleur principale »
   *  affiché dans le tiroir de variantes). Peut être null si aucune n'est encore désignée. */
  primaryColorId: string | null;
  colors: ColorVariant[];
  translations: ProductTranslation[];
}

interface Props {
  products: AdminProduct[];
  totalCount: number;
  startIndex: number;
  hasPfsConfig: boolean;
  /** Kill switch global PFS (Paramètres > toggle). Défaut = `hasPfsConfig`. */
  pfsGloballyEnabled?: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasOrderchampConfig: boolean;
  orderchampEnabled: boolean;
  hasMicrostoreConfig: boolean;
  /** Kill switch global Microstore (SiteConfig microstore_products_management_enabled). */
  microstoreEnabled?: boolean;
  /** Listes pour la modale d'édition en masse (catégorie, code SH, etc.) */
  bulkEditOptions: BulkEditOptions;
  /** Tags disponibles pour la modale « Ajouter / retirer des tags » du menu Plus. */
  availableTags: BulkTagsOption[];
  /** Collections disponibles pour la modale « Ajouter à une collection » du menu Plus. */
  availableCollections: BulkCollectionOption[];
}

// ─── Variant dirty-edit helpers ─────────────────────────────────────────────
// Édition inline dans le tiroir : chaque cellule (prix, stock, poids, packQty)
// se transforme en champ custom au double-clic. Tant que l'utilisatrice n'a
// pas cliqué « Appliquer les modifications » en bas du tiroir, les nouvelles
// valeurs vivent uniquement en mémoire dans dirtyEdits (Record<variantId,
// { field: newValue }>). Exportés pour les tests unitaires.

export type VariantField = "price" | "stock" | "weight" | "packQty" | "disabled";
export type VariantEditValue = number | boolean;

/**
 * Fallback stable pour l'absence d'édition en cours sur une variante.
 * Utilisé à la place de `?? {}` inline, qui créait un nouvel objet à chaque
 * render et cassait la memoization des lignes (VariantRow / VariantCardMobile).
 */
const EMPTY_VARIANT_EDITS: Partial<Record<VariantField, VariantEditValue>> = Object.freeze({});
export type VariantDirtyEdits = Record<string, Partial<Record<VariantField, VariantEditValue>>>;

export function isVariantCellDirty(
  edits: VariantDirtyEdits,
  variantId: string,
  field: VariantField,
): boolean {
  return edits[variantId]?.[field] !== undefined;
}

export function commitVariantCell(
  edits: VariantDirtyEdits,
  variantId: string,
  field: VariantField,
  newValue: VariantEditValue,
  originalValue: VariantEditValue,
): VariantDirtyEdits {
  const next: VariantDirtyEdits = { ...edits };
  if (newValue === originalValue) {
    if (next[variantId]) {
      const perVariant = { ...next[variantId] };
      delete perVariant[field];
      if (Object.keys(perVariant).length === 0) delete next[variantId];
      else next[variantId] = perVariant;
    }
    return next;
  }
  next[variantId] = { ...(next[variantId] ?? {}), [field]: newValue };
  return next;
}

export function countVariantDirtyEdits(edits: VariantDirtyEdits): number {
  let n = 0;
  for (const id in edits) n += Object.keys(edits[id]).length;
  return n;
}

/**
 * Vrai dès qu'au moins une variante du produit a une modification en attente
 * dans `dirtyEdits`. Utilisé pour teinter la ligne/carte produit en ambre pâle
 * (`product-row-dirty`) tant que la cliente n'a pas cliqué « Appliquer les
 * modifications ». Exporté pour les tests.
 */
export function productHasDirtyVariants(
  product: { colors: readonly { id: string }[] },
  edits: VariantDirtyEdits,
): boolean {
  return product.colors.some((c) => edits[c.id] !== undefined);
}

// ─── Helpers Prix HT unitaire vs total ─────────────────────────────────────
// La BDD stocke `unitPrice` différemment selon saleType :
//   - UNIT : prix par pièce (unité = total).
//   - PACK : prix total du paquet = unitaire × somme des quantités des tailles
//     (cf. `computeTotalPrice()` dans ColorVariantManager).
// Dans le tiroir, colonne « Prix HT » = unitaire (éditable),
// « Prix HT Total » = total (lecture seule).
export function computeVariantPackTotalQty(
  variant: {
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    variantSizes?: { quantity: number }[];
  },
  packOverride?: number,
): number {
  if (variant.saleType !== "PACK") return 1;
  const fromSizes = variant.variantSizes?.reduce((s, vs) => s + vs.quantity, 0) ?? 0;
  if (fromSizes > 0) return fromSizes;
  const fromPack = packOverride ?? variant.packQuantity ?? 0;
  return fromPack > 0 ? fromPack : 1;
}

// ─── Modif rapide « toute la colonne » (bulk column edit) ──────────────────
// Calcule le prix TOTAL à écrire en BDD pour chaque variante quand l'admin
// saisit un prix UNITAIRE unique à appliquer sur toute la colonne « Prix HT ».
// - UNIT : total = unitaire (une seule pièce).
// - PACK : total = unitaire × packTotalQty de la variante (peut différer
//   entre variantes si les quantités de tailles diffèrent).
// packQtyEdits : édition packQty en attente par variantId (respecte l'ordre
// dans lequel l'utilisatrice a déjà modifié le packQty avant le bulk-edit).
export type BulkPriceEdit = { variantId: string; newTotal: number; originalPrice: number };

export function computeBulkPriceEdits(
  variants: Array<{
    id: string;
    saleType: "UNIT" | "PACK";
    packQuantity: number | null;
    unitPrice: number;
    variantSizes?: { quantity: number }[];
  }>,
  newUnitPrice: number,
  packQtyEdits: Record<string, number | undefined> = {},
): BulkPriceEdit[] {
  return variants.map((v) => {
    const packOverride = packQtyEdits[v.id];
    const packTotalQty = computeVariantPackTotalQty(v, packOverride);
    const newTotal =
      v.saleType === "PACK"
        ? Math.round(newUnitPrice * packTotalQty * 100) / 100
        : newUnitPrice;
    return { variantId: v.id, newTotal, originalPrice: v.unitPrice };
  });
}

// Classe CSS de la ligne variante dans le tiroir : fond rouge pastel quand le
// stock est à 0 OU quand la variante est désactivée (y compris en édition en
// attente). Sinon hover neutre.
export function computeVariantRowClass(stock: number, disabled = false): string {
  const base = "border-t border-border-light transition-colors";
  return stock === 0 || disabled
    ? `${base} bg-red-100/70 hover:bg-red-200/60`
    : `${base} hover:bg-bg-primary/60`;
}

// ─── Cellule éditable au simple clic ────────────────────────────────────────
// Rend un <span> cliquable qui bascule en <input> custom au clic. Entrée /
// blur -> commit ; Échap -> annule cette édition en cours (sans toucher aux
// autres cellules dirty). L'affichage repose sur `children` : l'appelant
// fournit le JSX complet à afficher (chiffre + puce colorée pour le stock,
// préfixe €/kg, etc.).
function VariantEditableCell({
  variantId,
  field,
  currentValue,
  originalValue,
  isInt,
  dirty,
  ariaLabel,
  onCommit,
  children,
}: {
  variantId: string;
  field: VariantField;
  currentValue: number;
  originalValue: number;
  isInt: boolean;
  dirty: boolean;
  ariaLabel: string;
  onCommit: (field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => void;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(String(currentValue));
    setEditing(true);
  };

  const commit = () => {
    const raw = parseFloat(draft.replace(",", "."));
    if (Number.isFinite(raw) && raw >= 0) {
      const rounded = isInt ? Math.round(raw) : Math.round(raw * 100) / 100;
      onCommit(field, rounded, originalValue);
    }
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        step={isInt ? "1" : "0.01"}
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        className="variant-cell-input"
        aria-label={ariaLabel}
        data-variant-id={variantId}
        data-variant-field={field}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={startEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); }
      }}
      className={`variant-cell-editable text-xs font-body ${dirty ? "variant-cell-dirty" : ""}`}
      aria-label={`${ariaLabel} — cliquez pour modifier`}
      data-variant-id={variantId}
      data-variant-field={field}
    >
      {children}
      <span className="variant-cell-hint">Cliquez</span>
    </span>
  );
}

// ─── Bulk toggle Activer/Désactiver toutes les variantes du produit ────────
// Bouton à segments (Activer / Désactiver) posé dans la 1ʳᵉ cellule du bulk-row.
// Un clic pose un dirty edit `disabled = true|false` sur chaque variante ; le
// bandeau global Appliquer/Annuler en bas s'occupe de persister.
function BulkDisabledEditor({
  allCurrentlyDisabled,
  onApplyAll,
}: {
  allCurrentlyDisabled: boolean;
  onApplyAll: (disabled: boolean) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-primary p-0.5" role="group" aria-label="Activer ou désactiver toutes les variantes">
      <button
        type="button"
        onClick={() => onApplyAll(false)}
        title="Activer toutes les variantes du produit"
        aria-label="Activer toutes les variantes du produit"
        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
          !allCurrentlyDisabled
            ? "bg-emerald-600 text-white"
            : "text-emerald-700 hover:bg-emerald-50"
        }`}
      >
        Tout activer
      </button>
      <button
        type="button"
        onClick={() => onApplyAll(true)}
        title="Désactiver toutes les variantes du produit"
        aria-label="Désactiver toutes les variantes du produit"
        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide transition-colors ${
          allCurrentlyDisabled
            ? "bg-red-600 text-white"
            : "text-red-700 hover:bg-red-50"
        }`}
      >
        Tout désactiver
      </button>
    </span>
  );
}

// ─── Modif rapide « toute la colonne » (bulk column edit) ─────────────────
// Petit champ posé dans l'en-tête du tiroir, sous chaque colonne éditable.
// L'admin tape une valeur → Entrée / blur → applique à toutes les variantes
// du produit d'un coup (chaque cellule devient « en attente » comme si elle
// avait été éditée à la main). Le bandeau global Appliquer/Annuler en bas
// prend ensuite le relais.
function BulkColumnEditor({
  columnLabel,
  isInt,
  suffix,
  onApplyAll,
}: {
  columnLabel: string;
  isInt: boolean;
  suffix?: string;
  onApplyAll: (value: number) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const raw = parseFloat(draft.replace(",", "."));
    if (!Number.isFinite(raw) || raw < 0) return;
    const rounded = isInt ? Math.round(raw) : Math.round(raw * 100) / 100;
    onApplyAll(rounded);
  };

  return (
    <span className="bulk-col-input-wrap" title={`Écrivez une valeur → Entrée pour l'appliquer à toutes les variantes (${columnLabel})`}>
      <input
        type="number"
        step={isInt ? "1" : "0.01"}
        min={0}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
        }}
        placeholder="↓ tout"
        className="bulk-col-input"
        aria-label={`Modifier ${columnLabel} pour toutes les variantes`}
      />
      {suffix && <span className="bulk-col-input-suffix">{suffix}</span>}
    </span>
  );
}

// ─── VariantRow — ligne de tableau utilisée dans la modale variantes (bureau) ─
// Chaque cellule éditable délègue au top-level la mémorisation de la valeur en
// attente via `onCommitCell`. Le bandeau flottant global (bas de page) affiche
// le total des modifications et permet de tout appliquer / annuler d'un coup.
const VariantRow = React.memo(function VariantRow({
  variant,
  editsForVariant,
  onCommitCell,
  isPrimaryColor = false,
}: {
  variant: ColorVariant;
  editsForVariant: Partial<Record<VariantField, VariantEditValue>>;
  onCommitCell: (variantId: string, field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => void;
  isPrimaryColor?: boolean;
}) {
  const priceOrig = variant.unitPrice;
  const stockOrig = variant.stock;
  const weightOrig = variant.weight;
  const packOrig = variant.packQuantity ?? 0;
  const disabledOrig = variant.disabled;

  const priceCurrent = (editsForVariant.price as number | undefined) ?? priceOrig;
  const stockCurrent = (editsForVariant.stock as number | undefined) ?? stockOrig;
  const weightCurrent = (editsForVariant.weight as number | undefined) ?? weightOrig;
  const packCurrent = (editsForVariant.packQty as number | undefined) ?? packOrig;
  const disabledCurrent = (editsForVariant.disabled as boolean | undefined) ?? disabledOrig;

  const dirtyPrice = editsForVariant.price !== undefined;
  const dirtyStock = editsForVariant.stock !== undefined;
  const dirtyWeight = editsForVariant.weight !== undefined;
  const dirtyPack = editsForVariant.packQty !== undefined;
  const dirtyDisabled = editsForVariant.disabled !== undefined;

  const commit = useCallback(
    (field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => {
      onCommitCell(variant.id, field, newValue, originalValue);
    },
    [onCommitCell, variant.id],
  );

  const isPackVariant = variant.saleType === "PACK";
  const packTotalQty = computeVariantPackTotalQty(variant, packCurrent);
  const unitPriceOrig = isPackVariant
    ? Math.round((priceOrig / packTotalQty) * 100) / 100
    : priceOrig;
  const unitPriceCurrent = isPackVariant
    ? Math.round((priceCurrent / packTotalQty) * 100) / 100
    : priceCurrent;
  const commitUnitPrice = useCallback(
    (field: VariantField, newUnitValue: VariantEditValue, _origUnitValue: VariantEditValue) => {
      if (field !== "price") {
        commit(field, newUnitValue, _origUnitValue);
        return;
      }
      const newTotal = isPackVariant
        ? Math.round((newUnitValue as number) * packTotalQty * 100) / 100
        : (newUnitValue as number);
      commit("price", newTotal, priceOrig);
    },
    [commit, isPackVariant, packTotalQty, priceOrig],
  );

  const stockDotColor =
    stockCurrent === 0 ? "#DC2626" : stockCurrent <= 5 ? "#D97706" : "#16A34A";
  const stockLabelClass =
    stockCurrent === 0
      ? "text-[#DC2626] font-bold"
      : stockCurrent <= 5
      ? "text-[#D97706] font-semibold"
      : "text-[#16A34A] font-medium";

  const swatchStyle: React.CSSProperties = variant.color.patternImage
    ? { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundColor: variant.color.hex ?? "#9CA3AF" };

  return (
    <tr className={computeVariantRowClass(stockCurrent, disabledCurrent)}>
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2.5 flex-nowrap">
          <span className="relative shrink-0">
            <span
              className="block w-[22px] h-[22px] rounded-full"
              style={{
                ...swatchStyle,
                border: "2px solid #fff",
                boxShadow: "0 0 0 1px #D1D1D1, 0 1px 3px rgba(0,0,0,0.08)",
              }}
              title={variant.color.name}
            />
            {isPrimaryColor && (
              <span
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-black text-white text-[9px] leading-none flex items-center justify-center"
                title="Couleur principale du produit"
                aria-label="Couleur principale"
              >
                ★
              </span>
            )}
          </span>
          <span className="text-xs font-semibold font-body text-text-primary whitespace-nowrap">
            {variant.color.name}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!disabledCurrent}
            aria-label={disabledCurrent ? "Variante désactivée — cliquez pour activer" : "Variante activée — cliquez pour désactiver"}
            title={disabledCurrent ? "Cliquez pour activer la variante" : "Cliquez pour désactiver la variante"}
            onClick={() => commit("disabled", !disabledCurrent, disabledOrig)}
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide text-white cursor-pointer transition-shadow whitespace-nowrap ${
              disabledCurrent ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"
            } ${dirtyDisabled ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
            data-variant-id={variant.id}
            data-variant-field="disabled"
          >
            {disabledCurrent ? "Désactivée" : "Activée"}
          </button>
        </div>
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        {variant.saleType === "UNIT" ? (
          <span className="badge badge-info text-[10px]">Unité</span>
        ) : (
          <span className="badge badge-purple text-[10px] inline-flex items-center gap-1">
            Pack ×
            <VariantEditableCell
              variantId={variant.id}
              field="packQty"
              currentValue={packCurrent}
              originalValue={packOrig}
              isInt
              dirty={dirtyPack}
              ariaLabel={`Quantité par pack — ${variant.color.name}`}
              onCommit={commit}
            >
              {packCurrent}
            </VariantEditableCell>
          </span>
        )}
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        {variant.variantSizes && variant.variantSizes.length > 0 && (
          <span className="badge badge-neutral text-[10px] whitespace-nowrap">
            {variant.variantSizes
              .map((vs) => (vs.quantity > 1 ? `${vs.size.name}×${vs.quantity}` : vs.size.name))
              .join(", ")}
          </span>
        )}
      </td>

      <td className="px-4 py-3 text-right whitespace-nowrap">
        <VariantEditableCell
          variantId={variant.id}
          field="price"
          currentValue={unitPriceCurrent}
          originalValue={unitPriceOrig}
          isInt={false}
          dirty={dirtyPrice}
          ariaLabel={`Prix HT unitaire — ${variant.color.name}`}
          onCommit={commitUnitPrice}
        >
          <span className="font-semibold text-text-primary">
            {unitPriceCurrent.toFixed(2).replace(".", ",")} €
          </span>
        </VariantEditableCell>
      </td>

      <td className="px-4 py-3 text-right whitespace-nowrap">
        {isPackVariant ? (
          <span
            className={`text-xs font-body font-medium tabular-nums ${
              dirtyPrice ? "text-emerald-700" : "text-text-secondary"
            }`}
            title="Prix HT total du paquet (calculé)"
          >
            {priceCurrent.toFixed(2).replace(".", ",")} €
          </span>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-right whitespace-nowrap">
        <VariantEditableCell
          variantId={variant.id}
          field="stock"
          currentValue={stockCurrent}
          originalValue={stockOrig}
          isInt
          dirty={dirtyStock}
          ariaLabel={`Stock — ${variant.color.name}`}
          onCommit={commit}
        >
          {dirtyStock ? (
            <>{stockCurrent}</>
          ) : (
            <span className={`inline-flex items-center gap-1.5 ${stockLabelClass}`}>
              <span
                className={stockCurrent === 0 ? "animate-pulse" : ""}
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: stockDotColor,
                  display: "inline-block",
                }}
              />
              {stockCurrent}
            </span>
          )}
        </VariantEditableCell>
      </td>

      <td className="px-4 py-3 text-right whitespace-nowrap">
        <VariantEditableCell
          variantId={variant.id}
          field="weight"
          currentValue={weightCurrent}
          originalValue={weightOrig}
          isInt={false}
          dirty={dirtyWeight}
          ariaLabel={`Poids — ${variant.color.name}`}
          onCommit={commit}
        >
          <span className="text-text-secondary">
            {weightCurrent.toFixed(2).replace(".", ",")} kg
          </span>
        </VariantEditableCell>
      </td>
    </tr>
  );
});


// ─── VariantCardMobile — carte verticale utilisée dans la modale sur mobile ─
// Layout carte (rond couleur + nom + badges + grille 2×2 métriques). Sur bureau
// c'est le tableau VariantRow qui est affiché.
export const VariantCardMobile = React.memo(function VariantCardMobile({
  variant,
  editsForVariant,
  onCommitCell,
  isPrimaryColor = false,
}: {
  variant: ColorVariant;
  editsForVariant: Partial<Record<VariantField, VariantEditValue>>;
  onCommitCell: (variantId: string, field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => void;
  /** Vrai si la couleur de cette variante correspond à Product.primaryColorId. */
  isPrimaryColor?: boolean;
}) {
  const priceOrig = variant.unitPrice;
  const stockOrig = variant.stock;
  const weightOrig = variant.weight;
  const packOrig = variant.packQuantity ?? 0;
  const disabledOrig = variant.disabled;

  const priceCurrent = (editsForVariant.price as number | undefined) ?? priceOrig;
  const stockCurrent = (editsForVariant.stock as number | undefined) ?? stockOrig;
  const weightCurrent = (editsForVariant.weight as number | undefined) ?? weightOrig;
  const packCurrent = (editsForVariant.packQty as number | undefined) ?? packOrig;
  const disabledCurrent = (editsForVariant.disabled as boolean | undefined) ?? disabledOrig;

  const dirtyPrice = editsForVariant.price !== undefined;
  const dirtyStock = editsForVariant.stock !== undefined;
  const dirtyWeight = editsForVariant.weight !== undefined;
  const dirtyPack = editsForVariant.packQty !== undefined;
  const dirtyDisabled = editsForVariant.disabled !== undefined;

  const commit = useCallback(
    (field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => {
      onCommitCell(variant.id, field, newValue, originalValue);
    },
    [onCommitCell, variant.id],
  );

  const isPackVariant = variant.saleType === "PACK";
  const packTotalQty = computeVariantPackTotalQty(variant, packCurrent);
  const unitPriceOrig = isPackVariant
    ? Math.round((priceOrig / packTotalQty) * 100) / 100
    : priceOrig;
  const unitPriceCurrent = isPackVariant
    ? Math.round((priceCurrent / packTotalQty) * 100) / 100
    : priceCurrent;
  const commitUnitPrice = useCallback(
    (field: VariantField, newUnitValue: VariantEditValue, _origUnitValue: VariantEditValue) => {
      if (field !== "price") {
        commit(field, newUnitValue, _origUnitValue);
        return;
      }
      const newTotal = isPackVariant
        ? Math.round((newUnitValue as number) * packTotalQty * 100) / 100
        : (newUnitValue as number);
      commit("price", newTotal, priceOrig);
    },
    [commit, isPackVariant, packTotalQty, priceOrig],
  );

  const stockDotColor =
    stockCurrent === 0 ? "#DC2626" : stockCurrent <= 5 ? "#D97706" : "#16A34A";
  const stockLabelClass =
    stockCurrent === 0
      ? "text-[#DC2626] font-bold"
      : stockCurrent <= 5
      ? "text-[#D97706] font-semibold"
      : "text-[#16A34A] font-medium";

  const swatchStyle: React.CSSProperties = variant.color.patternImage
    ? { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundColor: variant.color.hex ?? "#9CA3AF" };

  const isOutOrDisabled = stockCurrent === 0 || disabledCurrent;

  const sizesLabel = variant.variantSizes && variant.variantSizes.length > 0
    ? variant.variantSizes
        .map((vs) => (vs.quantity > 1 ? `${vs.size.name}×${vs.quantity}` : vs.size.name))
        .join(", ")
    : null;

  return (
    <div
      className={`variant-card-mobile rounded-2xl border shadow-sm overflow-hidden ${
        isOutOrDisabled
          ? "bg-red-50/60 border-red-200"
          : "bg-bg-primary border-border"
      }`}
      data-variant-id={variant.id}
    >
      {/* Row 1 — grand rond couleur + nom en gros + sous-titre + pilule Activée */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <span
          className="w-11 h-11 rounded-full shrink-0"
          style={{
            ...swatchStyle,
            border: "2px solid #fff",
            boxShadow: "0 0 0 1px #D1D1D1, 0 2px 4px rgba(0,0,0,0.10)",
          }}
          title={variant.color.name}
        />
        <div className="min-w-0 flex-1">
          <div className="font-heading text-base font-bold text-text-primary truncate leading-tight">
            {variant.color.name}
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            {isPackVariant
              ? `Variante ×${packCurrent} par paquet`
              : "Vendue à l'unité"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!disabledCurrent}
          aria-label={disabledCurrent ? "Variante désactivée — cliquez pour activer" : "Variante activée — cliquez pour désactiver"}
          title={disabledCurrent ? "Cliquez pour activer la variante" : "Cliquez pour désactiver la variante"}
          onClick={() => commit("disabled", !disabledCurrent, disabledOrig)}
          className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors border ${
            disabledCurrent
              ? "bg-red-100 text-red-700 border-red-200 hover:bg-red-200"
              : "bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200"
          } ${dirtyDisabled ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
          data-variant-id={variant.id}
          data-variant-field="disabled"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${disabledCurrent ? "bg-red-600" : "bg-emerald-600"}`}
            aria-hidden
          />
          {disabledCurrent ? "Désactivée" : "Activée"}
        </button>
        {isPrimaryColor && (
          <span
            className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-black text-white"
            title="Couleur principale du produit"
          >
            Couleur principale
          </span>
        )}
      </div>

      {/* Row 2 — badges Unité/Pack + tailles sur leur propre ligne */}
      <div className="px-4 pb-3 flex items-center gap-1.5 flex-wrap">
        {variant.saleType === "UNIT" ? (
          <span className="badge badge-info text-[10px]">Unité</span>
        ) : (
          <span className="badge badge-purple text-[10px] inline-flex items-center gap-1">
            Pack ×
            <VariantEditableCell
              variantId={variant.id}
              field="packQty"
              currentValue={packCurrent}
              originalValue={packOrig}
              isInt
              dirty={dirtyPack}
              ariaLabel={`Quantité par pack — ${variant.color.name}`}
              onCommit={commit}
            >
              {packCurrent}
            </VariantEditableCell>
          </span>
        )}
        {sizesLabel && (
          <span className="badge badge-neutral text-[10px]">{sizesLabel}</span>
        )}
      </div>

      {/* Divider fin entre header et grille */}
      <div className="border-t border-border-light" />

      {/* Row 3 — grille 2×2 avec chiffres plus gros. Les filets internes
          sont posés en border-r / border-b sur les cellules (pas de wrapper
          spécial) pour rester dans le flow du composant. */}
      <div className="grid grid-cols-2">
        <div className="px-4 py-3 border-r border-b border-border-light">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Prix HT</div>
          <div className="mt-1">
            <VariantEditableCell
              variantId={variant.id}
              field="price"
              currentValue={unitPriceCurrent}
              originalValue={unitPriceOrig}
              isInt={false}
              dirty={dirtyPrice}
              ariaLabel={`Prix HT unitaire — ${variant.color.name}`}
              onCommit={commitUnitPrice}
            >
              <span className="text-lg font-bold text-text-primary tabular-nums">
                {unitPriceCurrent.toFixed(2).replace(".", ",")} €
              </span>
            </VariantEditableCell>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border-light">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Stock</div>
          <div className="mt-1">
            <VariantEditableCell
              variantId={variant.id}
              field="stock"
              currentValue={stockCurrent}
              originalValue={stockOrig}
              isInt
              dirty={dirtyStock}
              ariaLabel={`Stock — ${variant.color.name}`}
              onCommit={commit}
            >
              {dirtyStock ? (
                <span className="text-lg font-bold tabular-nums">{stockCurrent}</span>
              ) : (
                <span className={`inline-flex items-center gap-1.5 text-lg font-bold tabular-nums ${stockLabelClass}`}>
                  <span
                    className={stockCurrent === 0 ? "animate-pulse" : ""}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: stockDotColor,
                      display: "inline-block",
                    }}
                  />
                  {stockCurrent}
                </span>
              )}
            </VariantEditableCell>
          </div>
        </div>

        <div className="px-4 py-3 border-r border-border-light">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Prix HT total</div>
          <div className="mt-1">
            {isPackVariant ? (
              <span
                className={`text-sm font-semibold tabular-nums ${
                  dirtyPrice ? "text-emerald-700" : "text-text-secondary"
                }`}
                title="Prix HT total du paquet (calculé)"
              >
                {priceCurrent.toFixed(2).replace(".", ",")} €
              </span>
            ) : (
              <span className="text-sm text-text-muted">—</span>
            )}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Poids</div>
          <div className="mt-1">
            <VariantEditableCell
              variantId={variant.id}
              field="weight"
              currentValue={weightCurrent}
              originalValue={weightOrig}
              isInt={false}
              dirty={dirtyWeight}
              ariaLabel={`Poids — ${variant.color.name}`}
              onCommit={commit}
            >
              <span className="text-sm font-semibold text-text-secondary tabular-nums">
                {weightCurrent.toFixed(2).replace(".", ",")} kg
              </span>
            </VariantEditableCell>
          </div>
        </div>
      </div>
    </div>
  );
});


// ─── Status badge with inline dropdown ──────────────────────────────────────
function StatusBadge({
  status,
  onChange,
  canPutOnline,
  canPutOffline,
  canArchive,
  putOnlineReason,
}: {
  status: "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING";
  onChange: (next: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  canPutOnline: boolean;
  canPutOffline: boolean;
  canArchive: boolean;
  putOnlineReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuHeight = 150;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuHeight && rect.top > menuHeight;
    setPos({
      top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: rect.left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const labels = {
    ONLINE: "En ligne",
    OFFLINE: "Hors ligne",
    ARCHIVED: "Archivé",
    SYNCING: "En sync",
  } as const;
  const dotColors = {
    ONLINE: "#22C55E",
    OFFLINE: "#9CA3AF",
    ARCHIVED: "#F59E0B",
    SYNCING: "#3B82F6",
  } as const;
  const badgeCls = {
    ONLINE: "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] hover:bg-[#DCFCE7]",
    OFFLINE: "bg-bg-secondary text-text-secondary border-border hover:bg-bg-tertiary",
    ARCHIVED: "status-badge-archived bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA] hover:bg-[#FFEDD5]",
    SYNCING: "bg-blue-50 text-blue-700 border-blue-200",
  } as const;

  const isSyncing = status === "SYNCING";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={isSyncing}
        onClick={(e) => { e.stopPropagation(); if (!isSyncing) setOpen((v) => !v); }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
          badgeCls[status]
        } ${isSyncing ? "cursor-default" : "cursor-pointer"}`}
        title={isSyncing ? "Statut système : importation en cours" : "Cliquer pour changer le statut"}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: dotColors[status], animation: status === "SYNCING" ? "pulse 1.5s ease-in-out infinite" : undefined }}
        />
        {labels[status]}
        {!isSyncing && (
          <svg className={`w-2.5 h-2.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="bg-bg-primary border border-border rounded-xl shadow-[var(--shadow-pop)] py-1.5 px-1.5 animate-fadeIn flex flex-col gap-px"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 170 }}
          onClick={(e) => e.stopPropagation()}
        >
          <StatusOption
            label="En ligne"
            dotColor="#22C55E"
            selected={status === "ONLINE"}
            disabled={!canPutOnline}
            disabledReason={putOnlineReason}
            onClick={() => { onChange("ONLINE"); setOpen(false); }}
          />
          <StatusOption
            label="Hors ligne"
            dotColor="#9CA3AF"
            selected={status === "OFFLINE"}
            disabled={!canPutOffline}
            onClick={() => { onChange("OFFLINE"); setOpen(false); }}
          />
          <StatusOption
            label="Archivé"
            dotColor="#F59E0B"
            selected={status === "ARCHIVED"}
            disabled={!canArchive}
            onClick={() => { onChange("ARCHIVED"); setOpen(false); }}
          />
        </div>,
        document.body
      )}
    </>
  );
}

function StatusOption({
  label, dotColor, selected, disabled, disabledReason, onClick,
}: {
  label: string;
  dotColor: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || selected}
      onClick={onClick}
      title={disabled ? disabledReason : undefined}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-body font-medium transition-colors border-none bg-transparent ${
        disabled
          ? "text-text-muted opacity-50 cursor-not-allowed"
          : selected
          ? "text-text-primary bg-bg-tertiary cursor-default"
          : "text-text-primary hover:bg-bg-tertiary cursor-pointer"
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
      <span className="flex-1 text-left">{label}</span>
      {selected && (
        <svg className="w-3.5 h-3.5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

// ─── Mobile-only : modale centrée pour changer le statut ────────────────────
// Ouverte au tap sur le badge du coin haut-droit d'une ligne produit. Réutilise
// la même logique d'éligibilité que StatusBadge (desktop) et appelle le même
// handler onRowStatus → passe donc par la confirmation + OTP archive.
function MobileStatusChangeModal({
  open,
  status,
  productName,
  productReference,
  canPutOnline,
  canPutOffline,
  canArchive,
  putOnlineReason,
  onSelect,
  onClose,
}: {
  open: boolean;
  status: "ONLINE" | "OFFLINE" | "ARCHIVED";
  productName: string;
  productReference: string;
  canPutOnline: boolean;
  canPutOffline: boolean;
  canArchive: boolean;
  putOnlineReason?: string;
  onSelect: (next: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (next: "ONLINE" | "OFFLINE" | "ARCHIVED") => {
    onClose();
    onSelect(next);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-bg-primary rounded-2xl shadow-2xl border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted mb-1">
            Changer le statut
          </div>
          <div className="font-heading text-lg font-bold text-text-primary leading-tight truncate">
            {productName}
          </div>
          <div className="text-[11px] font-mono text-text-muted mt-0.5">
            {productReference}
          </div>
        </div>
        <div className="p-3 flex flex-col gap-2">
          <MobileStatusOption
            label="En ligne"
            dotColor="#22C55E"
            selected={status === "ONLINE"}
            disabled={!canPutOnline}
            disabledReason={putOnlineReason}
            onClick={() => pick("ONLINE")}
          />
          <MobileStatusOption
            label="Hors ligne"
            dotColor="#9CA3AF"
            selected={status === "OFFLINE"}
            disabled={!canPutOffline}
            onClick={() => pick("OFFLINE")}
          />
          <MobileStatusOption
            label="Archivé"
            dotColor="#F59E0B"
            selected={status === "ARCHIVED"}
            disabled={!canArchive}
            onClick={() => pick("ARCHIVED")}
          />
        </div>
        <div className="p-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-bg-secondary text-text-primary font-semibold text-sm hover:bg-bg-tertiary transition-colors"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MobileStatusOption({
  label, dotColor, selected, disabled, disabledReason, onClick,
}: {
  label: string;
  dotColor: string;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || selected}
      onClick={onClick}
      title={disabled ? disabledReason : undefined}
      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[15px] font-semibold transition-colors border ${
        disabled
          ? "text-text-muted bg-bg-secondary/50 border-border opacity-60 cursor-not-allowed"
          : selected
          ? "text-text-primary bg-bg-tertiary border-border cursor-default"
          : "text-text-primary bg-bg-primary border-border hover:bg-bg-tertiary active:bg-bg-tertiary cursor-pointer"
      }`}
    >
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: dotColor }} />
      <span className="flex-1 text-left">{label}</span>
      {selected && (
        <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {disabled && disabledReason && !selected && (
        <span className="text-[10px] font-normal text-text-muted italic max-w-[140px] text-right leading-tight">
          {disabledReason}
        </span>
      )}
    </button>
  );
}

// ─── Actions Dropdown (portal) ────────────────────────────────────────────────

function ActionsDropdown({
  productId,
  productName,
  productReference,
  expanded,
  refreshing,
  anchorRef,
  eligibility,
  ankorstorePublishing,
  pfsPublishing,
  efashionPublishing,
  fairePublishing,
  orderchampPublishing,
  onClose,
  onExpandToggle,
  onRefresh,
  onPutOnline,
  onPutOffline,
  onArchive,
  onSync,
  onPublishPfs,
  onPublishAnkorstore,
  onPublishEfashion,
  onPublishFaire,
  onPublishOrderchamp,
  onDelete,
}: {
  productId: string;
  productName: string;
  productReference: string;
  expanded: boolean;
  refreshing: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  eligibility: RowActionEligibility;
  ankorstorePublishing: boolean;
  pfsPublishing: boolean;
  efashionPublishing: boolean;
  fairePublishing: boolean;
  orderchampPublishing: boolean;
  onClose: () => void;
  onExpandToggle: () => void;
  onRefresh: () => void;
  onPutOnline: () => void;
  onPutOffline: () => void;
  onArchive: () => void;
  onSync: () => void;
  onPublishPfs: () => void;
  onPublishAnkorstore: () => void;
  onPublishEfashion: () => void;
  onPublishFaire: () => void;
  onPublishOrderchamp: () => void;
  onDelete: () => void;
}) {
  // `expanded` sert seulement de flag informatif : le vrai toggle passe par
  // onExpandToggle (bouton « Modifier les variantes » ci-dessous).
  void expanded;
  const maintenance = useMarketplaceMaintenance();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Position the menu below (or above if near bottom) the anchor button, aligned right
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Hauteur estimée du menu — on compte tous les items potentiels
    const menuHeight = 480;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuHeight && rect.top > menuHeight;
    setPos({
      top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 6,
      left: rect.right - 240,
    });
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(target) &&
        anchorRef.current && !anchorRef.current.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  // Styles maquette Ardoise : groupes nommés (Édition / Statut / Sync) +
  // items avec icône carrée à gauche + item « Supprimer » en rouge.
  const itemClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-text-primary hover:bg-bg-tertiary transition-colors no-underline border-none bg-transparent cursor-pointer";
  const itemDisabledClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-text-muted opacity-50 cursor-not-allowed border-none bg-transparent";
  const itemDangerClass =
    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-body font-medium text-error hover:bg-error-bg transition-colors border-none bg-transparent cursor-pointer";
  const iconWrap =
    "w-[22px] h-[22px] inline-flex items-center justify-center rounded-md bg-bg-tertiary text-text-secondary text-[13px] shrink-0";
  const iconWrapDanger =
    "w-[22px] h-[22px] inline-flex items-center justify-center rounded-md bg-error-bg text-error text-[13px] shrink-0";
  const groupLabel =
    "block text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted px-2.5 pt-2 pb-1";
  const sepCls = "h-px bg-border my-1 mx-1.5";

  return (
    <div
      ref={menuRef}
      className="bg-bg-primary border border-border rounded-xl shadow-[var(--shadow-pop)] py-1.5 px-1.5 animate-fadeIn flex flex-col gap-px"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 240 }}
    >
      {/* ─── Édition ─── */}
      <span className={groupLabel}>Édition</span>
      {/* « Modifier les variantes » exposé uniquement sur mobile : sur desktop
          la modale variantes s'ouvre au clic sur la ligne (le tap ligne mobile
          sert à toggler la sélection). */}
      <button type="button" onClick={onExpandToggle} className={`md:hidden ${itemClass}`}>
        <span className={iconWrap}>◫</span>
        Modifier les variantes
      </button>
      <Link
        href={`/admin/produits/${productId}/modifier`}
        className={itemClass}
        onClick={onClose}
      >
        <span className={iconWrap}>✎</span>
        Modifier la fiche
      </Link>
      <Link
        href={`/admin/produits/nouveau?dupliquerDe=${productId}`}
        className={itemClass}
        onClick={onClose}
      >
        <span className={iconWrap}>⎘</span>
        Dupliquer
      </Link>
      <Link
        href={`/fr/produits/${buildProductHandle(productName, productReference)}`}
        target="_blank"
        className={itemClass}
        onClick={onClose}
      >
        <span className={iconWrap}>↗</span>
        Voir la fiche publique
      </Link>

      <div className={sepCls} />

      {/* ─── Statut ─── */}
      <span className={groupLabel}>Statut</span>
      {eligibility.canPutOnline ? (
        <button type="button" onClick={onPutOnline} className={itemClass}>
          <span className={iconWrap}>●</span>
          Mettre en ligne
        </button>
      ) : (
        <span className={itemDisabledClass} title={eligibility.putOnlineReason ?? ""}>
          <span className={iconWrap}>●</span>
          Mettre en ligne
        </span>
      )}
      {eligibility.canPutOffline ? (
        <button type="button" onClick={onPutOffline} className={itemClass}>
          <span className={iconWrap}>○</span>
          Passer hors ligne
        </button>
      ) : (
        <span className={itemDisabledClass} title="Déjà hors ligne">
          <span className={iconWrap}>○</span>
          Passer hors ligne
        </span>
      )}
      {eligibility.canArchive ? (
        <button type="button" onClick={onArchive} className={itemClass}>
          <span className={iconWrap}>⌂</span>
          Archiver
        </button>
      ) : (
        <span className={itemDisabledClass} title="Déjà archivé">
          <span className={iconWrap}>⌂</span>
          Archiver
        </span>
      )}

      <div className={sepCls} />

      {/* ─── Synchronisation ─── */}
      <span className={groupLabel}>Synchronisation</span>
      {eligibility.canSync && (
        <button type="button" onClick={onSync} className={itemClass}>
          <span className={iconWrap}>↻</span>
          Synchroniser
        </button>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className={`${itemClass} ${refreshing ? "opacity-50 cursor-wait" : ""}`}
      >
        <span className={iconWrap}>↻</span>
        {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
      </button>
      {eligibility.canPublishPfs && (
        <button
          type="button"
          onClick={onPublishPfs}
          disabled={pfsPublishing || maintenance.pfs}
          title={maintenance.pfs ? "Paris Fashion Shop en maintenance sur la plateforme" : undefined}
          className={`${itemClass} ${pfsPublishing || maintenance.pfs ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {pfsPublishing
            ? "Publication PFS en cours…"
            : maintenance.pfs
              ? "Publier sur Paris Fashion Shop — en maintenance"
              : "Publier sur Paris Fashion Shop"}
        </button>
      )}
      {eligibility.canPublishEfashion && (
        <button
          type="button"
          onClick={onPublishEfashion}
          disabled={efashionPublishing || maintenance.efashion}
          title={maintenance.efashion ? "eFashion Paris en maintenance sur la plateforme" : undefined}
          className={`${itemClass} ${efashionPublishing || maintenance.efashion ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {efashionPublishing
            ? "Publication eFashion en cours…"
            : maintenance.efashion
              ? "Publier sur eFashion — en maintenance"
              : "Publier sur eFashion"}
        </button>
      )}
      {eligibility.canPublishAnkorstore && (
        <button
          type="button"
          onClick={onPublishAnkorstore}
          disabled={ankorstorePublishing || maintenance.ankorstore}
          title={maintenance.ankorstore ? "Ankorstore en maintenance sur la plateforme" : undefined}
          className={`${itemClass} ${ankorstorePublishing || maintenance.ankorstore ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {ankorstorePublishing
            ? "Publication Ankorstore en cours…"
            : maintenance.ankorstore
              ? "Publier sur Ankorstore — en maintenance"
              : "Publier sur Ankorstore"}
        </button>
      )}
      {eligibility.canPublishFaire && (
        <button
          type="button"
          onClick={onPublishFaire}
          disabled={fairePublishing || maintenance.faire}
          title={maintenance.faire ? "Faire en maintenance sur la plateforme" : undefined}
          className={`${itemClass} ${fairePublishing || maintenance.faire ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {fairePublishing
            ? "Publication Faire en cours…"
            : maintenance.faire
              ? "Publier sur Faire — en maintenance"
              : "Publier sur Faire"}
        </button>
      )}
      {eligibility.canPublishOrderchamp && (
        <button
          type="button"
          onClick={onPublishOrderchamp}
          disabled={orderchampPublishing || maintenance.orderchamp}
          title={maintenance.orderchamp ? "Orderchamp en maintenance sur la plateforme" : undefined}
          className={`${itemClass} ${orderchampPublishing || maintenance.orderchamp ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {orderchampPublishing
            ? "Publication Orderchamp en cours…"
            : maintenance.orderchamp
              ? "Publier sur Orderchamp — en maintenance"
              : "Publier sur Orderchamp"}
        </button>
      )}

      <div className={sepCls} />

      {/* ─── Suppression ─── */}
      <button
        type="button"
        onClick={onDelete}
        className={itemDangerClass}
      >
        <span className={iconWrapDanger}>✕</span>
        Supprimer le produit
      </button>
    </div>
  );
}

// ─── Dates Cell ────────────────────────────────────────────────────────────────
// formatRelativeDate is exported from @/lib/format-date

/**
 * Tooltip détaillé affiché au survol d'une puce d'export marketplace.
 * Extrait en fonction pure pour pouvoir être couvert par Vitest sans
 * dépendance à testing-library.
 */
export function formatExportTooltip(
  lastExportedAt: string | null,
  marketplaceLabel: string,
): string {
  if (!lastExportedAt) {
    return `Jamais exporté vers ${marketplaceLabel} depuis l'admin.`;
  }
  const d = new Date(lastExportedAt);
  if (Number.isNaN(d.getTime())) {
    return `Jamais exporté vers ${marketplaceLabel} depuis l'admin.`;
  }
  const longFmt = d.toLocaleString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `Dernier export vers ${marketplaceLabel} le ${longFmt}.`;
}

/**
 * Mini-puce « initiale colorée + date d'export » utilisée dans la cellule
 * Dates pour montrer d'un coup d'œil quand chaque marketplace a reçu sa
 * dernière diffusion (export Excel/ZIP). Visible aussi pour les produits en
 * brouillon — c'est tout l'intérêt par rapport aux badges marketplace.
 *
 * Si `lastExportedAt` est null, on garde la ligne (avec « — » discret) pour
 * que la liste reste lisible en colonnes alignées, plutôt qu'un trou variable.
 */
export function MarketplaceExportLine({
  initials,
  initialsClass,
  lastExportedAt,
  marketplaceLabel,
}: {
  initials: string;
  /** Tailwind classes pour la pastille d'initiales (bg + text + border). */
  initialsClass: string;
  lastExportedAt: string | null;
  marketplaceLabel: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-body whitespace-nowrap"
      title={formatExportTooltip(lastExportedAt, marketplaceLabel)}
    >
      <span
        className={`inline-flex items-center justify-center min-w-[24px] h-[15px] px-1 rounded text-[9px] font-bold tracking-tight border ${initialsClass}`}
        aria-hidden="true"
      >
        {initials}
      </span>
      {lastExportedAt ? (
        <span className="tabular-nums text-text-secondary">{formatRelativeDate(lastExportedAt)}</span>
      ) : (
        <span className="text-text-muted/70">—</span>
      )}
    </span>
  );
}

/**
 * Considère que `updatedAt` reflète une "vraie" modification ultérieure à la
 * création — Prisma met `updatedAt = createdAt` à l'insert, donc on tolère
 * une fenêtre de 60s pour absorber les race-conditions internes (catégorie
 * créée juste après le produit, par ex.).
 */
export function wasMeaningfullyUpdated(createdAt: string, updatedAt: string): boolean {
  const c = new Date(createdAt).getTime();
  const u = new Date(updatedAt).getTime();
  if (Number.isNaN(c) || Number.isNaN(u)) return false;
  return u - c > 60_000;
}

function ProductDatesCell({
  createdAt,
  updatedAt,
  lastRefreshedAt,
  pfsLastExportedAt,
  ankorstoreLastExportedAt,
  efashionLastExportedAt,
  microstoreLastExportedAt,
  faireLastExportedAt,
}: {
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  pfsLastExportedAt: string | null;
  ankorstoreLastExportedAt: string | null;
  efashionLastExportedAt: string | null;
  microstoreLastExportedAt: string | null;
  faireLastExportedAt: string | null;
}) {
  const showUpdated = wasMeaningfullyUpdated(createdAt, updatedAt);
  const longFmt = (iso: string) =>
    new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="flex flex-col gap-1 min-w-[130px]">
      {/* Créé */}
      <span
        className="inline-flex items-center gap-1.5 text-[11px] font-body text-text-muted whitespace-nowrap"
        title={`Créé le ${longFmt(createdAt)}`}
      >
        <svg className="w-3 h-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        <span className="tabular-nums">{formatRelativeDate(createdAt)}</span>
      </span>
      {/* Modifié — masqué si jamais modifié (updatedAt ≈ createdAt) */}
      {showUpdated && (
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-body text-text-secondary whitespace-nowrap"
          title={`Dernière modification le ${longFmt(updatedAt)}`}
        >
          <svg className="w-3 h-3 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487zm0 0L19.5 7.125" />
          </svg>
          <span className="tabular-nums">{formatRelativeDate(updatedAt)}</span>
        </span>
      )}
      {/* Rafraîchi — accent indigo pour repérer instantanément les produits relancés */}
      {lastRefreshedAt && (
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-body text-[#4F46E5] font-medium whitespace-nowrap"
          title={`Dernier rafraîchissement le ${longFmt(lastRefreshedAt)}`}
        >
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
          </svg>
          <span className="tabular-nums">{formatRelativeDate(lastRefreshedAt)}</span>
        </span>
      )}
    </div>
  );
}

// ─── Product Row (expandable) ──────────────────────────────────────────────────

function ProductRow({
  product,
  rowNumber,
  hasPfsConfig,
  pfsGloballyEnabled = true,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  hasOrderchampConfig,
  orderchampEnabled,
  hasMicrostoreConfig,
  microstoreEnabled = true,
  selected,
  onToggle,
  expanded,
  onExpandToggle,
  dirtyEdits,
  onCommitCell,
  isDeleting = false,
  onRowStatus,
  onRowDelete,
  onRowSync,
}: {
  product: AdminProduct;
  rowNumber: number;
  hasPfsConfig: boolean;
  pfsGloballyEnabled?: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasOrderchampConfig: boolean;
  orderchampEnabled: boolean;
  hasMicrostoreConfig: boolean;
  microstoreEnabled?: boolean;
  selected: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpandToggle: () => void;
  dirtyEdits: VariantDirtyEdits;
  onCommitCell: (variantId: string, field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => void;
  isDeleting?: boolean;
  onRowStatus: (productId: string, status: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onRowDelete: (productId: string) => void;
  onRowSync: (productId: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [mobileStatusOpen, setMobileStatusOpen] = useState(false);
  const [linkPfsOpen, setLinkPfsOpen] = useState(false);
  const [linkAkOpen, setLinkAkOpen] = useState(false);
  const [linkEfOpen, setLinkEfOpen] = useState(false);
  const [linkFaireOpen, setLinkFaireOpen] = useState(false);
  const [linkOrderchampOpen, setLinkOrderchampOpen] = useState(false);
  // Modales « Publier / Lier » : une par marketplace, ouvertes au clic du badge
  const [actionModalPfs, setActionModalPfs] = useState(false);
  const [actionModalAk, setActionModalAk] = useState(false);
  const [actionModalEf, setActionModalEf] = useState(false);
  const [actionModalFaire, setActionModalFaire] = useState(false);
  const [actionModalOrderchamp, setActionModalOrderchamp] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Suivi du tap sur la ligne : distinguer un scroll (le doigt a bougé) d'un
  // vrai tap pour éviter la sélection accidentelle sur mobile.
  const rowTouchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [refCopied, setRefCopied] = useState(false);
  const { enqueue, items: queueItems, getRecentClientSuccessAt } = useMarketplaceRefreshQueue();
  const { hasActiveJobForProduct: hasLinkJob } = useMarketplaceLinkJobs();
  const { addProduct: addToEfashionShootingBatch, items: efashionShootingItems } = useEfashionShootingBatch();
  const { open: openRailWidget, nudgeWidget: nudgeRailWidget } = useRightRail();
  const efashionShootingPending = React.useMemo(() => {
    const item = efashionShootingItems.find((i) => i.productId === product.id);
    return item ? item.mode : null;
  }, [efashionShootingItems, product.id]);
  // Distinction visuelle vs métier :
  //  - showXxx : rendre le badge (même barré si le kill switch global est OFF)
  //  - xxxOperational : autoriser une action (publier, resync). Un kill switch
  //    OFF côté Paramètres coupe l'action mais laisse le badge visible barré.
  const maintenance = useMarketplaceMaintenance();
  const showAnkorstore = hasAnkorstoreConfig;
  const showEfashion = hasEfashionConfig;
  const showFaire = hasFaireConfig;
  const showOrderchamp = hasOrderchampConfig;
  // Maintenance plateforme = coupe l'opérationnalité, même si le kill switch tenant est ON.
  const ankorstoreOperational = hasAnkorstoreConfig && ankorstoreEnabled && !maintenance.ankorstore;
  const efashionOperational = hasEfashionConfig && efashionEnabled && !maintenance.efashion;
  const faireOperational = hasFaireConfig && faireEnabled && !maintenance.faire;
  const orderchampOperational = hasOrderchampConfig && orderchampEnabled && !maintenance.orderchamp;
  const pfsOperational = hasPfsConfig && pfsGloballyEnabled && !maintenance.pfs;
  const pfsDisabledOverall = maintenance.pfs || !product.pfsEnabled || !pfsGloballyEnabled;
  const ankorsDisabledOverall = maintenance.ankorstore || !product.ankorsEnabled || !ankorstoreEnabled;
  const efashionDisabledOverall = maintenance.efashion || !product.efashionEnabled || !efashionEnabled;
  const faireDisabledOverall = maintenance.faire || !product.faireEnabled || !faireEnabled;
  const orderchampDisabledOverall = maintenance.orderchamp || !product.orderchampEnabled || !orderchampEnabled;
  const efashionLinked = product.colors.some((c) => c.efashionProductId != null);
  const { refreshSingle } = useRefreshMarketplaceDialog({
    showPfs: pfsOperational,
    showAnkorstore: ankorstoreOperational,
    showEfashion: efashionOperational,
    showFaire: faireOperational,
    showOrderchamp: orderchampOperational,
  });

  // Optimistic UI : quand la cliente clique la croix « ignorer » d'un badge
  // orange, on masque le orange TOUT DE SUITE localement (sans attendre le
  // router.refresh() qui régénère la table lourde /admin/produits). Le serveur
  // est appelé en tâche de fond ; en cas d'échec on retire l'entrée et le
  // orange revient.
  type SyncFlagKey = "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp" | "microstore";
  const [optimisticallyCleared, setOptimisticallyCleared] = useState<
    ReadonlySet<SyncFlagKey>
  >(() => new Set());
  const isClearedLocally = (mp: SyncFlagKey) => optimisticallyCleared.has(mp);
  const addClearedLocally = (mp: SyncFlagKey) =>
    setOptimisticallyCleared((prev) => {
      const next = new Set(prev);
      next.add(mp);
      return next;
    });
  const removeClearedLocally = (mp: SyncFlagKey) =>
    setOptimisticallyCleared((prev) => {
      if (!prev.has(mp)) return prev;
      const next = new Set(prev);
      next.delete(mp);
      return next;
    });
  useEffect(() => {
    if (!product.pfsSyncRequired) removeClearedLocally("pfs");
  }, [product.pfsSyncRequired]);
  useEffect(() => {
    if (!product.ankorsSyncRequired) removeClearedLocally("ankorstore");
  }, [product.ankorsSyncRequired]);
  useEffect(() => {
    if (!product.efashionSyncRequired) removeClearedLocally("efashion");
  }, [product.efashionSyncRequired]);
  useEffect(() => {
    if (!product.faireSyncRequired) removeClearedLocally("faire");
  }, [product.faireSyncRequired]);
  useEffect(() => {
    if (!product.orderchampSyncRequired) removeClearedLocally("orderchamp");
  }, [product.orderchampSyncRequired]);
  useEffect(() => {
    if (!product.microstoreSyncRequired) removeClearedLocally("microstore");
  }, [product.microstoreSyncRequired]);

  const effectivePfsSyncRequired =
    product.pfsSyncRequired && !isClearedLocally("pfs");
  const effectiveAnkorsSyncRequired =
    product.ankorsSyncRequired && !isClearedLocally("ankorstore");
  const effectiveEfashionSyncRequired =
    product.efashionSyncRequired && !isClearedLocally("efashion");
  const effectiveFaireSyncRequired =
    product.faireSyncRequired && !isClearedLocally("faire");
  const effectiveOrderchampSyncRequired =
    product.orderchampSyncRequired && !isClearedLocally("orderchamp");
  const effectiveMicrostoreSyncRequired =
    product.microstoreSyncRequired && !isClearedLocally("microstore");

  // État "loading" des badges marketplaces : on regarde la dernière opération
  // marketplace pour ce produit et on bloque les clics tant qu'elle est en
  // file/exécution/attente du callback. Verrou local supplémentaire pour le
  // bref instant entre le clic et la mise à jour de la file (anti-double-clic).
  // On englobe aussi les liaisons manuelles (MarketplaceLinkContext) — sans
  // ce signal le badge resterait rouge toute la durée de la liaison.
  const pfsOp = findLatestOpForProduct(queueItems, product.id, "pfs");
  const pfsBadgeState = computeMarketplaceBadgeState(
    product.pfsProductId,
    pfsOp,
    "pfs",
    effectivePfsSyncRequired,
    undefined,
    getRecentClientSuccessAt(product.id, "pfs"),
    hasLinkJob(product.id, "pfs"),
  );
  const [pendingPfsEnqueue, setPendingPfsEnqueue] = useState(false);
  const isPfsPublishing = pfsBadgeState.loading || pendingPfsEnqueue;

  const ankorstoreOp = findLatestOpForProduct(queueItems, product.id, "ankorstore");
  const ankorstoreBadgeState = computeMarketplaceBadgeState(
    product.ankorsProductId,
    ankorstoreOp,
    "ankorstore",
    effectiveAnkorsSyncRequired,
    undefined,
    getRecentClientSuccessAt(product.id, "ankorstore"),
    hasLinkJob(product.id, "ankorstore"),
  );
  const [pendingAnkorstoreEnqueue, setPendingAnkorstoreEnqueue] = useState(false);
  const isAnkorstorePublishing = ankorstoreBadgeState.loading || pendingAnkorstoreEnqueue;

  const efashionOp = findLatestOpForProduct(queueItems, product.id, "efashion");
  const efashionBadgeState = computeMarketplaceBadgeState(
    efashionLinked ? "linked" : null,
    efashionOp,
    "efashion",
    effectiveEfashionSyncRequired,
    undefined,
    getRecentClientSuccessAt(product.id, "efashion"),
    hasLinkJob(product.id, "efashion"),
  );
  const [pendingEfashionEnqueue, setPendingEfashionEnqueue] = useState(false);
  const isEfashionPublishing = efashionBadgeState.loading || pendingEfashionEnqueue;

  const faireOp = findLatestOpForProduct(queueItems, product.id, "faire");
  const faireBadgeState = computeMarketplaceBadgeState(
    product.faireProductId,
    faireOp,
    "faire",
    effectiveFaireSyncRequired,
    undefined,
    getRecentClientSuccessAt(product.id, "faire"),
    hasLinkJob(product.id, "faire"),
  );
  const [pendingFaireEnqueue, setPendingFaireEnqueue] = useState(false);
  const isFairePublishing = faireBadgeState.loading || pendingFaireEnqueue;

  const orderchampOp = findLatestOpForProduct(queueItems, product.id, "orderchamp");
  const orderchampBadgeState = computeMarketplaceBadgeState(
    product.orderchampProductId,
    orderchampOp,
    "orderchamp",
    effectiveOrderchampSyncRequired,
    undefined,
    getRecentClientSuccessAt(product.id, "orderchamp"),
    // `hasLinkJob` ne connait pas encore « orderchamp » — on ne peut pas typer
    // proprement tant que MarketplaceLinkContext n'a pas été étendu. Fallback
    // false : les liaisons manuelles orderchamp n'ont pas encore de flow UI.
    false,
  );
  const [pendingOrderchampEnqueue, setPendingOrderchampEnqueue] = useState(false);
  const isOrderchampPublishing = orderchampBadgeState.loading || pendingOrderchampEnqueue;

  // État de confirmation « Publier sur X ? » — piloté par une seule modale
  // partagée (MarketplacePublishConfirmModal). null = fermée.
  const [publishConfirmFor, setPublishConfirmFor] = useState<
    "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp" | null
  >(null);

  // Demande la création d'une nouvelle fiche sur PFS — même logique que pour
  // Ankorstore mais sans la possibilité de "lier à existant" (pas de modale).
  const handlePublishPfs = useCallback(() => {
    if (isPfsPublishing) return;
    setPublishConfirmFor("pfs");
  }, [isPfsPublishing]);
  const doPublishPfs = useCallback(() => {
    setPublishConfirmFor(null);
    setPendingPfsEnqueue(true);
    enqueue([
      {
        productId: product.id,
        reference: product.reference,
        productName: product.name,
        firstImage: product.firstImage,
        options: { local: false, pfs: true },
        mode: "publish",
        marketplace: "pfs",
      },
    ]);
  }, [enqueue, product]);

  // Demande la création d'une nouvelle fiche sur Ankorstore — appelé depuis le
  // badge "+ Ankorstore" et l'item du menu Actions. On passe par une simple
  // confirmation puis on enqueue : le widget en bas à droite affichera la
  // progression (callback Ankorstore asynchrone, voir CLAUDE.md > mode callback-only).
  const handlePublishAnkorstore = useCallback(() => {
    if (isAnkorstorePublishing) return;
    setPublishConfirmFor("ankorstore");
  }, [isAnkorstorePublishing]);
  const doPublishAnkorstore = useCallback(() => {
    setPublishConfirmFor(null);
    setPendingAnkorstoreEnqueue(true);
    enqueue([
      {
        productId: product.id,
        reference: product.reference,
        productName: product.name,
        firstImage: product.firstImage,
        options: { local: false, pfs: false, ankorstore: true },
        mode: "publish",
        marketplace: "ankorstore",
      },
    ]);
  }, [enqueue, product]);

  // Clic 1-clic depuis un badge orange « Synchro nécessaire ». Pas de
  // confirmation : la cliente a déjà vu le badge et choisi délibérément.
  // Utilitaire de confirmation partagé par les 4 marketplaces asynchrones.
  // Le clic sur un badge marketplace passe par cette confirmation avant
  // d'enqueue la resynchro — évite les envois accidentels.
  const confirmMarketplaceSync = useCallback(
    async (label: string, asyncNote = "") => {
      return await confirm({
        type: "info",
        title: `Synchroniser « ${product.name} » sur ${label} ?`,
        message:
          `Les dernières modifications locales seront envoyées à ${label} pour mettre à jour la fiche existante.` +
          asyncNote,
        confirmLabel: "Oui, synchroniser",
        cancelLabel: "Annuler",
      });
    },
    [confirm, product.name],
  );

  const handleSyncPfs = useCallback(async () => {
    if (isPfsPublishing) return;
    if (!(await confirmMarketplaceSync("Paris Fashion Shop"))) return;
    setPendingPfsEnqueue(true);
    enqueue([{
      productId: product.id,
      reference: product.reference,
      productName: product.name,
      firstImage: product.firstImage,
      options: { local: false, pfs: true },
      mode: "resync",
      marketplace: "pfs",
    }]);
  }, [enqueue, product, isPfsPublishing, confirmMarketplaceSync]);

  const handleSyncAnkorstore = useCallback(async () => {
    if (isAnkorstorePublishing) return;
    if (!(await confirmMarketplaceSync(
      "Ankorstore",
      " La synchro Ankorstore est asynchrone : le résultat arrivera dans les minutes qui suivent.",
    ))) return;
    setPendingAnkorstoreEnqueue(true);
    enqueue([{
      productId: product.id,
      reference: product.reference,
      productName: product.name,
      firstImage: product.firstImage,
      options: { local: false, pfs: false, ankorstore: true },
      mode: "resync",
      marketplace: "ankorstore",
    }]);
  }, [enqueue, product, isAnkorstorePublishing, confirmMarketplaceSync]);

  const handleSyncEfashion = useCallback(async () => {
    if (isEfashionPublishing) return;
    if (!(await confirmMarketplaceSync("eFashion Paris"))) return;
    setPendingEfashionEnqueue(true);
    enqueue([{
      productId: product.id,
      reference: product.reference,
      productName: product.name,
      firstImage: product.firstImage,
      options: { local: false, pfs: false, ankorstore: false, efashion: true },
      mode: "resync",
      marketplace: "efashion",
    }]);
  }, [enqueue, product, isEfashionPublishing, confirmMarketplaceSync]);

  // Demande la création d'une nouvelle fiche sur eFashion Paris — appelé depuis
  // le badge "+ eFashion". Même logique qu'Ankorstore (confirmation + enqueue +
  // widget bas-droite), mais le flow eFashion est synchrone (pas de callback).
  const handlePublishEfashion = useCallback(() => {
    if (isEfashionPublishing) return;
    setPublishConfirmFor("efashion");
  }, [isEfashionPublishing]);
  const doPublishEfashion = useCallback(() => {
    setPublishConfirmFor(null);
    // Première publication eFashion = ticket de shooting nécessaire → file
    // batch (validation manuelle de l'utilisatrice avant envoi groupé).
    // Pas besoin du lock pendingEfashionEnqueue : l'opération est synchrone
    // côté serveur (un simple upsert en BDD) et la widget eFashion en bas à
    // droite reflètera l'ajout au prochain poll.
    void addToEfashionShootingBatch(product.id, "PUBLISH");
  }, [addToEfashionShootingBatch, product]);

  // Quand la file remonte enfin l'opération en queue/in_progress, on lâche le
  // verrou local : c'est maintenant l'état serveur qui pilote l'affichage.
  useEffect(() => {
    if (pendingPfsEnqueue && pfsBadgeState.loading) {
      setPendingPfsEnqueue(false);
    }
  }, [pendingPfsEnqueue, pfsBadgeState.loading]);
  useEffect(() => {
    if (pendingAnkorstoreEnqueue && ankorstoreBadgeState.loading) {
      setPendingAnkorstoreEnqueue(false);
    }
  }, [pendingAnkorstoreEnqueue, ankorstoreBadgeState.loading]);
  useEffect(() => {
    if (pendingEfashionEnqueue && efashionBadgeState.loading) {
      setPendingEfashionEnqueue(false);
    }
  }, [pendingEfashionEnqueue, efashionBadgeState.loading]);
  useEffect(() => {
    if (pendingFaireEnqueue && faireBadgeState.loading) {
      setPendingFaireEnqueue(false);
    }
  }, [pendingFaireEnqueue, faireBadgeState.loading]);
  useEffect(() => {
    if (pendingOrderchampEnqueue && orderchampBadgeState.loading) {
      setPendingOrderchampEnqueue(false);
    }
  }, [pendingOrderchampEnqueue, orderchampBadgeState.loading]);

  // Modale variantes ouverte (bureau ou mobile) : lock body scroll + fermeture ESC.
  useEffect(() => {
    if (!expanded) return;
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExpandToggle(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [expanded, onExpandToggle]);

  const handlePublishFaire = useCallback(() => {
    if (isFairePublishing) return;
    setPublishConfirmFor("faire");
  }, [isFairePublishing]);
  const doPublishFaire = useCallback(() => {
    setPublishConfirmFor(null);
    setPendingFaireEnqueue(true);
    enqueue([
      {
        productId: product.id,
        reference: product.reference,
        productName: product.name,
        firstImage: product.firstImage,
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
        mode: "publish",
        marketplace: "faire",
      },
    ]);
  }, [enqueue, product]);

  const handleSyncFaire = useCallback(async () => {
    if (isFairePublishing) return;
    if (!(await confirmMarketplaceSync("Faire"))) return;
    setPendingFaireEnqueue(true);
    enqueue([{
      productId: product.id,
      reference: product.reference,
      productName: product.name,
      firstImage: product.firstImage,
      options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
      mode: "resync",
      marketplace: "faire",
    }]);
  }, [enqueue, product, isFairePublishing, confirmMarketplaceSync]);

  const handlePublishOrderchamp = useCallback(() => {
    if (isOrderchampPublishing) return;
    setPublishConfirmFor("orderchamp");
  }, [isOrderchampPublishing]);
  const doPublishOrderchamp = useCallback(() => {
    setPublishConfirmFor(null);
    setPendingOrderchampEnqueue(true);
    enqueue([
      {
        productId: product.id,
        reference: product.reference,
        productName: product.name,
        firstImage: product.firstImage,
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: false, orderchamp: true },
        mode: "publish",
        marketplace: "orderchamp",
      },
    ]);
  }, [enqueue, product]);

  const handleSyncOrderchamp = useCallback(async () => {
    if (isOrderchampPublishing) return;
    if (!(await confirmMarketplaceSync("Orderchamp"))) return;
    setPendingOrderchampEnqueue(true);
    enqueue([{
      productId: product.id,
      reference: product.reference,
      productName: product.name,
      firstImage: product.firstImage,
      options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: false, orderchamp: true },
      mode: "resync",
      marketplace: "orderchamp",
    }]);
  }, [enqueue, product, isOrderchampPublishing, confirmMarketplaceSync]);

  const [microstoreBusy, setMicrostoreBusy] = useState(false);
  const handleSyncMicrostore = useCallback(async () => {
    if (microstoreBusy) return;
    const ok = await confirm({
      type: "info",
      title: `Synchroniser « ${product.name} » sur Microstore ?`,
      message:
        "La fiche Microstore sera créée si absente ou mise à jour (nom, prix, stock, couleurs, catégorie, description). " +
        "Les photos ne sont pas envoyées — à ajouter manuellement côté Microstore si besoin.",
      confirmLabel: "Oui, synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setMicrostoreBusy(true);
    // Nudge le widget « Photos Microstore » — cf. MicrostoreStatusCard.
    nudgeRailWidget("microstore-upload");
    try {
      const { pushProductToMicrostore } = await import(
        "@/app/actions/admin/microstore-products"
      );
      const res = await pushProductToMicrostore(product.id);
      if (res.success) {
        toast.success("Fiche Microstore synchronisée");
        router.refresh();
      } else {
        toast.error(
          "Envoi Microstore échoué",
          res.error ?? "Erreur inconnue.",
        );
      }
    } finally {
      setMicrostoreBusy(false);
    }
  }, [microstoreBusy, product.id, product.name, confirm, toast, router]);

  const handleCancelMicrostoreSync = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Ignorer cette synchronisation Microstore ?",
      message:
        "Le badge orange disparaîtra et vos dernières modifications NE seront pas envoyées à Microstore. " +
        "Vous pourrez toujours re-synchroniser plus tard en cliquant sur le badge vert.",
      confirmLabel: "Oui, ignorer",
    });
    if (!ok) return;
    addClearedLocally("microstore");
    toast.success("Synchronisation ignorée");
    void (async () => {
      const { clearMicrostoreSyncRequired } = await import(
        "@/app/actions/admin/microstore-products"
      );
      const res = await clearMicrostoreSyncRequired(product.id);
      if (!res.success) {
        removeClearedLocally("microstore");
        toast.error("Impossible d'ignorer", res.error ?? "Erreur inconnue.");
        return;
      }
      router.refresh();
    })();
  }, [confirm, product.id, toast, router]);

  // Croix « annuler la synchro » sur le badge orange. Confirmation modale puis
  // reset du drapeau syncRequired : le produit repasse en vert « en ligne »
  // sans qu'aucune modif ne soit envoyée à la marketplace.
  const handleCancelSyncRequired = useCallback(
    async (marketplace: "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp", marketplaceLabel: string) => {
      const ok = await confirm({
        type: "warning",
        title: `Ignorer cette synchronisation ${marketplaceLabel} ?`,
        message:
          `Le badge orange disparaîtra et vos dernières modifications NE seront pas envoyées à ${marketplaceLabel}. ` +
          `La fiche ${marketplaceLabel} restera dans son état précédent. Vous pourrez toujours synchroniser plus tard ` +
          `en cliquant sur l'icône ↻ du produit.`,
        confirmLabel: "Oui, ignorer",
      });
      if (!ok) return;
      addClearedLocally(marketplace);
      toast.success("Synchronisation ignorée");
      void clearSyncRequiredFlag(product.id, marketplace).then((res) => {
        if (!res.success) {
          removeClearedLocally(marketplace);
          toast.error("Impossible d'ignorer", res.error ?? "Erreur inconnue.");
          return;
        }
        router.refresh();
      });
    },
    [confirm, product.id, toast, router],
  );

  // Toutes les couleurs uniques attribuées au produit (UNIT + PACK confondus).
  const uniqueColors = [...new Map(product.colors
    .filter((c) => c.colorId && c.color)
    .map((c) => [c.colorId!, c] as const)
  ).values()];
  const minPrice = product.colors.length > 0
    ? Math.min(...product.colors.map((c) => c.unitPrice))
    : NaN;

  // Stock status
  const isFullyOutOfStock = product.colors.length > 0 && product.colors.every((c) => c.stock === 0);
  const hasPartialOutOfStock = !isFullyOutOfStock && product.colors.some((c) => c.stock === 0);
  const showRuptureBadge = computeShowStockBadges({ status: product.status, isIncomplete: product.isIncomplete }, "rupture");
  const showPartialBadge = computeShowStockBadges({ status: product.status, isIncomplete: product.isIncomplete }, "partial");

  const allNonFrLocales = NON_DEFAULT_LOCALES;
  const existingLocales = new Set(product.translations.map((t) => t.locale));
  const missingLocales = allNonFrLocales.filter((l) => !existingLocales.has(l));
  const hasMissingTranslations = missingLocales.length > 0;

  // ─── State d'édition inline : remonté au top-level ──────────────────────
  // Le bandeau apply/cancel est désormais un flottant global (voir
  // AdminProductsTable). ProductRow ne fait que passer les modifs de ses
  // variantes vers le state top-level via `onCommitCell` (prop).

  const eligibility = computeRowActionEligibility(
    { ...product, efashionLinked, fairePublished: faireBadgeState.online, orderchampPublished: orderchampBadgeState.online },
    {
      hasPfsConfig,
      hasAnkorstoreConfig,
      ankorstoreEnabled,
      hasEfashionConfig,
      efashionEnabled,
      hasFaireConfig,
      faireEnabled,
      hasOrderchampConfig,
      orderchampEnabled,
    },
  );

  const hasDirtyVariants = productHasDirtyVariants(product, dirtyEdits);

  return (
    <>
      <tr
        onTouchStart={(e) => {
          // Mémorise la position de départ du tap pour distinguer un vrai clic
          // d'un scroll dans onClick ci-dessous.
          const t = e.touches[0];
          rowTouchRef.current = { x: t.clientX, y: t.clientY, moved: false };
        }}
        onTouchMove={(e) => {
          if (!rowTouchRef.current) return;
          const t = e.touches[0];
          const dx = Math.abs(t.clientX - rowTouchRef.current.x);
          const dy = Math.abs(t.clientY - rowTouchRef.current.y);
          if (dx > 8 || dy > 8) rowTouchRef.current.moved = true;
        }}
        onClick={(e) => {
          // Sur mobile (<md) : clic ligne = toggle sélection (fond gris).
          // Sur desktop : clic ligne = ouvrir la modale variantes.
          //
          // Skip 1 — la cible est un élément interactif (bouton, lien, input) :
          // iOS Safari a un bug où stopPropagation ne bloque pas toujours le
          // bubble des taps convertis en clicks. Check target est plus fiable.
          const target = e.target as HTMLElement;
          if (target.closest("button, a, input, label")) return;
          // Skip 2 — le doigt a bougé pendant le tap → c'est un scroll, pas un
          // clic délibéré. Évite la sélection accidentelle en effleurant/scrollant.
          if (rowTouchRef.current?.moved) {
            rowTouchRef.current = null;
            return;
          }
          rowTouchRef.current = null;
          if (typeof window === "undefined") return;
          if (window.matchMedia("(max-width: 767px)").matches) {
            onToggle();
          } else {
            onExpandToggle();
          }
        }}
        aria-selected={selected}
        style={{ touchAction: "manipulation" }}
        className={`group table-row cursor-pointer md:transition-colors md:duration-150 ${
          selected ? "product-row-selected" : ""
        } ${hasDirtyVariants ? "product-row-dirty" : ""} ${expanded ? "border-b-0" : ""} ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
      >
        {/* Checkbox (desktop only) */}
        <td className="hidden md:table-cell px-2 md:px-4 py-3.5 w-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="checkbox-custom"
          />
        </td>

        {/* N° de ligne */}
        <td className="hidden sm:table-cell px-2 py-3.5 w-10 text-center">
          <span className="font-body text-[11px] text-text-muted tabular-nums">{rowNumber}</span>
        </td>

        {/* Produit — photo + nom + référence dans une seule colonne (fusion
            des anciennes cellules Photo + Réf. + Produit pour ressembler à
            la maquette Ardoise). */}
        <td className="px-4 md:px-6 py-7 md:py-8 md:min-w-[280px]">
          <div className="flex items-center gap-4">
            {/* Miniature à gauche — plus grande pour bien voir le produit
                (72px mobile, 88px tablette, 64px desktop). Clic = édition. */}
            <Link
              href={`/admin/produits/${product.id}/modifier`}
              onClick={(e) => e.stopPropagation()}
              prefetch={false}
              className="shrink-0"
              aria-label={`Modifier ${product.name}`}
            >
              {product.firstImage ? (
                <img
                  src={product.firstImage}
                  alt={product.name}
                  className="w-[72px] h-[72px] md:w-[88px] md:h-[88px] lg:w-16 lg:h-16 object-cover rounded-xl border border-border shadow-sm"
                />
              ) : (
                <div className="w-[72px] h-[72px] md:w-[88px] md:h-[88px] lg:w-16 lg:h-16 bg-bg-tertiary rounded-xl border border-border flex items-center justify-center">
                  <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
                  </svg>
                </div>
              )}
            </Link>
            {/* Nom + référence */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="font-semibold text-text-primary text-[13.5px] leading-tight truncate" title={product.name}>
                  {product.name}
                </p>
                {hasMissingTranslations && (
                  <span
                    className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold shrink-0"
                    title={`Traductions manquantes: ${missingLocales.join(", ")}`}
                  >
                    ⓘ
                  </span>
                )}
                {/* Pastille de vérification PFS — cliquable (déclenche la vérif).
                    Enveloppée dans un span stopPropagation pour ne pas toggle la
                    sélection de la ligne. */}
                <span onClick={(e) => e.stopPropagation()} className="inline-flex">
                  <PfsVerifyBadge
                    productId={product.id}
                    productName={product.name}
                    productReference={product.reference}
                    productFirstImage={null}
                    pfsProductId={product.pfsProductId}
                    pfsCheckedAt={product.pfsCheckedAt}
                    pfsCheckStatus={product.pfsCheckStatus}
                    pfsCheckIssues={product.pfsCheckIssues as PfsVerifyIssue[] | null}
                  />
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1 min-w-0">
                <p className="font-mono text-[11px] text-text-muted truncate">{product.reference}</p>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await navigator.clipboard.writeText(product.reference);
                      setRefCopied(true);
                      window.setTimeout(() => setRefCopied(false), 1500);
                    } catch {
                      toast.error("Impossible de copier la référence");
                    }
                  }}
                  title={refCopied ? "Référence copiée" : "Copier la référence"}
                  aria-label={refCopied ? "Référence copiée" : "Copier la référence"}
                  className="inline-flex items-center justify-center w-4 h-4 rounded text-text-muted hover:bg-bg-tertiary hover:text-text-primary transition-colors shrink-0"
                >
                  {refCopied ? (
                    <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
              </div>
              {/* Prix + icônes Important/Verrouiller sous la référence.
                  Toujours visibles pour libérer la largeur du tableau.
                  stopPropagation sur les toggles pour éviter de toggle la
                  sélection de la ligne en cliquant sur ⭐ ou 🔒. */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {!isNaN(minPrice) ? (
                  (() => {
                    const pct = product.discountPercent && product.discountPercent > 0
                      ? product.discountPercent
                      : 0;
                    // Troncature au centime (règle métier : jamais d'arrondi à la hausse).
                    const finalPrice = pct > 0
                      ? Math.floor(minPrice * (1 - pct / 100) * 100) / 100
                      : minPrice;
                    return pct > 0 ? (
                      <span className="inline-flex items-baseline gap-1 tabular-nums">
                        <span className="text-text-muted text-[11px] line-through">
                          {minPrice.toFixed(2)} EUR
                        </span>
                        <span className="font-semibold text-error text-[12.5px]">
                          {finalPrice.toFixed(2)} EUR
                        </span>
                      </span>
                    ) : (
                      <span className="font-semibold text-text-primary text-[12.5px] tabular-nums">
                        {minPrice.toFixed(2)} EUR
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-text-muted text-[11px]">—</span>
                )}
                <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                  <ProductImportantToggle productId={product.id} initialImportant={product.important} variant="icon" />
                  <ProductLockToggle productId={product.id} initialLocked={product.locked} variant="icon" />
                </span>
              </div>
              {/* Couleurs attribuées au produit — une pastille par couleur
                  unique (UNIT + PACK confondus), légende flottante au survol. */}
              {uniqueColors.length > 0 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {uniqueColors.map((v) => (
                    <ColorSwatch
                      key={v.colorId!}
                      color={v.color}
                      outOfStock={isColorOutOfStock(product.colors, v.colorId)}
                      allDisabled={isColorAllDisabled(product.colors, v.colorId)}
                    />
                  ))}
                </div>
              )}
              {/* Badges marketplaces compacts pour mobile + tablette (< lg).
                  Alignés horizontalement (flex-nowrap + flex-1 chacun) pour
                  qu'aucun ne déborde quel que soit le nombre configurés.
                  Non-interactifs : simple aperçu du statut. Les actions passent
                  par le menu ⋮. Ajout Microstore le 2026-07-29. */}
              {/* Les brouillons ne peuvent pas être publiés → on cache complètement
                  la barre des badges marketplace pour éviter la confusion. */}
              {!product.isIncomplete && (
              <div className="lg:hidden flex items-stretch gap-1 mt-2.5 w-full flex-nowrap">
                {/* Règle de clic sur badges compact :
                    - vert (à jour) ou orange (sync nécessaire) → synchroniser
                    - rouge (non lié) → ouvre la modale « Créer ou Lier » (identique desktop)
                    - rayé (désactivé) → non cliquable */}
                <MpDot
                  label="PFS"
                  active={hasPfsConfig && pfsBadgeState.online}
                  syncRequired={pfsBadgeState.syncRequired}
                  disabled={pfsDisabledOverall}
                  busy={isPfsPublishing}
                  onClick={pfsOperational ? (
                    pfsBadgeState.online
                      ? () => void handleSyncPfs()
                      : () => setActionModalPfs(true)
                  ) : undefined}
                />
                {showEfashion && (
                  <MpDot
                    label="EF"
                    active={efashionBadgeState.online}
                    syncRequired={efashionBadgeState.syncRequired}
                    disabled={efashionDisabledOverall}
                    shootingPending={!!efashionShootingPending}
                    busy={isEfashionPublishing}
                    onClick={efashionOperational && !efashionShootingPending ? (
                      efashionBadgeState.online
                        ? () => void handleSyncEfashion()
                        : () => setActionModalEf(true)
                    ) : undefined}
                  />
                )}
                {showAnkorstore && (
                  <MpDot
                    label="AK"
                    active={ankorstoreBadgeState.online}
                    syncRequired={ankorstoreBadgeState.syncRequired}
                    disabled={ankorsDisabledOverall}
                    busy={isAnkorstorePublishing}
                    onClick={ankorstoreOperational ? (
                      ankorstoreBadgeState.online
                        ? () => void handleSyncAnkorstore()
                        : () => setActionModalAk(true)
                    ) : undefined}
                  />
                )}
                {showFaire && (
                  <MpDot
                    label="FA"
                    active={faireBadgeState.online}
                    syncRequired={faireBadgeState.syncRequired}
                    disabled={faireDisabledOverall}
                    busy={isFairePublishing}
                    onClick={faireOperational ? (
                      faireBadgeState.online
                        ? () => void handleSyncFaire()
                        : () => setActionModalFaire(true)
                    ) : undefined}
                  />
                )}
                {showOrderchamp && (
                  <MpDot
                    label="OC"
                    active={orderchampBadgeState.online}
                    syncRequired={orderchampBadgeState.syncRequired}
                    disabled={orderchampDisabledOverall}
                    busy={isOrderchampPublishing}
                    onClick={orderchampOperational ? (
                      orderchampBadgeState.online
                        ? () => void handleSyncOrderchamp()
                        : () => setActionModalOrderchamp(true)
                    ) : undefined}
                  />
                )}
                {hasMicrostoreConfig && (
                  <MpDot
                    label="MC"
                    active={!!product.microstoreLastPushedAt}
                    syncRequired={product.microstoreSyncRequired}
                    disabled={!product.microstoreEnabled}
                    busy={microstoreBusy}
                    onClick={product.microstoreEnabled ? () => void handleSyncMicrostore() : undefined}
                  />
                )}
              </div>
              )}
            </div>
          </div>
        </td>

        {/* Marketplaces */}
        <td className="hidden lg:table-cell px-3 py-3.5">
          {shouldShowDraftMarketplaceNotice({
            isIncomplete: product.isIncomplete,
            pfsProductId: product.pfsProductId,
            ankorsProductId: product.ankorsProductId,
            efashionLinked,
          }) ? (
            <div
              className="inline-flex items-start gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-semibold bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE] max-w-[200px]"
              title="Ce produit est en brouillon : finalisez la fiche (image, prix, etc.) pour pouvoir le publier ou le lier à une marketplace."
            >
              <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span className="leading-tight">
                Brouillon — impossible de lier aux marketplaces
              </span>
            </div>
          ) : (
            <div className="flex flex-row gap-1 items-center flex-nowrap">
              <MarketplaceBadge
                published={pfsBadgeState.online}
                publishing={isPfsPublishing}
                syncRequired={pfsBadgeState.syncRequired && !pendingPfsEnqueue}
                lastExportedAt={product.pfsLastExportedAt}
                onActionClick={
                  pfsOperational && !pfsBadgeState.online && !isPfsPublishing
                    ? () => setActionModalPfs(true)
                    : undefined
                }
                onSyncClick={handleSyncPfs}
                onCancelSyncRequired={() => handleCancelSyncRequired("pfs", "Paris Fashion Shop")}
                disabledForProduct={pfsDisabledOverall}
                disabledReason={maintenance.pfs ? "maintenance" : "product"}
              />
              {showEfashion ? (
                <EfashionBadge
                  linked={efashionBadgeState.online}
                  publishing={isEfashionPublishing}
                  syncRequired={efashionBadgeState.syncRequired && !pendingEfashionEnqueue}
                  lastExportedAt={product.efashionLastExportedAt}
                  onActionClick={
                    efashionOperational && !efashionBadgeState.online && !isEfashionPublishing
                      ? () => setActionModalEf(true)
                      : undefined
                  }
                  onSyncClick={handleSyncEfashion}
                  onCancelSyncRequired={() => handleCancelSyncRequired("efashion", "eFashion Paris")}
                  disabledForProduct={efashionDisabledOverall}
                  disabledReason={maintenance.efashion ? "maintenance" : "product"}
                  shootingPending={efashionShootingPending}
                  onShootingClick={() => openRailWidget("shooting")}
                />
              ) : (
                <span className="inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold bg-bg-secondary text-text-muted border border-border">
                  EF
                </span>
              )}
              <AnkorstoreBadge
                published={ankorstoreBadgeState.online}
                publishing={isAnkorstorePublishing}
                syncRequired={ankorstoreBadgeState.syncRequired && !pendingAnkorstoreEnqueue}
                lastExportedAt={product.ankorstoreLastExportedAt}
                onActionClick={
                  ankorstoreOperational && !ankorstoreBadgeState.online && !isAnkorstorePublishing
                    ? () => setActionModalAk(true)
                    : undefined
                }
                onSyncClick={handleSyncAnkorstore}
                onCancelSyncRequired={() => handleCancelSyncRequired("ankorstore", "Ankorstore")}
                disabledForProduct={ankorsDisabledOverall}
                disabledReason={maintenance.ankorstore ? "maintenance" : "product"}
              />
              {showFaire ? (
                <FaireBadge
                  published={faireBadgeState.online}
                  publishing={isFairePublishing}
                  syncRequired={faireBadgeState.syncRequired && !pendingFaireEnqueue}
                  lastExportedAt={product.faireLastExportedAt}
                  onActionClick={
                    faireOperational && !faireBadgeState.online && !isFairePublishing
                      ? () => setActionModalFaire(true)
                      : undefined
                  }
                  onSyncClick={handleSyncFaire}
                  onCancelSyncRequired={() => handleCancelSyncRequired("faire", "Faire")}
                  disabledForProduct={faireDisabledOverall}
                  disabledReason={maintenance.faire ? "maintenance" : "product"}
                />
              ) : (
                <span className="inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11px] font-semibold bg-bg-secondary text-text-muted border border-border">
                  Faire
                </span>
              )}
              {showOrderchamp ? (
                <OrderchampBadge
                  published={orderchampBadgeState.online}
                  publishing={isOrderchampPublishing}
                  syncRequired={orderchampBadgeState.syncRequired && !pendingOrderchampEnqueue}
                  lastExportedAt={product.orderchampLastExportedAt}
                  onActionClick={
                    orderchampOperational && !orderchampBadgeState.online && !isOrderchampPublishing
                      ? () => setActionModalOrderchamp(true)
                      : undefined
                  }
                  onSyncClick={handleSyncOrderchamp}
                  onCancelSyncRequired={() => handleCancelSyncRequired("orderchamp", "Orderchamp")}
                  disabledForProduct={orderchampDisabledOverall}
                  disabledReason={maintenance.orderchamp ? "maintenance" : "product"}
                />
              ) : (
                <span className="inline-flex items-center justify-center w-[62px] h-[36px] rounded-md text-[11.5px] font-semibold bg-bg-secondary text-text-muted border border-border">
                  OC
                </span>
              )}
              <MicrostoreBadge
                configured={hasMicrostoreConfig}
                syncRequired={effectiveMicrostoreSyncRequired}
                onSyncClick={microstoreBusy || !microstoreEnabled ? undefined : handleSyncMicrostore}
                onCancelSyncRequired={handleCancelMicrostoreSync}
                disabledForProduct={!product.microstoreEnabled}
                disabledGlobally={!microstoreEnabled}
              />
            </div>
          )}
        </td>

        {/* Statut */}
        <td className="hidden md:table-cell px-3 py-3.5">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 flex-nowrap">
              {product.isIncomplete && product.status !== "ONLINE" && !product.pfsProductId ? (
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#F3E8FF] text-[#7C3AED] border border-[#DDD6FE]"
                  title="Brouillon — produit en cours de création"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                  Brouillon
                </span>
              ) : (
                <StatusBadge
                  status={product.status as "ONLINE" | "OFFLINE" | "ARCHIVED" | "SYNCING"}
                  canPutOnline={eligibility.canPutOnline}
                  canPutOffline={eligibility.canPutOffline}
                  canArchive={eligibility.canArchive}
                  putOnlineReason={eligibility.putOnlineReason}
                  onChange={(next) => onRowStatus(product.id, next)}
                />
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-nowrap">
              {showRuptureBadge && isFullyOutOfStock && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]"
                  title="Toutes les variantes sont en rupture de stock"
                >
                  Rupture
                </span>
              )}
              {showPartialBadge && hasPartialOutOfStock && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#C2410C] border border-[#FED7AA]"
                  title="Certaines variantes sont en rupture de stock"
                >
                  Stock partiel
                </span>
              )}
              {product.colorsMissingImageCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                  title="Une ou plusieurs couleurs actives n'ont pas encore d'image"
                >
                  {product.colorsMissingImageCount} couleur{product.colorsMissingImageCount > 1 ? "s" : ""} sans image
                </span>
              )}
              {product.missingFields.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"
                  title={MISSING_FIELD_TITLES[f]}
                >
                  {MISSING_FIELD_LABELS[f]}
                </span>
              ))}
              {isDeleting && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200">
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Suppression...
                </span>
              )}
            </div>
          </div>
        </td>

        {/* Dates — Créé / Modifié / Rafraîchi sur 3 lignes (lignes masquées si
            vides ou égales à la création). */}
        <td className="hidden xl:table-cell px-3 py-3">
          <ProductDatesCell
            createdAt={product.createdAt}
            updatedAt={product.updatedAt}
            lastRefreshedAt={product.lastRefreshedAt}
            pfsLastExportedAt={product.pfsLastExportedAt}
            ankorstoreLastExportedAt={product.ankorstoreLastExportedAt}
            efashionLastExportedAt={product.efashionLastExportedAt}
            microstoreLastExportedAt={product.microstoreLastExportedAt}
            faireLastExportedAt={product.faireLastExportedAt}
          />
        </td>

        {/* Actions */}
        <td className="relative p-0 md:px-3 md:py-3.5 text-right align-top md:align-middle" onClick={(e) => e.stopPropagation()}>
          {/* Badge statut collé au coin haut-droit de la ligne (mobile only).
              Positionné dans le td Actions car c'est la dernière colonne visible
              → vraiment aligné sur le bord droit de la ligne, au niveau du ⋮.
              Cliquable (bouton) uniquement pour ONLINE/OFFLINE/ARCHIVED → ouvre
              une modale centrée pour changer le statut. Brouillon et SYNCING
              restent des badges décoratifs non-cliquables. */}
          {(() => {
            const statusLocked = product.isIncomplete || product.status === "SYNCING";
            const bg = product.isIncomplete
              ? "#7C3AED"
              : product.status === "ONLINE"
                ? "#059669"
                : product.status === "SYNCING"
                  ? "#2563EB"
                  : product.status === "ARCHIVED"
                    ? "#EA580C"
                    : "#64748B";
            const label = product.isIncomplete
              ? "Brouillon"
              : product.status === "ONLINE"
                ? "En ligne"
                : product.status === "SYNCING"
                  ? "En sync"
                  : product.status === "ARCHIVED"
                    ? "Archivé"
                    : "Hors ligne";
            const baseCls = "md:hidden absolute top-0 right-0 z-20 inline-flex items-center px-2.5 py-1 rounded-bl-md text-[11px] font-bold uppercase tracking-wide text-white shadow-md whitespace-nowrap";
            if (statusLocked) {
              return <span className={baseCls} style={{ backgroundColor: bg }}>{label}</span>;
            }
            return (
              <button
                type="button"
                onClick={() => setMobileStatusOpen(true)}
                aria-label={`Statut actuel : ${label}. Toucher pour changer.`}
                className={`${baseCls} cursor-pointer active:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-white/60`}
                style={{ backgroundColor: bg }}
              >
                {label}
                <svg className="w-2.5 h-2.5 ml-1 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            );
          })()}
          {/* Bouton ⋮ : sur mobile poussé en bas de la cellule pour laisser la
              place au badge en haut. Sur desktop centré verticalement (align-middle). */}
          <div ref={actionsRef} className="relative inline-block mt-10 mr-1.5 md:mt-0 md:mr-0">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              aria-label="Actions du produit"
              title="Actions"
              className={`inline-flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-lg transition-all ${
                actionsOpen
                  ? "bg-bg-tertiary border border-border text-text-primary"
                  : "bg-transparent border border-transparent text-text-muted hover:bg-bg-tertiary hover:border-border hover:text-text-primary"
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.75" />
                <circle cx="12" cy="12" r="1.75" />
                <circle cx="19" cy="12" r="1.75" />
              </svg>
            </button>
            {actionsOpen && createPortal(
              <ActionsDropdown
                productId={product.id}
                productName={product.name}
                productReference={product.reference}
                expanded={expanded}
                refreshing={refreshing}
                anchorRef={actionsRef}
                eligibility={eligibility}
                ankorstorePublishing={isAnkorstorePublishing}
                pfsPublishing={isPfsPublishing}
                efashionPublishing={isEfashionPublishing}
                fairePublishing={isFairePublishing}
                orderchampPublishing={isOrderchampPublishing}
                onClose={() => setActionsOpen(false)}
                onExpandToggle={() => { onExpandToggle(); setActionsOpen(false); }}
                onRefresh={async () => {
                  setActionsOpen(false);
                  if (refreshing) return;
                  setRefreshing(true);
                  try {
                    await refreshSingle({
                      productId: product.id,
                      reference: product.reference,
                      productName: product.name,
                      firstImage: product.firstImage,
                      status: product.status,
                      isIncomplete: product.isIncomplete,
                      wasImported: !!product.pfsProductId,
                      locked: product.locked,
                      orderchampProductId: product.orderchampProductId,
                    });
                  } finally {
                    setRefreshing(false);
                  }
                }}
                onPutOnline={() => { setActionsOpen(false); onRowStatus(product.id, "ONLINE"); }}
                onPutOffline={() => { setActionsOpen(false); onRowStatus(product.id, "OFFLINE"); }}
                onArchive={() => { setActionsOpen(false); onRowStatus(product.id, "ARCHIVED"); }}
                onSync={() => { setActionsOpen(false); onRowSync(product.id); }}
                onPublishPfs={() => { setActionsOpen(false); void handlePublishPfs(); }}
                onPublishAnkorstore={() => { setActionsOpen(false); void handlePublishAnkorstore(); }}
                onPublishEfashion={() => { setActionsOpen(false); void handlePublishEfashion(); }}
                onPublishFaire={() => { setActionsOpen(false); void handlePublishFaire(); }}
                onPublishOrderchamp={() => { setActionsOpen(false); void handlePublishOrderchamp(); }}
                onDelete={() => { setActionsOpen(false); onRowDelete(product.id); }}
              />,
              document.body
            )}
          </div>
        </td>
      </tr>

      {/* ── Modale variantes ──
          Ouverte au clic sur la ligne (bureau) ou via le menu ⋮ → « Modifier
          les variantes ». Rendue dans document.body pour éviter d'être coincée
          dans le <tbody> (invalide HTML). Plein écran sur mobile, carte centrée
          de taille moyenne sur bureau. */}
      {expanded && createPortal(
        <div className="fixed inset-0 z-[9998] flex flex-col md:items-center md:justify-center md:p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={onExpandToggle}
            aria-hidden
          />
          {/* Panel — plein écran sur mobile, carte centrée large sur bureau
              (max-w-7xl = 1280px : tient un tableau 7 colonnes toutes lignes
              sur UNE seule ligne sans wrap, quelle que soit la longueur du nom
              de couleur ou la présence du badge « Principale »). */}
          <div
            className="relative flex flex-col bg-bg-primary w-full h-full md:h-auto md:max-h-[85vh] md:w-full md:max-w-7xl md:rounded-2xl md:shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={`Variantes de ${product.name}`}
          >
            {/* Header sticky */}
            <div className="shrink-0 flex items-center gap-3 px-4 md:px-6 py-3 md:py-4 border-b border-border">
              <div className="w-1 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 mb-0.5">
                  Variantes
                </div>
                <div className="font-heading text-base md:text-xl font-bold text-text-primary leading-tight truncate">
                  {product.name}
                  <span className="ml-2 text-text-muted font-normal text-sm font-body">
                    · {product.colors.length} variante{product.colors.length > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <Link
                href={`/admin/produits/${product.id}/modifier`}
                className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors no-underline shrink-0"
              >
                Édition complète
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <button
                type="button"
                onClick={onExpandToggle}
                aria-label="Fermer"
                className="shrink-0 w-10 h-10 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-primary flex items-center justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body scrollable.
                Bureau (≥ md) : tableau une ligne par variante (comme l'ancien tiroir).
                Mobile (< md) : cartes empilées (le tableau à 7 colonnes ne tient pas). */}
            <div className="flex-1 overflow-auto bg-bg-secondary/30">
              <div className="px-4 md:px-6 pt-3 pb-2 text-[12px] text-text-muted">
                Cliquez sur un chiffre pour l'éditer, ou modifiez toute la colonne d'un coup.
              </div>

              {/* ─── Tableau BUREAU ─────────────────────────────────────── */}
              <div className="hidden md:block px-6 pb-6">
                <div className="rounded-xl border border-border bg-bg-primary overflow-hidden shadow-sm">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-bg-secondary/60 border-b border-border">
                        <th className="px-4 py-3 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Couleur</th>
                        <th className="px-4 py-3 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Type</th>
                        <th className="px-4 py-3 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Tailles</th>
                        <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Prix HT</th>
                        <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Prix HT Total</th>
                        <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Stock</th>
                        <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Poids</th>
                      </tr>
                      <tr className="bg-bg-secondary border-b border-border">
                        <th className="px-4 py-2 text-left">
                          <BulkDisabledEditor
                            allCurrentlyDisabled={product.colors.every((v) => {
                              const dirty = dirtyEdits[v.id]?.disabled;
                              return (dirty as boolean | undefined) ?? v.disabled;
                            })}
                            onApplyAll={(disabled) => {
                              for (const v of product.colors) {
                                onCommitCell(v.id, "disabled", disabled, v.disabled);
                              }
                            }}
                          />
                        </th>
                        <th colSpan={2} className="px-4 py-2 text-left">
                          <span className="bulk-col-label">Modifier toute la colonne ↓</span>
                        </th>
                        <th className="px-4 py-2 text-right">
                          <BulkColumnEditor
                            columnLabel="prix HT unitaire"
                            isInt={false}
                            suffix="€"
                            onApplyAll={(unitValue) => {
                              const packQtyEdits: Record<string, number | undefined> = {};
                              for (const v of product.colors) {
                                packQtyEdits[v.id] = dirtyEdits[v.id]?.packQty as number | undefined;
                              }
                              const edits = computeBulkPriceEdits(product.colors, unitValue, packQtyEdits);
                              for (const e of edits) {
                                onCommitCell(e.variantId, "price", e.newTotal, e.originalPrice);
                              }
                            }}
                          />
                        </th>
                        <th className="px-4 py-2" aria-hidden="true" />
                        <th className="px-4 py-2 text-right">
                          <BulkColumnEditor
                            columnLabel="stock"
                            isInt
                            onApplyAll={(value) => {
                              for (const v of product.colors) {
                                onCommitCell(v.id, "stock", value, v.stock);
                              }
                            }}
                          />
                        </th>
                        <th className="px-4 py-2 text-right">
                          <BulkColumnEditor
                            columnLabel="poids"
                            isInt={false}
                            suffix="kg"
                            onApplyAll={(value) => {
                              for (const v of product.colors) {
                                onCommitCell(v.id, "weight", value, v.weight);
                              }
                            }}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {product.colors.map((variant) => (
                        <VariantRow
                          key={variant.id}
                          variant={variant}
                          editsForVariant={dirtyEdits[variant.id] ?? EMPTY_VARIANT_EDITS}
                          onCommitCell={onCommitCell}
                          isPrimaryColor={!!product.primaryColorId && variant.colorId === product.primaryColorId}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ─── Cartes MOBILE ──────────────────────────────────────── */}
              <div className="md:hidden">
                {/* Accordion « Modifier toute la colonne » — replié par défaut */}
                <details className="mx-4 mb-4 rounded-xl bg-bg-primary border border-border">
                  <summary className="px-4 py-3 cursor-pointer flex items-center justify-between list-none select-none">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
                      Modifier toute la colonne ↓
                    </span>
                    <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="px-4 pb-4 pt-1 border-t border-border-light space-y-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">État global</div>
                      <BulkDisabledEditor
                        allCurrentlyDisabled={product.colors.every((v) => {
                          const dirty = dirtyEdits[v.id]?.disabled;
                          return (dirty as boolean | undefined) ?? v.disabled;
                        })}
                        onApplyAll={(disabled) => {
                          for (const v of product.colors) {
                            onCommitCell(v.id, "disabled", disabled, v.disabled);
                          }
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">Prix HT unitaire</div>
                        <BulkColumnEditor
                          columnLabel="prix HT unitaire"
                          isInt={false}
                          suffix="€"
                          onApplyAll={(unitValue) => {
                            const packQtyEdits: Record<string, number | undefined> = {};
                            for (const v of product.colors) {
                              packQtyEdits[v.id] = dirtyEdits[v.id]?.packQty as number | undefined;
                            }
                            const edits = computeBulkPriceEdits(product.colors, unitValue, packQtyEdits);
                            for (const e of edits) {
                              onCommitCell(e.variantId, "price", e.newTotal, e.originalPrice);
                            }
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">Stock</div>
                        <BulkColumnEditor
                          columnLabel="stock"
                          isInt
                          onApplyAll={(value) => {
                            for (const v of product.colors) {
                              onCommitCell(v.id, "stock", value, v.stock);
                            }
                          }}
                        />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">Poids</div>
                        <BulkColumnEditor
                          columnLabel="poids"
                          isInt={false}
                          suffix="kg"
                          onApplyAll={(value) => {
                            for (const v of product.colors) {
                              onCommitCell(v.id, "weight", value, v.weight);
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </details>

                <div className="px-4 pb-6 flex flex-col gap-3">
                  {product.colors.map((variant) => (
                    <VariantCardMobile
                      key={variant.id}
                      variant={variant}
                      editsForVariant={dirtyEdits[variant.id] ?? EMPTY_VARIANT_EDITS}
                      onCommitCell={onCommitCell}
                      isPrimaryColor={!!product.primaryColorId && variant.colorId === product.primaryColorId}
                    />
                  ))}
                </div>
              </div>
            </div>
            {/* Le bandeau Appliquer/Annuler des modifications est global (bas
                de page AdminProductsTable) et reste visible pendant que la
                modale est ouverte. */}
          </div>
        </div>,
        document.body,
      )}

      {/* ⚠️ Modales rendues via createPortal sur document.body : sinon elles
          sortent en tant que <div> direct enfant de <tbody>, ce qui est
          invalide en HTML et déclenche une hydration error côté Next 16. */}
      {linkPfsOpen && createPortal(
        <LinkPfsProductModal
          marketplace="pfs"
          productId={product.id}
          productName={product.name}
          reference={product.reference}
          onClose={() => {
            setLinkPfsOpen(false);
            router.refresh();
          }}
        />,
        document.body,
      )}

      {linkAkOpen && createPortal(
        <LinkAnkorstoreProductModal
          marketplace="ankorstore"
          productId={product.id}
          productName={product.name}
          reference={product.reference}
          onClose={() => {
            setLinkAkOpen(false);
            router.refresh();
          }}
        />,
        document.body,
      )}

      {linkEfOpen && createPortal(
        <LinkEfashionProductModal
          marketplace="efashion"
          productId={product.id}
          productName={product.name}
          reference={product.reference}
          onClose={() => {
            setLinkEfOpen(false);
            router.refresh();
          }}
        />,
        document.body,
      )}

      {linkFaireOpen && createPortal(
        <LinkFaireProductModal
          marketplace="faire"
          productId={product.id}
          productName={product.name}
          reference={product.reference}
          onClose={() => {
            setLinkFaireOpen(false);
            router.refresh();
          }}
        />,
        document.body,
      )}

      {/* Orderchamp : LinkMarketplaceModal ne supporte pas encore le flow
          « lier à un existant » (Marketplace type limité). On garde le state
          pour l'API future ; en attendant on cast pour ne pas casser le typage. */}
      {linkOrderchampOpen && createPortal(
        <LinkOrderchampProductModal
          marketplace={"orderchamp" as never}
          productId={product.id}
          productName={product.name}
          reference={product.reference}
          onClose={() => {
            setLinkOrderchampOpen(false);
            router.refresh();
          }}
        />,
        document.body,
      )}

      {/* Modales « Publier / Lier » pour chaque marketplace — ouvertes par
          clic sur le badge marketplace correspondant quand le produit n'y
          est pas encore. */}
      {/* Modales « Publier ou lier » (badge cliqué) — le composant unifié
          affiche 2 cartes de choix (Créer / Lier). */}
      <MarketplacePushModal
        open={actionModalPfs}
        marketplace="pfs"
        mode="publish-or-link"
        title="Publier ce produit sur Paris Fashion Shop"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        canCreate={eligibility.canPublishPfs && !isPfsPublishing}
        canLink={hasPfsConfig && !product.pfsProductId && !isPfsPublishing}
        createDisabledReason={eligibility.canPublishPfs ? undefined : "Fiche incomplète ou marketplace non configurée"}
        onClose={() => setActionModalPfs(false)}
        onConfirm={() => { setActionModalPfs(false); void handlePublishPfs(); }}
        onLink={() => { setActionModalPfs(false); setLinkPfsOpen(true); }}
      />
      <MarketplacePushModal
        open={actionModalAk}
        marketplace="ankorstore"
        mode="publish-or-link"
        title="Publier ce produit sur Ankorstore"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        canCreate={eligibility.canPublishAnkorstore && !isAnkorstorePublishing}
        canLink={showAnkorstore && !product.ankorsProductId && !isAnkorstorePublishing}
        createDisabledReason={eligibility.canPublishAnkorstore ? undefined : "Fiche incomplète ou marketplace non configurée"}
        onClose={() => setActionModalAk(false)}
        onConfirm={() => { setActionModalAk(false); void handlePublishAnkorstore(); }}
        onLink={() => { setActionModalAk(false); setLinkAkOpen(true); }}
      />
      <MarketplacePushModal
        open={actionModalEf}
        marketplace="efashion"
        mode="publish-or-link"
        title="Publier ce produit sur eFashion Paris"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        canCreate={eligibility.canPublishEfashion && !isEfashionPublishing}
        canLink={showEfashion && !efashionLinked && !isEfashionPublishing}
        createDisabledReason={eligibility.canPublishEfashion ? undefined : "Fiche incomplète ou marketplace non configurée"}
        onClose={() => setActionModalEf(false)}
        onConfirm={() => { setActionModalEf(false); void handlePublishEfashion(); }}
        onLink={() => { setActionModalEf(false); setLinkEfOpen(true); }}
      />
      <MarketplacePushModal
        open={actionModalFaire}
        marketplace="faire"
        mode="publish-or-link"
        title="Publier ce produit sur Faire"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        canCreate={!faireBadgeState.online && !isFairePublishing}
        canLink={showFaire && !faireBadgeState.online && !isFairePublishing}
        createDisabledReason={!faireBadgeState.online ? undefined : "Produit déjà publié"}
        onClose={() => setActionModalFaire(false)}
        onConfirm={() => { setActionModalFaire(false); void handlePublishFaire(); }}
        onLink={() => { setActionModalFaire(false); setLinkFaireOpen(true); }}
      />
      <MarketplacePushModal
        open={actionModalOrderchamp}
        marketplace="orderchamp"
        mode="publish-or-link"
        title="Publier ce produit sur Orderchamp"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        canCreate={!orderchampBadgeState.online && !isOrderchampPublishing}
        canLink={showOrderchamp && !orderchampBadgeState.online && !isOrderchampPublishing}
        createDisabledReason={!orderchampBadgeState.online ? undefined : "Produit déjà publié"}
        onClose={() => setActionModalOrderchamp(false)}
        onConfirm={() => { setActionModalOrderchamp(false); void handlePublishOrderchamp(); }}
        onLink={() => { setActionModalOrderchamp(false); setLinkOrderchampOpen(true); }}
      />

      {/* Modale « Publier sur X ? » — confirmation simple avec message.
          Ouverte par les handlers handlePublishXxx (publishConfirmFor). */}
      <MarketplacePushModal
        open={publishConfirmFor === "pfs"}
        marketplace="pfs"
        mode="publish"
        title="Publier ce produit sur Paris Fashion Shop ?"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        message="Une nouvelle fiche sera créée avec les informations, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit."
        onClose={() => setPublishConfirmFor(null)}
        onConfirm={doPublishPfs}
      />
      <MarketplacePushModal
        open={publishConfirmFor === "ankorstore"}
        marketplace="ankorstore"
        mode="publish"
        title="Publier ce produit sur Ankorstore ?"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        message="Une nouvelle fiche sera créée avec les informations, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit."
        onClose={() => setPublishConfirmFor(null)}
        onConfirm={doPublishAnkorstore}
      />
      <MarketplacePushModal
        open={publishConfirmFor === "efashion"}
        marketplace="efashion"
        mode="publish"
        title="Publier ce produit sur eFashion Paris ?"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        subtitle="prochain batch shooting"
        confirmLabel="Publier maintenant"
        message="Le produit sera ajouté au prochain batch de shooting eFashion."
        onClose={() => setPublishConfirmFor(null)}
        onConfirm={doPublishEfashion}
      />
      <MarketplacePushModal
        open={publishConfirmFor === "faire"}
        marketplace="faire"
        mode="publish"
        title="Publier ce produit sur Faire ?"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        subtitle="création brouillon"
        confirmLabel="Publier maintenant"
        message="Une nouvelle fiche brouillon sera créée avec les infos actuelles."
        infoTone="warning"
        infoMessage={
          <>
            La fiche est créée en <strong>brouillon</strong>. Vous pourrez la publier définitivement depuis Faire ensuite.
          </>
        }
        onClose={() => setPublishConfirmFor(null)}
        onConfirm={doPublishFaire}
      />
      <MarketplacePushModal
        open={publishConfirmFor === "orderchamp"}
        marketplace="orderchamp"
        mode="publish"
        title="Publier ce produit sur Orderchamp ?"
        productName={product.name}
        productReference={product.reference}
        productImage={product.firstImage}
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        message="Une nouvelle fiche sera créée avec les informations, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit."
        onClose={() => setPublishConfirmFor(null)}
        onConfirm={doPublishOrderchamp}
      />

      {/* Modale mobile de changement de statut (ouverte au tap sur le badge du coin) */}
      {!product.isIncomplete && product.status !== "SYNCING" && (
        <MobileStatusChangeModal
          open={mobileStatusOpen}
          status={product.status as "ONLINE" | "OFFLINE" | "ARCHIVED"}
          productName={product.name}
          productReference={product.reference}
          canPutOnline={eligibility.canPutOnline}
          canPutOffline={eligibility.canPutOffline}
          canArchive={eligibility.canArchive}
          putOnlineReason={eligibility.putOnlineReason}
          onSelect={(next) => onRowStatus(product.id, next)}
          onClose={() => setMobileStatusOpen(false)}
        />
      )}
    </>
  );
}

// ─── Table with synchronized top + bottom scrollbar ─────────────────────────────

function TableWithTopScroll({
  products, startIndex, hasPfsConfig, pfsGloballyEnabled, hasAnkorstoreConfig, ankorstoreEnabled, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, hasOrderchampConfig, orderchampEnabled, hasMicrostoreConfig, microstoreEnabled, selectedIds, allSelected, toggleSelectAll, toggleSelect, expandedIds, toggleExpand, dirtyEdits, onCommitCell, deletingIds, onRowStatus, onRowDelete, onRowSync,
}: {
  products: AdminProduct[];
  startIndex: number;
  hasPfsConfig: boolean;
  pfsGloballyEnabled: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasOrderchampConfig: boolean;
  orderchampEnabled: boolean;
  hasMicrostoreConfig: boolean;
  microstoreEnabled?: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  toggleSelectAll: () => void;
  toggleSelect: (id: string) => void;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  dirtyEdits: VariantDirtyEdits;
  onCommitCell: (variantId: string, field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => void;
  deletingIds: Set<string>;
  onRowStatus: (productId: string, status: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onRowDelete: (productId: string) => void;
  onRowSync: (productId: string) => void;
}) {
  return (
    <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Table — pas de min-width, les colonnes secondaires disparaissent aux petits breakpoints.
          Sur mobile (< md) : padding cellules réduit, colonne actions étroite,
          table-fixed pour que la colonne Produit prenne exactement la largeur restante
          → aucun scroll horizontal quel que soit le contenu. */}
      <div className="max-w-full overflow-x-hidden">
        <table className="w-full text-sm font-body table-fixed md:table-auto">
          <thead>
            <tr className="table-header">
              <th className="hidden md:table-cell px-2 md:px-4 py-3.5 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="checkbox-custom"
                  title="Tout sélectionner"
                />
              </th>
              <th className="hidden sm:table-cell px-2 py-3.5 w-10 text-center text-[10px] font-bold text-text-muted uppercase tracking-widest">#</th>
              <th className="px-3 md:px-5 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Produit</th>
              <th className="hidden lg:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Marketplaces</th>
              <th className="hidden md:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">État</th>
              <th className="hidden xl:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Dates</th>
              <th className="px-1.5 md:px-3 py-3.5 text-right text-[10px] w-10 md:w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {products.map((product, index) => (
              <ProductRow
                key={product.id}
                product={product}
                rowNumber={startIndex + index + 1}
                hasPfsConfig={hasPfsConfig}
                pfsGloballyEnabled={pfsGloballyEnabled}
                hasAnkorstoreConfig={hasAnkorstoreConfig}
                ankorstoreEnabled={ankorstoreEnabled}
                hasEfashionConfig={hasEfashionConfig}
                efashionEnabled={efashionEnabled}
                hasFaireConfig={hasFaireConfig}
                faireEnabled={faireEnabled}
                hasOrderchampConfig={hasOrderchampConfig}
                orderchampEnabled={orderchampEnabled}
                hasMicrostoreConfig={hasMicrostoreConfig}
                microstoreEnabled={microstoreEnabled}
                selected={selectedIds.has(product.id)}
                onToggle={() => toggleSelect(product.id)}
                expanded={expandedIds.has(product.id)}
                onExpandToggle={() => toggleExpand(product.id)}
                dirtyEdits={dirtyEdits}
                onCommitCell={onCommitCell}
                isDeleting={deletingIds.has(product.id)}
                onRowStatus={onRowStatus}
                onRowDelete={onRowDelete}
                onRowSync={onRowSync}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Table ────────────────────────────────────────────────────────────────

export default function AdminProductsTable({
  products,
  totalCount: _totalCount,
  startIndex,
  hasPfsConfig,
  pfsGloballyEnabled = hasPfsConfig,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  hasOrderchampConfig,
  orderchampEnabled,
  hasMicrostoreConfig,
  microstoreEnabled = true,
  bulkEditOptions,
  availableTags,
  availableCollections,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // ─── Édition inline des variantes ──────────────────────────────────────
  // Le state vit ici (top-level) pour qu'un seul bandeau flottant global
  // affiche le total des modifications, même après avoir édité plusieurs
  // produits successivement dans la modale variantes.
  const [dirtyEdits, setDirtyEdits] = useState<VariantDirtyEdits>({});
  const [applyingVariantEdits, setApplyingVariantEdits] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { isFiltering } = useFilterPending();
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkPublishDraftsOpen, setBulkPublishDraftsOpen] = useState(false);
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false);
  const [bulkCollectionOpen, setBulkCollectionOpen] = useState(false);
  const router = useRouter();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const { confirm } = useConfirm();
  const { confirm: otpConfirm } = useOtpConfirm();
  const { ask: askMarketplaceOptions } = useRefreshMarketplacePrompt();
  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showEfashion = !!(hasEfashionConfig && efashionEnabled);
  const showFaire = !!(hasFaireConfig && faireEnabled);
  const showOrderchamp = !!(hasOrderchampConfig && orderchampEnabled);
  const { refreshBulk } = useRefreshMarketplaceDialog({
    showPfs: hasPfsConfig,
    showAnkorstore,
    showEfashion,
    showFaire,
    showOrderchamp,
  });
  const { enqueue: enqueuePfs } = useMarketplaceRefreshQueue();
  const { refresh: refreshEfashionBatch } = useEfashionShootingBatch();
  const { nudgeWidget: nudgeRailWidget } = useRightRail();
  const toast = useToast();
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  // Libellé de l'action bulk en cours (« Traduction… », « Suppression… », etc.).
  // Alimente à la fois le badge dans BulkActionBar et le voile posé sur le
  // tableau. `null` quand aucune action n'est en cours.
  const [bulkActionLabel, setBulkActionLabel] = useState<string | null>(null);

  // Confirmation bulk « Publier N produits sur X ? » — pilotée par une seule
  // modale partagée (MarketplaceBulkPublishConfirmModal). null = fermée.
  const [bulkPublishConfirm, setBulkPublishConfirm] = useState<{
    marketplace: MarketplaceKey;
    ids: string[];
  } | null>(null);

  const allProducts = products;

  const allPageIds = allProducts.map((p) => p.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allPageIds));
    }
  }, [allSelected, allPageIds]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      if (prev.has(id)) return new Set();
      return new Set([id]);
    });
  }, []);

  // ─── Handlers édition inline (global) ─────────────────────────────────
  const handleCommitCell = useCallback(
    (variantId: string, field: VariantField, newValue: VariantEditValue, originalValue: VariantEditValue) => {
      setDirtyEdits((prev) => commitVariantCell(prev, variantId, field, newValue, originalValue));
    },
    [],
  );
  const handleCancelAllVariantEdits = useCallback(() => {
    setDirtyEdits({});
  }, []);
  const totalDirtyVariants = countVariantDirtyEdits(dirtyEdits);
  const affectedProductIds = new Set<string>();
  for (const variantId in dirtyEdits) {
    const p = allProducts.find((prod) => prod.colors.some((c) => c.id === variantId));
    if (p) affectedProductIds.add(p.id);
  }

  // Enregistre toutes les modifs (variante par variante), puis propose la
  // propagation aux marketplaces via une seule pop-up qui liste les produits
  // impactés par marketplace.
  const handleApplyAllVariantEdits = useCallback(async () => {
    if (totalDirtyVariants === 0 || applyingVariantEdits) return;
    const snapshot = dirtyEdits;
    setApplyingVariantEdits(true);
    try {
      const entries = Object.entries(snapshot);
      await Promise.all(
        entries.map(async ([variantId, changes]) => {
          const variant = allProducts
            .flatMap((p) => p.colors)
            .find((c) => c.id === variantId);
          if (!variant) return;
          const data: Parameters<typeof updateVariantQuick>[1] = {};
          if (changes.price !== undefined) data.unitPrice = changes.price as number;
          if (changes.stock !== undefined) data.stock = changes.stock as number;
          if (changes.weight !== undefined) data.weight = changes.weight as number;
          if (changes.packQty !== undefined) {
            data.packQuantity = variant.saleType === "PACK" ? (changes.packQty as number) : null;
          }
          if (changes.disabled !== undefined) data.disabled = changes.disabled as boolean;
          if (Object.keys(data).length > 0) {
            await updateVariantQuick(variantId, data);
          }
        }),
      );
      setDirtyEdits({});
      toast.success(
        `${totalDirtyVariants} modification${totalDirtyVariants > 1 ? "s" : ""} enregistrée${totalDirtyVariants > 1 ? "s" : ""}`,
      );
      router.refresh();

      // Regroupe les produits impactés par marketplace pour la pop-up.
      const variantIds = Object.keys(snapshot);
      const {
        affectedProducts,
        pfsProducts,
        ankorsProducts,
        efashionProducts,
        faireProducts,
        orderchampProducts,
      } = computeBulkVariantMarketplaceTargets(allProducts, variantIds, {
        hasPfsConfig,
        showAnkorstore,
        showEfashion,
        showFaire,
        showOrderchamp,
      });

      // Microstore : produits impactés Microstore-activés (config globale +
      // toggle par produit). Contrat cliente : « push stock ou créer produit
      // c'est pareil » — l'API `/goods/import_v1` upsert par `item_ref`, donc
      // un premier push crée automatiquement la fiche côté Microstore, un
      // push suivant la met à jour. Pas de restriction sur
      // `microstoreLastPushedAt` — sinon la case n'apparaîtrait jamais avant
      // le tout premier envoi manuel. Les brouillons sont exclus (cf.
      // `isMicrostorePropagationEligible`) : sinon on créerait une fiche
      // vide côté Microstore au premier push.
      const microstoreProducts = hasMicrostoreConfig
        ? affectedProducts.flatMap((p) => {
            const full = allProducts.find((ap) => ap.id === p.id);
            return full && isMicrostorePropagationEligible(full) ? [p] : [];
          })
        : [];

      if (
        pfsProducts.length === 0 &&
        ankorsProducts.length === 0 &&
        efashionProducts.length === 0 &&
        faireProducts.length === 0 &&
        orderchampProducts.length === 0 &&
        microstoreProducts.length === 0
      ) {
        return;
      }

      // Modale unifiée ardoise (mêmes cases + KPI + compteurs de désactivation
      // que la modale « Rafraîchir »).
      const allProductIds = Array.from(
        new Set([
          ...pfsProducts.map((p) => p.id),
          ...ankorsProducts.map((p) => p.id),
          ...efashionProducts.map((p) => p.id),
          ...faireProducts.map((p) => p.id),
          ...orderchampProducts.map((p) => p.id),
          ...microstoreProducts.map((p) => p.id),
        ]),
      );
      const firstName = affectedProducts[0]?.name;
      // Boucle : si la cliente annule la propagation, on lui confirme que
      // les badges orange « Synchro nécessaire » suffisent. Si elle veut revenir
      // au choix, on ré-ouvre la modale de propagation.
      let options: Awaited<ReturnType<typeof askMarketplaceOptions>> = null;
      while (true) {
        options = await askMarketplaceOptions({
          count: affectedProducts.length,
          firstProductName: firstName,
          productIds: allProductIds,
          showPfs: pfsProducts.length > 0,
          showAnkorstore: ankorsProducts.length > 0,
          showEfashion: efashionProducts.length > 0,
          showFaire: faireProducts.length > 0,
          showOrderchamp: orderchampProducts.length > 0,
          showMicrostore: microstoreProducts.length > 0,
          // Propagation stock/prix/poids : pas de section "Boutique/Nouveauté"
          // (elle ne concerne que le parcours Rafraîchir), et on pré-coche
          // toutes les marketplaces liées — c'est ce que la cliente attend.
          showBoutique: false,
          defaultAllChecked: true,
          title:
            affectedProducts.length === 1
              ? "Propager les modifications ?"
              : `Propager les modifications à ${affectedProducts.length} produits ?`,
          subtitle:
            affectedProducts.length === 1 && firstName
              ? `« ${firstName} » — cochez les marketplaces où renvoyer prix/stock/poids.`
              : "Cochez les marketplaces où renvoyer prix/stock/poids.",
          eyebrow: "Propagation",
          confirmLabel: "Mettre à jour",
          actionLabel: "mettre à jour",
          actionMode: "update",
        });
        if (options) break;
        // Annulation : updateVariantQuick a déjà posé pfsSyncRequired /
        // ankorsSyncRequired / efashionSyncRequired / faireSyncRequired sur
        // les marketplaces liées → badge orange automatique. On l'explique
        // à la cliente et on lui laisse la porte pour revenir au choix.
        const keepPending = await confirm({
          type: "info",
          title: "Ne pas propager pour l'instant ?",
          message:
            "Vos modifications restent enregistrées côté boutique. Les marketplaces liées " +
            "afficheront un badge orange « Synchronisation nécessaire » pour que vous puissiez " +
            "pousser plus tard en cliquant sur ce badge.",
          confirmLabel: "Oui, je pousserai plus tard",
          cancelLabel: "Revenir au choix",
        });
        if (keepPending) return;
      }

      const inputs: Parameters<typeof enqueuePfs>[0] = [];
      if (options.pfs) {
        for (const p of pfsProducts) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: true },
            mode: "publish",
            marketplace: "pfs",
          });
        }
      }
      if (options.ankorstore) {
        for (const p of ankorsProducts) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: false, ankorstore: true },
            mode: "publish",
            marketplace: "ankorstore",
          });
        }
      }
      if (options.efashion) {
        for (const p of efashionProducts) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: false, ankorstore: false, efashion: true },
            mode: "publish",
            marketplace: "efashion",
          });
        }
      }
      if (options.faire) {
        for (const p of faireProducts) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
            mode: "publish",
            marketplace: "faire",
          });
        }
      }
      if (options.orderchamp) {
        for (const p of orderchampProducts) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: false, orderchamp: true },
            mode: "publish",
            marketplace: "orderchamp",
          });
        }
      }
      if (inputs.length > 0) enqueuePfs(inputs);

      // Microstore : hors queue (POST /goods/import_v1 synchrone). Fire-and-
      // forget avec toast récapitulatif à la fin.
      if (options.microstore && microstoreProducts.length > 0) {
        nudgeRailWidget("microstore-upload");
        const { bulkPushProductsToMicrostore } = await import(
          "@/app/actions/admin/microstore-products"
        );
        void bulkPushProductsToMicrostore(
          microstoreProducts.map((p) => p.id),
        ).then((res) => {
          if (res.success) {
            const n = res.totals?.pushed ?? 0;
            const skipped = (res.results ?? []).filter((r) => !r.success);
            if (n === 0 && skipped.length > 0) {
              toast.error(
                "Microstore : rien envoyé",
                skipped
                  .slice(0, 3)
                  .map((s) => `${s.reference} : ${s.error}`)
                  .join(" · "),
              );
            } else if (skipped.length > 0) {
              const refs = skipped.map((s) => s.reference).slice(0, 5).join(", ");
              toast.info(
                `Microstore : ${n} envoyé${n > 1 ? "s" : ""}, ${skipped.length} sauté${skipped.length > 1 ? "s" : ""}`,
                `À corriger : ${refs}${skipped.length > 5 ? "…" : ""}. Ex : ${skipped[0]!.error}`,
              );
            } else {
              toast.success(
                `Microstore mis à jour`,
                `${n} produit${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}.`,
              );
            }
          } else {
            toast.error(
              "Microstore : envoi bulk échoué",
              res.error ?? "Erreur inconnue.",
            );
          }
        });
      }
    } catch (e) {
      toast.error(
        "Enregistrement impossible",
        e instanceof Error ? e.message : "Erreur inconnue",
      );
    } finally {
      setApplyingVariantEdits(false);
    }
  }, [
    totalDirtyVariants,
    applyingVariantEdits,
    dirtyEdits,
    allProducts,
    hasPfsConfig,
    hasMicrostoreConfig,
    showAnkorstore,
    showEfashion,
    showFaire,
    showOrderchamp,
    askMarketplaceOptions,
    enqueuePfs,
    router,
    toast,
    confirm,
  ]);

  // Sélection filtrée sur les vrais brouillons (OFFLINE + fiche incomplète).
  // Sert au bouton « Publier brouillons sur marketplaces » — un produit
  // simplement mis « Hors ligne » par l'admin (fiche complète) N'EST PAS un
  // brouillon et ne doit pas déclencher ce bouton. Voir helper testable.
  const selectedDraftIds = computeSelectedDraftIds(allProducts, selectedIds);

  const handleBulkPublishDraftsConfirm = useCallback(
    async (decision: {
      eligibleIds: string[];
      publishPfs: boolean;
      publishAnkorstore: boolean;
      publishEfashion: boolean;
      publishFaire: boolean;
      publishMicrostore: boolean;
      efashionEligibleIds: string[];
      microstoreEligibleIds: string[];
    }) => {
      setBulkPublishDraftsOpen(false);
      if (decision.eligibleIds.length === 0) return;

      const eligibleProducts = allProducts.filter((p) => decision.eligibleIds.includes(p.id));

      // 1) Passage en ligne en masse (la server action revérifie le flag
      //    isIncomplete + images/stock/catégorie côté serveur).
      showLoading();
      let onlineResult: Awaited<ReturnType<typeof bulkUpdateProductStatus>> | null = null;
      try {
        onlineResult = await bulkUpdateProductStatus(decision.eligibleIds, "ONLINE");
      } catch (e) {
        toast.error("Mise en ligne impossible", e instanceof Error ? e.message : "Erreur inconnue.");
        hideLoading();
        return;
      } finally {
        hideLoading();
      }

      const onlineIds = new Set(onlineResult.success);
      if (onlineResult.errors.length > 0) {
        const refs = onlineResult.errors.map((e) => e.reference).join(", ");
        toast.error(
          `${onlineResult.errors.length} produit${onlineResult.errors.length > 1 ? "s" : ""} non mis en ligne`,
          `Référence${onlineResult.errors.length > 1 ? "s" : ""} : ${refs}`,
        );
      }
      if (onlineResult.success.length > 0) {
        toast.success(
          `${onlineResult.success.length} produit${onlineResult.success.length > 1 ? "s" : ""} mis en ligne`,
        );
      }

      // 2) Enqueue des publications marketplaces pour les produits effectivement mis en ligne
      const inputs: Parameters<typeof enqueuePfs>[0] = [];
      for (const p of eligibleProducts) {
        if (!onlineIds.has(p.id)) continue;
        if (decision.publishPfs && hasPfsConfig && !p.pfsProductId) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: true },
            mode: "publish" as const,
            marketplace: "pfs" as const,
          });
        }
        if (decision.publishAnkorstore && showAnkorstore && !p.ankorsProductId) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: false, ankorstore: true },
            mode: "publish" as const,
            marketplace: "ankorstore" as const,
          });
        }
        if (decision.publishFaire && showFaire && !p.faireProductId) {
          inputs.push({
            productId: p.id,
            reference: p.reference,
            productName: p.name,
            firstImage: p.firstImage,
            options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
            mode: "publish" as const,
            marketplace: "faire" as const,
          });
        }
      }
      if (inputs.length > 0) enqueuePfs(inputs);

      // 3) eFashion = workflow shooting (1 ticket regroupé pour N produits).
      //    On ajoute uniquement les produits effectivement mis en ligne ET
      //    déclarés éligibles côté modale (pas encore liés à eFashion).
      if (decision.publishEfashion && showEfashion && decision.efashionEligibleIds.length > 0) {
        const toAddIds = decision.efashionEligibleIds.filter((id) => onlineIds.has(id));
        if (toAddIds.length > 0) {
          try {
            const res = await bulkAddToEfashionShootingBatch(toAddIds, "PUBLISH");
            if (res.addedCount > 0) {
              toast.success(
                `${res.addedCount} produit${res.addedCount > 1 ? "s" : ""} ajouté${res.addedCount > 1 ? "s" : ""} au shooting eFashion`,
                "Validez l'envoi depuis la fenêtre eFashion en bas à droite.",
              );
            }
          } catch (e) {
            toast.error(
              "Ajout au shooting eFashion impossible",
              e instanceof Error ? e.message : "Erreur inconnue.",
            );
          } finally {
            void refreshEfashionBatch();
          }
        }
      }

      // 4) Microstore : upsert synchrone via /goods/import_v1 (pas de queue).
      //    On ne pousse que les produits effectivement mis en ligne + avec
      //    toggle Microstore activé.
      if (
        decision.publishMicrostore &&
        hasMicrostoreConfig &&
        decision.microstoreEligibleIds.length > 0
      ) {
        const toPushIds = decision.microstoreEligibleIds.filter((id) => onlineIds.has(id));
        if (toPushIds.length > 0) {
          nudgeRailWidget("microstore-upload");
          const { bulkPushProductsToMicrostore } = await import(
            "@/app/actions/admin/microstore-products"
          );
          void bulkPushProductsToMicrostore(toPushIds).then((res) => {
            if (res.success) {
              const n = res.totals?.pushed ?? 0;
              const skipped = (res.results ?? []).filter((r) => !r.success);
              if (n === 0 && skipped.length > 0) {
                toast.error(
                  "Microstore : rien envoyé",
                  skipped
                    .slice(0, 3)
                    .map((s) => `${s.reference} : ${s.error}`)
                    .join(" · "),
                );
              } else if (skipped.length > 0) {
                const refs = skipped.map((s) => s.reference).slice(0, 5).join(", ");
                toast.info(
                  `Microstore : ${n} envoyé${n > 1 ? "s" : ""}, ${skipped.length} sauté${skipped.length > 1 ? "s" : ""}`,
                  `À corriger : ${refs}${skipped.length > 5 ? "…" : ""}. Ex : ${skipped[0]!.error}`,
                );
              } else {
                toast.success(
                  "Microstore mis à jour",
                  `${n} produit${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}.`,
                );
              }
            } else {
              toast.error(
                "Microstore : envoi bulk échoué",
                res.error ?? "Erreur inconnue.",
              );
            }
          });
        }
      }

      setSelectedIds(new Set());
      router.refresh();
    },
    [
      allProducts,
      enqueuePfs,
      hasPfsConfig,
      hasMicrostoreConfig,
      showAnkorstore,
      showEfashion,
      showFaire,
      refreshEfashionBatch,
      showLoading,
      hideLoading,
      toast,
      router,
    ],
  );

  // ─── Bulk product actions ──
  // `idsOverride` permet l'appel depuis une ligne unique (menu Actions). Quand
  // il est fourni, on ne touche pas à `selectedIds` (la sélection reste intacte).
  const handleBulkStatus = useCallback(async (
    status: "ONLINE" | "OFFLINE" | "ARCHIVED",
    idsOverride?: string[],
  ) => {
    const ids = idsOverride ?? [...selectedIds];
    const count = ids.length;
    if (count === 0) return;
    const fromBulk = idsOverride === undefined;
    const statusLabels: Record<string, { verb: string; title: string; type: "info" | "warning" }> = {
      ONLINE:   { verb: "mis en ligne", title: "Mettre en ligne", type: "info" },
      OFFLINE:  { verb: "mis hors ligne", title: "Mettre hors ligne", type: "warning" },
      ARCHIVED: { verb: "archivé(s)", title: "Archiver", type: "warning" },
    };
    const label = statusLabels[status];

    const confirmed = await confirm({
      type: label.type,
      title: `${label.title} ${count} produit${count > 1 ? "s" : ""} ?`,
      message: status === "ARCHIVED"
        ? "Les produits archivés ne seront plus visibles en ligne."
        : `${count} produit${count > 1 ? "s seront" : " sera"} ${label.verb}.`,
      confirmLabel: label.title,
      cancelLabel: "Annuler",
    });
    if (!confirmed) return;

    // ─── Vérification par code OTP uniquement pour l'archivage ───
    let otpForServer: { otpId: string; code: string; pauseChoice?: "15min" | "1h" | "24h" | null } | null = null;
    if (status === "ARCHIVED") {
      const otpLabels = ids
        .map((id) => {
          const p = allProducts.find((x) => x.id === id);
          return p ? { reference: p.reference, name: p.name } : null;
        })
        .filter((x): x is { reference: string; name: string } => x !== null);
      const otpRes = await otpConfirm({
        action: "archive",
        title: `${label.title} ${count} produit${count > 1 ? "s" : ""}`,
        message: "Un code de sécurité vient d'être envoyé sur votre boîte mail pro pour confirmer l'archivage.",
        productIds: ids,
        productLabels: otpLabels,
        confirmLabel: label.title,
      });
      if (!otpRes.confirmed) return;
      otpForServer = otpRes.otp;
    }

    setBulkMessage(null);
    const bulkVerb =
      status === "ONLINE" ? "Mise en ligne" :
      status === "OFFLINE" ? "Mise hors ligne" :
      "Archivage";
    setBulkActionLabel(`${bulkVerb} de ${count} produit${count > 1 ? "s" : ""}…`);
    let successIds: string[] = [];
    await new Promise<void>((resolve) => {
      startTransition(async () => {
        try {
          const result = await bulkUpdateProductStatus(ids, status, otpForServer);
          successIds = result.success;

          const msgs: string[] = [];
          if (result.success.length > 0) {
            msgs.push(`${result.success.length} produit${result.success.length > 1 ? "s" : ""} ${label.verb}`);
          }
          if (result.errors.length > 0) {
            const refs = result.errors.map((e) => `${e.reference} (${e.reason})`).join(", ");
            msgs.push(`Erreurs : ${refs}`);
          }
          setBulkMessage({
            type: result.errors.length > 0 ? "error" : "success",
            text: msgs.join(" — "),
          });
          if (fromBulk) setSelectedIds(new Set());
          router.refresh();
        } catch (e) {
          setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
        } finally {
          setBulkActionLabel(null);
          resolve();
        }
      });
    });

    // Propose la mise a jour marketplaces pour les produits deja publies
    // (PFS, Ankorstore, eFashion Paris et Faire). Une seule modale avec
    // cases a cocher : l'admin decide pour chaque marketplace ; cochee par
    // defaut quand au moins 1 candidat existe.
    if (successIds.length > 0) {
      const pfsCandidates = hasPfsConfig
        ? allProducts.filter((p) => successIds.includes(p.id) && p.pfsProductId)
        : [];
      const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
      const ankorsCandidates = showAnkorstore
        ? allProducts.filter((p) => successIds.includes(p.id) && p.ankorsProductId)
        : [];
      const showEfashion = hasEfashionConfig && efashionEnabled;
      const efashionCandidates = showEfashion
        ? allProducts.filter(
            (p) =>
              successIds.includes(p.id) &&
              (p.colors ?? []).some((c) => c.efashionProductId != null),
          )
        : [];
      const showFaire = hasFaireConfig && faireEnabled;
      const faireCandidates = showFaire
        ? allProducts.filter((p) => successIds.includes(p.id) && p.faireProductId)
        : [];
      const showOrderchamp = hasOrderchampConfig && orderchampEnabled;
      const orderchampCandidates = showOrderchamp
        ? allProducts.filter((p) => successIds.includes(p.id) && p.orderchampProductId)
        : [];
      const microstoreCandidates = hasMicrostoreConfig
        ? allProducts.filter(
            (p) => successIds.includes(p.id) && isMicrostorePropagationEligible(p),
          )
        : [];

      const candidates: MarketplaceCandidates = {
        pfs: pfsCandidates,
        ankorstore: ankorsCandidates,
        efashion: efashionCandidates,
        faire: faireCandidates,
        orderchamp: orderchampCandidates,
      };
      if (hasAnyCandidate(candidates) || microstoreCandidates.length > 0) {
        const firstName = allProducts.find((p) => p.id === successIds[0])?.name;
        const options = await askMarketplaceOptions({
          count: successIds.length,
          firstProductName: firstName,
          productIds: [
            ...allCandidateIds(candidates),
            ...microstoreCandidates.map((p) => p.id),
          ],
          showPfs: pfsCandidates.length > 0,
          showAnkorstore: ankorsCandidates.length > 0,
          showEfashion: efashionCandidates.length > 0,
          showFaire: faireCandidates.length > 0,
          showOrderchamp: orderchampCandidates.length > 0,
          showMicrostore: microstoreCandidates.length > 0,
          showBoutique: false,
          defaultAllChecked: true,
          title:
            successIds.length === 1
              ? "Propager le nouveau statut ?"
              : `Propager le nouveau statut à ${successIds.length} produits ?`,
          subtitle:
            "Le statut sera appliqué sur les marketplaces cochées pour les produits déjà publiés.",
          eyebrow: "Propagation statut",
          confirmLabel: "Mettre à jour",
        });
        if (options) {
          const inputs = buildMarketplaceInputs(candidates, options);
          if (inputs.length > 0) enqueuePfs(inputs);
          if (options.microstore && microstoreCandidates.length > 0) {
            nudgeRailWidget("microstore-upload");
            const { bulkPushProductsToMicrostore } = await import(
              "@/app/actions/admin/microstore-products"
            );
            void bulkPushProductsToMicrostore(
              microstoreCandidates.map((p) => p.id),
            ).then((res) => {
              if (res.success) {
                const n = res.totals?.pushed ?? 0;
                toast.success(
                  `Microstore mis à jour`,
                  `${n} produit${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}.`,
                );
              } else {
                toast.error(
                  "Microstore : envoi bulk échoué",
                  res.error ?? "Erreur inconnue.",
                );
              }
            });
          }
        }
      }
    }
  }, [selectedIds, startTransition, askMarketplaceOptions, allProducts, enqueuePfs, hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, hasMicrostoreConfig, toast, router]);

  // ─── Bulk modif d'attributs produit (catégorie, code SH, composition, pays,
  // saison, best-seller) ──
  const handleBulkAttributes = useCallback(async (payload: BulkEditPayload) => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setBulkEditOpen(false);
      return;
    }

    setBulkMessage(null);
    // Setter le libellé AVANT startTransition : sinon la mise à jour est
    // marquée comme « transition » (basse priorité) et React peut la batcher
    // avec le setBulkActionLabel(null) de fin — le badge/voile ne rendrait
    // jamais.
    setBulkActionLabel(`Modification de ${ids.length} produit${ids.length > 1 ? "s" : ""}…`);
    type BulkAttrResult = Awaited<ReturnType<typeof bulkUpdateProductAttributes>>;
    const result = await new Promise<BulkAttrResult | null>((resolve) => {
      startTransition(async () => {
        try {
          const r = await bulkUpdateProductAttributes(ids, payload);
          const msgs: string[] = [];
          if (r.updated > 0) {
            msgs.push(`${r.updated} produit${r.updated > 1 ? "s" : ""} modifié${r.updated > 1 ? "s" : ""}`);
          }
          if (r.errors.length > 0) {
            msgs.push(`${r.errors.length} en erreur (${r.errors.slice(0, 3).map((e) => e.reference).join(", ")}${r.errors.length > 3 ? "…" : ""})`);
          }
          setBulkMessage({
            type: r.errors.length === 0 ? "success" : "error",
            text: msgs.join(" — ") || "Aucun changement.",
          });
          resolve(r);
        } catch (e) {
          setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
          resolve(null);
        } finally {
          setBulkActionLabel(null);
          setBulkEditOpen(false);
        }
      });
    });

    // Propose la propagation aux marketplaces sur les produits modifiés et déjà
    // publiés (PFS + Ankorstore + eFashion + Faire).
    const successIds = result?.success ?? [];
    if (successIds.length === 0) return;

    const pfsCandidates = hasPfsConfig
      ? allProducts.filter((p) => successIds.includes(p.id) && p.pfsProductId)
      : [];
    const ankorsCandidates = showAnkorstore
      ? allProducts.filter((p) => successIds.includes(p.id) && p.ankorsProductId)
      : [];
    const efashionCandidates = showEfashion
      ? allProducts.filter(
          (p) =>
            successIds.includes(p.id) &&
            (p.colors ?? []).some((c) => c.efashionProductId != null),
        )
      : [];
    const faireCandidates = showFaire
      ? allProducts.filter((p) => successIds.includes(p.id) && p.faireProductId)
      : [];
    const showOrderchamp = hasOrderchampConfig && orderchampEnabled;
    // Orderchamp est upsert-style (comme Microstore) : la case peut apparaître
    // même si le produit n'est pas encore lié à OC. `orderchampUpdateProduct`
    // retombe automatiquement sur `orderchampPublishProduct` si l'ID OC
    // manque, donc un premier push crée la fiche.
    const orderchampCandidates = showOrderchamp
      ? allProducts.filter(
          (p) =>
            successIds.includes(p.id) &&
            isOrderchampPropagationEligible(p),
        )
      : [];
    const microstoreCandidates = hasMicrostoreConfig
      ? allProducts.filter(
          (p) => successIds.includes(p.id) && isMicrostorePropagationEligible(p),
        )
      : [];

    const candidates: MarketplaceCandidates = {
      pfs: pfsCandidates,
      ankorstore: ankorsCandidates,
      efashion: efashionCandidates,
      faire: faireCandidates,
      orderchamp: orderchampCandidates,
    };
    if (!hasAnyCandidate(candidates) && microstoreCandidates.length === 0) return;

    const firstName = allProducts.find((p) => p.id === successIds[0])?.name;
    // Boucle avec confirmation à l'annulation — les flags sont déjà posés côté
    // serveur par bulkUpdateProductAttributes, donc le badge orange s'affichera
    // même si la cliente clique Annuler ici.
    let options: Awaited<ReturnType<typeof askMarketplaceOptions>> = null;
    while (true) {
      options = await askMarketplaceOptions({
        count: successIds.length,
        firstProductName: firstName,
        productIds: [
          ...allCandidateIds(candidates),
          ...microstoreCandidates.map((p) => p.id),
        ],
        showPfs: pfsCandidates.length > 0,
        showAnkorstore: ankorsCandidates.length > 0,
        showEfashion: efashionCandidates.length > 0,
        showFaire: faireCandidates.length > 0,
        showOrderchamp: orderchampCandidates.length > 0,
        showMicrostore: microstoreCandidates.length > 0,
        showBoutique: false,
        defaultAllChecked: true,
        title:
          successIds.length === 1
            ? "Propager les modifications ?"
            : `Propager les modifications à ${successIds.length} produits ?`,
        subtitle:
          "Les modifications seront envoyées sur les marketplaces cochées pour les produits déjà publiés.",
        eyebrow: "Propagation",
        confirmLabel: "Mettre à jour",
      });
      if (options) break;
      const keepPending = await confirm({
        type: "info",
        title: "Ne pas propager pour l'instant ?",
        message:
          "Vos modifications restent enregistrées côté boutique. Les marketplaces liées " +
          "afficheront un badge orange « Synchronisation nécessaire » pour que vous puissiez " +
          "pousser plus tard en cliquant sur ce badge.",
        confirmLabel: "Oui, je pousserai plus tard",
        cancelLabel: "Revenir au choix",
      });
      if (keepPending) return;
    }
    const inputs = buildMarketplaceInputs(candidates, options);
    if (inputs.length > 0) enqueuePfs(inputs);

    // Microstore : hors queue, appel synchrone bulk avec toast récap.
    if (options.microstore && microstoreCandidates.length > 0) {
      nudgeRailWidget("microstore-upload");
      const { bulkPushProductsToMicrostore } = await import(
        "@/app/actions/admin/microstore-products"
      );
      void bulkPushProductsToMicrostore(
        microstoreCandidates.map((p) => p.id),
      ).then((res) => {
        if (res.success) {
          const n = res.totals?.pushed ?? 0;
          toast.success(
            `Microstore mis à jour`,
            `${n} produit${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}.`,
          );
        } else {
          toast.error(
            "Microstore : envoi bulk échoué",
            res.error ?? "Erreur inconnue.",
          );
        }
      });
    }
  }, [selectedIds, startTransition, askMarketplaceOptions, allProducts, enqueuePfs, hasPfsConfig, hasMicrostoreConfig, showAnkorstore, showEfashion, showFaire, confirm, toast]);

  const handleBulkDelete = useCallback(async (idsOverride?: string[]) => {
    const ids = idsOverride ?? [...selectedIds];
    const count = ids.length;
    if (count === 0) return;
    const fromBulk = idsOverride === undefined;

    // Ask the server which products will be deleted vs archived so we can show
    // the admin exactly what the action will do before they confirm.
    let preview: Awaited<ReturnType<typeof previewProductDeletion>>;
    try {
      preview = await previewProductDeletion(ids);
    } catch (e) {
      setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      return;
    }

    const deleteCount = preview.willDelete.length;
    const archiveCount = preview.willArchive.length;

    let title: string;
    let message: string;
    let confirmLabel: string;

    if (archiveCount === 0) {
      // Pure permanent delete path — never-sold products only.
      title = `Supprimer définitivement ${deleteCount} produit${deleteCount > 1 ? "s" : ""} ?`;
      message = deleteCount === 1
        ? "Ce produit n'a jamais été vendu. Il sera supprimé définitivement (action irréversible)."
        : "Ces produits n'ont jamais été vendus. Ils seront supprimés définitivement (action irréversible).";
      confirmLabel = "Supprimer définitivement";
    } else if (deleteCount === 0) {
      // Pure archive path — every selected product already has orders.
      const refs = preview.willArchive.map((p) => p.reference).join(", ");
      title = `Archiver ${archiveCount} produit${archiveCount > 1 ? "s" : ""} ?`;
      message = archiveCount === 1
        ? `Ce produit (${refs}) a déjà été vendu. Il ne peut pas être supprimé définitivement : il sera archivé pour conserver l'historique des commandes et les factures.`
        : `Ces produits ont déjà été vendus (${refs}). Ils ne peuvent pas être supprimés définitivement : ils seront archivés pour conserver l'historique des commandes et les factures.`;
      confirmLabel = "Archiver";
    } else {
      // Mixed path — some will be deleted, some archived.
      const deleteRefs = preview.willDelete.map((p) => p.reference).join(", ");
      const archiveRefs = preview.willArchive.map((p) => p.reference).join(", ");
      title = `Traiter ${count} produit${count > 1 ? "s" : ""} ?`;
      message =
        `${deleteCount} produit${deleteCount > 1 ? "s" : ""} jamais vendu${deleteCount > 1 ? "s" : ""} sera supprimé${deleteCount > 1 ? "s" : ""} définitivement : ${deleteRefs}.\n\n` +
        `${archiveCount} produit${archiveCount > 1 ? "s" : ""} déjà vendu${archiveCount > 1 ? "s" : ""} sera archivé${archiveCount > 1 ? "s" : ""} (historique conservé) : ${archiveRefs}.`;
      confirmLabel = "Supprimer et archiver";
    }

    // Capture les ID marketplace AVANT suppression locale (sinon perdus en BDD)
    const pfsCandidates = hasPfsConfig
      ? allProducts
          .filter((p) => ids.includes(p.id) && p.pfsProductId)
          .map((p) => ({ pfsProductId: p.pfsProductId as string, reference: p.reference }))
      : [];
    const ankorsCandidates = showAnkorstore
      ? allProducts
          .filter((p) => ids.includes(p.id) && p.ankorsProductId)
          .map((p) => ({ ankorsProductId: p.ankorsProductId as string, reference: p.reference }))
      : [];
    // eFashion : 1 produit BJ = N produit-couleurs côté eFashion (1 par couleur)
    const showEfashion = hasEfashionConfig && efashionEnabled;
    const efashionCandidates = showEfashion
      ? allProducts
          .filter((p) => ids.includes(p.id))
          .flatMap((p) =>
            (p.colors ?? [])
              .filter((c) => c.efashionProductId != null)
              .map((c) => ({
                efashionProductId: c.efashionProductId as number,
                reference: p.reference,
              })),
          )
      : [];
    const showFaireDelete = hasFaireConfig && faireEnabled;
    const faireCandidates = showFaireDelete
      ? allProducts
          .filter((p) => ids.includes(p.id) && p.faireProductId)
          .map((p) => ({ faireProductId: p.faireProductId as string, reference: p.reference }))
      : [];
    const showOrderchampDelete = hasOrderchampConfig && orderchampEnabled;
    const orderchampCandidates = showOrderchampDelete
      ? allProducts
          .filter((p) => ids.includes(p.id) && p.orderchampProductId)
          .map((p) => ({ orderchampProductId: p.orderchampProductId as string, reference: p.reference }))
      : [];

    const pfsRef = { current: false };
    const ankorsRef = { current: false };
    const efashionRef = { current: false };
    const faireRef = { current: false };
    const orderchampRef = { current: false };

    const checkboxes: {
      id: string;
      label: string;
      defaultChecked: boolean;
      onChange: (v: boolean) => void;
    }[] = [];
    if (pfsCandidates.length > 0) {
      checkboxes.push({
        id: "pfs",
        label: `Retirer aussi de Paris Fashion Shop (${pfsCandidates.length} produit${pfsCandidates.length > 1 ? "s" : ""} publié${pfsCandidates.length > 1 ? "s" : ""})`,
        defaultChecked: false,
        onChange: (v) => {
          pfsRef.current = v;
        },
      });
    }
    if (ankorsCandidates.length > 0) {
      checkboxes.push({
        id: "ankorstore",
        label: `Supprimer aussi sur Ankorstore (${ankorsCandidates.length} produit${ankorsCandidates.length > 1 ? "s" : ""} publié${ankorsCandidates.length > 1 ? "s" : ""})`,
        defaultChecked: false,
        onChange: (v) => {
          ankorsRef.current = v;
        },
      });
    }
    if (efashionCandidates.length > 0) {
      const productsWithEfashion = new Set(efashionCandidates.map((c) => c.reference)).size;
      checkboxes.push({
        id: "efashion",
        label: `Supprimer aussi sur eFashion Paris (${efashionCandidates.length} fiche${efashionCandidates.length > 1 ? "s" : ""}-couleur sur ${productsWithEfashion} produit${productsWithEfashion > 1 ? "s" : ""})`,
        defaultChecked: false,
        onChange: (v) => {
          efashionRef.current = v;
        },
      });
    }
    if (faireCandidates.length > 0) {
      checkboxes.push({
        id: "faire",
        label: `Supprimer aussi sur Faire (${faireCandidates.length} produit${faireCandidates.length > 1 ? "s" : ""} publié${faireCandidates.length > 1 ? "s" : ""})`,
        defaultChecked: false,
        onChange: (v) => {
          faireRef.current = v;
        },
      });
    }
    if (orderchampCandidates.length > 0) {
      checkboxes.push({
        id: "orderchamp",
        label: `Supprimer aussi sur Orderchamp (${orderchampCandidates.length} produit${orderchampCandidates.length > 1 ? "s" : ""} publié${orderchampCandidates.length > 1 ? "s" : ""})`,
        defaultChecked: false,
        onChange: (v) => {
          orderchampRef.current = v;
        },
      });
    }

    const confirmed = await confirm({
      type: "danger",
      title,
      message,
      confirmLabel,
      cancelLabel: "Annuler",
      ...(checkboxes.length > 0 && {
        checkboxesLabel: "Marketplaces",
        checkboxes,
      }),
    });
    if (!confirmed) return;

    // ─── Vérification par code OTP (envoyé par mail) ───
    const otpLabels = ids
      .map((id) => {
        const p = allProducts.find((x) => x.id === id);
        return p ? { reference: p.reference, name: p.name } : null;
      })
      .filter((x): x is { reference: string; name: string } => x !== null);
    const otpAction = archiveCount === 0 ? "delete" : archiveCount > 0 && deleteCount === 0 ? "archive" : "delete";
    const otpRes = await otpConfirm({
      action: otpAction,
      title: title,
      message: "Un code de sécurité vient d'être envoyé sur votre boîte mail pro pour confirmer cette action.",
      productIds: ids,
      productLabels: otpLabels,
      confirmLabel,
    });
    if (!otpRes.confirmed) return;

    const confirmPfsDelete = pfsRef.current && pfsCandidates.length > 0;
    const confirmAnkorsDelete = ankorsRef.current && ankorsCandidates.length > 0;
    const confirmEfashionDelete = efashionRef.current && efashionCandidates.length > 0;
    const confirmFaireDelete = faireRef.current && faireCandidates.length > 0;
    const confirmOrderchampDelete = orderchampRef.current && orderchampCandidates.length > 0;

    setBulkMessage(null);
    setDeletingIds(new Set(ids));
    setBulkActionLabel(
      archiveCount === 0
        ? `Suppression de ${deleteCount} produit${deleteCount > 1 ? "s" : ""}…`
        : deleteCount === 0
          ? `Archivage de ${archiveCount} produit${archiveCount > 1 ? "s" : ""}…`
          : `Suppression de ${count} produit${count > 1 ? "s" : ""}…`,
    );
    startTransition(async () => {
      try {
        // 1. Kickoff Ankorstore delete BEFORE local delete (the AnkorstoreOperation
        //    row needs a live product FK; the row will be cascade-deleted with the
        //    product shortly after, but the kickoff itself has already been sent
        //    to Ankorstore so the deletion proceeds remotely either way).
        if (confirmAnkorsDelete) {
          try {
            const ankorsResults = await deleteProductsOnAnkorstore(ankorsCandidates);
            const okCount = ankorsResults.filter((r) => r.status === "ok").length;
            const errCount = ankorsResults.length - okCount;
            if (errCount === 0) {
              toast.success(`${okCount} suppression${okCount > 1 ? "s" : ""} demandée${okCount > 1 ? "s" : ""} à Ankorstore`);
            } else {
              const errRefs = ankorsResults.filter((r) => r.status === "error").map((r) => r.reference).join(", ");
              toast.error(
                "Suppression Ankorstore partielle",
                `${okCount} OK · ${errCount} échec${errCount > 1 ? "s" : ""} (${errRefs})`,
              );
            }
          } catch (err) {
            toast.error("Échec suppression Ankorstore", err instanceof Error ? err.message : String(err));
          }
        }

        const result = await bulkDeleteProducts(ids, otpRes.otp ?? null);

        const msgs: string[] = [];
        if (result.deleted > 0) msgs.push(`${result.deleted} produit${result.deleted > 1 ? "s" : ""} supprimé${result.deleted > 1 ? "s" : ""} définitivement`);
        if (result.archived.length > 0) {
          const refs = result.archived.map((p) => p.reference).join(", ");
          msgs.push(`${result.archived.length} archivé${result.archived.length > 1 ? "s" : ""} (commandes existantes) : ${refs}`);
        }
        setBulkMessage({
          type: "success",
          text: msgs.join(" — ") || "Aucun produit traité",
        });
        if (fromBulk) setSelectedIds(new Set());
        router.refresh();

        // Suppression eFashion en parallèle (synchrone) si l'admin a confirmé
        if (confirmEfashionDelete) {
          try {
            const efResults = await deleteProductsOnEfashion(efashionCandidates);
            const okCount = efResults.filter((r) => r.status === "ok").length;
            const errCount = efResults.length - okCount;
            if (errCount === 0) {
              toast.success(`${okCount} fiche${okCount > 1 ? "s" : ""} supprimée${okCount > 1 ? "s" : ""} sur eFashion Paris`);
            } else {
              const errRefs = efResults.filter((r) => r.status === "error").map((r) => r.reference).join(", ");
              toast.error(
                "Suppression eFashion partielle",
                `${okCount} OK · ${errCount} échec${errCount > 1 ? "s" : ""} (${errRefs})`,
              );
            }
          } catch (err) {
            toast.error("Échec suppression eFashion", err instanceof Error ? err.message : String(err));
          }
        }

        // Suppression PFS en arrière-plan si l'admin a confirmé
        if (confirmPfsDelete) {
          try {
            const pfsResults = await deleteProductsOnPfs(pfsCandidates);
            const okCount = pfsResults.filter((r) => r.status === "ok").length;
            const errCount = pfsResults.length - okCount;
            if (errCount === 0) {
              toast.success(`${okCount} produit${okCount > 1 ? "s" : ""} retiré${okCount > 1 ? "s" : ""} de Paris Fashion Shop`);
            } else {
              const errRefs = pfsResults.filter((r) => r.status === "error").map((r) => r.reference).join(", ");
              toast.error(
                "Suppression PFS partielle",
                `${okCount} OK · ${errCount} échec${errCount > 1 ? "s" : ""} (${errRefs})`,
              );
            }
          } catch (err) {
            toast.error("Échec suppression PFS", err instanceof Error ? err.message : String(err));
          }
        }

        // Suppression Faire en parallèle (synchrone) si l'admin a confirmé
        if (confirmFaireDelete) {
          try {
            const faireResults = await deleteProductsOnFaire(faireCandidates);
            const okCount = faireResults.filter((r) => r.status === "ok").length;
            const errCount = faireResults.length - okCount;
            if (errCount === 0) {
              toast.success(`${okCount} produit${okCount > 1 ? "s" : ""} supprimé${okCount > 1 ? "s" : ""} de Faire`);
            } else {
              const errRefs = faireResults.filter((r) => r.status === "error").map((r) => r.reference).join(", ");
              toast.error(
                "Suppression Faire partielle",
                `${okCount} OK · ${errCount} échec${errCount > 1 ? "s" : ""} (${errRefs})`,
              );
            }
          } catch (err) {
            toast.error("Échec suppression Faire", err instanceof Error ? err.message : String(err));
          }
        }

        // Suppression Orderchamp en parallèle (synchrone) si l'admin a confirmé
        if (confirmOrderchampDelete) {
          try {
            const orderchampResults = await deleteProductsOnOrderchamp(orderchampCandidates);
            const okCount = orderchampResults.filter((r) => r.status === "ok").length;
            const errCount = orderchampResults.length - okCount;
            if (errCount === 0) {
              toast.success(`${okCount} produit${okCount > 1 ? "s" : ""} supprimé${okCount > 1 ? "s" : ""} d'Orderchamp`);
            } else {
              const errRefs = orderchampResults.filter((r) => r.status === "error").map((r) => r.reference).join(", ");
              toast.error(
                "Suppression Orderchamp partielle",
                `${okCount} OK · ${errCount} échec${errCount > 1 ? "s" : ""} (${errRefs})`,
              );
            }
          } catch (err) {
            toast.error("Échec suppression Orderchamp", err instanceof Error ? err.message : String(err));
          }
        }
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      } finally {
        setBulkActionLabel(null);
        setDeletingIds(new Set());
      }
    });
  }, [selectedIds, startTransition, confirm, allProducts, hasPfsConfig, showAnkorstore, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, hasOrderchampConfig, orderchampEnabled, toast, router]);

  // Synchroniser un (ou plusieurs) produit(s) avec les marketplaces : renvoie
  // toutes les données (prix, stock, images, statut, etc.) au même `pfsProductId`
  // / `ankorsProductId` (resync forcée — `forceFullSync: true` côté serveur).
  // eFashion = sync de la visibilité + prix + stock sur chaque couleur liée.
  const handleBulkSync = useCallback(async (idsOverride: string[]) => {
    const ids = idsOverride;
    if (ids.length === 0) return;
    const showEfashion = hasEfashionConfig && efashionEnabled;
    const showFaireLocal = hasFaireConfig && faireEnabled;
    const showOrderchampLocal = hasOrderchampConfig && orderchampEnabled;
    const targets = allProducts.filter((p) => ids.includes(p.id));
    const pfsTargets = hasPfsConfig ? targets.filter((p) => p.pfsProductId) : [];
    const ankorsTargets = showAnkorstore ? targets.filter((p) => p.ankorsProductId) : [];
    const efashionTargets = showEfashion
      ? targets.filter((p) => (p.colors ?? []).some((c) => c.efashionProductId != null))
      : [];
    const faireTargets = showFaireLocal ? targets.filter((p) => p.faireProductId) : [];
    // Orderchamp est upsert-style (règle transversale — voir mémoire) : la case
    // apparaît même si le produit n'est pas encore lié à OC. Les produits déjà
    // liés partent en mode "resync" (productRepublish + forceFullSync), les
    // non-liés partent en mode "publish" (crée la fiche OC).
    const orderchampTargets = showOrderchampLocal
      ? targets.filter((p) => isOrderchampPropagationEligible(p))
      : [];
    const orderchampLinkedTargets = orderchampTargets.filter((p) => !!p.orderchampProductId);
    const orderchampUnlinkedTargets = orderchampTargets.filter((p) => !p.orderchampProductId);
    const microstoreTargets = hasMicrostoreConfig
      ? targets.filter((p) => isMicrostorePropagationEligible(p))
      : [];

    if (
      pfsTargets.length === 0 &&
      ankorsTargets.length === 0 &&
      efashionTargets.length === 0 &&
      faireTargets.length === 0 &&
      orderchampTargets.length === 0 &&
      microstoreTargets.length === 0
    ) {
      toast.error("Rien à synchroniser", "Ce produit n'est publié sur aucune marketplace.");
      return;
    }

    const candidates: MarketplaceCandidates = {
      pfs: pfsTargets,
      ankorstore: ankorsTargets,
      efashion: efashionTargets,
      faire: faireTargets,
      orderchamp: orderchampTargets,
    };
    const firstName = targets[0]?.name;
    const options = await askMarketplaceOptions({
      count: ids.length,
      firstProductName: firstName,
      productIds: [
        ...allCandidateIds(candidates),
        ...microstoreTargets.map((p) => p.id),
      ],
      showPfs: pfsTargets.length > 0,
      showAnkorstore: ankorsTargets.length > 0,
      showEfashion: efashionTargets.length > 0,
      showFaire: faireTargets.length > 0,
      showOrderchamp: orderchampTargets.length > 0,
      showMicrostore: microstoreTargets.length > 0,
      showBoutique: false,
      defaultAllChecked: true,
      title:
        ids.length === 1
          ? "Synchroniser ce produit avec les marketplaces ?"
          : `Synchroniser ${ids.length} produits avec les marketplaces ?`,
      subtitle:
        "Toutes les informations actuelles (prix, stock, images, statut, etc.) seront renvoyées aux marketplaces cochées. Le produit garde le même identifiant en ligne.",
      eyebrow: "Synchronisation",
      confirmLabel: "Synchroniser",
      actionLabel: "synchroniser",
      actionMode: "update",
    });
    if (!options) return;
    // Split OC : le mode "resync" ne fonctionne QUE pour les fiches déjà liées
    // (productRepublish exige l'ID OC). Les fiches non-liées passent en mode
    // "publish" — le worker appellera orderchampPublishProduct pour créer la
    // fiche de zéro.
    const candidatesLinkedOc: MarketplaceCandidates = {
      ...candidates,
      orderchamp: orderchampLinkedTargets,
    };
    const inputs = buildMarketplaceInputs(candidatesLinkedOc, options, "resync");
    if (options.orderchamp && orderchampUnlinkedTargets.length > 0) {
      const ocPublishCandidates: MarketplaceCandidates = {
        pfs: [], ankorstore: [], efashion: [], faire: [],
        orderchamp: orderchampUnlinkedTargets,
      };
      const ocPublishInputs = buildMarketplaceInputs(
        ocPublishCandidates,
        { orderchamp: true },
        "publish",
      );
      inputs.push(...ocPublishInputs);
    }
    if (inputs.length > 0) enqueuePfs(inputs);

    // Microstore : hors queue, appel synchrone bulk.
    if (options.microstore && microstoreTargets.length > 0) {
      nudgeRailWidget("microstore-upload");
      const { bulkPushProductsToMicrostore } = await import(
        "@/app/actions/admin/microstore-products"
      );
      void bulkPushProductsToMicrostore(
        microstoreTargets.map((p) => p.id),
      ).then((res) => {
        if (res.success) {
          const n = res.totals?.pushed ?? 0;
          const skipped = (res.results ?? []).filter((r) => !r.success);
          if (n === 0 && skipped.length > 0) {
            toast.error(
              "Microstore : rien synchronisé",
              skipped
                .slice(0, 3)
                .map((s) => `${s.reference} : ${s.error}`)
                .join(" · "),
            );
          } else if (skipped.length > 0) {
            const refs = skipped.map((s) => s.reference).slice(0, 5).join(", ");
            toast.info(
              `Microstore : ${n} synchronisé${n > 1 ? "s" : ""}, ${skipped.length} sauté${skipped.length > 1 ? "s" : ""}`,
              `À corriger : ${refs}${skipped.length > 5 ? "…" : ""}. Ex : ${skipped[0]!.error}`,
            );
          } else {
            toast.success(
              `Microstore synchronisé`,
              `${n} produit${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}.`,
            );
          }
        } else {
          toast.error(
            "Microstore : synchro bulk échouée",
            res.error ?? "Erreur inconnue.",
          );
        }
      });
    }
  }, [allProducts, hasPfsConfig, showAnkorstore, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, hasMicrostoreConfig, askMarketplaceOptions, enqueuePfs, toast]);

  // ─── Nouveaux handlers pour BulkActionBar ─────────────────────────────
  // Ces handlers alimentent le panneau « Marketplaces » qui liste, pour chaque
  // marketplace configuré, les produits à publier (identifiant marketplace
  // absent + statut ONLINE) ou à synchroniser (drapeau *SyncRequired = true).

  const handleBulkMarketplacePublish = useCallback((marketplace: MarketplaceKey, ids: string[]) => {
    if (ids.length === 0) return;
    setBulkPublishConfirm({ marketplace, ids });
  }, []);

  // Exécution effective après confirmation dans la modale bulk.
  const doBulkMarketplacePublish = useCallback(() => {
    if (!bulkPublishConfirm) return;
    const { marketplace, ids } = bulkPublishConfirm;
    setBulkPublishConfirm(null);
    const count = ids.length;
    const plural = count > 1 ? "s" : "";
    const label = MARKETPLACE_LABEL[marketplace];

    // eFashion : première publication = ticket de shooting, pas d'envoi direct.
    if (marketplace === "efashion") {
      void (async () => {
        try {
          const res = await bulkAddToEfashionShootingBatch(ids, "PUBLISH");
          if (res.addedCount > 0) {
            toast.success(
              `${res.addedCount} produit${res.addedCount > 1 ? "s" : ""} ajouté${res.addedCount > 1 ? "s" : ""} au shooting eFashion`,
              "Validez l'envoi depuis la fenêtre eFashion en bas à droite.",
            );
          }
        } catch (e) {
          toast.error("Ajout au shooting eFashion impossible", e instanceof Error ? e.message : "Erreur inconnue.");
        } finally {
          void refreshEfashionBatch();
        }
      })();
      return;
    }

    // Microstore n'a pas de bouton « Publier » séparé côté UI (le panneau
    // marketplaces ne montre qu'un bouton « Synchroniser »). Guard défensif
    // au cas où quelque chose déclencherait ce chemin par erreur.
    if (marketplace === "microstore") return;

    const products = allProducts.filter((p) => ids.includes(p.id));
    const options: {
      local: boolean;
      pfs: boolean;
      ankorstore: boolean;
      efashion: boolean;
      faire: boolean;
      orderchamp?: boolean;
    } = { local: false, pfs: false, ankorstore: false, efashion: false, faire: false };
    if (marketplace === "pfs") options.pfs = true;
    if (marketplace === "ankorstore") options.ankorstore = true;
    if (marketplace === "faire") options.faire = true;
    if (marketplace === "orderchamp") options.orderchamp = true;
    enqueuePfs(
      products.map((p) => ({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: { ...options },
        mode: "publish" as const,
        marketplace,
      })),
    );
    toast.success(
      `${count} produit${plural} en cours de publication sur ${label}`,
      "Suivi dans la fenêtre en bas à droite.",
    );
  }, [bulkPublishConfirm, allProducts, enqueuePfs, toast, refreshEfashionBatch]);

  const handleBulkMarketplaceSync = useCallback(async (marketplace: MarketplaceKey, ids: string[]) => {
    if (ids.length === 0) return;
    const count = ids.length;
    const plural = count > 1 ? "s" : "";
    const label = MARKETPLACE_LABEL[marketplace] ?? marketplace;

    // Microstore : upsert synchrone via /goods/import_v1, pas de queue.
    if (marketplace === "microstore") {
      const ok = await confirm({
        type: "info",
        title: `Synchroniser ${count} produit${plural} sur Microstore ?`,
        message:
          `Les fiches Microstore seront créées si absentes ou mises à jour (nom, prix, stock, couleurs, catégorie, description). ` +
          `Les photos ne sont pas envoyées — à ajouter manuellement côté Microstore si besoin.`,
        confirmLabel: "Oui, synchroniser",
        cancelLabel: "Annuler",
      });
      if (ok !== true) return;
      nudgeRailWidget("microstore-upload");
      const { bulkPushProductsToMicrostore } = await import(
        "@/app/actions/admin/microstore-products"
      );
      const res = await bulkPushProductsToMicrostore(ids);
      if (res.success) {
        const n = res.totals?.pushed ?? 0;
        const skipped = (res.results ?? []).filter((r) => !r.success);
        if (n === 0 && skipped.length > 0) {
          toast.error(
            "Microstore : rien synchronisé",
            skipped
              .slice(0, 3)
              .map((s) => `${s.reference} : ${s.error}`)
              .join(" · "),
          );
        } else if (skipped.length > 0) {
          const refs = skipped.map((s) => s.reference).slice(0, 5).join(", ");
          toast.info(
            `Microstore : ${n} synchronisé${n > 1 ? "s" : ""}, ${skipped.length} sauté${skipped.length > 1 ? "s" : ""}`,
            `À corriger : ${refs}${skipped.length > 5 ? "…" : ""}. Ex : ${skipped[0]!.error}`,
          );
        } else {
          toast.success(
            `Microstore synchronisé`,
            `${n} produit${n > 1 ? "s" : ""} envoyé${n > 1 ? "s" : ""}.`,
          );
        }
      } else {
        toast.error(
          "Microstore : synchro bulk échouée",
          res.error ?? "Erreur inconnue.",
        );
      }
      return;
    }

    const asyncNote = marketplace === "ankorstore"
      ? " La synchro Ankorstore est asynchrone : le résultat arrivera dans les minutes qui suivent."
      : "";
    const ok = await confirm({
      type: "info",
      title: `Synchroniser ${count} produit${plural} sur ${label} ?`,
      message: `Les changements locaux seront envoyés sur ${label} pour mettre à jour les fiches existantes.${asyncNote}`,
      confirmLabel: "Oui, synchroniser",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    const products = allProducts.filter((p) => ids.includes(p.id));
    const options = { local: false, pfs: false, ankorstore: false, efashion: false, faire: false };
    if (marketplace === "pfs") options.pfs = true;
    if (marketplace === "ankorstore") options.ankorstore = true;
    if (marketplace === "efashion") options.efashion = true;
    if (marketplace === "faire") options.faire = true;
    enqueuePfs(
      products.map((p) => ({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        options: { ...options },
        mode: "resync" as const,
        marketplace,
      })),
    );
    toast.success(
      `${count} produit${plural} en cours de synchro sur ${label}`,
      "Suivi dans la fenêtre en bas à droite.",
    );
  }, [allProducts, enqueuePfs, toast, confirm]);

  const handleBulkTranslateAll = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const plural = ids.length > 1 ? "s" : "";
    const ok = await confirm({
      type: "info",
      title: `Traduire ${ids.length} produit${plural} en anglais ?`,
      message: `Le nom et la description en anglais seront remplacés par une nouvelle traduction depuis le français. La traduction utilise le compte PFS.`,
      confirmLabel: "Oui, traduire",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    // Setter le libellé AVANT startTransition (mise à jour urgente) pour
    // garantir que le badge/voile de chargement s'affichent bien pendant
    // l'appel réseau. Cf. commentaire dans handleBulkAttributes.
    setBulkActionLabel(`Traduction de ${ids.length} produit${plural} en cours…`);
    startTransition(async () => {
      try {
        const res = await bulkTranslateProducts(ids);
        const parts: string[] = [];
        if (res.translated > 0) parts.push(`${res.translated} traduit${res.translated > 1 ? "s" : ""}`);
        if (res.failed > 0) parts.push(`${res.failed} en échec`);
        if (res.skipped > 0) parts.push(`${res.skipped} ignoré${res.skipped > 1 ? "s" : ""}`);
        if (res.translated > 0 && res.failed === 0) {
          toast.success("Traduction terminée", parts.join(" · "));
        } else if (res.translated > 0) {
          toast.info("Traduction terminée", parts.join(" · "));
        } else {
          toast.error("Aucune traduction n'a pu être enregistrée", parts.join(" · ") || "Réessayez dans quelques instants.");
        }
      } catch (e) {
        toast.error("Traduction impossible", e instanceof Error ? e.message : "Erreur inconnue.");
      } finally {
        setBulkActionLabel(null);
      }
    });
  }, [selectedIds, confirm, toast, startTransition]);

  // ─── Best-seller en masse ───────────────────────────────────────────────
  // Réutilise `bulkUpdateProductAttributes({ isBestSeller })` qui pose déjà
  // `pfsSyncRequired=true` sur les produits liés à PFS. Confirmation légère
  // via useConfirm() puis toast récapitulatif.
  const handleBulkSetBestSeller = useCallback(async (isBestSeller: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const plural = ids.length > 1 ? "s" : "";
    const action = isBestSeller ? "marquer" : "retirer";
    const ok = await confirm({
      type: "info",
      title: `${isBestSeller ? "Marquer" : "Retirer"} ${ids.length} produit${plural} comme best-seller${plural} ?`,
      message: isBestSeller
        ? "L'étoile sera ajoutée. Les produits déjà publiés sur PFS seront marqués « Synchro nécessaire »."
        : "L'étoile sera retirée. Les produits déjà publiés sur PFS seront marqués « Synchro nécessaire ».",
      confirmLabel: `Oui, ${action}`,
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    setBulkActionLabel(
      `${isBestSeller ? "Marquage" : "Retrait"} best-seller de ${ids.length} produit${plural}…`,
    );
    startTransition(async () => {
      try {
        const r = await bulkUpdateProductAttributes(ids, { isBestSeller });
        if (r.updated > 0 && r.errors.length === 0) {
          toast.success(
            `${r.updated} produit${r.updated > 1 ? "s" : ""} modifié${r.updated > 1 ? "s" : ""}`,
            isBestSeller ? "Étoile best-seller ajoutée." : "Étoile best-seller retirée.",
          );
        } else if (r.errors.length > 0) {
          toast.error(
            `${r.errors.length} produit${r.errors.length > 1 ? "s" : ""} en erreur`,
            r.errors.slice(0, 3).map((e) => e.reference).join(", "),
          );
        } else {
          toast.info("Aucun changement", "Les produits étaient déjà dans cet état.");
        }
      } catch (e) {
        toast.error("Modification impossible", e instanceof Error ? e.message : "Erreur inconnue.");
      } finally {
        setBulkActionLabel(null);
      }
    });
  }, [selectedIds, confirm, toast, startTransition]);

  // ─── « Important » en masse ─────────────────────────────────────────────
  // Étoile jaune admin (filtrage/tri interne). Aucun impact marketplaces ni
  // boutique publique : le serveur skippe les drapeaux syncRequired quand
  // seul `important` est modifié.
  const handleBulkSetImportant = useCallback(async (important: boolean) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const plural = ids.length > 1 ? "s" : "";
    const action = important ? "marquer" : "retirer";
    const ok = await confirm({
      type: "info",
      title: `${important ? "Marquer" : "Retirer"} ${ids.length} produit${plural} comme important${plural} ?`,
      message: important
        ? "L'étoile admin sera ajoutée. Aucun impact sur les marketplaces ni la boutique."
        : "L'étoile admin sera retirée. Aucun impact sur les marketplaces ni la boutique.",
      confirmLabel: `Oui, ${action}`,
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    setBulkActionLabel(
      `${important ? "Marquage" : "Retrait"} important de ${ids.length} produit${plural}…`,
    );
    startTransition(async () => {
      try {
        const r = await bulkUpdateProductAttributes(ids, { important });
        if (r.updated > 0 && r.errors.length === 0) {
          toast.success(
            `${r.updated} produit${r.updated > 1 ? "s" : ""} modifié${r.updated > 1 ? "s" : ""}`,
            important ? "Étoile important ajoutée." : "Étoile important retirée.",
          );
        } else if (r.errors.length > 0) {
          toast.error(
            `${r.errors.length} produit${r.errors.length > 1 ? "s" : ""} en erreur`,
            r.errors.slice(0, 3).map((e) => e.reference).join(", "),
          );
        } else {
          toast.info("Aucun changement", "Les produits étaient déjà dans cet état.");
        }
      } catch (e) {
        toast.error("Modification impossible", e instanceof Error ? e.message : "Erreur inconnue.");
      } finally {
        setBulkActionLabel(null);
      }
    });
  }, [selectedIds, confirm, toast, startTransition]);

  // ─── Tags en masse ──────────────────────────────────────────────────────
  // Ouvert par le menu Plus. Handler appelé par la modale BulkTagsModal.
  const handleBulkTagsApply = useCallback(
    async (mode: "add" | "remove", tagIds: string[]) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0 || tagIds.length === 0) {
        setBulkTagsOpen(false);
        return;
      }
      const plural = ids.length > 1 ? "s" : "";
      setBulkActionLabel(
        mode === "add"
          ? `Ajout de tags à ${ids.length} produit${plural}…`
          : `Retrait de tags de ${ids.length} produit${plural}…`,
      );
      startTransition(async () => {
        try {
          if (mode === "add") {
            const r = await bulkAddTagsToProducts(ids, tagIds);
            toast.success(
              `${r.linksCreated} lien${r.linksCreated > 1 ? "s" : ""} ajouté${r.linksCreated > 1 ? "s" : ""}`,
              `${r.tagsCount} tag${r.tagsCount > 1 ? "s" : ""} sur ${r.productsCount} produit${r.productsCount > 1 ? "s" : ""}.`,
            );
          } else {
            const r = await bulkRemoveTagsFromProducts(ids, tagIds);
            toast.success(
              `${r.linksRemoved} lien${r.linksRemoved > 1 ? "s" : ""} retiré${r.linksRemoved > 1 ? "s" : ""}`,
              `${r.tagsCount} tag${r.tagsCount > 1 ? "s" : ""} sur ${r.productsCount} produit${r.productsCount > 1 ? "s" : ""}.`,
            );
          }
        } catch (e) {
          toast.error(
            "Modification des tags impossible",
            e instanceof Error ? e.message : "Erreur inconnue.",
          );
        } finally {
          setBulkActionLabel(null);
          setBulkTagsOpen(false);
        }
      });
    },
    [selectedIds, toast, startTransition],
  );

  // ─── Ajout à une collection en masse ─────────────────────────────────────
  // Seuls les produits ONLINE peuvent rejoindre une collection (parité avec
  // addProductToCollection unitaire). Le count des ignorés est remonté par
  // le retour de la server action.
  const handleBulkAddToCollection = useCallback(
    async (collectionId: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        setBulkCollectionOpen(false);
        return;
      }
      setBulkActionLabel(`Ajout à la collection…`);
      startTransition(async () => {
        try {
          const r = await bulkAddProductsToCollection(collectionId, ids);
          if (r.added > 0) {
            toast.success(
              `${r.added} produit${r.added > 1 ? "s" : ""} ajouté${r.added > 1 ? "s" : ""} à la collection`,
              r.skipped > 0
                ? `${r.skipped} ignoré${r.skipped > 1 ? "s" : ""} (brouillon/archivé).`
                : undefined,
            );
          } else if (r.skipped > 0) {
            toast.info(
              "Aucun produit ajouté",
              `${r.skipped} produit${r.skipped > 1 ? "s" : ""} ignoré${r.skipped > 1 ? "s" : ""} car brouillon ou archivé.`,
            );
          } else {
            toast.info("Aucun changement", "Les produits étaient déjà dans cette collection.");
          }
        } catch (e) {
          toast.error(
            "Ajout à la collection impossible",
            e instanceof Error ? e.message : "Erreur inconnue.",
          );
        } finally {
          setBulkActionLabel(null);
          setBulkCollectionOpen(false);
        }
      });
    },
    [selectedIds, toast, startTransition],
  );

  const handleBulkRefreshCurrent = useCallback(async () => {
    const selectedProductsPayload = allProducts
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({
        productId: p.id,
        reference: p.reference,
        productName: p.name,
        firstImage: p.firstImage,
        status: p.status,
        isIncomplete: p.isIncomplete,
        wasImported: !!p.pfsProductId,
        locked: p.locked,
        orderchampProductId: p.orderchampProductId,
      }));
    await refreshBulk(selectedProductsPayload);
  }, [allProducts, selectedIds, refreshBulk]);

  if (allProducts.length === 0) {
    return (
      <div className="relative bg-bg-primary border border-border rounded-2xl p-16 text-center">
        <div className="w-16 h-16 bg-bg-tertiary rounded-2xl flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="font-heading font-bold text-text-primary text-base mb-1.5">Aucun produit trouvé</p>
        <p className="text-sm text-text-muted font-body max-w-xs mx-auto">Aucun résultat ne correspond à vos critères de recherche. Essayez de modifier vos filtres.</p>
        <FilterLoadingOverlay visible={isFiltering} />
      </div>
    );
  }

  return (
    <div>
      {/* Barre d'actions en masse — nouveau composant flottant (Variante A).
          Le rendu, le compteur intelligent, le panneau Marketplaces contextuel
          et le menu « Plus » vivent dans BulkActionBar. Ici on se contente de
          brancher les handlers déjà en place. */}
      <BulkActionBar
        selectedProducts={allProducts.filter((p) => selectedIds.has(p.id)).map((p) => ({
          id: p.id,
          reference: p.reference,
          name: p.name,
          status: p.status,
          isIncomplete: p.isIncomplete,
          locked: p.locked,
          firstImage: p.firstImage,
          pfsProductId: p.pfsProductId,
          ankorsProductId: p.ankorsProductId,
          efashionReferenceBase: p.efashionReferenceBase,
          faireProductId: p.faireProductId,
          orderchampProductId: p.orderchampProductId,
          pfsSyncRequired: p.pfsSyncRequired,
          ankorsSyncRequired: p.ankorsSyncRequired,
          efashionSyncRequired: p.efashionSyncRequired,
          faireSyncRequired: p.faireSyncRequired,
          orderchampSyncRequired: p.orderchampSyncRequired,
          microstoreEnabled: p.microstoreEnabled,
          microstoreLastPushedAt: p.microstoreLastPushedAt,
        }))}
        isPending={isPending}
        pendingLabel={bulkActionLabel}
        marketplaces={{
          pfs: { available: hasPfsConfig },
          ankorstore: { configured: hasAnkorstoreConfig, enabled: ankorstoreEnabled },
          efashion: { configured: hasEfashionConfig, enabled: efashionEnabled },
          faire: { configured: hasFaireConfig, enabled: faireEnabled },
          orderchamp: { configured: hasOrderchampConfig, enabled: orderchampEnabled },
          microstore: { configured: hasMicrostoreConfig },
        }}
        draftCount={selectedDraftIds.length}
        onStatus={(status) => handleBulkStatus(status)}
        onDelete={() => handleBulkDelete()}
        onRefresh={handleBulkRefreshCurrent}
        onEditAttributes={() => setBulkEditOpen(true)}
        onTranslateAll={handleBulkTranslateAll}
        onDeselectAll={() => setSelectedIds(new Set())}
        onMarketplacePublish={handleBulkMarketplacePublish}
        onMarketplaceSync={handleBulkMarketplaceSync}
        onPublishDrafts={() => setBulkPublishDraftsOpen(true)}
        onSetBestSeller={handleBulkSetBestSeller}
        onSetImportant={handleBulkSetImportant}
        onOpenTagsModal={() => setBulkTagsOpen(true)}
        onOpenCollectionModal={() => setBulkCollectionOpen(true)}
      />

      {/* Message résultat bulk */}
      {bulkMessage && (
        <div className={`mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-body ${
          bulkMessage.type === "success"
            ? "bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          <span>{bulkMessage.text}</span>
          <button
            type="button"
            onClick={() => setBulkMessage(null)}
            className="ml-auto text-current opacity-50 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tableau avec double scrollbar (haut + bas) */}
      <div className="relative">
        <TableWithTopScroll products={allProducts} startIndex={startIndex} hasPfsConfig={hasPfsConfig} pfsGloballyEnabled={pfsGloballyEnabled} hasAnkorstoreConfig={hasAnkorstoreConfig} ankorstoreEnabled={ankorstoreEnabled} hasEfashionConfig={hasEfashionConfig} efashionEnabled={efashionEnabled} hasFaireConfig={hasFaireConfig} faireEnabled={faireEnabled} hasOrderchampConfig={hasOrderchampConfig} orderchampEnabled={orderchampEnabled} hasMicrostoreConfig={hasMicrostoreConfig} microstoreEnabled={microstoreEnabled} selectedIds={selectedIds} allSelected={allSelected} toggleSelectAll={toggleSelectAll} toggleSelect={toggleSelect} expandedIds={expandedIds} toggleExpand={toggleExpand} dirtyEdits={dirtyEdits} onCommitCell={handleCommitCell} deletingIds={deletingIds} onRowStatus={(id, status) => handleBulkStatus(status, [id])} onRowDelete={(id) => handleBulkDelete([id])} onRowSync={(id) => handleBulkSync([id])} />
        <FilterLoadingOverlay visible={isFiltering} />
        <BulkActionOverlay label={bulkActionLabel} />
      </div>

      {/* Bandeau flottant global — apparaît en bas de l'écran dès qu'au moins
          une cellule a bougé dans la modale variantes (ou sur un autre produit
          dont la modale a déjà été fermée sans appliquer). */}
      {totalDirtyVariants > 0 && (
        <div className="variant-apply-bar-floating">
          <div className="variant-apply-bar">
            <div className="flex items-center gap-3 flex-1 min-w-0 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 ring-1 ring-amber-400/40 flex items-center justify-center flex-shrink-0">
                <span
                  className="w-2.5 h-2.5 rounded-full bg-amber-400"
                  style={{ animation: "variant-dirty-pulse 1.8s ease-in-out infinite" }}
                />
              </div>
              <div className="leading-tight min-w-0">
                <div className="font-heading font-bold text-[15px] text-white truncate">
                  {totalDirtyVariants} modification{totalDirtyVariants > 1 ? "s" : ""} en attente
                  <span className="ml-1.5 text-slate-400 font-normal text-[13px]">
                    · {affectedProductIds.size} produit{affectedProductIds.size > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  Ces changements ne sont pas encore enregistrés
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelAllVariantEdits}
              disabled={applyingVariantEdits}
              className="variant-apply-btn-ghost relative z-10"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleApplyAllVariantEdits}
              disabled={applyingVariantEdits}
              className="variant-apply-btn-primary relative z-10"
            >
              {applyingVariantEdits ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
              {applyingVariantEdits ? "Enregistrement…" : "Appliquer les modifications"}
            </button>
          </div>
        </div>
      )}

      {/* Modale d'édition en masse d'attributs produit */}
      <BulkEditAttributesModal
        open={bulkEditOpen}
        selectedCount={selectedIds.size}
        options={bulkEditOptions}
        onCancel={() => setBulkEditOpen(false)}
        onApply={handleBulkAttributes}
        isPending={isPending}
      />

      {/* Modale « Tags en masse » — ajouter / retirer plusieurs tags à la fois */}
      <BulkTagsModal
        open={bulkTagsOpen}
        selectedCount={selectedIds.size}
        tags={availableTags}
        onCancel={() => setBulkTagsOpen(false)}
        onApply={handleBulkTagsApply}
        isPending={isPending}
      />

      {/* Modale « Ajouter à une collection » — un seul choix, brouillons ignorés */}
      <BulkAddToCollectionModal
        open={bulkCollectionOpen}
        selectedCount={selectedIds.size}
        onlineCount={allProducts.filter((p) => selectedIds.has(p.id) && p.status === "ONLINE").length}
        collections={availableCollections}
        onCancel={() => setBulkCollectionOpen(false)}
        onApply={handleBulkAddToCollection}
        isPending={isPending}
      />

      {/* Modale de publication en masse des brouillons */}
      {bulkPublishDraftsOpen && (
        <BulkPublishDraftsModal
          open={bulkPublishDraftsOpen}
          productIds={selectedDraftIds}
          hasPfsConfig={hasPfsConfig}
          hasAnkorstoreConfig={hasAnkorstoreConfig}
          ankorstoreEnabled={ankorstoreEnabled}
          hasEfashionConfig={hasEfashionConfig}
          efashionEnabled={efashionEnabled}
          hasFaireConfig={hasFaireConfig}
          faireEnabled={faireEnabled}
          hasOrderchampConfig={hasOrderchampConfig}
          orderchampEnabled={orderchampEnabled}
          hasMicrostoreConfig={hasMicrostoreConfig}
          onCancel={() => setBulkPublishDraftsOpen(false)}
          onConfirm={handleBulkPublishDraftsConfirm}
        />
      )}

      {/* Modale de confirmation « Publier N produits sur X ? » — partagée
          entre les 4 marketplaces, ouverte par handleBulkMarketplacePublish. */}
      {bulkPublishConfirm && (() => {
        const { marketplace, ids } = bulkPublishConfirm;
        const selected = allProducts.filter((p) => ids.includes(p.id)).map((p) => ({
          id: p.id,
          name: p.name,
          firstImage: p.firstImage,
        }));
        const marketplaceName = MARKETPLACE_LABEL[marketplace];

        if (marketplace === "efashion") {
          return (
            <MarketplacePushModal
              open
              marketplace="efashion"
              mode="bulk-publish"
              title={`Publier ${selected.length} produits sur ${marketplaceName}`}
              subtitle="prochain batch shooting"
              products={selected}
              confirmLabel="Ajouter au shooting"
              infoMessage={<>Une entrée de shooting sera créée pour chaque produit. L'envoi effectif se validera depuis la fenêtre <strong>eFashion</strong> en bas à droite.</>}
              onClose={() => setBulkPublishConfirm(null)}
              onConfirm={doBulkMarketplacePublish}
            />
          );
        }

        if (marketplace === "faire") {
          return (
            <MarketplacePushModal
              open
              marketplace="faire"
              mode="bulk-publish"
              title={`Publier ${selected.length} produits sur ${marketplaceName}`}
              subtitle="création brouillons"
              products={selected}
              infoTone="warning"
              infoMessage={<>Les fiches sont créées en <strong>brouillon</strong>. Vous pourrez les publier définitivement depuis Faire ensuite.</>}
              onClose={() => setBulkPublishConfirm(null)}
              onConfirm={doBulkMarketplacePublish}
            />
          );
        }

        // Microstore : pas de modale bulk-publish spécifique — le panneau
        // Marketplaces ne propose qu'un bouton « Synchroniser » qui appelle
        // handleBulkMarketplaceSync directement.
        if (marketplace === "microstore") return null;

        const asyncNote = marketplace === "ankorstore"
          ? " La publication Ankorstore est asynchrone : le résultat arrive dans les minutes qui suivent."
          : "";
        return (
          <MarketplacePushModal
            open
            marketplace={marketplace}
            mode="bulk-publish"
            title={`Publier ${selected.length} produits sur ${marketplaceName}`}
            products={selected}
            infoMessage={
              <>
                La publication utilise <strong>vos infos, photos, prix et stock actuels</strong> pour chaque produit. Vous pourrez tout modifier après.
                {asyncNote}
              </>
            }
            onClose={() => setBulkPublishConfirm(null)}
            onConfirm={doBulkMarketplacePublish}
          />
        );
      })()}
    </div>
  );
}

/**
 * Voile blanc translucide + petit cercle de chargement superposé sur le
 * tableau produits pendant qu'un filtre / onglet / recherche re-fetch la
 * liste (transition Next.js). Empêche le double-clic et signale que
 * l'affichage est en train d'être actualisé.
 */
function FilterLoadingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-20 bg-white/60 backdrop-blur-[1px] rounded-2xl pointer-events-none"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 bg-bg-primary border border-border rounded-full px-3.5 py-1.5 shadow-md">
        <svg className="w-4 h-4 animate-spin text-bg-dark" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-[12px] font-body font-medium text-text-secondary">Chargement…</span>
      </div>
    </div>
  );
}

/**
 * Voile blanc translucide + libellé « … en cours » posé sur le tableau
 * pendant qu'une action bulk (traduction, suppression, changement de statut,
 * modification d'attributs) tourne. Complète la bande animée de la
 * BulkActionBar : la cliente voit que la barre ET le tableau signalent
 * l'activité, pas juste un spinner détaché flottant au milieu de l'écran.
 */
function BulkActionOverlay({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-20 bg-white/60 backdrop-blur-[1px] rounded-2xl pointer-events-none"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2.5 bg-bg-primary border border-border rounded-full px-4 py-2 shadow-lg">
        <svg className="w-4 h-4 animate-spin text-bg-dark" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-[13px] font-body font-medium text-text-primary">{label}</span>
      </div>
    </div>
  );
}

/**
 * Badge compact marketplace pour mobile + tablette (< lg) où la colonne
 * Marketplaces dédiée est masquée. Non-interactive : simple indicateur.
 * Les actions passent par le menu ⋮ ou la fiche produit.
 *
 * Rendu = mêmes codes couleur que les vrais badges desktop (vert/orange/gris)
 * + petit point coloré pour un rappel visuel de l'état. Alignés horizontalement
 * en flex-nowrap pour que les 4 (PFS/EF/AK/Faire) tiennent sur une seule ligne
 * quelle que soit la largeur (Format A validé maquette 2026-07-13).
 */
function MpDot({
  label,
  active,
  syncRequired,
  disabled = false,
  shootingPending = false,
  onClick,
  busy = false,
}: {
  label: string;
  active: boolean;
  syncRequired: boolean;
  disabled?: boolean;
  shootingPending?: boolean;
  /** Si fourni, le badge devient cliquable (publier / synchroniser). Le
      stopPropagation est géré ici pour ne pas déclencher la sélection de ligne. */
  onClick?: () => void;
  busy?: boolean;
}) {
  // Tailles bumpées (mobile) : h-7 + text-[11.5px] + px-2 (au lieu de h-6 + text-[10.5px] + px-1.5).
  const sizeCls = "gap-1.5 flex-1 min-w-0 px-2 h-7 rounded-md text-[11.5px] font-semibold border leading-none";
  if (disabled) {
    return (
      <span
        className={`inline-flex items-center justify-center ${sizeCls} text-text-muted border-border-dark`}
        style={{
          background:
            "repeating-linear-gradient(45deg,#FAFAFA,#FAFAFA 6px,#F4F4F5 6px,#F4F4F5 12px)",
        }}
        title={`${label} — marketplace désactivée`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-muted" />
        <span className="whitespace-nowrap line-through decoration-[1.5px]">{label}</span>
      </span>
    );
  }
  if (shootingPending) {
    return (
      <span
        className={`inline-flex items-center justify-center ${sizeCls} bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]`}
        title={`${label} — en attente de shooting eFashion`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#F59E0B]" />
        <span className="whitespace-nowrap">{label}</span>
      </span>
    );
  }
  const isSync = active && syncRequired;
  // Pas lié + cliquable → rouge (appelle à l'action : créer ou lier).
  // Pas lié + non cliquable (marketplace non opérationnelle) → gris passif.
  const canAct = !active && !!onClick;
  const cls = isSync
    ? "sync-required-badge bg-[#FFF7ED] text-[#9A3412] border-[#FED7AA]"
    : active
      ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]"
      : canAct
        ? "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]"
        : "bg-bg-secondary text-text-muted border-border";
  const dotCls = isSync
    ? "bg-[#F97316]"
    : active
      ? "bg-[#22C55E]"
      : canAct
        ? "bg-[#DC2626]"
        : "bg-slate-300";
  const title = isSync
    ? `${label} — cliquer pour synchroniser`
    : active
      ? `${label} — en ligne`
      : `${label} — cliquer pour publier ou lier`;
  if (!onClick) {
    return (
      <span
        className={`inline-flex items-center justify-center ${sizeCls} ${cls}`}
        title={`${label} — ${isSync ? "synchronisation nécessaire" : active ? "en ligne" : "hors ligne"}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
        <span className="whitespace-nowrap">{label}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        onClick();
      }}
      disabled={busy}
      className={`inline-flex items-center justify-center ${sizeCls} ${cls} ${busy ? "opacity-60 cursor-wait" : "cursor-pointer active:scale-95"} transition-transform`}
      title={busy ? `${label} — en cours…` : title}
    >
      {busy ? (
        <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
