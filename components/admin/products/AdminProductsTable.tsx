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
  previewProductDeletion,
  updateVariantQuick,
} from "@/app/actions/admin/products";
import { deleteProductsOnPfs, deleteProductsOnAnkorstore, deleteProductsOnEfashion, deleteProductsOnFaire } from "@/app/actions/admin/marketplace-delete";
import { bulkAddToEfashionShootingBatch } from "@/app/actions/admin/efashion-shooting-batch";
import BulkEditAttributesModal, { type BulkEditOptions, type BulkEditPayload } from "@/components/admin/products/BulkEditAttributesModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useRefreshMarketplaceDialog } from "@/components/admin/products/useRefreshMarketplaceDialog";
import { ProductLockToggle } from "@/components/admin/products/ProductLockToggle";
import { useMarketplaceRefreshQueue } from "@/components/admin/products/MarketplaceRefreshContext";
import { useEfashionShootingBatch } from "@/components/admin/products/EfashionShootingBatchContext";
import { useFilterPending } from "@/components/admin/products/FilterPendingContext";
import { findLatestOpForProduct, computeMarketplaceBadgeState } from "@/components/admin/products/marketplaceBadgeState";
import { computeBulkVariantMarketplaceTargets } from "@/lib/bulk-variant-marketplace-targets";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
import { formatRelativeDate } from "@/lib/format-date";
import MarketplaceActionModal from "@/components/admin/products/MarketplaceActionModal";
import BulkActionBar, { type MarketplaceKey } from "@/components/admin/products/BulkActionBar";

const MARKETPLACE_LABEL: Record<MarketplaceKey, string> = {
  pfs: "Paris Fashion Shop",
  ankorstore: "Ankorstore",
  efashion: "eFashion Paris",
  faire: "Faire",
};

// Modales lourdes — chargées à l'ouverture seulement pour alléger le bundle
// initial de la table produits (cf. audit perf 2026-05-31).
const LinkPfsProductModal = dynamic(
  () => import("@/components/admin/products/LinkPfsProductModal"),
);
const LinkAnkorstoreProductModal = dynamic(
  () => import("@/components/admin/products/LinkAnkorstoreProductModal"),
);
const LinkEfashionProductModal = dynamic(
  () => import("@/components/admin/products/LinkEfashionProductModal"),
);
const LinkFaireProductModal = dynamic(
  () => import("@/components/admin/products/LinkFaireProductModal"),
);
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
}

