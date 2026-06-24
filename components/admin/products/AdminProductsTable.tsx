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
  previewProductDeletion,
  updateVariantQuick,
  bulkUpdateVariants,
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
import { findLatestOpForProduct, computeMarketplaceBadgeState } from "@/components/admin/products/marketplaceBadgeState";
import { computeBulkVariantMarketplaceTargets } from "@/lib/bulk-variant-marketplace-targets";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";
// Bouton d'export marketplace : import statique (présent dans la barre d'actions
// qui apparaît à la 1re sélection — un chargement asynchrone créerait un
// clignotement visible, cf. bug "page qui se refresh" rapporté 2026-06-04).
import MarketplaceExportButton from "@/components/admin/products/MarketplaceExportButton";

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
}

export function computeRowActionEligibility(
  product: {
    status: string;
    isIncomplete: boolean;
    pfsProductId: string | null;
    ankorsProductId: string | null;
    efashionLinked?: boolean;
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
  onPublishClick,
  onLinkClick,
  onSyncClick,
}: {
  published: boolean;
  /** Une publication / mise à jour PFS est en cours pour ce produit. */
  publishing?: boolean;
  /** Le produit est lié à PFS mais des modifs locales n'ont pas été propagées. */
  syncRequired?: boolean;
  onPublishClick?: () => void;
  /** Ouvre la modale de liaison vers une fiche PFS existante (mappage couleurs). */
  onLinkClick?: () => void;
  onSyncClick?: () => void;
}) {
  if (publishing) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE]"
        title="Publication PFS en cours…"
      >
        <svg
          className="w-2.5 h-2.5 animate-spin"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        PFS en cours…
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
        title="Publié sur Paris Fashion Shop"
      >
        <span className="w-1 h-1 rounded-full bg-[#22C55E]" />
        PFS
      </span>
    );
  }
  // Non publié : on propose deux actions côte à côte quand elles sont
  // disponibles — "Publier" (créer une nouvelle fiche PFS) et "Lier"
  // (rattacher à une fiche existante). Si seule une callback est passée,
  // on affiche la pastille correspondante.
  if (onPublishClick || onLinkClick) {
    return (
      <span className="inline-flex items-center gap-1">
        {onPublishClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPublishClick();
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] transition-colors cursor-pointer"
            title="Cliquer pour publier ce produit sur Paris Fashion Shop"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            PFS
          </button>
        )}
        {onLinkClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLinkClick();
            }}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted bg-bg-secondary border border-border hover:border-text-secondary hover:text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
            title="Lier à une fiche Paris Fashion Shop existante"
            aria-label="Lier à une fiche Paris Fashion Shop existante"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
          </button>
        )}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border"
      title="Non publié sur Paris Fashion Shop"
    >
      <span className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
      PFS
    </span>
  );
}

function AnkorstoreBadge({
  published,
  publishing = false,
  syncRequired = false,
  onPublishClick,
  onLinkClick,
  onSyncClick,
}: {
  published: boolean;
  /** Une publication / mise à jour Ankorstore est en cours pour ce produit. */
  publishing?: boolean;
  /** Le produit est lié à Ankorstore mais des modifs locales n'ont pas été propagées. */
  syncRequired?: boolean;
  onPublishClick?: () => void;
  onLinkClick?: () => void;
  onSyncClick?: () => void;
}) {
  if (publishing) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE]"
        title="Publication Ankorstore en cours… (1 à 5 minutes)"
      >
        <svg
          className="w-2.5 h-2.5 animate-spin"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        Ankorstore en cours…
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
        title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à Ankorstore"
      >
        <span className="relative inline-flex">
          <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse" />
          <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping" />
        </span>
        Ankorstore · Synchro
      </button>
    );
  }
  if (published) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
        title="Publié sur Ankorstore"
      >
        <span className="w-1 h-1 rounded-full bg-[#22C55E]" />
        Ankorstore
      </span>
    );
  }
  // Non publié : on propose deux actions côte à côte quand elles sont
  // disponibles — "Publier" (créer une nouvelle fiche Ankorstore) et "Lier"
  // (rattacher à une fiche existante). Si seule une callback est passée,
  // on affiche la pastille correspondante.
  if (onPublishClick || onLinkClick) {
    return (
      <span className="inline-flex items-center gap-1">
        {onPublishClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPublishClick();
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] transition-colors cursor-pointer"
            title="Cliquer pour publier ce produit sur Ankorstore"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Ankorstore
          </button>
        )}
        {onLinkClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLinkClick();
            }}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted bg-bg-secondary border border-border hover:border-text-secondary hover:text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
            title="Lier à un produit Ankorstore existant"
            aria-label="Lier à un produit Ankorstore existant"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
          </button>
        )}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border"
      title="Non publié sur Ankorstore"
    >
      <span className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
      Ankorstore
    </span>
  );
}

function EfashionBadge({
  linked,
  publishing = false,
  syncRequired = false,
  onPublishClick,
  onLinkClick,
  onSyncClick,
}: {
  linked: boolean;
  publishing?: boolean;
  /** Le produit est lié à eFashion mais des modifs locales n'ont pas été propagées. */
  syncRequired?: boolean;
  onPublishClick?: () => void;
  onLinkClick?: () => void;
  onSyncClick?: () => void;
}) {
  if (publishing) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#C7D2FE]"
        title="Publication eFashion Paris en cours…"
      >
        <svg
          className="w-2.5 h-2.5 animate-spin"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        eFashion en cours…
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
        title="Synchronisation nécessaire — cliquez pour envoyer vos dernières modifications à eFashion Paris"
      >
        <span className="relative inline-flex">
          <span className="w-1 h-1 rounded-full bg-[#F97316] animate-pulse" />
          <span className="absolute inset-0 w-1 h-1 rounded-full bg-[#F97316] opacity-60 animate-ping" />
        </span>
        eFashion · Synchro
      </button>
    );
  }
  if (linked) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
        title="Lié à eFashion Paris"
      >
        <span className="w-1 h-1 rounded-full bg-[#22C55E]" />
        eFashion
      </span>
    );
  }
  if (onPublishClick || onLinkClick) {
    return (
      <span className="inline-flex items-center gap-1">
        {onPublishClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPublishClick();
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] transition-colors cursor-pointer"
            title="Cliquer pour publier ce produit sur eFashion Paris"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            eFashion
          </button>
        )}
        {onLinkClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLinkClick();
            }}
            className="inline-flex items-center justify-center w-5 h-5 rounded text-text-muted bg-bg-secondary border border-border hover:border-text-secondary hover:text-text-secondary hover:bg-bg-tertiary transition-colors cursor-pointer"
            title="Lier à un produit eFashion Paris existant"
            aria-label="Lier à un produit eFashion Paris existant"
          >
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
          </button>
        )}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border"
      title="Non lié à eFashion Paris"
    >
      <span className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
      eFashion
    </span>
  );
}

function FaireBadge({
  published,
  publishing = false,
  syncRequired = false,
  onPublishClick,
  onSyncClick,
}: {
  published: boolean;
  publishing?: boolean;
  syncRequired?: boolean;
  onPublishClick?: () => void;
  onSyncClick?: () => void;
}) {
  if (publishing) {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FCE7F3] text-[#9D174D] border border-[#FBCFE8]"
        title="Publication Faire en cours…"
      >
        <svg
          className="w-2.5 h-2.5 animate-spin"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
        </svg>
        Faire en cours…
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FFF7ED] text-[#9A3412] border border-[#FED7AA] hover:bg-[#FFEDD5] transition-colors cursor-pointer"
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
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]"
        title="Publié sur Faire"
      >
        <span className="w-1 h-1 rounded-full bg-[#22C55E]" />
        Faire
      </span>
    );
  }
  if (onPublishClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPublishClick();
        }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] hover:bg-[#FEE2E2] transition-colors cursor-pointer"
        title="Cliquer pour publier ce produit sur Faire"
      >
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Faire
      </button>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-muted border border-border"
      title="Non publié sur Faire"
    >
      <span className="w-1 h-1 rounded-full bg-[#9CA3AF]" />
      Faire
    </span>
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
  faireProductId: string | null;
  /** Drapeaux « Synchronisation nécessaire » pilotés par le save produit et le
   *  worker image. Affiche un badge orange cliquable pour pousser la modif. */
  pfsSyncRequired: boolean;
  ankorsSyncRequired: boolean;
  efashionSyncRequired: boolean;
  faireSyncRequired: boolean;
  /** Dates du dernier export Excel/ZIP réussi par marketplace (null = jamais
   *  exporté). Affichées en petite ligne sous chaque badge marketplace. */
  pfsLastExportedAt: string | null;
  efashionLastExportedAt: string | null;
  microstoreLastExportedAt: string | null;
  ankorstoreLastExportedAt: string | null;
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

// ─── Variant Editor Row ────────────────────────────────────────────────────────

function VariantRow({
  variant,
  product,
  hasPfsConfig,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  checked,
  onCheck,
  onSaved,
}: {
  variant: ColorVariant;
  product: AdminProduct;
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  checked: boolean;
  onCheck: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(variant.unitPrice));
  const [stock, setStock] = useState(String(variant.stock));
  const [weight, setWeight] = useState(String(variant.weight));
  const [packQuantity, setPackQuantity] = useState(String(variant.packQuantity ?? ""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { confirm } = useConfirm();
  const { enqueue } = useMarketplaceRefreshQueue();

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await updateVariantQuick(variant.id, {
        unitPrice: parseFloat(price) || 0,
        stock: parseInt(stock) || 0,
        weight: parseFloat(weight) || 0,
        packQuantity: variant.saleType === "PACK" ? (parseInt(packQuantity) || null) : null,
      });
      setEditing(false);
      onSaved();

      // Propose la mise a jour marketplaces avec cases a cocher (PFS + AS + eFashion + Faire).
      const pfsAvailable = hasPfsConfig && !!product.pfsProductId;
      const ankorsAvailable =
        hasAnkorstoreConfig && ankorstoreEnabled && !!product.ankorsProductId;
      const efashionAvailable =
        hasEfashionConfig && efashionEnabled &&
        product.colors.some((c) => c.efashionProductId != null);
      const faireAvailable =
        hasFaireConfig && faireEnabled && !!product.faireProductId;
      if (pfsAvailable || ankorsAvailable || efashionAvailable || faireAvailable) {
        const pfsRef = { current: pfsAvailable };
        const ankorsRef = { current: ankorsAvailable };
        const efashionRef = { current: efashionAvailable };
        const faireRef = { current: faireAvailable };
        const checkboxes: {
          id: string;
          label: string;
          defaultChecked: boolean;
          onChange: (v: boolean) => void;
        }[] = [];
        if (pfsAvailable) {
          checkboxes.push({
            id: "pfs",
            label: "Mettre à jour sur Paris Fashion Shop",
            defaultChecked: true,
            onChange: (v) => {
              pfsRef.current = v;
            },
          });
        }
        if (ankorsAvailable) {
          checkboxes.push({
            id: "ankorstore",
            label: "Mettre à jour sur Ankorstore",
            defaultChecked: true,
            onChange: (v) => {
              ankorsRef.current = v;
            },
          });
        }
        if (efashionAvailable) {
          checkboxes.push({
            id: "efashion",
            label: "Mettre à jour sur eFashion Paris",
            defaultChecked: true,
            onChange: (v) => {
              efashionRef.current = v;
            },
          });
        }
        if (faireAvailable) {
          checkboxes.push({
            id: "faire",
            label: "Mettre à jour sur Faire",
            defaultChecked: true,
            onChange: (v) => {
              faireRef.current = v;
            },
          });
        }
        const ok = await confirm({
          type: "info",
          title: "Propager aux marketplaces ?",
          message: `Modification de la variante "${variant.color.name}" — cochez les marketplaces où l'envoyer.`,
          checkboxesLabel: "Marketplaces",
          checkboxes,
          confirmLabel: "Mettre à jour",
          cancelLabel: "Plus tard",
        });
        if (ok === true) {
          const inputs: Parameters<typeof enqueue>[0] = [];
          if (pfsRef.current) {
            inputs.push({
              productId: product.id,
              reference: product.reference,
              productName: product.name,
              firstImage: product.firstImage,
              options: { local: false, pfs: true },
              mode: "publish",
              marketplace: "pfs",
            });
          }
          if (ankorsRef.current) {
            inputs.push({
              productId: product.id,
              reference: product.reference,
              productName: product.name,
              firstImage: product.firstImage,
              options: { local: false, pfs: false, ankorstore: true },
              mode: "publish",
              marketplace: "ankorstore",
            });
          }
          if (efashionRef.current) {
            inputs.push({
              productId: product.id,
              reference: product.reference,
              productName: product.name,
              firstImage: product.firstImage,
              options: { local: false, pfs: false, ankorstore: false, efashion: true },
              mode: "publish",
              marketplace: "efashion",
            });
          }
          if (faireRef.current) {
            inputs.push({
              productId: product.id,
              reference: product.reference,
              productName: product.name,
              firstImage: product.firstImage,
              options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
              mode: "publish",
              marketplace: "faire",
            });
          }
          if (inputs.length > 0) enqueue(inputs);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <tr className={`transition-colors border-t border-border-light ${checked ? "bg-[#EEF2FF]" : "hover:bg-bg-primary/80"}`}
      >
        {/* Checkbox */}
        <td className="pl-5 pr-2 py-2.5 w-10">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="checkbox-custom checkbox-sm"
            title={`Sélectionner ${variant.color.name} — ${product.name}`}
          />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            {(() => {
              const mainHex = variant.color.hex ?? "#9CA3AF";
              const fullName = variant.color.name;
              const swatchStyle: React.CSSProperties = variant.color.patternImage
                ? { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { backgroundColor: mainHex };
              return (
                <>
                  <span
                    className="w-5 h-5 rounded-full shrink-0"
                    style={{
                      ...swatchStyle,
                      border: '2px solid #fff',
                      boxShadow: '0 0 0 1px #D1D1D1, 0 1px 2px rgba(0,0,0,0.08)',
                    }}
                    title={fullName}
                  />
                  <span className="text-xs font-medium font-body text-text-primary">
                    {fullName}
                  </span>
                </>
              );
            })()}
          </div>
        </td>
        <td className="px-3 py-2.5 text-xs font-body">
          <span className={`badge text-[10px] ${variant.saleType === "UNIT" ? "badge-info" : "badge-purple"}`}>
            {variant.saleType === "UNIT" ? "Unité" : `Pack ×${variant.packQuantity}`}
          </span>
          {variant.variantSizes && variant.variantSizes.length > 0 && (
            <span className="badge badge-neutral text-[10px] ml-1.5">
              {variant.variantSizes.map(vs => vs.quantity > 1 ? `${vs.size.name}\u00D7${vs.quantity}` : vs.size.name).join(", ")}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs font-body font-semibold text-text-primary">
          {Number(variant.unitPrice).toFixed(2)} €
        </td>
        <td className="px-3 py-2.5 text-xs font-body">
          {variant.stock === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[#DC2626] font-bold">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#DC2626', display: 'inline-block' }} className="animate-pulse" />
              {variant.stock}
            </span>
          ) : variant.stock <= 5 ? (
            <span className="inline-flex items-center gap-1.5 text-[#D97706] font-semibold">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D97706', display: 'inline-block' }} />
              {variant.stock}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[#16A34A] font-medium">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
              {variant.stock}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs font-body text-text-secondary">
          {variant.weight} kg
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium font-body transition-all px-2.5 py-1 bg-bg-primary text-text-secondary border border-border-dark rounded-md shadow-sm hover:border-text-primary hover:text-text-primary"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Modifier
          </button>
        </td>
      </tr>
    );
  }

  // ── Mode édition ──
  const inputClass = "variant-input w-full";


  return (
    <>
      <tr className="border-t-[1.5px] border-t-[#FDE68A] bg-[#FFFBEB]">
        <td className="pl-5 pr-2 py-2.5 w-10">
          <input type="checkbox" checked={checked} onChange={onCheck} className="checkbox-custom checkbox-sm" />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="w-5 h-5 rounded-full shrink-0"
              style={{
                ...(variant.color.patternImage
                  ? { backgroundImage: `url(${variant.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { backgroundColor: variant.color.hex ?? "#9CA3AF" }),
                border: '2px solid #fff', boxShadow: '0 0 0 1px #D1D1D1',
              }}
            />
            <span className="text-xs font-medium font-body text-text-primary">
              {variant.color.name}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className={`badge text-[10px] ${variant.saleType === "UNIT" ? "badge-info" : "badge-purple"}`}>
              {variant.saleType === "UNIT" ? "Unité" : "Pack"}
            </span>
            {variant.saleType === "PACK" && (
              <input type="number" min={2} value={packQuantity} onChange={(e) => setPackQuantity(e.target.value)} placeholder="Qté" className={`${inputClass} !w-14`} title="Quantité par paquet" />
            )}
            {variant.variantSizes && variant.variantSizes.length > 0 && (
              <span className="badge badge-neutral text-[10px]">
                {variant.variantSizes.map(vs => vs.quantity > 1 ? `${vs.size.name}\u00D7${vs.quantity}` : vs.size.name).join(", ")}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={`${inputClass} !w-20`} />
        </td>
        <td className="px-3 py-2.5">
          <input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} className={`${inputClass} !w-16`} />
        </td>
        <td className="px-3 py-2.5">
          <input type="number" step="0.01" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} className={`${inputClass} !w-16`} />
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`inline-flex items-center gap-1 font-body transition-colors px-3 py-1.5 text-[11px] font-semibold bg-bg-dark text-text-inverse rounded-md border-none ${saving ? "cursor-wait opacity-60" : "cursor-pointer"}`}
            >
              {saving ? (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {saving ? "..." : "OK"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="font-body transition-colors px-2.5 py-1.5 text-[11px] text-text-secondary bg-transparent border-none rounded-md cursor-pointer hover:bg-bg-primary hover:text-text-primary"
            >
              Annuler
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr className="bg-[#FEF2F2]">
          <td colSpan={9} className="px-5 py-2 text-xs font-body text-error">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              {error}
            </div>
          </td>
        </tr>
      )}
    </>
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
  onClose,
  onExpandToggle,
  onRefresh,
  onPutOnline,
  onPutOffline,
  onArchive,
  onSync,
  onPublishPfs,
  onPublishAnkorstore,
  onDelete,
}: {
  productId: string;
  expanded: boolean;
  refreshing: boolean;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  eligibility: RowActionEligibility;
  /** Publication / sync Ankorstore en cours pour ce produit. */
  ankorstorePublishing: boolean;
  /** Publication / sync PFS en cours pour ce produit. */
  pfsPublishing: boolean;
  onClose: () => void;
  onExpandToggle: () => void;
  onRefresh: () => void;
  onPutOnline: () => void;
  onPutOffline: () => void;
  onArchive: () => void;
  onSync: () => void;
  onPublishPfs: () => void;
  onPublishAnkorstore: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Position the menu below (or above if near bottom) the anchor button, aligned right
  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Hauteur estimée du menu — on compte tous les items potentiels
    const menuHeight = 380;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < menuHeight && rect.top > menuHeight;
    setPos({
      top: openAbove ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: rect.right - 200, // 200px = w-50
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

  const itemClass =
    "block w-full text-left px-4 py-2 text-xs font-body text-text-primary hover:bg-bg-tertiary transition-colors no-underline border-none bg-transparent cursor-pointer";
  const itemDisabledClass =
    "block w-full text-left px-4 py-2 text-xs font-body text-text-muted opacity-50 cursor-not-allowed border-none bg-transparent";

  return (
    <div
      ref={menuRef}
      className="w-50 bg-bg-primary border border-border rounded-xl shadow-lg py-1 animate-fadeIn"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999, width: 200 }}
    >
      <Link
        href={`/admin/produits/${productId}/modifier`}
        className={itemClass}
        onClick={onClose}
      >
        Modifier
      </Link>
      <Link
        href={`/fr/produits/${productId}`}
        target="_blank"
        className={itemClass}
        onClick={onClose}
      >
        Voir côté client
      </Link>
      <Link
        href={`/admin/produits/nouveau?dupliquerDe=${productId}`}
        className={itemClass}
        onClick={onClose}
      >
        Dupliquer
      </Link>
      <button
        type="button"
        onClick={onExpandToggle}
        className={itemClass}
      >
        {expanded ? "Masquer les variantes" : "Voir les variantes"}
      </button>

      <div className="border-t border-border my-1" />

      {/* ── Changements de statut ── */}
      {eligibility.canPutOnline ? (
        <button type="button" onClick={onPutOnline} className={itemClass}>
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            Mettre en ligne
          </span>
        </button>
      ) : (
        <span className={itemDisabledClass} title={eligibility.putOnlineReason ?? ""}>
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            Mettre en ligne
          </span>
        </span>
      )}

      {eligibility.canPutOffline ? (
        <button type="button" onClick={onPutOffline} className={itemClass}>
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#9CA3AF]" />
            Mettre hors ligne
          </span>
        </button>
      ) : (
        <span className={itemDisabledClass} title="Déjà hors ligne">
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#9CA3AF]" />
            Mettre hors ligne
          </span>
        </span>
      )}

      {eligibility.canArchive ? (
        <button type="button" onClick={onArchive} className={itemClass}>
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            Archiver
          </span>
        </button>
      ) : (
        <span className={itemDisabledClass} title="Déjà archivé">
          <span className="inline-flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
            Archiver
          </span>
        </span>
      )}

      <div className="border-t border-border my-1" />

      {/* ── Sync marketplaces (différent de "Rafraîchir") ── */}
      {eligibility.canSync && (
        <button type="button" onClick={onSync} className={itemClass}>
          <span className="inline-flex items-center gap-2">
            <svg className="w-3 h-3 text-[#6366F1]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
            Synchroniser
          </span>
        </button>
      )}

      {/* ── Publier sur PFS (uniquement si non encore publié) ── */}
      {eligibility.canPublishPfs && (
        <button
          type="button"
          onClick={onPublishPfs}
          disabled={pfsPublishing}
          className={`${itemClass} ${pfsPublishing ? "opacity-50 cursor-wait" : ""}`}
        >
          <span className="inline-flex items-center gap-2">
            {pfsPublishing ? (
              <svg className="w-3 h-3 text-[#4F46E5] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            )}
            {pfsPublishing ? "Publication PFS en cours…" : "Publier sur Paris Fashion Shop"}
          </span>
        </button>
      )}

      {/* ── Publier sur Ankorstore (uniquement si non encore publié) ── */}
      {eligibility.canPublishAnkorstore && (
        <button
          type="button"
          onClick={onPublishAnkorstore}
          disabled={ankorstorePublishing}
          className={`${itemClass} ${ankorstorePublishing ? "opacity-50 cursor-wait" : ""}`}
        >
          <span className="inline-flex items-center gap-2">
            {ankorstorePublishing ? (
              <svg className="w-3 h-3 text-[#4F46E5] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
              </svg>
            ) : (
              <svg className="w-3 h-3 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            )}
            {ankorstorePublishing ? "Publication Ankorstore en cours…" : "Publier sur Ankorstore"}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className={`${itemClass} ${refreshing ? "opacity-50 cursor-wait" : ""}`}
      >
        {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
      </button>

      <div className="border-t border-border my-1" />

      {/* ── Suppression ── */}
      <button
        type="button"
        onClick={onDelete}
        className="block w-full text-left px-4 py-2 text-xs font-body text-red-600 hover:bg-red-50 transition-colors border-none bg-transparent cursor-pointer"
      >
        Supprimer
      </button>
    </div>
  );
}

// ─── Dates Cell ────────────────────────────────────────────────────────────────

/**
 * Formate une date pour la cellule compacte du tableau produits :
 *   - aujourd'hui → "auj."
 *   - hier → "hier"
 *   - moins de 7 jours → "il y a Nj"
 *   - même année → "12 juin"
 *   - sinon → "12 juin 2025"
 *
 * Exporté pour les tests unitaires.
 */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const msPerDay = 86_400_000;
  // Comparaison "jour calendaire" pour ne pas dépendre de l'heure.
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / msPerDay);
  if (diffDays === 0) return "auj.";
  if (diffDays === 1) return "hier";
  if (diffDays > 1 && diffDays < 7) return `il y a ${diffDays}j`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("fr-FR", sameYear
    ? { day: "2-digit", month: "short" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Petite ligne « Exporté il y a Xj » / « Jamais exporté » sous un badge
 * marketplace. Si `lastExportedAt` est fourni, l'icône reprend l'accent du
 * badge (vert tendre = récent). Sinon, gris italique discret.
 *
 * Volontairement compact pour ne pas alourdir le tableau : on cible la même
 * hauteur de ligne que le badge sync-required (~16px).
 */
export function MarketplaceExportedAtChip({
  lastExportedAt,
  marketplaceLabel,
}: {
  lastExportedAt: string | null;
  marketplaceLabel: string;
}) {
  if (!lastExportedAt) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-body italic text-text-muted/80 whitespace-nowrap"
        title={`Jamais exporté vers ${marketplaceLabel} depuis l'admin.`}
      >
        <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Jamais exporté
      </span>
    );
  }
  const longFmt = new Date(lastExportedAt).toLocaleString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-body font-medium text-emerald-700 whitespace-nowrap"
      title={`Dernier export vers ${marketplaceLabel} le ${longFmt}.`}
    >
      <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
      Exporté <span className="tabular-nums">{formatRelativeDate(lastExportedAt)}</span>
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
}: {
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
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
    <div className="flex flex-col gap-1 min-w-[110px]">
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
  selectedVariantIds,
  onToggleVariant,
  onToggleAllVariants,
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
  selectedVariantIds: Set<string>;
  onToggleVariant: (id: string) => void;
  onToggleAllVariants: (ids: string[], select: boolean) => void;
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

  const variantIds = product.colors.map((c) => c.id);
  const allVariantsSelected = variantIds.length > 0 && variantIds.every((id) => selectedVariantIds.has(id));

  const eligibility = computeRowActionEligibility(
    { ...product, efashionLinked },
    {
      hasPfsConfig,
      hasAnkorstoreConfig,
      ankorstoreEnabled,
      hasEfashionConfig,
      efashionEnabled,
    },
  );

  return (
    <>
      <tr
        className={`table-row transition-all duration-150 ${selected ? "bg-[#EEF2FF]" : ""} ${expanded ? "border-b-0" : ""} ${isDeleting ? "opacity-50 pointer-events-none" : ""}`}
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
        <td className="px-2 py-3.5 w-10 text-center cursor-pointer" onClick={onExpandToggle}>
          <span className="font-body text-[11px] text-text-muted tabular-nums">{rowNumber}</span>
        </td>

        {/* Photo — click direct vers la page d'édition (sinon le td ouvre le drawer) */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <Link
            href={`/admin/produits/${product.id}/modifier`}
            onClick={(e) => e.stopPropagation()}
            className="inline-block"
            aria-label={`Modifier ${product.name}`}
          >
            {product.firstImage ? (
              <img
                src={product.firstImage}
                alt={product.name}
                className="w-12 h-12 object-cover rounded-xl border border-border shadow-sm"
              />
            ) : (
              <div className="w-12 h-12 bg-bg-tertiary rounded-xl flex items-center justify-center border border-border">
                <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 9V7.5a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 21z" />
                </svg>
              </div>
            )}
          </Link>
        </td>

        {/* Référence — la pastille redirige vers l'édition, le reste de la cellule ouvre le drawer */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
          <div className="inline-flex items-center gap-1.5">
            <Link
              href={`/admin/produits/${product.id}/modifier`}
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-[11px] bg-bg-tertiary px-2 py-1 rounded-md text-text-secondary whitespace-nowrap border border-border-light hover:bg-bg-secondary hover:text-text-primary transition-colors"
              aria-label={`Modifier ${product.name}`}
            >
              {product.reference}
            </Link>
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
              className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-border-light bg-bg-primary text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
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
            <span onClick={(e) => e.stopPropagation()} className="inline-flex">
              <ProductLockToggle
                productId={product.id}
                initialLocked={product.locked}
                variant="icon"
              />
            </span>
          </div>
        </td>

        {/* Produit — nom, catégorie › sous-cat, couleurs + prix mini (fusion des
            anciennes colonnes Nom, Catégorie, Couleurs pour économiser de la
            largeur horizontale). */}
        <td className="px-3 py-3 cursor-pointer min-w-[260px] max-w-[420px]" onClick={onExpandToggle}>
          <div className="flex flex-col gap-1">
            {/* Ligne 1 : nom + badge traductions manquantes */}
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="font-semibold text-text-primary text-sm truncate" title={product.name}>{product.name}</p>
              {hasMissingTranslations && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-300 text-amber-700 text-[9px] font-bold shrink-0" title={`Traductions manquantes: ${missingLocales.join(", ")}`}>
                  ⓘ
                </span>
              )}
            </div>
            {/* Ligne 2 : catégorie › sous-catégorie en breadcrumb */}
            <p className="text-[11px] text-text-muted font-body leading-tight truncate" title={product.subCategoryName ? `${product.categoryName} › ${product.subCategoryName}` : product.categoryName}>
              <span className="text-text-secondary font-medium">{product.categoryName}</span>
              {product.subCategoryName && (
                <>
                  <span className="mx-1 text-text-muted">›</span>
                  <span>{product.subCategoryName}</span>
                </>
              )}
            </p>
            {/* Ligne 3 : couleurs (max 5 puis compteur) + prix mini, séparés par un point */}
            <div className="flex items-center gap-2 flex-nowrap">
              {uniqueColors.length > 0 && (
                <div className="flex items-center gap-0.5 flex-nowrap shrink-0">
                  {uniqueColors.slice(0, 5).map((c) => {
                    const mainHex = c.color.hex ?? "#9CA3AF";
                    const swatchStyle: React.CSSProperties = c.color.patternImage
                      ? { backgroundImage: `url(${c.color.patternImage})`, backgroundSize: "cover", backgroundPosition: "center" }
                      : { backgroundColor: mainHex };
                    return (
                      <span
                        key={c.colorId}
                        title={c.color.name}
                        className="inline-block w-4 h-4 rounded-full shrink-0"
                        style={{
                          ...swatchStyle,
                          border: '1.5px solid #fff',
                          boxShadow: '0 0 0 1px #D1D5DB',
                        }}
                      />
                    );
                  })}
                  {uniqueColors.length > 5 && (
                    <span className="ml-1 text-[10px] text-text-muted font-semibold whitespace-nowrap">+{uniqueColors.length - 5}</span>
                  )}
                </div>
              )}
              {!isNaN(minPrice) && (
                <>
                  {uniqueColors.length > 0 && <span className="text-text-muted text-[10px]">·</span>}
                  <p className="text-[11px] text-text-muted whitespace-nowrap">
                    dès <span className="font-semibold text-text-secondary tabular-nums">{minPrice.toFixed(2)} €</span>
                  </p>
                </>
              )}
            </div>
          </div>
        </td>

        {/* Statut */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
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
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                  product.status === "ONLINE"
                    ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]"
                    : product.status === "SYNCING"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : product.status === "ARCHIVED"
                    ? "bg-[#FFF7ED] text-[#C2410C] border-[#FED7AA]"
                    : "bg-bg-secondary text-text-secondary border-border"
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    product.status === "ONLINE" ? "bg-[#22C55E]"
                    : product.status === "SYNCING" ? "bg-blue-500 animate-pulse"
                    : product.status === "ARCHIVED" ? "bg-[#F59E0B]"
                    : "bg-[#9CA3AF]"
                  }`} />
                  {product.status === "ONLINE" ? "En ligne"
                    : product.status === "SYNCING" ? "Importation en cours depuis Paris Fashion Shop"
                    : product.status === "ARCHIVED" ? "Archivé"
                    : "Hors ligne"}
                </span>
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

        {/* Marketplaces */}
        <td className="px-3 py-3.5 cursor-pointer" onClick={onExpandToggle}>
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
            <div className="flex flex-col gap-1.5 items-start">
              <div className="flex flex-col gap-0.5 items-start">
                <MarketplaceBadge
                  published={!!product.pfsProductId}
                  publishing={isPfsPublishing}
                  syncRequired={product.pfsSyncRequired && !isPfsPublishing}
                  onPublishClick={
                    eligibility.canPublishPfs && !isPfsPublishing
                      ? () => { void handlePublishPfs(); }
                      : undefined
                  }
                  onLinkClick={
                    // On expose le bouton "Lier" seulement quand PFS est configuré,
                    // que le produit n'est pas déjà lié, et qu'aucune publication
                    // n'est en cours (même grammaire que Ankorstore/eFashion).
                    hasPfsConfig && !product.pfsProductId && !isPfsPublishing
                      ? () => setLinkPfsOpen(true)
                      : undefined
                  }
                  onSyncClick={handleSyncPfs}
                />
                <MarketplaceExportedAtChip
                  lastExportedAt={product.pfsLastExportedAt}
                  marketplaceLabel="Paris Fashion Shop"
                />
              </div>
              <div className="flex flex-col gap-0.5 items-start">
                <AnkorstoreBadge
                  published={!!product.ankorsProductId}
                  publishing={isAnkorstorePublishing}
                  syncRequired={product.ankorsSyncRequired && !isAnkorstorePublishing}
                  onPublishClick={
                    eligibility.canPublishAnkorstore && !isAnkorstorePublishing
                      ? () => { void handlePublishAnkorstore(); }
                      : undefined
                  }
                  onLinkClick={
                    showAnkorstore && !product.ankorsProductId && !isAnkorstorePublishing
                      ? () => setLinkAkOpen(true)
                      : undefined
                  }
                  onSyncClick={handleSyncAnkorstore}
                />
                <MarketplaceExportedAtChip
                  lastExportedAt={product.ankorstoreLastExportedAt}
                  marketplaceLabel="Ankorstore"
                />
              </div>
              {showEfashion && (
                <div className="flex flex-col gap-0.5 items-start">
                  <EfashionBadge
                    linked={efashionLinked}
                    publishing={isEfashionPublishing}
                    syncRequired={product.efashionSyncRequired && !isEfashionPublishing}
                    onPublishClick={
                      eligibility.canPublishEfashion && !isEfashionPublishing
                        ? () => { void handlePublishEfashion(); }
                        : undefined
                    }
                    onLinkClick={
                      showEfashion && !efashionLinked && !isEfashionPublishing
                        ? () => setLinkEfOpen(true)
                        : undefined
                    }
                    onSyncClick={handleSyncEfashion}
                  />
                  <MarketplaceExportedAtChip
                    lastExportedAt={product.efashionLastExportedAt}
                    marketplaceLabel="eFashion"
                  />
                </div>
              )}
              {!showEfashion && (
                <div className="flex flex-col gap-0.5 items-start">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-secondary border border-border">
                    eFashion
                  </span>
                  <MarketplaceExportedAtChip
                    lastExportedAt={product.efashionLastExportedAt}
                    marketplaceLabel="eFashion"
                  />
                </div>
              )}
              {/* Microstore : pas de badge "lié" (export Excel uniquement), seulement la trace
                  de la dernière vente Excel. Toujours affiché pour la cohérence avec le filtre. */}
              <div className="flex flex-col gap-0.5 items-start">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-bg-secondary text-text-secondary border border-border">
                  Microstore
                </span>
                <MarketplaceExportedAtChip
                  lastExportedAt={product.microstoreLastExportedAt}
                  marketplaceLabel="Microstore"
                />
              </div>
              {showFaire && (
                <FaireBadge
                  published={!!product.faireProductId}
                  publishing={isFairePublishing}
                  syncRequired={product.faireSyncRequired && !isFairePublishing}
                  onPublishClick={
                    !product.faireProductId && !isFairePublishing
                      ? () => { void handlePublishFaire(); }
                      : undefined
                  }
                  onSyncClick={handleSyncFaire}
                />
              )}
            </div>
          )}
        </td>

        {/* Dates — Créé / Modifié / Rafraîchi sur 3 lignes, ligne masquée si
            l'info est vide ou égale à la création (évite le bruit visuel). */}
        <td className="px-3 py-3 cursor-pointer" onClick={onExpandToggle}>
          <ProductDatesCell
            createdAt={product.createdAt}
            updatedAt={product.updatedAt}
            lastRefreshedAt={product.lastRefreshedAt}
          />
        </td>

        {/* Actions */}
        <td className="px-3 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
          <div ref={actionsRef} className="relative inline-block">
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:border-border-dark hover:text-text-primary transition-all shadow-sm"
            >
              Actions
              <svg className={`w-3 h-3 transition-transform duration-200 ${actionsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
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
                onDelete={() => { setActionsOpen(false); onRowDelete(product.id); }}
              />,
              document.body
            )}
          </div>
        </td>
      </tr>

      {/* ── Tiroir variantes ── */}
      {expanded && (
        <tr>
          <td colSpan={9} className="p-0">
            <div className="drawer-variant-container" style={{ position: 'relative' }}>
              {/* En-tête du tiroir */}
              <div
                className="flex items-center justify-between drawer-variant-header"
                style={{ padding: '12px 20px' }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-[3px] h-4 rounded-sm bg-bg-dark" />
                    <span className="font-heading text-[11px] font-bold text-text-primary uppercase tracking-wider"
                    >
                      {product.colors.length} variante{product.colors.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  {product.colors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onToggleAllVariants(variantIds, !allVariantsSelected)}
                      className={`inline-flex items-center gap-1.5 font-body transition-all px-2.5 py-1 text-[10px] font-semibold rounded-md border cursor-pointer ${
                        allVariantsSelected
                          ? "border-bg-dark bg-bg-dark text-text-inverse"
                          : "border-border-dark bg-bg-primary text-text-secondary"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={allVariantsSelected}
                        readOnly
                        className="checkbox-custom checkbox-sm pointer-events-none"
                        tabIndex={-1}
                      />
                      {allVariantsSelected ? "Désélectionner tout" : "Sélectionner tout"}
                    </button>
                  )}
                </div>
                <Link
                  href={`/admin/produits/${product.id}/modifier`}
                  className="inline-flex items-center gap-1.5 font-body transition-colors text-[11px] text-text-secondary hover:text-text-primary no-underline"
                >
                  Édition complète
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>

              {/* Table des variantes */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="drawer-variant-th">
                    <th className="w-10 py-2 pl-5 pr-2"></th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Couleur</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Type</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Prix HT</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Stock</th>
                    <th className="px-3 py-2 text-left font-body text-[10px] font-bold text-text-muted uppercase tracking-wider">Poids</th>
                    <th className="px-3 py-2 text-right text-[10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {product.colors.map((variant) => (
                    <VariantRow
                      key={variant.id}
                      variant={variant}
                      product={product}
                      hasPfsConfig={hasPfsConfig}
                      hasAnkorstoreConfig={hasAnkorstoreConfig}
                      ankorstoreEnabled={ankorstoreEnabled}
                      hasEfashionConfig={hasEfashionConfig}
                      efashionEnabled={efashionEnabled}
                      hasFaireConfig={hasFaireConfig}
                      faireEnabled={faireEnabled}
                      checked={selectedVariantIds.has(variant.id)}
                      onCheck={() => onToggleVariant(variant.id)}
                      onSaved={() => {}}
                    />
                  ))}
                </tbody>
              </table>
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
    </>
  );
}

// ─── Bulk Variant Edit Bar ──────────────────────────────────────────────────────

const BULK_FIELDS: { value: string; label: string; icon: string }[] = [
  { value: "stock", label: "Stock", icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  { value: "price", label: "Prix HT", icon: "M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { value: "weight", label: "Poids", icon: "M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" },
];

function BulkVariantBar({
  count,
  onApply,
  onClear,
  isPending,
}: {
  count: number;
  onApply: (data: Record<string, unknown>) => void;
  onClear: () => void;
  isPending: boolean;
}) {
  const [field, setField] = useState<string>("stock");
  const [mode, setMode] = useState<"set" | "add">("set");
  const [value, setValue] = useState("");
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);

  const handleApply = () => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;

    if (field === "stock") {
      onApply(mode === "set" ? { stock: Math.max(0, Math.round(numVal)) } : { stock: { increment: Math.round(numVal) } });
    } else if (field === "price") {
      if (mode === "set") onApply({ unitPrice: Math.max(0, numVal) });
      else onApply({ unitPrice: { increment: numVal } });
    } else if (field === "weight") {
      onApply({ weight: Math.max(0, numVal) });
    }
  };

  const barInputStyle: React.CSSProperties = {
    padding: '7px 12px',
    fontSize: '12px',
    fontFamily: 'var(--font-roboto), sans-serif',
    color: '#FFFFFF',
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '8px',
    outline: 'none',
    width: 140,
  };

  return (
    <div
      className="bulk-variant-bar"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#1A1A1A',
        color: '#fff',
        borderRadius: 16,
        padding: '14px 20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {/* Count badge */}
      <div className="flex items-center gap-2">
        <span className="font-heading"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
        <span className="font-body" style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>
          variante{count > 1 ? "s" : ""}
        </span>
      </div>

      <div style={{ height: 24, width: 1, background: 'rgba(255,255,255,0.15)' }} />

      {/* Field selector — custom dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setFieldMenuOpen(!fieldMenuOpen)}
          className="font-body"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 10,
            cursor: 'pointer',
            transition: 'all 0.15s',
            minWidth: 150,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
        >
          <svg className="w-3.5 h-3.5 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={BULK_FIELDS.find(f => f.value === field)?.icon ?? ""} />
          </svg>
          <span className="flex-1 text-left">{BULK_FIELDS.find(f => f.value === field)?.label}</span>
          <svg className={`w-3 h-3 shrink-0 opacity-50 transition-transform duration-200 ${fieldMenuOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {fieldMenuOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setFieldMenuOpen(false)} />
            <div
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                marginBottom: 6,
                minWidth: 200,
                background: '#fff',
                borderRadius: 12,
                boxShadow: '0 12px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)',
                overflow: 'hidden',
                zIndex: 61,
                animation: 'confirmSlideUp 0.15s ease-out',
              }}
            >
              <div style={{ padding: '6px 0' }}>
                {BULK_FIELDS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => { setField(f.value); setValue(""); setFieldMenuOpen(false); }}
                    className="font-body"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '9px 14px',
                      fontSize: 12,
                      fontWeight: field === f.value ? 700 : 500,
                      color: field === f.value ? '#1A1A1A' : '#6B6B6B',
                      background: field === f.value ? '#F7F7F8' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.1s',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { if (field !== f.value) e.currentTarget.style.background = '#F7F7F8'; }}
                    onMouseLeave={(e) => { if (field !== f.value) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} style={{ color: field === f.value ? '#1A1A1A' : '#9CA3AF' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                    </svg>
                    <span className="flex-1">{f.label}</span>
                    {field === f.value && (
                      <svg className="w-3.5 h-3.5 text-[#22C55E]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Mode (set / add) — only for stock & price */}
      {(field === "stock" || field === "price") && (
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
          <button
            type="button"
            onClick={() => setMode("set")}
            className="font-body"
            style={{
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: mode === "set" ? '#fff' : 'transparent',
              color: mode === "set" ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s',
            }}
          >
            Définir
          </button>
          <button
            type="button"
            onClick={() => setMode("add")}
            className="font-body"
            style={{
              padding: '7px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: mode === "add" ? '#fff' : 'transparent',
              color: mode === "add" ? '#1A1A1A' : 'rgba(255,255,255,0.5)',
              transition: 'all 0.15s',
            }}
          >
            +/−
          </button>
        </div>
      )}

      {/* Value input */}
      {(
        <input
          type="number"
          step={field === "stock" ? "1" : "0.01"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            field === "stock" ? (mode === "set" ? "Nouveau stock" : "+10 ou -5")
            : field === "price" ? (mode === "set" ? "Nouveau prix" : "+1.50 ou -0.50")
            : field === "weight" ? "Poids (kg)"
            : "Valeur"
          }
          style={barInputStyle}
        />
      )}

      {/* Apply button */}
      <button
        type="button"
        onClick={handleApply}
        disabled={isPending || (!value)}
        className="flex items-center gap-1.5 font-body"
        style={{
          padding: '7px 16px',
          fontSize: 12,
          fontWeight: 700,
          background: '#fff',
          color: '#1A1A1A',
          border: 'none',
          borderRadius: 8,
          cursor: isPending || (!value) ? 'not-allowed' : 'pointer',
          opacity: isPending || (!value) ? 0.4 : 1,
          transition: 'all 0.15s',
        }}
      >
        {isPending ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        Appliquer
      </button>

      <div style={{ height: 24, width: 1, background: 'rgba(255,255,255,0.15)' }} />

      {/* Clear */}
      <button
        type="button"
        onClick={onClear}
        className="font-body"
        style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.4)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
      >
        Désélectionner
      </button>
    </div>
  );
}

// ─── Table with synchronized top + bottom scrollbar ─────────────────────────────

function TableWithTopScroll({
  products, startIndex, hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, selectedIds, allSelected, toggleSelectAll, toggleSelect, expandedIds, toggleExpand, selectedVariantIds, toggleVariant, toggleAllVariants, deletingIds, onRowStatus, onRowDelete, onRowSync,
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
  selectedVariantIds: Set<string>;
  toggleVariant: (id: string) => void;
  toggleAllVariants: (ids: string[], select: boolean) => void;
  deletingIds: Set<string>;
  onRowStatus: (productId: string, status: "ONLINE" | "OFFLINE" | "ARCHIVED") => void;
  onRowDelete: (productId: string) => void;
  onRowSync: (productId: string) => void;
}) {
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topInnerRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef<"top" | "bottom" | null>(null);

  // Sync widths & show/hide top scrollbar
  useEffect(() => {
    const tableEl = tableScrollRef.current;
    const topEl = topScrollRef.current;
    const topInner = topInnerRef.current;
    if (!tableEl || !topEl || !topInner) return;

    const syncWidth = () => {
      const scrollW = tableEl.scrollWidth;
      const clientW = tableEl.clientWidth;
      topInner.style.width = `${scrollW}px`;
      // Hide top scrollbar when no overflow
      topEl.style.display = scrollW > clientW ? "block" : "none";
    };

    syncWidth();

    const ro = new ResizeObserver(syncWidth);
    ro.observe(tableEl);
    return () => ro.disconnect();
  }, [products]);

  // Sync scroll positions
  useEffect(() => {
    const topEl = topScrollRef.current;
    const tableEl = tableScrollRef.current;
    if (!topEl || !tableEl) return;

    const onTopScroll = () => {
      if (isSyncingRef.current === "bottom") return;
      isSyncingRef.current = "top";
      tableEl.scrollLeft = topEl.scrollLeft;
      requestAnimationFrame(() => { isSyncingRef.current = null; });
    };
    const onTableScroll = () => {
      if (isSyncingRef.current === "top") return;
      isSyncingRef.current = "bottom";
      topEl.scrollLeft = tableEl.scrollLeft;
      requestAnimationFrame(() => { isSyncingRef.current = null; });
    };

    topEl.addEventListener("scroll", onTopScroll);
    tableEl.addEventListener("scroll", onTableScroll);
    return () => {
      topEl.removeEventListener("scroll", onTopScroll);
      tableEl.removeEventListener("scroll", onTableScroll);
    };
  }, []);

  return (
    <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Top scrollbar */}
      <div ref={topScrollRef} className="overflow-x-auto" style={{ height: 12 }}>
        <div ref={topInnerRef} style={{ height: 1 }} />
      </div>
      {/* Table */}
      <div ref={tableScrollRef} className="overflow-x-auto">
        <table className="w-full text-sm font-body" style={{ minWidth: 980 }}>
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
              <th className="px-2 py-3.5 w-10 text-center text-[10px] font-bold text-text-muted uppercase tracking-widest">#</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Photo</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Réf.</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Produit</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Statut</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Marketplaces</th>
              <th className="px-3 py-3.5 text-left text-[10px] font-bold text-text-muted uppercase tracking-widest">Dates</th>
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
                selectedVariantIds={selectedVariantIds}
                onToggleVariant={toggleVariant}
                onToggleAllVariants={toggleAllVariants}
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
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
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

  const allProducts = products;

  const allPageIds = allProducts.map((p) => p.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;
  const variantCount = selectedVariantIds.size;

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

  const toggleVariant = useCallback((variantId: string) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }, []);

  const toggleAllVariants = useCallback((ids: string[], select: boolean) => {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (select) {
        ids.forEach((id) => next.add(id));
      } else {
        ids.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

  const clearSelectedVariants = useCallback(() => {
    setSelectedVariantIds(new Set());
  }, []);

  // Sélection filtrée sur les brouillons (OFFLINE) — sert au bouton « Publier
  // brouillons sur marketplaces ». Le bouton n'apparaît que si la sélection
  // courante contient au moins un produit OFFLINE.
  const selectedDraftIds = allProducts
    .filter((p) => selectedIds.has(p.id) && p.status === "OFFLINE")
    .map((p) => p.id);
  const hasSelectedDrafts = selectedDraftIds.length > 0;

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
    showLoading();
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
          hideLoading();
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
  }, [selectedIds, startTransition, showLoading, hideLoading, confirm, allProducts, enqueuePfs, hasPfsConfig, hasAnkorstoreConfig, ankorstoreEnabled, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, router]);

  // ─── Bulk modif d'attributs produit (catégorie, code SH, composition, pays,
  // saison, best-seller) ──
  const handleBulkAttributes = useCallback(async (payload: BulkEditPayload) => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      setBulkEditOpen(false);
      return;
    }

    setBulkMessage(null);
    type BulkAttrResult = Awaited<ReturnType<typeof bulkUpdateProductAttributes>>;
    const result = await new Promise<BulkAttrResult | null>((resolve) => {
      startTransition(async () => {
        try {
          showLoading(`Modification de ${ids.length} produit${ids.length > 1 ? "s" : ""}…`);
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
          hideLoading();
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
  }, [selectedIds, startTransition, showLoading, hideLoading, confirm, allProducts, enqueuePfs, hasPfsConfig, showAnkorstore, showEfashion, showFaire]);

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
    showLoading();
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
        hideLoading();
        setDeletingIds(new Set());
      }
    });
  }, [selectedIds, startTransition, showLoading, hideLoading, confirm, allProducts, hasPfsConfig, showAnkorstore, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, toast, router]);

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

  // ─── Bulk variant actions ──
  const handleBulkVariantUpdate = useCallback(async (data: Record<string, unknown>) => {
    const ids = [...selectedVariantIds];
    setBulkMessage(null);

    const hasIncrement = Object.values(data).some((v) => v && typeof v === "object" && "increment" in (v as Record<string, unknown>));

    showLoading();
    startTransition(async () => {
      let bulkSucceeded = false;
      try {
        if (hasIncrement) {
          const field = Object.keys(data)[0];
          const incrementVal = (data[field] as { increment: number }).increment;
          let updated = 0;
          for (const variantId of ids) {
            try {
              const product = allProducts.find((p) => p.colors.some((c) => c.id === variantId));
              const variant = product?.colors.find((c) => c.id === variantId);
              if (!variant) continue;

              const currentVal = field === "stock" ? variant.stock : field === "unitPrice" ? variant.unitPrice : variant.weight;
              const newVal = Math.max(0, currentVal + incrementVal);
              await updateVariantQuick(variantId, { [field]: field === "stock" ? Math.round(newVal) : newVal });
              updated++;
            } catch { /* skip */ }
          }
          setBulkMessage({
            type: "success",
            text: `${updated} variante${updated > 1 ? "s" : ""} mise${updated > 1 ? "s" : ""} à jour`,
          });
          bulkSucceeded = updated > 0;
        } else {
          const result = await bulkUpdateVariants(ids, data as Record<string, number | string | null>);
          setBulkMessage({
            type: "success",
            text: `${result.updated} variante${result.updated > 1 ? "s" : ""} mise${result.updated > 1 ? "s" : ""} à jour`,
          });
          bulkSucceeded = result.updated > 0;
        }
        setSelectedVariantIds(new Set());
      } catch (e) {
        setBulkMessage({ type: "error", text: e instanceof Error ? e.message : "Erreur" });
      } finally {
        hideLoading();
      }

      // Propose la mise à jour marketplaces (PFS + Ankorstore + eFashion + Faire)
      // sur les produits dont au moins une variante a été modifiée.
      if (!bulkSucceeded) return;
      const showEfashion = hasEfashionConfig && efashionEnabled;
      const showFaire = hasFaireConfig && faireEnabled;
      const { affectedProducts, pfsProducts, ankorsProducts, efashionProducts, faireProducts } =
        computeBulkVariantMarketplaceTargets(allProducts, ids, {
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
      )
        return;

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
          onChange: (v) => {
            pfsRef.current = v;
          },
        });
      }
      if (ankorsProducts.length > 0) {
        checkboxes.push({
          id: "ankorstore",
          label: `Mettre à jour sur Ankorstore (${ankorsProducts.length} produit${ankorsProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => {
            ankorsRef.current = v;
          },
        });
      }
      if (efashionProducts.length > 0) {
        checkboxes.push({
          id: "efashion",
          label: `Mettre à jour sur eFashion Paris (${efashionProducts.length} produit${efashionProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => {
            efashionRef.current = v;
          },
        });
      }
      if (faireProducts.length > 0) {
        checkboxes.push({
          id: "faire",
          label: `Mettre à jour sur Faire (${faireProducts.length} produit${faireProducts.length > 1 ? "s" : ""})`,
          defaultChecked: true,
          onChange: (v) => {
            faireRef.current = v;
          },
        });
      }
      const ok = await confirm({
        type: "info",
        title: "Propager aux marketplaces ?",
        message: `${affectedProducts.length} produit${affectedProducts.length > 1 ? "s" : ""} touché${affectedProducts.length > 1 ? "s" : ""} par cette modification — cochez les marketplaces où l'envoyer.`,
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
    });
  }, [selectedVariantIds, allProducts, startTransition, showLoading, hideLoading, hasPfsConfig, showAnkorstore, hasEfashionConfig, efashionEnabled, hasFaireConfig, faireEnabled, confirm, enqueuePfs]);

  if (allProducts.length === 0) {
    return (
      <div className="bg-bg-primary border border-border rounded-2xl p-16 text-center">
        <div className="w-16 h-16 bg-bg-tertiary rounded-2xl flex items-center justify-center mx-auto mb-5">
          <svg className="w-7 h-7 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="font-heading font-bold text-text-primary text-base mb-1.5">Aucun produit trouvé</p>
        <p className="text-sm text-text-muted font-body max-w-xs mx-auto">Aucun résultat ne correspond à vos critères de recherche. Essayez de modifier vos filtres.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Barre d'actions en masse (produits)
          Toujours montée dans le DOM puis animée via le pattern CSS Grid
          `grid-rows-[0fr] → grid-rows-[1fr]` : la barre s'agrandit en douceur
          au lieu d'apparaître d'un coup et de pousser le tableau (bug "page qui
          se refresh" rapporté 2026-06-04). Quand rien n'est sélectionné, le
          wrapper a 0px de hauteur ET 0px de marge — aucun espace vide. */}
      <div
        aria-hidden={!someSelected}
        className={`grid transition-all duration-300 ease-out ${
          someSelected
            ? "grid-rows-[1fr] opacity-100 mb-3"
            : "grid-rows-[0fr] opacity-0 mb-0 pointer-events-none"
        }`}
      >
        <div className="overflow-hidden">
        <div className="flex items-center gap-3 bg-bg-dark text-text-inverse rounded-2xl px-5 py-3.5 shadow-lg">
          <span className="text-sm font-body font-semibold tabular-nums">
            {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
          </span>
          <div className="h-4 w-px bg-bg-primary/20" />
          <button
            type="button"
            onClick={() => handleBulkStatus("ONLINE")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#22C55E] text-white text-xs font-medium rounded-lg hover:bg-[#16A34A] disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Mettre en ligne
          </button>
          <button
            type="button"
            onClick={() => handleBulkStatus("OFFLINE")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-primary/10 text-text-inverse text-xs font-medium rounded-lg hover:bg-bg-primary/20 disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
            Mettre hors ligne
          </button>
          <button
            type="button"
            onClick={() => handleBulkStatus("ARCHIVED")}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F59E0B]/80 text-white text-xs font-medium rounded-lg hover:bg-[#D97706] disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
            Archiver
          </button>
          <div className="h-4 w-px bg-bg-primary/20" />
          {hasSelectedDrafts && (
            <button
              type="button"
              onClick={() => setBulkPublishDraftsOpen(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4F46E5] text-white text-xs font-medium rounded-lg hover:bg-[#4338CA] disabled:opacity-50 transition-colors font-body"
              title="Mettre en ligne les brouillons éligibles et les publier sur les marketplaces"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Publier brouillons ({selectedDraftIds.length})
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              const selectedProducts = allProducts
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
              await refreshBulk(selectedProducts);
            }}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6366F1] text-white text-xs font-medium rounded-lg hover:bg-[#4F46E5] disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
            Rafraîchir
          </button>
          <button
            type="button"
            onClick={() => setBulkEditOpen(true)}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#A855F7] text-white text-xs font-medium rounded-lg hover:bg-[#9333EA] disabled:opacity-50 transition-colors font-body"
            title="Modifier en masse : catégorie, code SH, composition, pays, saison, best-seller"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Modifier
          </button>
          <div className="h-4 w-px bg-bg-primary/20" />
          <MarketplaceExportButton
            productIds={Array.from(selectedIds)}
            disabled={isPending}
            onExported={() => router.refresh()}
          />
          <button
            type="button"
            onClick={() => handleBulkDelete()}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/80 text-white text-xs font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors font-body"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Supprimer
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); }}
            className="ml-auto text-xs text-text-inverse/50 hover:text-text-inverse transition-colors font-body"
          >
            Désélectionner
          </button>
        </div>
        </div>
      </div>

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
      <TableWithTopScroll products={allProducts} startIndex={startIndex} hasPfsConfig={hasPfsConfig} hasAnkorstoreConfig={hasAnkorstoreConfig} ankorstoreEnabled={ankorstoreEnabled} hasEfashionConfig={hasEfashionConfig} efashionEnabled={efashionEnabled} hasFaireConfig={hasFaireConfig} faireEnabled={faireEnabled} selectedIds={selectedIds} allSelected={allSelected} toggleSelectAll={toggleSelectAll} toggleSelect={toggleSelect} expandedIds={expandedIds} toggleExpand={toggleExpand} selectedVariantIds={selectedVariantIds} toggleVariant={toggleVariant} toggleAllVariants={toggleAllVariants} deletingIds={deletingIds} onRowStatus={(id, status) => handleBulkStatus(status, [id])} onRowDelete={(id) => handleBulkDelete([id])} onRowSync={(id) => handleBulkSync([id])} />

      {/* Barre flottante d'édition en masse des variantes */}
      {variantCount > 0 && (
        <BulkVariantBar
          count={variantCount}
          onApply={handleBulkVariantUpdate}
          onClear={clearSelectedVariants}
          isPending={isPending}
        />
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