export function computeRowActionEligibility(
  product: {
    status: string;
    isIncomplete: boolean;
    pfsProductId: string | null;
    ankorsProductId: string | null;
    efashionLinked?: boolean;
    fairePublished?: boolean;
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

// ─── Marketplace publish badge ─────────────────────────────────────────────────

function MarketplaceBadge({
  published,
  publishing = false,
  syncRequired = false,
  lastExportedAt = null,
  onActionClick,
  onSyncClick,
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  /** Ouvre la modale Publier/Lier (le parent gère ensuite les actions). */
  onActionClick?: () => void;
  onSyncClick?: () => void;
}) {
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSyncClick?.();
        }}
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer leading-tight"
        title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Paris Fashion Shop"
      >
        <span className="relative inline-flex">
          <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse" />
          <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping" />
        </span>
        PFS · Synchro
      </button>
    );
  }
  if (published) {
    return (
      <span
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] leading-tight"
        title={lastExportedAt ? `Publié sur Paris Fashion Shop — dernier export ${formatRelativeDate(lastExportedAt)}` : "Publié sur Paris Fashion Shop"}
      >
        <span>PFS</span>
        {lastExportedAt && <span className="text-[8.5px] opacity-70 font-medium tabular-nums">{formatRelativeDate(lastExportedAt)}</span>}
      </span>
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
      className={`inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold leading-tight transition-colors ${
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
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
}) {
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSyncClick?.();
        }}
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer leading-tight"
        title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Ankorstore"
      >
        <span className="relative inline-flex">
          <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse" />
          <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping" />
        </span>
        ANKOR · Synchro
      </button>
    );
  }
  if (published) {
    return (
      <span
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] leading-tight"
        title={lastExportedAt ? `Publié sur Ankorstore — dernier export ${formatRelativeDate(lastExportedAt)}` : "Publié sur Ankorstore"}
      >
        <span>ANKOR</span>
        {lastExportedAt && <span className="text-[8.5px] opacity-70 font-medium tabular-nums">{formatRelativeDate(lastExportedAt)}</span>}
      </span>
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
      className={`inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold leading-tight transition-colors ${
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
}: {
  linked: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
}) {
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
  if (linked && syncRequired) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSyncClick?.();
        }}
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer leading-tight"
        title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à eFashion Paris"
      >
        <span className="relative inline-flex">
          <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse" />
          <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping" />
        </span>
        EF · Synchro
      </button>
    );
  }
  if (linked) {
    return (
      <span
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] leading-tight"
        title={lastExportedAt ? `Lié à eFashion Paris — dernier export ${formatRelativeDate(lastExportedAt)}` : "Lié à eFashion Paris"}
      >
        <span>EF</span>
        {lastExportedAt && <span className="text-[8.5px] opacity-70 font-medium tabular-nums">{formatRelativeDate(lastExportedAt)}</span>}
      </span>
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
      className={`inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold leading-tight transition-colors ${
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
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  lastExportedAt?: string | null;
  onActionClick?: () => void;
  onSyncClick?: () => void;
}) {
  if (publishing) {
    return (
      <span
        className="inline-flex flex-row items-center justify-center gap-1 w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#FCE7F3] text-[#9D174D] border border-[#FBCFE8] leading-tight"
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSyncClick?.();
        }}
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer leading-tight"
        title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Faire"
      >
        <span className="relative inline-flex">
          <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse" />
          <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping" />
        </span>
        Faire · Synchro
      </button>
    );
  }
  if (published) {
    return (
      <span
        className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] leading-tight"
        title={lastExportedAt ? `Publié sur Faire — dernier export ${formatRelativeDate(lastExportedAt)}` : "Publié sur Faire"}
      >
        <span>Faire</span>
        {lastExportedAt && <span className="text-[8.5px] opacity-70 font-medium tabular-nums">{formatRelativeDate(lastExportedAt)}</span>}
      </span>
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
      className={`inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold leading-tight transition-colors ${
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
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes?: VariantSizeEntry[];
  color: { name: string; hex: string | null; patternImage?: string | null };
  efashionProductId?: number | null;
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
  /** Verrou manuel : si true, désactive le bouton « Rafraîchir ». */
  locked: boolean;
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
  /** Drapeaux « Synchronisation nécessaire » pilotés par le save produit et le
   *  worker image. Affiche un badge orange cliquable pour pousser la modif. */
  pfsSyncRequired: boolean;
  ankorsSyncRequired: boolean;
  efashionSyncRequired: boolean;
  faireSyncRequired: boolean;
  /** Dates du dernier export Excel/ZIP réussi par marketplace (null = jamais
   *  exporté). Affichées dans la colonne « Dates » avec une puce d'initiales
   *  par marketplace — visibles aussi pour les brouillons. */
  pfsLastExportedAt: string | null;
  efashionLastExportedAt: string | null;
  microstoreLastExportedAt: string | null;
  ankorstoreLastExportedAt: string | null;
  faireLastExportedAt: string | null;
  colors: ColorVariant[];
  translations: ProductTranslation[];
}

interface Props {
  products: AdminProduct[];
  totalCount: number;
  startIndex: number;
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  /** Listes pour la modale d'édition en masse (catégorie, code SH, etc.) */
  bulkEditOptions: BulkEditOptions;
}

// ─── Variant dirty-edit helpers ─────────────────────────────────────────────
// Édition inline dans le tiroir : chaque cellule (prix, stock, poids, packQty)
// se transforme en champ custom au double-clic. Tant que l'utilisatrice n'a
// pas cliqué « Appliquer les modifications » en bas du tiroir, les nouvelles
// valeurs vivent uniquement en mémoire dans dirtyEdits (Record<variantId,
// { field: newValue }>). Exportés pour les tests unitaires.

export type VariantField = "price" | "stock" | "weight" | "packQty";
export type VariantDirtyEdits = Record<string, Partial<Record<VariantField, number>>>;

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
  newValue: number,
  originalValue: number,
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
  onCommit: (field: VariantField, newValue: number, originalValue: number) => void;
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

// ─── Variant Row (nouvelle version : édition inline, plus de checkbox) ─────
// La ligne n'a plus de bouton « Modifier » ni de case à cocher. Chaque cellule
// éditable délègue au top-level (AdminProductsTable) la mémorisation de la
// valeur en attente via `onCommitCell`. Un bandeau flottant global en bas de
// l'écran affiche le total des modifications et permet de tout appliquer /
// annuler d'un coup, même à travers plusieurs tiroirs ouverts.
function VariantRow({
  variant,
  editsForVariant,
  onCommitCell,
}: {
  variant: ColorVariant;
  editsForVariant: Partial<Record<VariantField, number>>;
  onCommitCell: (variantId: string, field: VariantField, newValue: number, originalValue: number) => void;
}) {
  const priceOrig = variant.unitPrice;
  const stockOrig = variant.stock;
  const weightOrig = variant.weight;
  const packOrig = variant.packQuantity ?? 0;

  const priceCurrent = editsForVariant.price ?? priceOrig;
  const stockCurrent = editsForVariant.stock ?? stockOrig;
  const weightCurrent = editsForVariant.weight ?? weightOrig;
  const packCurrent = editsForVariant.packQty ?? packOrig;

  const dirtyPrice = editsForVariant.price !== undefined;
  const dirtyStock = editsForVariant.stock !== undefined;
  const dirtyWeight = editsForVariant.weight !== undefined;
  const dirtyPack = editsForVariant.packQty !== undefined;

  const commit = useCallback(
    (field: VariantField, newValue: number, originalValue: number) => {
      onCommitCell(variant.id, field, newValue, originalValue);
    },
    [onCommitCell, variant.id],
  );

  // Puce colorée du stock : vert, ambre (≤5), rouge (0).
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
    <tr className="border-t border-border-light transition-colors hover:bg-bg-primary/60">
      {/* Couleur */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className="w-[22px] h-[22px] rounded-full shrink-0"
            style={{
              ...swatchStyle,
              border: "2px solid #fff",
              boxShadow: "0 0 0 1px #D1D1D1, 0 1px 3px rgba(0,0,0,0.08)",
            }}
            title={variant.color.name}
          />
          <span className="text-xs font-semibold font-body text-text-primary">
            {variant.color.name}
          </span>
        </div>
      </td>

      {/* Type - UNIT ou PACK avec édition inline du packQty */}
      <td className="px-4 py-3">
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

      {/* Tailles (lecture seule ici) */}
      <td className="px-4 py-3">
        {variant.variantSizes && variant.variantSizes.length > 0 && (
          <span className="badge badge-neutral text-[10px]">
            {variant.variantSizes
              .map((vs) => (vs.quantity > 1 ? `${vs.size.name}×${vs.quantity}` : vs.size.name))
              .join(", ")}
          </span>
        )}
      </td>

      {/* Prix HT */}
      <td className="px-4 py-3 text-right">
        <VariantEditableCell
          variantId={variant.id}
          field="price"
          currentValue={priceCurrent}
          originalValue={priceOrig}
          isInt={false}
          dirty={dirtyPrice}
          ariaLabel={`Prix HT — ${variant.color.name}`}
          onCommit={commit}
        >
          <span className="font-semibold text-text-primary">
            {priceCurrent.toFixed(2).replace(".", ",")} €
          </span>
        </VariantEditableCell>
      </td>

      {/* Stock */}
      <td className="px-4 py-3 text-right">
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

      {/* Poids */}
      <td className="px-4 py-3 text-right">
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
}


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
    ARCHIVED: "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA] hover:bg-[#FFEDD5]",
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

// ─── Actions Dropdown (portal) ────────────────────────────────────────────────

function ActionsDropdown({
  productId,
  expanded,
  refreshing,
  anchorRef,
  eligibility,
  ankorstorePublishing,
  pfsPublishing,
  efashionPublishing,
  fairePublishing,
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
  onDelete,
}: {
  productId: string;
  expanded: boolean;
  refreshing: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  eligibility: RowActionEligibility;
  ankorstorePublishing: boolean;
  pfsPublishing: boolean;
  efashionPublishing: boolean;
  fairePublishing: boolean;
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
  onDelete: () => void;
}) {
  // `expanded` et `onExpandToggle` ne sont plus exposés dans le menu mais
  // restent dans la signature pour compat amont — on évite l'avertissement.
  void expanded;
  void onExpandToggle;
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
        href={`/fr/produits/${productId}`}
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
          disabled={pfsPublishing}
          className={`${itemClass} ${pfsPublishing ? "opacity-50 cursor-wait" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {pfsPublishing ? "Publication PFS en cours…" : "Publier sur Paris Fashion Shop"}
        </button>
      )}
      {eligibility.canPublishEfashion && (
        <button
          type="button"
          onClick={onPublishEfashion}
          disabled={efashionPublishing}
          className={`${itemClass} ${efashionPublishing ? "opacity-50 cursor-wait" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {efashionPublishing ? "Publication eFashion en cours…" : "Publier sur eFashion"}
        </button>
      )}
      {eligibility.canPublishAnkorstore && (
        <button
          type="button"
          onClick={onPublishAnkorstore}
          disabled={ankorstorePublishing}
          className={`${itemClass} ${ankorstorePublishing ? "opacity-50 cursor-wait" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {ankorstorePublishing ? "Publication Ankorstore en cours…" : "Publier sur Ankorstore"}
        </button>
      )}
      {eligibility.canPublishFaire && (
        <button
          type="button"
          onClick={onPublishFaire}
          disabled={fairePublishing}
          className={`${itemClass} ${fairePublishing ? "opacity-50 cursor-wait" : ""}`}
        >
          <span className={iconWrap}>+</span>
          {fairePublishing ? "Publication Faire en cours…" : "Publier sur Faire"}
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
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
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
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  selected: boolean;
  onToggle: () => void;
  expanded: boolean;
  onExpandToggle: () => void;
  dirtyEdits: VariantDirtyEdits;
  onCommitCell: (variantId: string, field: VariantField, newValue: number, originalValue: number) => void;
  isDeleting?: boolean;
  onRowStatus: (productId: string, status: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onRowDelete: (productId: string) => void;
  onRowSync: (productId: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [linkPfsOpen, setLinkPfsOpen] = useState(false);
  const [linkAkOpen, setLinkAkOpen] = useState(false);
  const [linkEfOpen, setLinkEfOpen] = useState(false);
  const [linkFaireOpen, setLinkFaireOpen] = useState(false);
  // Modales « Publier / Lier » : une par marketplace, ouvertes au clic du badge
  const [actionModalPfs, setActionModalPfs] = useState(false);
  const [actionModalAk, setActionModalAk] = useState(false);
  const [actionModalEf, setActionModalEf] = useState(false);
  const [actionModalFaire, setActionModalFaire] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [refCopied, setRefCopied] = useState(false);
  const { enqueue, items: queueItems } = useMarketplaceRefreshQueue();
  const { addProduct: addToEfashionShootingBatch } = useEfashionShootingBatch();
  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showEfashion = hasEfashionConfig && efashionEnabled;
  const showFaire = hasFaireConfig && faireEnabled;
  const efashionLinked = product.colors.some((c) => c.efashionProductId != null);
  const { refreshSingle } = useRefreshMarketplaceDialog({
    showPfs: hasPfsConfig,
    showAnkorstore,
    showEfashion,
    showFaire,
  });

  // État "loading" des badges marketplaces : on regarde la dernière opération
  // marketplace pour ce produit et on bloque les clics tant qu'elle est en
  // file/exécution/attente du callback. Verrou local supplémentaire pour le
  // bref instant entre le clic et la mise à jour de la file (anti-double-clic).
  const pfsOp = findLatestOpForProduct(queueItems, product.id, "pfs");
  const pfsBadgeState = computeMarketplaceBadgeState(product.pfsProductId, pfsOp, "pfs");
  const [pendingPfsEnqueue, setPendingPfsEnqueue] = useState(false);
  const isPfsPublishing = pfsBadgeState.loading || pendingPfsEnqueue;

  const ankorstoreOp = findLatestOpForProduct(queueItems, product.id, "ankorstore");
  const ankorstoreBadgeState = computeMarketplaceBadgeState(
    product.ankorsProductId,
    ankorstoreOp,
    "ankorstore",
  );
  const [pendingAnkorstoreEnqueue, setPendingAnkorstoreEnqueue] = useState(false);
  const isAnkorstorePublishing = ankorstoreBadgeState.loading || pendingAnkorstoreEnqueue;

  const efashionOp = findLatestOpForProduct(queueItems, product.id, "efashion");
  const efashionBadgeState = computeMarketplaceBadgeState(
    efashionLinked ? "linked" : null,
    efashionOp,
    "efashion",
  );
  const [pendingEfashionEnqueue, setPendingEfashionEnqueue] = useState(false);
  const isEfashionPublishing = efashionBadgeState.loading || pendingEfashionEnqueue;

  const faireOp = findLatestOpForProduct(queueItems, product.id, "faire");
  const faireBadgeState = computeMarketplaceBadgeState(
    product.faireProductId,
    faireOp,
    "faire",
  );
  const [pendingFaireEnqueue, setPendingFaireEnqueue] = useState(false);
  const isFairePublishing = faireBadgeState.loading || pendingFaireEnqueue;

  // Demande la création d'une nouvelle fiche sur PFS — même logique que pour
  // Ankorstore mais sans la possibilité de "lier à existant" (pas de modale).
  const handlePublishPfs = useCallback(async () => {
    if (isPfsPublishing) return;
    const ok = await confirm({
      type: "warning",
      title: "Publier sur Paris Fashion Shop ?",
      message: `"${product.name}" (${product.reference}) n'est pas encore sur Paris Fashion Shop. Une nouvelle fiche y sera créée avec les infos, photos, prix et stock actuels du produit.`,
      confirmLabel: "Oui, publier",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
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
  }, [confirm, enqueue, product, isPfsPublishing]);

  // Demande la création d'une nouvelle fiche sur Ankorstore — appelé depuis le
  // badge "+ Ankorstore" et l'item du menu Actions. On passe par une simple
  // confirmation puis on enqueue : le widget en bas à droite affichera la
  // progression (callback Ankorstore asynchrone, voir CLAUDE.md > mode callback-only).
  const handlePublishAnkorstore = useCallback(async () => {
    if (isAnkorstorePublishing) return;
    const ok = await confirm({
      type: "warning",
      title: "Publier sur Ankorstore ?",
      message: `"${product.name}" (${product.reference}) n'est pas encore sur Ankorstore. Une nouvelle fiche y sera créée avec les infos, photos, prix et stock actuels du produit.`,
      confirmLabel: "Oui, publier",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
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
  }, [confirm, enqueue, product, isAnkorstorePublishing]);

  // Clic 1-clic depuis un badge orange « Synchro nécessaire ». Pas de
  // confirmation : la cliente a déjà vu le badge et choisi délibérément.
  const handleSyncPfs = useCallback(() => {
    if (isPfsPublishing) return;
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
  }, [enqueue, product, isPfsPublishing]);

  const handleSyncAnkorstore = useCallback(() => {
    if (isAnkorstorePublishing) return;
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
  }, [enqueue, product, isAnkorstorePublishing]);

  const handleSyncEfashion = useCallback(() => {
    if (isEfashionPublishing) return;
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
  }, [enqueue, product, isEfashionPublishing]);

  // Demande la création d'une nouvelle fiche sur eFashion Paris — appelé depuis
  // le badge "+ eFashion". Même logique qu'Ankorstore (confirmation + enqueue +
  // widget bas-droite), mais le flow eFashion est synchrone (pas de callback).
  const handlePublishEfashion = useCallback(async () => {
    if (isEfashionPublishing) return;
    const ok = await confirm({
      type: "warning",
      title: "Publier sur eFashion Paris ?",
      message: `"${product.name}" (${product.reference}) n'est pas encore sur eFashion Paris. Une nouvelle fiche y sera créée avec les infos, photos, prix et stock actuels du produit.`,
      confirmLabel: "Oui, publier",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
    // Première publication eFashion = ticket de shooting nécessaire → file
    // batch (validation manuelle de l'utilisatrice avant envoi groupé).
    // Pas besoin du lock pendingEfashionEnqueue : l'opération est synchrone
    // côté serveur (un simple upsert en BDD) et la widget eFashion en bas à
    // droite reflètera l'ajout au prochain poll.
    void addToEfashionShootingBatch(product.id, "PUBLISH");
  }, [confirm, addToEfashionShootingBatch, product, isEfashionPublishing]);

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

  const handlePublishFaire = useCallback(async () => {
    if (isFairePublishing) return;
    const ok = await confirm({
      type: "warning",
      title: "Publier sur Faire ?",
      message: `"${product.name}" (${product.reference}) n'est pas encore sur Faire. Une nouvelle fiche brouillon y sera créée avec les infos, photos, prix et stock actuels du produit.`,
      confirmLabel: "Oui, publier",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
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
  }, [confirm, enqueue, product, isFairePublishing]);

  const handleSyncFaire = useCallback(() => {
    if (isFairePublishing) return;
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
  }, [enqueue, product, isFairePublishing]);

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
    { ...product, efashionLinked, fairePublished: faireBadgeState.online },
    {
      hasPfsConfig,
      hasAnkorstoreConfig,
      ankorstoreEnabled,
      hasEfashionConfig,
      efashionEnabled,
      hasFaireConfig,
      faireEnabled,
    },
  );

  return (
    <>
      <tr
        className={`group table-row transition-all duration-150 ${selected ? "bg-[#EEF2FF]" : ""} ${expanded ? "border-b-0" : ""} ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
      >
        {/* Checkbox */}
        <td className="px-4 py-3.5 w-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="checkbox-custom"
          />
        </td>

        {/* N° de ligne */}
        <td className="hidden sm:table-cell px-2 py-3.5 w-10 text-center cursor-pointer" onClick={onExpandToggle}>
          <span className="font-body text-[11px] text-text-muted tabular-nums">{rowNumber}</span>
        </td>

        {/* Produit — photo + nom + référence dans une seule colonne (fusion
            des anciennes cellules Photo + Réf. + Produit pour ressembler à
            la maquette Ardoise). */}
        <td className="px-3 py-3 cursor-pointer min-w-[260px]" onClick={onExpandToggle}>
          <div className="flex items-center gap-3">
            {/* Miniature à gauche — click = page d'édition */}
            <Link
              href={`/admin/produits/${product.id}/modifier`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0"
              aria-label={`Modifier ${product.name}`}
            >
              {product.firstImage ? (
                <img
                  src={product.firstImage}
                  alt={product.name}
                  className="w-11 h-11 object-cover rounded-lg border border-border shadow-sm"
                />
              ) : (
                <div className="w-11 h-11 bg-bg-tertiary rounded-lg border border-border flex items-center justify-center">
                  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              </div>
              <p className="font-mono text-[11px] text-text-muted mt-0.5 truncate">{product.reference}</p>
              {/* Infos compactes pour mobile : prix + état + marketplaces.
                  Masquées dès qu'on a assez de place pour les colonnes dédiées. */}
              <div className="md:hidden flex items-center gap-2 mt-1.5 flex-wrap">
                {!isNaN(minPrice) && (
                  <span className="font-semibold text-text-primary text-[12px] tabular-nums">
                    {minPrice.toFixed(2)} EUR
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold border ${
                  product.status === "ONLINE" ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]"
                    : product.status === "SYNCING" ? "bg-blue-50 text-blue-700 border-blue-200"
                    : product.status === "ARCHIVED" ? "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]"
                    : "bg-bg-secondary text-text-secondary border-border"
                }`}>
                  <span className={`w-1 h-1 rounded-full ${
                    product.status === "ONLINE" ? "bg-[#22C55E]"
                      : product.status === "SYNCING" ? "bg-blue-500"
                      : product.status === "ARCHIVED" ? "bg-[#F59E0B]"
                      : "bg-[#9CA3AF]"
                  }`} />
                  {product.status === "ONLINE" ? "En ligne"
                    : product.status === "SYNCING" ? "En sync"
                    : product.status === "ARCHIVED" ? "Archivé"
                    : "Hors ligne"}
                </span>
              </div>
              {/* Badges marketplaces compacts pour mobile + tablette (< lg).
                  Non-interactifs : simple aperçu du statut de publication.
                  Les vraies actions sont accessibles via le menu ⋮. */}
              <div className="lg:hidden flex items-center gap-1 mt-1.5 flex-wrap">
                <MpDot label="PFS" active={hasPfsConfig && !!product.pfsProductId} syncRequired={product.pfsSyncRequired} />
                {showEfashion && (
                  <MpDot label="EF" active={efashionLinked} syncRequired={product.efashionSyncRequired} />
                )}
                {showAnkorstore && (
                  <MpDot label="AK" active={!!product.ankorsProductId} syncRequired={product.ankorsSyncRequired} />
                )}
                {showFaire && (
                  <MpDot label="Faire" active={faireBadgeState.online} syncRequired={product.faireSyncRequired} />
                )}
              </div>
            </div>
            {/* Boutons compacts (copie ref + verrou) à droite, discrets, apparaissent au survol */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
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
                className="inline-flex items-center justify-center w-6 h-6 rounded-md text-text-muted hover:bg-bg-tertiary hover:text-text-primary transition-colors"
              >
                {refCopied ? (
                  <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <ProductLockToggle productId={product.id} initialLocked={product.locked} variant="icon" />
            </div>
          </div>
        </td>

        {/* Prix */}
        <td className="hidden md:table-cell px-3 py-3.5 cursor-pointer whitespace-nowrap" onClick={onExpandToggle}>
          {!isNaN(minPrice) ? (
            <span className="font-semibold text-text-primary text-[13.5px] tabular-nums">
              {minPrice.toFixed(2)} EUR
            </span>
          ) : (
            <span className="text-text-muted text-[11px]">—</span>
          )}
        </td>

        {/* Marketplaces */}
        <td className="hidden lg:table-cell px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
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
            <div className="flex flex-row gap-1 items-start flex-wrap">
              <MarketplaceBadge
                published={!!product.pfsProductId}
                publishing={isPfsPublishing}
                syncRequired={product.pfsSyncRequired && !isPfsPublishing}
                lastExportedAt={product.pfsLastExportedAt}
                onActionClick={
                  hasPfsConfig && !product.pfsProductId && !isPfsPublishing
                    ? () => setActionModalPfs(true)
                    : undefined
                }
                onSyncClick={handleSyncPfs}
              />
              {showEfashion ? (
                <EfashionBadge
                  linked={efashionLinked}
                  publishing={isEfashionPublishing}
                  syncRequired={product.efashionSyncRequired && !isEfashionPublishing}
                  lastExportedAt={product.efashionLastExportedAt}
                  onActionClick={
                    showEfashion && !efashionLinked && !isEfashionPublishing
                      ? () => setActionModalEf(true)
                      : undefined
                  }
                  onSyncClick={handleSyncEfashion}
                />
              ) : (
                <span className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border leading-tight">
                  EF
                </span>
              )}
              <AnkorstoreBadge
                published={!!product.ankorsProductId}
                publishing={isAnkorstorePublishing}
                syncRequired={product.ankorsSyncRequired && !isAnkorstorePublishing}
                lastExportedAt={product.ankorstoreLastExportedAt}
                onActionClick={
                  showAnkorstore && !product.ankorsProductId && !isAnkorstorePublishing
                    ? () => setActionModalAk(true)
                    : undefined
                }
                onSyncClick={handleSyncAnkorstore}
              />
              {showFaire ? (
                <FaireBadge
                  published={faireBadgeState.online}
                  publishing={isFairePublishing}
                  syncRequired={product.faireSyncRequired && !isFairePublishing && !faireBadgeState.justPublishedOk}
                  lastExportedAt={product.faireLastExportedAt}
                  onActionClick={
                    showFaire && !faireBadgeState.online && !isFairePublishing
                      ? () => setActionModalFaire(true)
                      : undefined
                  }
                  onSyncClick={handleSyncFaire}
                />
              ) : (
                <span className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border leading-tight">
                  Faire
                </span>
              )}
              {/* Microstore : pas d'API → badge neutre, pas de date ni d'action */}
              <span
                className="inline-flex flex-col items-center justify-center gap-px w-[62px] h-[36px] rounded-md text-[10px] font-semibold bg-bg-tertiary text-text-secondary border border-border-strong leading-tight"
                title="Microstore — pas d'API, géré manuellement"
              >
                MC
              </span>
            </div>
          )}
        </td>

        {/* Statut */}
        <td className="hidden md:table-cell px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
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
        <td className="hidden xl:table-cell px-3 py-3 cursor-pointer" onClick={onExpandToggle}>
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
        <td className="px-3 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div ref={actionsRef} className="relative inline-block">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              aria-label="Actions du produit"
              title="Actions"
              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg transition-all ${
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
                expanded={expanded}
                refreshing={refreshing}
                anchorRef={actionsRef}
                eligibility={eligibility}
                ankorstorePublishing={isAnkorstorePublishing}
                pfsPublishing={isPfsPublishing}
                efashionPublishing={isEfashionPublishing}
                fairePublishing={isFairePublishing}
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
                onDelete={() => { setActionsOpen(false); onRowDelete(product.id); }}
              />,
              document.body
            )}
          </div>
        </td>
      </tr>

      {/* ── Tiroir variantes (refonte cockpit) ── */}
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="drawer-variant-container">
              {/* En-tête du tiroir */}
              <div className="drawer-variant-header relative flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-1 h-9 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-700" />
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 mb-0.5">
                      Tiroir variantes
                    </div>
                    <div className="font-heading text-xl font-bold text-text-primary leading-tight">
                      {product.colors.length} variante{product.colors.length > 1 ? "s" : ""}
                      <span className="ml-2 text-text-muted font-normal text-sm font-body">
                        · cliquez sur un chiffre pour l'éditer
                      </span>
                    </div>
                  </div>
                </div>
                <Link
                  href={`/admin/produits/${product.id}/modifier`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors no-underline"
                >
                  Édition complète
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              </div>

              {/* Table des variantes */}
              <div className="drawer-variant-table-wrap">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="drawer-variant-th">
                      <th className="px-4 py-3 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Couleur</th>
                      <th className="px-4 py-3 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Type</th>
                      <th className="px-4 py-3 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Tailles</th>
                      <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Prix HT</th>
                      <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Stock</th>
                      <th className="px-4 py-3 text-right font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Poids</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.colors.map((variant) => (
                      <VariantRow
                        key={variant.id}
                        variant={variant}
                        editsForVariant={dirtyEdits[variant.id] ?? {}}
                        onCommitCell={onCommitCell}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Bandeau apply/cancel : géré globalement au niveau AdminProductsTable */}
            </div>
          </td>
        </tr>
      )}

      {/* ⚠️ Modales rendues via createPortal sur document.body : sinon elles
          sortent en tant que <div> direct enfant de <tbody>, ce qui est
          invalide en HTML et déclenche une hydration error côté Next 16. */}
      {linkPfsOpen && createPortal(
        <LinkPfsProductModal
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

      {/* Modales « Publier / Lier » pour chaque marketplace — ouvertes par
          clic sur le badge marketplace correspondant quand le produit n'y
          est pas encore. */}
      <MarketplaceActionModal
        open={actionModalPfs}
        marketplaceName="Paris Fashion Shop"
        marketplaceCode="PFS"
        productLabel={`${product.name} · ${product.reference}`}
        canCreate={eligibility.canPublishPfs && !isPfsPublishing}
        canLink={hasPfsConfig && !product.pfsProductId && !isPfsPublishing}
        createDisabledReason={eligibility.canPublishPfs ? undefined : "Fiche incomplète ou marketplace non configurée"}
        onClose={() => setActionModalPfs(false)}
        onCreate={() => { setActionModalPfs(false); void handlePublishPfs(); }}
        onLink={() => { setActionModalPfs(false); setLinkPfsOpen(true); }}
      />
      <MarketplaceActionModal
        open={actionModalAk}
        marketplaceName="Ankorstore"
        marketplaceCode="ANKOR"
        productLabel={`${product.name} · ${product.reference}`}
        canCreate={eligibility.canPublishAnkorstore && !isAnkorstorePublishing}
        canLink={showAnkorstore && !product.ankorsProductId && !isAnkorstorePublishing}
        createDisabledReason={eligibility.canPublishAnkorstore ? undefined : "Fiche incomplète ou marketplace non configurée"}
        onClose={() => setActionModalAk(false)}
        onCreate={() => { setActionModalAk(false); void handlePublishAnkorstore(); }}
        onLink={() => { setActionModalAk(false); setLinkAkOpen(true); }}
      />
      <MarketplaceActionModal
        open={actionModalEf}
        marketplaceName="eFashion Paris"
        marketplaceCode="EF"
        productLabel={`${product.name} · ${product.reference}`}
        canCreate={eligibility.canPublishEfashion && !isEfashionPublishing}
        canLink={showEfashion && !efashionLinked && !isEfashionPublishing}
        createDisabledReason={eligibility.canPublishEfashion ? undefined : "Fiche incomplète ou marketplace non configurée"}
        onClose={() => setActionModalEf(false)}
        onCreate={() => { setActionModalEf(false); void handlePublishEfashion(); }}
        onLink={() => { setActionModalEf(false); setLinkEfOpen(true); }}
      />
      <MarketplaceActionModal
        open={actionModalFaire}
        marketplaceName="Faire"
        marketplaceCode="Faire"
        productLabel={`${product.name} · ${product.reference}`}
        canCreate={!faireBadgeState.online && !isFairePublishing}
        canLink={showFaire && !faireBadgeState.online && !isFairePublishing}
        createDisabledReason={!faireBadgeState.online ? undefined : "Produit déjà publié"}
        onClose={() => setActionModalFaire(false)}
        onCreate={() => { setActionModalFaire(false); void handlePublishFaire(); }}
        onLink={() => { setActionModalFaire(false); setLinkFaireOpen(true); }}
      />
    </>
  );
}

// ─── Table with synchronized top + bottom scrollbar ─────────────────────────────

function TableWithTopScroll({
  products, startIndex, hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, selectedIds, allSelected, toggleSelectAll, toggleSelect, expandedIds, toggleExpand, dirtyEdits, onCommitCell, deletingIds, onRowStatus, onRowDelete, onRowSync,
}: {
  products: AdminProduct[];
  startIndex: number;
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  selectedIds: Set<string>;
  allSelected: boolean;
  toggleSelectAll: () => void;
  toggleSelect: (id: string) => void;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  dirtyEdits: VariantDirtyEdits;
  onCommitCell: (variantId: string, field: VariantField, newValue: number, originalValue: number) => void;
  deletingIds: Set<string>;
  onRowStatus: (productId: string, status: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onRowDelete: (productId: string) => void;
  onRowSync: (productId: string) => void;
}) {
  return (
    <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Table — pas de min-width, les colonnes secondaires disparaissent aux petits breakpoints */}
      <div>
        <table className="w-full text-sm font-body">
          <thead>
            <tr className="table-header">
              <th className="px-4 py-3.5 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="checkbox-custom"
                  title="Tout sélectionner"
                />
              </th>
              <th className="hidden sm:table-cell px-2 py-3.5 w-10 text-center text-[10px] font-bold text-text-muted uppercase tracking-widest">#</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Produit</th>
              <th className="hidden md:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Prix</th>
              <th className="hidden lg:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Marketplaces</th>
              <th className="hidden md:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">État</th>
              <th className="hidden xl:table-cell px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Dates</th>
              <th className="px-3 py-3.5 text-right text-[10px] w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {products.map((product, index) => (
              <ProductRow
                key={product.id}
                product={product}
                rowNumber={startIndex + index + 1}
                hasPfsConfig={hasPfsConfig}
                hasAnkorstoreConfig={hasAnkorstoreConfig}
                ankorstoreEnabled={ankorstoreEnabled}
                hasEfashionConfig={hasEfashionConfig}
                efashionEnabled={efashionEnabled}
                hasFaireConfig={hasFaireConfig}
                faireEnabled={faireEnabled}
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
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  bulkEditOptions,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // ─── Édition inline des variantes ──────────────────────────────────────
  // Le state vit ici (top-level) pour qu'un seul bandeau flottant global
  // affiche le total des modifications, même quand plusieurs tiroirs
  // variantes sont ouverts sur des produits différents.
  const [dirtyEdits, setDirtyEdits] = useState<VariantDirtyEdits>({});
  const [applyingVariantEdits, setApplyingVariantEdits] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { isFiltering } = useFilterPending();
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkPublishDraftsOpen, setBulkPublishDraftsOpen] = useState(false);
  const router = useRouter();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const { confirm } = useConfirm();
  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showEfashion = !!(hasEfashionConfig && efashionEnabled);
  const showFaire = !!(hasFaireConfig && faireEnabled);
  const { refreshBulk } = useRefreshMarketplaceDialog({
    showPfs: hasPfsConfig,
    showAnkorstore,
    showEfashion,
    showFaire,
  });
  const { enqueue: enqueuePfs } = useMarketplaceRefreshQueue();
  const { refresh: refreshEfashionBatch } = useEfashionShootingBatch();
  const toast = useToast();
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  // Libellé de l'action bulk en cours (« Traduction… », « Suppression… », etc.).
  // Alimente à la fois le badge dans BulkActionBar et le voile posé sur le
  // tableau. `null` quand aucune action n'est en cours.
  const [bulkActionLabel, setBulkActionLabel] = useState<string | null>(null);

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
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Handlers édition inline (global) ─────────────────────────────────
  const handleCommitCell = useCallback(
    (variantId: string, field: VariantField, newValue: number, originalValue: number) => {
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
          if (changes.price !== undefined) data.unitPrice = changes.price;
          if (changes.stock !== undefined) data.stock = changes.stock;
          if (changes.weight !== undefined) data.weight = changes.weight;
          if (changes.packQty !== undefined) {
            data.packQuantity = variant.saleType === "PACK" ? changes.packQty : null;
          }
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
      const { affectedProducts, pfsProducts, ankorsProducts, efashionProducts, faireProducts } =
        computeBulkVariantMarketplaceTargets(allProducts, variantIds, {
          hasPfsConfig,
          showAnkorstore,
          showEfashion,
          showFaire,
        });

      if (
        pfsProducts.length === 0 &&
        ankorsProducts.length === 0 &&
        efashionProducts.length === 0 &&
        faireProducts.length === 0
      ) {
        return;
      }

      const pfsRef = { current: pfsProducts.length > 0 };
      const ankorsRef = { current: ankorsProducts.length > 0 };
      const efashionRef = { current: efashionProducts.length > 0 };
      const faireRef = { current: faireProducts.length > 0 };
      const checkboxes: {
        id: string;
        label: string;
        defaultChecked: boolean;
        onChange: (v: boolean) => void;
      }[] = [];
      if (pfsProducts.length > 0) {
        checkboxes.push({
          id: "pfs",
          label: `Mettre à jour sur Paris Fashion Shop (${pfsProducts.length} produit${pfsProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => { pfsRef.current = v; },
        });
      }
      if (ankorsProducts.length > 0) {
        checkboxes.push({
          id: "ankorstore",
          label: `Mettre à jour sur Ankorstore (${ankorsProducts.length} produit${ankorsProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => { ankorsRef.current = v; },
        });
      }
      if (efashionProducts.length > 0) {
        checkboxes.push({
          id: "efashion",
          label: `Mettre à jour sur eFashion Paris (${efashionProducts.length} produit${efashionProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => { efashionRef.current = v; },
        });
      }
      if (faireProducts.length > 0) {
        checkboxes.push({
          id: "faire",
          label: `Mettre à jour sur Faire (${faireProducts.length} produit${faireProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => { faireRef.current = v; },
        });
      }

      const ok = await confirm({
        type: "info",
        title: "Propager aux marketplaces ?",
        message: `${affectedProducts.length} produit${affectedProducts.length > 1 ? "s" : ""} touché${affectedProducts.length > 1 ? "s" : ""} par ces modifications — cochez les marketplaces où l'envoyer.`,
        checkboxesLabel: "Marketplaces",
        checkboxes,
        confirmLabel: "Mettre à jour",
        cancelLabel: "Plus tard",
      });
      if (ok !== true) return;

      const inputs: Parameters<typeof enqueuePfs>[0] = [];
      if (pfsRef.current) {
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
      if (ankorsRef.current) {
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
      if (efashionRef.current) {
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
      if (faireRef.current) {
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
      if (inputs.length > 0) enqueuePfs(inputs);
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
    showAnkorstore,
    showEfashion,
    showFaire,
    confirm,
    enqueuePfs,
    router,
    toast,
  ]);

  // Sélection filtrée sur les brouillons (OFFLINE) — sert au bouton « Publier
  // brouillons sur marketplaces ». Le bouton n'apparaît que si la sélection
  // courante contient au moins un produit OFFLINE.
  const selectedDraftIds = allProducts
    .filter((p) => selectedIds.has(p.id) && p.status === "OFFLINE")
    .map((p) => p.id);

  const handleBulkPublishDraftsConfirm = useCallback(
    async (decision: {
      eligibleIds: string[];
      publishPfs: boolean;
      publishAnkorstore: boolean;
      publishEfashion: boolean;
      publishFaire: boolean;
      efashionEligibleIds: string[];
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

      setSelectedIds(new Set());
      router.refresh();
    },
    [
      allProducts,
      enqueuePfs,
      hasPfsConfig,
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
          const result = await bulkUpdateProductStatus(ids, status);
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

      if (
        pfsCandidates.length > 0 ||
        ankorsCandidates.length > 0 ||
        efashionCandidates.length > 0 ||
        faireCandidates.length > 0
      ) {
        const pfsRef = { current: pfsCandidates.length > 0 };
        const ankorsRef = { current: ankorsCandidates.length > 0 };
        const efashionRef = { current: efashionCandidates.length > 0 };
        const faireRef = { current: faireCandidates.length > 0 };
        const checkboxes: {
          id: string;
          label: string;
          defaultChecked: boolean;
          onChange: (v: boolean) => void;
        }[] = [];
        if (pfsCandidates.length > 0) {
          checkboxes.push({
            id: "pfs",
            label: `Mettre à jour sur Paris Fashion Shop (${pfsCandidates.length} sur ${successIds.length})`,
            defaultChecked: true,
            onChange: (v) => {
              pfsRef.current = v;
            },
          });
        }
        if (ankorsCandidates.length > 0) {
          checkboxes.push({
            id: "ankorstore",
            label: `Mettre à jour sur Ankorstore (${ankorsCandidates.length} sur ${successIds.length})`,
            defaultChecked: true,
            onChange: (v) => {
              ankorsRef.current = v;
            },
          });
        }
        if (efashionCandidates.length > 0) {
          checkboxes.push({
            id: "efashion",
            label: `Mettre à jour sur eFashion Paris (${efashionCandidates.length} sur ${successIds.length})`,
            defaultChecked: true,
            onChange: (v) => {
              efashionRef.current = v;
            },
          });
        }
        if (faireCandidates.length > 0) {
          checkboxes.push({
            id: "faire",
            label: `Mettre à jour sur Faire (${faireCandidates.length} sur ${successIds.length})`,
            defaultChecked: true,
            onChange: (v) => {
              faireRef.current = v;
            },
          });
        }

        const ok = await confirm({
          type: "info",
          title: `Propager aux marketplaces ?`,
          message: `Le nouveau statut sera appliqué sur les marketplaces cochées pour les produits déjà publiés.`,
          checkboxesLabel: "Marketplaces",
          checkboxes,
          confirmLabel: "Mettre à jour",
          cancelLabel: "Plus tard",
        });
        if (ok === true) {
          const inputs: Parameters<typeof enqueuePfs>[0] = [];
          if (pfsRef.current) {
            for (const p of pfsCandidates) {
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
          }
          if (ankorsRef.current) {
            for (const p of ankorsCandidates) {
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
          }
          if (efashionRef.current) {
            for (const p of efashionCandidates) {
              inputs.push({
                productId: p.id,
                reference: p.reference,
                productName: p.name,
                firstImage: p.firstImage,
                options: { local: false, pfs: false, ankorstore: false, efashion: true },
                mode: "publish" as const,
                marketplace: "efashion" as const,
              });
            }
          }
          if (faireRef.current) {
            for (const p of faireCandidates) {
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
        }
      }
    }
  }, [selectedIds, startTransition, confirm, allProducts, enqueuePfs, hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, router]);

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

    if (
      pfsCandidates.length === 0 &&
      ankorsCandidates.length === 0 &&
      efashionCandidates.length === 0 &&
      faireCandidates.length === 0
    )
      return;

    const pfsRef = { current: pfsCandidates.length > 0 };
    const ankorsRef = { current: ankorsCandidates.length > 0 };
    const efashionRef = { current: efashionCandidates.length > 0 };
    const faireRef = { current: faireCandidates.length > 0 };
    const checkboxes: {
      id: string;
      label: string;
      defaultChecked: boolean;
      onChange: (v: boolean) => void;
    }[] = [];
    if (pfsCandidates.length > 0) {
      checkboxes.push({
        id: "pfs",
        label: `Mettre à jour sur Paris Fashion Shop (${pfsCandidates.length} sur ${successIds.length})`,
        defaultChecked: true,
        onChange: (v) => { pfsRef.current = v; },
      });
    }
    if (ankorsCandidates.length > 0) {
      checkboxes.push({
        id: "ankorstore",
        label: `Mettre à jour sur Ankorstore (${ankorsCandidates.length} sur ${successIds.length})`,
        defaultChecked: true,
        onChange: (v) => { ankorsRef.current = v; },
      });
    }
    if (efashionCandidates.length > 0) {
      checkboxes.push({
        id: "efashion",
        label: `Mettre à jour sur eFashion Paris (${efashionCandidates.length} sur ${successIds.length})`,
        defaultChecked: true,
        onChange: (v) => { efashionRef.current = v; },
      });
    }
    if (faireCandidates.length > 0) {
      checkboxes.push({
        id: "faire",
        label: `Mettre à jour sur Faire (${faireCandidates.length} sur ${successIds.length})`,
        defaultChecked: true,
        onChange: (v) => { faireRef.current = v; },
      });
    }

    const ok = await confirm({
      type: "info",
      title: "Propager aux marketplaces ?",
      message: "Les modifications seront envoyées sur les marketplaces cochées pour les produits déjà publiés.",
      checkboxesLabel: "Marketplaces",
      checkboxes,
      confirmLabel: "Mettre à jour",
      cancelLabel: "Plus tard",
    });
    if (ok !== true) return;

    const inputs: Parameters<typeof enqueuePfs>[0] = [];
    if (pfsRef.current) {
      for (const p of pfsCandidates) {
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
    }
    if (ankorsRef.current) {
      for (const p of ankorsCandidates) {
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
    }
    if (efashionRef.current) {
      for (const p of efashionCandidates) {
        inputs.push({
          productId: p.id,
          reference: p.reference,
          productName: p.name,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: true },
          mode: "publish" as const,
          marketplace: "efashion" as const,
        });
      }
    }
    if (faireRef.current) {
      for (const p of faireCandidates) {
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
  }, [selectedIds, startTransition, confirm, allProducts, enqueuePfs, hasPfsConfig, showAnkorstore, showEfashion, showFaire]);

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

    const pfsRef = { current: false };
    const ankorsRef = { current: false };
    const efashionRef = { current: false };
    const faireRef = { current: false };

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

    const confirmPfsDelete = pfsRef.current && pfsCandidates.length > 0;
    const confirmAnkorsDelete = ankorsRef.current && ankorsCandidates.length > 0;
    const confirmEfashionDelete = efashionRef.current && efashionCandidates.length > 0;
    const confirmFaireDelete = faireRef.current && faireCandidates.length > 0;

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

        const result = await bulkDeleteProducts(ids);

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
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      } finally {
        setBulkActionLabel(null);
        setDeletingIds(new Set());
      }
    });
  }, [selectedIds, startTransition, confirm, allProducts, hasPfsConfig, showAnkorstore, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, toast, router]);

  // Synchroniser un (ou plusieurs) produit(s) avec les marketplaces : renvoie
  // toutes les données (prix, stock, images, statut, etc.) au même `pfsProductId`
  // / `ankorsProductId` (resync forcée — `forceFullSync: true` côté serveur).
  // eFashion = sync de la visibilité + prix + stock sur chaque couleur liée.
  const handleBulkSync = useCallback(async (idsOverride: string[]) => {
    const ids = idsOverride;
    if (ids.length === 0) return;
    const showEfashion = hasEfashionConfig && efashionEnabled;
    const showFaireLocal = hasFaireConfig && faireEnabled;
    const targets = allProducts.filter((p) => ids.includes(p.id));
    const pfsTargets = hasPfsConfig ? targets.filter((p) => p.pfsProductId) : [];
    const ankorsTargets = showAnkorstore ? targets.filter((p) => p.ankorsProductId) : [];
    const efashionTargets = showEfashion
      ? targets.filter((p) => (p.colors ?? []).some((c) => c.efashionProductId != null))
      : [];
    const faireTargets = showFaireLocal ? targets.filter((p) => p.faireProductId) : [];

    if (
      pfsTargets.length === 0 &&
      ankorsTargets.length === 0 &&
      efashionTargets.length === 0 &&
      faireTargets.length === 0
    ) {
      toast.error("Rien à synchroniser", "Ce produit n'est publié sur aucune marketplace.");
      return;
    }

    const pfsRef = { current: pfsTargets.length > 0 };
    const ankorsRef = { current: ankorsTargets.length > 0 };
    const efashionRef = { current: efashionTargets.length > 0 };
    const faireRef = { current: faireTargets.length > 0 };
    const checkboxes: {
      id: string;
      label: string;
      defaultChecked: boolean;
      onChange: (v: boolean) => void;
    }[] = [];
    if (pfsTargets.length > 0) {
      checkboxes.push({
        id: "pfs",
        label: `Paris Fashion Shop (${pfsTargets.length} produit${pfsTargets.length > 1 ? "s" : ""})`,
        defaultChecked: true,
        onChange: (v) => { pfsRef.current = v; },
      });
    }
    if (ankorsTargets.length > 0) {
      checkboxes.push({
        id: "ankorstore",
        label: `Ankorstore (${ankorsTargets.length} produit${ankorsTargets.length > 1 ? "s" : ""})`,
        defaultChecked: true,
        onChange: (v) => { ankorsRef.current = v; },
      });
    }
    if (efashionTargets.length > 0) {
      checkboxes.push({
        id: "efashion",
        label: `eFashion Paris (${efashionTargets.length} produit${efashionTargets.length > 1 ? "s" : ""})`,
        defaultChecked: true,
        onChange: (v) => { efashionRef.current = v; },
      });
    }
    if (faireTargets.length > 0) {
      checkboxes.push({
        id: "faire",
        label: `Faire (${faireTargets.length} produit${faireTargets.length > 1 ? "s" : ""})`,
        defaultChecked: true,
        onChange: (v) => { faireRef.current = v; },
      });
    }

    const ok = await confirm({
      type: "info",
      title: `Synchroniser ${ids.length} produit${ids.length > 1 ? "s" : ""} avec les marketplaces ?`,
      message:
        "Toutes les informations actuelles (prix, stock, images, statut, etc.) seront renvoyées aux marketplaces cochées. Le produit garde le même identifiant en ligne.",
      checkboxesLabel: "Marketplaces",
      checkboxes,
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    const inputs: Parameters<typeof enqueuePfs>[0] = [];
    if (pfsRef.current) {
      for (const p of pfsTargets) {
        inputs.push({
          productId: p.id,
          reference: p.reference,
          productName: p.name,
          firstImage: p.firstImage,
          options: { local: false, pfs: true },
          mode: "resync" as const,
          marketplace: "pfs" as const,
        });
      }
    }
    if (ankorsRef.current) {
      for (const p of ankorsTargets) {
        inputs.push({
          productId: p.id,
          reference: p.reference,
          productName: p.name,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: true },
          mode: "resync" as const,
          marketplace: "ankorstore" as const,
        });
      }
    }
    if (efashionRef.current) {
      for (const p of efashionTargets) {
        inputs.push({
          productId: p.id,
          reference: p.reference,
          productName: p.name,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: true },
          mode: "resync" as const,
          marketplace: "efashion" as const,
        });
      }
    }
    if (faireRef.current) {
      for (const p of faireTargets) {
        inputs.push({
          productId: p.id,
          reference: p.reference,
          productName: p.name,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
          mode: "resync" as const,
          marketplace: "faire" as const,
        });
      }
    }
    if (inputs.length > 0) enqueuePfs(inputs);
  }, [allProducts, hasPfsConfig, showAnkorstore, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, confirm, enqueuePfs, toast]);

  // ─── Nouveaux handlers pour BulkActionBar ─────────────────────────────
  // Ces handlers alimentent le panneau « Marketplaces » qui liste, pour chaque
  // marketplace configuré, les produits à publier (identifiant marketplace
  // absent + statut ONLINE) ou à synchroniser (drapeau *SyncRequired = true).

  const handleBulkMarketplacePublish = useCallback(async (marketplace: MarketplaceKey, ids: string[]) => {
    if (ids.length === 0) return;
    const count = ids.length;
    const plural = count > 1 ? "s" : "";
    const label = MARKETPLACE_LABEL[marketplace];

    // eFashion : première publication = ticket de shooting, pas d'envoi direct.
    if (marketplace === "efashion") {
      const ok = await confirm({
        type: "info",
        title: `Ajouter ${count} produit${plural} au shooting eFashion ?`,
        message: `Une entrée de shooting sera créée pour chaque produit. L'envoi effectif vers eFashion se validera depuis la fenêtre "eFashion" en bas à droite.`,
        confirmLabel: "Ajouter au shooting",
        cancelLabel: "Annuler",
      });
      if (ok !== true) return;
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

    const asyncNote = marketplace === "ankorstore"
      ? " La publication Ankorstore est asynchrone : le résultat arrivera dans les minutes qui suivent."
      : "";
    const ok = await confirm({
      type: "warning",
      title: `Publier ${count} produit${plural} sur ${label} ?`,
      message: `Une nouvelle fiche sera créée sur ${label} pour chaque produit, avec les infos, photos, prix et stock actuels.${asyncNote}`,
      confirmLabel: "Oui, publier",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;

    const products = allProducts.filter((p) => ids.includes(p.id));
    const options = { local: false, pfs: false, ankorstore: false, efashion: false, faire: false };
    if (marketplace === "pfs") options.pfs = true;
    if (marketplace === "ankorstore") options.ankorstore = true;
    if (marketplace === "faire") options.faire = true;
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
  }, [allProducts, enqueuePfs, toast, refreshEfashionBatch, confirm]);

  const handleBulkMarketplaceSync = useCallback(async (marketplace: MarketplaceKey, ids: string[]) => {
    if (ids.length === 0) return;
    const count = ids.length;
    const plural = count > 1 ? "s" : "";
    const label = MARKETPLACE_LABEL[marketplace];

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
          pfsSyncRequired: p.pfsSyncRequired,
          ankorsSyncRequired: p.ankorsSyncRequired,
          efashionSyncRequired: p.efashionSyncRequired,
          faireSyncRequired: p.faireSyncRequired,
        }))}
        isPending={isPending}
        pendingLabel={bulkActionLabel}
        marketplaces={{
          pfs: { available: hasPfsConfig },
          ankorstore: { configured: hasAnkorstoreConfig, enabled: ankorstoreEnabled },
          efashion: { configured: hasEfashionConfig, enabled: efashionEnabled },
          faire: { configured: hasFaireConfig, enabled: faireEnabled },
        }}
        onStatus={(status) => handleBulkStatus(status)}
        onDelete={() => handleBulkDelete()}
        onRefresh={handleBulkRefreshCurrent}
        onEditAttributes={() => setBulkEditOpen(true)}
        onTranslateAll={handleBulkTranslateAll}
        onDeselectAll={() => setSelectedIds(new Set())}
        onMarketplacePublish={handleBulkMarketplacePublish}
        onMarketplaceSync={handleBulkMarketplaceSync}
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
        <TableWithTopScroll products={allProducts} startIndex={startIndex} hasPfsConfig={hasPfsConfig} hasAnkorstoreConfig={hasAnkorstoreConfig} ankorstoreEnabled={ankorstoreEnabled} hasEfashionConfig={hasEfashionConfig} efashionEnabled={efashionEnabled} hasFaireConfig={hasFaireConfig} faireEnabled={faireEnabled} selectedIds={selectedIds} allSelected={allSelected} toggleSelectAll={toggleSelectAll} toggleSelect={toggleSelect} expandedIds={expandedIds} toggleExpand={toggleExpand} dirtyEdits={dirtyEdits} onCommitCell={handleCommitCell} deletingIds={deletingIds} onRowStatus={(id, status) => handleBulkStatus(status, [id])} onRowDelete={(id) => handleBulkDelete([id])} onRowSync={(id) => handleBulkSync([id])} />
        <FilterLoadingOverlay visible={isFiltering} />
        <BulkActionOverlay label={bulkActionLabel} />
      </div>

      {/* Bandeau flottant global — apparaît en bas de l'écran dès qu'au moins
          une cellule a bougé dans n'importe quel tiroir variantes ouvert. */}
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
          onCancel={() => setBulkPublishDraftsOpen(false)}
          onConfirm={handleBulkPublishDraftsConfirm}
        />
      )}
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
 * Pastille compacte statut marketplace, utilisée dans la colonne Produit sur
 * mobile + tablette (< lg) où la colonne Marketplaces dédiée est masquée.
 * Non-interactive : simple indicateur. Les actions passent par le menu ⋮.
 */
function MpDot({ label, active, syncRequired }: { label: string; active: boolean; syncRequired: boolean }) {
  const cls = syncRequired && active
    ? "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]"
    : active
      ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]"
      : "bg-bg-secondary text-text-muted border-border";
  return (
    <span className={`inline-flex items-center justify-center px-1.5 h-5 rounded text-[9.5px] font-semibold border leading-none ${cls}`}>
      {label}
    </span>
  );
}
