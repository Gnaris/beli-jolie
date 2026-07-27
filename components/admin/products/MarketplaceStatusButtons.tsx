"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMarketplaceRefreshQueue } from "./MarketplaceRefreshContext";
import { useEfashionShootingBatch } from "./EfashionShootingBatchContext";
import { useMarketplaceMaintenance } from "./MarketplaceMaintenanceContext";
import {
  computeMarketplaceBadgeState,
  findLatestOpForProduct,
  type MarketplaceBadgeState,
} from "./marketplaceBadgeState";
import SetPfsBrandModal from "./SetPfsBrandModal";

// Modales lourdes — chargées à l'ouverture pour alléger le bundle initial.
const LinkPfsProductModal = dynamic(() => import("./LinkMarketplaceModal"));
const LinkAnkorstoreProductModal = LinkPfsProductModal;
const LinkEfashionProductModal = LinkPfsProductModal;
const LinkFaireProductModal = LinkPfsProductModal;
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { MarketplacePushModal } from "./MarketplacePushModal";
import { removeAnkorstoreMatch } from "@/app/actions/admin/ankorstore";
import { removeEfashionMatch } from "@/app/actions/admin/efashion";
import { removePfsMatch } from "@/app/actions/admin/pfs";
import { removeFaireMatch } from "@/app/actions/admin/faire";
import { clearSyncRequiredFlag } from "@/app/actions/admin/marketplace-sync-flags";

interface MarketplaceStatusButtonsProps {
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  pfsProductId: string | null;
  pfsBrandName: string | null;
  hasPfsConfig: boolean;
  /** Kill switch global PFS depuis Paramètres. Défaut true. */
  pfsEnabled?: boolean;
  ankorsProductId: string | null;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  efashionLinked: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  faireProductId: string | null;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  pfsSyncRequired?: boolean;
  ankorsSyncRequired?: boolean;
  efashionSyncRequired?: boolean;
  faireSyncRequired?: boolean;
  /** Marketplace activée pour ce produit (Product.*Enabled). Défaut true. */
  pfsEnabledForProduct?: boolean;
  ankorsEnabledForProduct?: boolean;
  efashionEnabledForProduct?: boolean;
  faireEnabledForProduct?: boolean;
  /** Maintenance plateforme (contrôle Beliandjolie, affecte toutes les boutiques). Défaut false. */
  pfsMaintenance?: boolean;
  ankorstoreMaintenance?: boolean;
  efashionMaintenance?: boolean;
  faireMaintenance?: boolean;
}

type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire";

// ──────────────────────────────────────────────────────────────────────────
// Icônes
// ──────────────────────────────────────────────────────────────────────────

const Icon = {
  Refresh: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
    </svg>
  ),
  Link: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  ),
  Unlink: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
    </svg>
  ),
  Plus: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  ),
  Tag: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Eye: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Close: (
    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Spinner: (
    <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
    </svg>
  ),
};

// ──────────────────────────────────────────────────────────────────────────
// Petit bouton-icône réutilisable — couleur via prop (success/warning/danger/neutral)
// ──────────────────────────────────────────────────────────────────────────

type IconBtnTone = "success" | "warning" | "danger" | "neutral";

function IconBtn({
  tone,
  icon,
  onClick,
  disabled = false,
  busy = false,
  title,
  ariaLabel,
}: {
  tone: IconBtnTone;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  title: string;
  ariaLabel: string;
}) {
  const toneClasses = {
    success: "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] hover:bg-[#DCFCE7]",
    warning: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] hover:bg-[#FEF3C7]",
    danger: "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA] hover:bg-[#FEE2E2]",
    neutral: "bg-bg-secondary text-text-secondary border-border hover:bg-bg-tertiary",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full border transition-colors ${toneClasses} ${
        disabled || busy ? "opacity-50 cursor-wait" : ""
      }`}
      title={title}
      aria-label={ariaLabel}
    >
      {busy ? Icon.Spinner : icon}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Badge marketplace (état principal + clic principal)
// ──────────────────────────────────────────────────────────────────────────

const MARKETPLACE_META: Record<
  MarketplaceKey,
  { letter: string; gradient: string }
> = {
  pfs: {
    letter: "P",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
  },
  ankorstore: {
    letter: "A",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  },
  efashion: {
    letter: "E",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
  },
  faire: {
    letter: "F",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  },
};

function StatusBadge({
  state,
  marketplace,
  label,
  sublabel,
  onClick,
  onCancelSyncRequired,
  title,
  loadingLabel,
  disabledForProduct = false,
  disabledReason = "product",
  awaitingShooting = false,
  awaitingShootingLabel,
}: {
  state: MarketplaceBadgeState;
  /** Sert à choisir le logo rond coloré (P / A / E / F). */
  marketplace: MarketplaceKey;
  label: string;
  /** Texte secondaire affiché à droite du nom (ex: "· Belicia"). */
  sublabel?: string | null;
  onClick: () => void;
  onCancelSyncRequired?: () => void;
  title: string;
  loadingLabel: string;
  /** Marketplace désactivée (soit pour ce produit, soit globalement). */
  disabledForProduct?: boolean;
  /** Raison de la désactivation :
   *   - "product" : Product.*Enabled=false (activable par la cliente)
   *   - "global"  : kill switch tenant (Paramètres > Marketplaces)
   *   - "maintenance" : maintenance plateforme (contrôle Beli & Jolie) */
  disabledReason?: "product" | "global" | "maintenance";
  /** Produit en attente de validation shooting (lot eFashion non commité). */
  awaitingShooting?: boolean;
  /** Texte du sublabel jaune (ex: "en attente shooting"). */
  awaitingShootingLabel?: string;
}) {
  const mp = MARKETPLACE_META[marketplace];

  // Priorité d'affichage : disabled > loading > awaitingShooting > syncRequired > online > offline.
  const chipClasses = disabledForProduct
    ? "text-text-muted border-border-dark cursor-not-allowed"
    : state.loading
    ? "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE] cursor-wait"
    : awaitingShooting
      ? "bg-[#FEF08A] text-[#713F12] border-[#EAB308] hover:bg-[#FDE047] cursor-default"
      : state.syncRequired
        ? "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A] hover:bg-[#FDE68A] cursor-pointer"
        : state.online
          ? "bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0] cursor-default"
          : "bg-bg-tertiary text-text-muted border-border hover:bg-bg-secondary cursor-pointer";

  const disabledStyle: React.CSSProperties | undefined = disabledForProduct
    ? {
        background:
          "repeating-linear-gradient(45deg,#FAFAFA,#FAFAFA 6px,#F4F4F5 6px,#F4F4F5 12px)",
      }
    : undefined;

  const buttonEl = (
    <button
      type="button"
      onClick={onClick}
      disabled={state.loading || disabledForProduct}
      className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full text-[11px] font-semibold font-body border transition-all ${chipClasses}`}
      style={disabledStyle}
      title={disabledForProduct ? undefined : title}
    >
        {/* Logo rond avec initiale du marketplace */}
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[8.5px] font-extrabold flex-shrink-0"
          style={{
            background: mp.gradient,
            ...(disabledForProduct
              ? { filter: "grayscale(1) brightness(0.85)" }
              : {}),
          }}
          aria-hidden
        >
          {mp.letter}
        </span>

        {/* Label */}
        {disabledForProduct ? (
          <span className="line-through decoration-[1.5px] decoration-text-muted">
            {label}
          </span>
        ) : state.loading ? (
          <span className="inline-flex items-center gap-1.5">
            {Icon.Spinner}
            {loadingLabel}
          </span>
        ) : awaitingShooting ? (
          <span>
            {label} <span className="opacity-60">·</span>{" "}
            <span className="font-bold">
              {awaitingShootingLabel ?? "en attente shooting"}
            </span>
          </span>
        ) : state.syncRequired ? (
          <span>
            {label} <span className="opacity-60">·</span>{" "}
            <span className="font-bold">synchro nécessaire</span>
          </span>
        ) : state.online ? (
          sublabel ? (
            <span>
              {label} <span className="opacity-60">·</span>{" "}
              <span className="font-bold">{sublabel}</span>
            </span>
          ) : (
            <span>{label}</span>
          )
        ) : (
          <span>{label}</span>
        )}

        {/* Dot d'état à droite */}
        {!state.loading && !disabledForProduct && (
          awaitingShooting ? (
            <span className="relative inline-flex">
              <span className="w-1.5 h-1.5 rounded-full bg-[#EAB308] animate-pulse" />
              <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-[#EAB308] opacity-60 animate-ping" />
            </span>
          ) : state.syncRequired ? (
            <span className="relative inline-flex">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
              <span className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-[#F59E0B] opacity-60 animate-ping" />
            </span>
          ) : (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                state.online ? "bg-[#22C55E] animate-pulse" : "bg-border-dark"
              }`}
            />
          )
        )}
        {disabledForProduct && (
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
        )}
    </button>
  );

  const disabledTooltip =
    disabledReason === "maintenance"
      ? `${label} · en maintenance sur la plateforme`
      : disabledReason === "global"
      ? `${label} · marketplace désactivée dans Paramètres`
      : `${label} · marketplace désactivée pour ce produit`;

  return (
    <span className="group relative inline-flex">
      {disabledForProduct ? (
        <Tooltip content={disabledTooltip}>
          {buttonEl}
        </Tooltip>
      ) : (
        buttonEl
      )}
      {state.syncRequired && !awaitingShooting && onCancelSyncRequired && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancelSyncRequired();
          }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-[#B45309] border border-[#FDE68A] shadow-sm flex items-center justify-center hover:bg-[#FDE68A] hover:text-[#78350F] transition-colors"
          title="Ignorer cette synchronisation (le badge orange disparaîtra et le produit repassera en état « en ligne » sans rien envoyer)"
          aria-label="Ignorer cette synchronisation"
        >
          {Icon.Close}
        </button>
      )}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Marketplace block : badge + actions inline groupés
// Chaque bloc reste compact, avec un séparateur visuel discret entre blocs.
// ──────────────────────────────────────────────────────────────────────────

function MarketplaceBlock({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-1">
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────────────────────────────────

export function MarketplaceStatusButtons({
  productId,
  reference,
  productName,
  firstImage,
  pfsProductId,
  pfsBrandName,
  hasPfsConfig,
  pfsEnabled = true,
  ankorsProductId,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  efashionLinked,
  hasEfashionConfig,
  efashionEnabled,
  faireProductId,
  hasFaireConfig,
  faireEnabled,
  pfsSyncRequired = false,
  ankorsSyncRequired = false,
  efashionSyncRequired = false,
  faireSyncRequired = false,
  pfsEnabledForProduct = true,
  ankorsEnabledForProduct = true,
  efashionEnabledForProduct = true,
  faireEnabledForProduct = true,
  pfsMaintenance: pfsMaintenanceProp,
  ankorstoreMaintenance: ankorstoreMaintenanceProp,
  efashionMaintenance: efashionMaintenanceProp,
  faireMaintenance: faireMaintenanceProp,
}: MarketplaceStatusButtonsProps) {
  const router = useRouter();
  // Contexte plateforme (monté au layout admin) — la prop reste prioritaire si
  // fournie explicitement (utile en tests unitaires).
  const maintenanceCtx = useMarketplaceMaintenance();
  const pfsMaintenance = pfsMaintenanceProp ?? maintenanceCtx.pfs;
  const ankorstoreMaintenance = ankorstoreMaintenanceProp ?? maintenanceCtx.ankorstore;
  const efashionMaintenance = efashionMaintenanceProp ?? maintenanceCtx.efashion;
  const faireMaintenance = faireMaintenanceProp ?? maintenanceCtx.faire;
  const { enqueue, items } = useMarketplaceRefreshQueue();
  const {
    addProduct: addToEfashionShootingBatch,
    items: efashionShootingItems,
  } = useEfashionShootingBatch();
  const efashionShootingEntry = useMemo(
    () => efashionShootingItems.find((it) => it.productId === productId),
    [efashionShootingItems, productId],
  );
  const efashionAwaitingShooting = Boolean(efashionShootingEntry);
  const efashionShootingBadgeLabel =
    efashionShootingEntry?.mode === "REFRESH"
      ? "en attente shooting (maj)"
      : "en attente shooting";
  const { confirm } = useConfirm();
  const toast = useToast();

  const [confirmPfsOpen, setConfirmPfsOpen] = useState(false);
  const [resyncPfsOpen, setResyncPfsOpen] = useState(false);
  const [confirmAkOpen, setConfirmAkOpen] = useState(false);
  const [resyncAkOpen, setResyncAkOpen] = useState(false);
  const [linkAkOpen, setLinkAkOpen] = useState(false);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [unlinkAkBusy, setUnlinkAkBusy] = useState(false);
  const [unlinkPfsBusy, setUnlinkPfsBusy] = useState(false);
  const [linkPfsOpen, setLinkPfsOpen] = useState(false);
  const [linkEfOpen, setLinkEfOpen] = useState(false);
  const [unlinkEfBusy, setUnlinkEfBusy] = useState(false);
  const [resyncEfOpen, setResyncEfOpen] = useState(false);
  const [confirmEfOpen, setConfirmEfOpen] = useState(false);
  const [confirmFaireOpen, setConfirmFaireOpen] = useState(false);
  const [resyncFaireOpen, setResyncFaireOpen] = useState(false);
  const [unlinkFaireBusy, setUnlinkFaireBusy] = useState(false);
  const [linkFaireOpen, setLinkFaireOpen] = useState(false);

  const pfsOp = useMemo(() => findLatestOpForProduct(items, productId, "pfs"), [items, productId]);
  const ankorstoreOp = useMemo(
    () => findLatestOpForProduct(items, productId, "ankorstore"),
    [items, productId],
  );
  const efashionOp = useMemo(
    () => findLatestOpForProduct(items, productId, "efashion"),
    [items, productId],
  );
  const faireOp = useMemo(
    () => findLatestOpForProduct(items, productId, "faire"),
    [items, productId],
  );

  const efashionState = useMemo(
    () =>
      computeMarketplaceBadgeState(
        efashionLinked ? "linked" : null,
        efashionOp,
        "efashion",
        efashionSyncRequired,
      ),
    [efashionLinked, efashionOp, efashionSyncRequired],
  );
  const pfsState = useMemo(
    () => computeMarketplaceBadgeState(pfsProductId, pfsOp, "pfs", pfsSyncRequired),
    [pfsProductId, pfsOp, pfsSyncRequired],
  );
  const ankorstoreState = useMemo(
    () => computeMarketplaceBadgeState(ankorsProductId, ankorstoreOp, "ankorstore", ankorsSyncRequired),
    [ankorsProductId, ankorstoreOp, ankorsSyncRequired],
  );
  const faireState = useMemo(
    () => computeMarketplaceBadgeState(faireProductId, faireOp, "faire", faireSyncRequired),
    [faireProductId, faireOp, faireSyncRequired],
  );

  // ── Refresh routeur après publication réussie ──
  useEffect(() => {
    if (pfsState.justPublishedOk && !pfsProductId) router.refresh();
  }, [pfsState.justPublishedOk, pfsProductId, router]);
  useEffect(() => {
    if (ankorstoreState.justPublishedOk && !ankorsProductId) router.refresh();
  }, [ankorstoreState.justPublishedOk, ankorsProductId, router]);
  useEffect(() => {
    if (efashionState.justPublishedOk && !efashionLinked) router.refresh();
  }, [efashionState.justPublishedOk, efashionLinked, router]);
  useEffect(() => {
    if (faireState.justPublishedOk && !faireProductId) router.refresh();
  }, [faireState.justPublishedOk, faireProductId, router]);

  // ──────────────────────────────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────────────────────────────

  const handleCancelSyncRequired = async (
    marketplace: MarketplaceKey,
    marketplaceLabel: string,
  ) => {
    const ok = await confirm({
      type: "warning",
      title: `Ignorer cette synchronisation ${marketplaceLabel} ?`,
      message:
        `Le badge orange disparaîtra et vos dernières modifications NE seront pas envoyées à ${marketplaceLabel}. ` +
        `La fiche ${marketplaceLabel} restera dans son état précédent. Vous pourrez toujours synchroniser plus tard ` +
        `en cliquant sur l'icône ↻ du badge.`,
      confirmLabel: "Oui, ignorer",
    });
    if (!ok) return;
    const res = await clearSyncRequiredFlag(productId, marketplace);
    if (res.success) {
      toast.success("Synchronisation ignorée");
      router.refresh();
    } else {
      toast.error("Impossible d'ignorer", res.error ?? "Erreur inconnue.");
    }
  };

  // PFS
  const handlePublishPfs = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: true },
        mode: "publish",
        marketplace: "pfs",
      },
    ]);
    setConfirmPfsOpen(false);
  };
  const handleResyncPfs = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: true },
        mode: "resync",
        marketplace: "pfs",
      },
    ]);
    setResyncPfsOpen(false);
  };
  const handleUnlinkPfs = async () => {
    const ok = await confirm({
      type: "warning",
      title: "Délier de Paris Fashion Shop ?",
      message:
        "Le lien entre ce produit et sa fiche PFS sera effacé côté site. " +
        "Aucune action n'est faite sur PFS : la fiche restera telle quelle. " +
        "Vous pourrez ensuite re-publier ou re-lier ce produit à une autre fiche PFS.",
      confirmLabel: "Oui, délier",
    });
    if (!ok) return;
    setUnlinkPfsBusy(true);
    try {
      const res = await removePfsMatch(productId);
      if (res.success) {
        toast.success("Produit délié de Paris Fashion Shop");
        router.refresh();
      } else {
        toast.error("Échec du déliage", res.error ?? "Erreur inconnue.");
      }
    } catch (err) {
      toast.error("Échec du déliage", err instanceof Error ? err.message : String(err));
    } finally {
      setUnlinkPfsBusy(false);
    }
  };

  // Ankorstore
  const handlePublishAnkorstore = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: false, ankorstore: true },
        mode: "publish",
        marketplace: "ankorstore",
      },
    ]);
    setConfirmAkOpen(false);
  };
  const handleResyncAnkorstore = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: false, ankorstore: true },
        mode: "resync",
        marketplace: "ankorstore",
      },
    ]);
    setResyncAkOpen(false);
  };
  const handleUnlinkAnkorstore = async () => {
    const ok = await confirm({
      type: "warning",
      title: "Délier de Ankorstore ?",
      message:
        "Le lien entre ce produit et sa fiche Ankorstore sera effacé côté site. " +
        "Aucune action n'est faite sur Ankorstore : si la fiche Ankorstore existe " +
        "encore, elle restera telle quelle. Vous pourrez ensuite re-publier ou " +
        "re-lier ce produit à une autre fiche Ankorstore.",
      confirmLabel: "Oui, délier",
    });
    if (!ok) return;
    setUnlinkAkBusy(true);
    try {
      const res = await removeAnkorstoreMatch(productId);
      if (res.success) {
        toast.success("Produit délié de Ankorstore");
        router.refresh();
      } else {
        toast.error("Échec du déliage", res.error ?? "Erreur inconnue.");
      }
    } catch (err) {
      toast.error("Échec du déliage", err instanceof Error ? err.message : String(err));
    } finally {
      setUnlinkAkBusy(false);
    }
  };

  // eFashion
  const handleResyncEfashion = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: false, ankorstore: false, efashion: true },
        mode: "resync",
        marketplace: "efashion",
      },
    ]);
    setResyncEfOpen(false);
  };
  const handlePublishEfashion = () => {
    if (efashionLinked) {
      enqueue([
        {
          productId,
          reference,
          productName,
          firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: true },
          mode: "publish",
          marketplace: "efashion",
        },
      ]);
    } else {
      void addToEfashionShootingBatch(productId, "PUBLISH");
    }
    setConfirmEfOpen(false);
  };
  // Faire
  const handlePublishFaire = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
        mode: "publish",
        marketplace: "faire",
      },
    ]);
    setConfirmFaireOpen(false);
  };
  const handleResyncFaire = () => {
    enqueue([
      {
        productId,
        reference,
        productName,
        firstImage,
        options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
        mode: "resync",
        marketplace: "faire",
      },
    ]);
    setResyncFaireOpen(false);
  };
  const handleUnlinkFaire = async () => {
    const ok = await confirm({
      type: "warning",
      title: "Délier de Faire ?",
      message:
        "Le lien entre ce produit et sa fiche Faire sera effacé côté site. " +
        "Aucune action n'est faite sur Faire : la fiche existante y restera telle quelle. " +
        "Vous pourrez ensuite re-publier ce produit.",
      confirmLabel: "Oui, délier",
    });
    if (!ok) return;
    setUnlinkFaireBusy(true);
    try {
      const res = await removeFaireMatch(productId);
      if (res.success) {
        toast.success("Produit délié de Faire");
        router.refresh();
      } else {
        toast.error("Échec du déliage", res.error ?? "Erreur inconnue.");
      }
    } catch (err) {
      toast.error("Échec du déliage", err instanceof Error ? err.message : String(err));
    } finally {
      setUnlinkFaireBusy(false);
    }
  };

  const handleUnlinkEfashion = async () => {
    const ok = await confirm({
      type: "warning",
      title: "Délier de eFashion Paris ?",
      message:
        "Le lien entre ce produit et ses fiches eFashion sera effacé côté site. " +
        "Aucune action n'est faite sur eFashion : les lignes existantes chez eux " +
        "restent telles quelles. Vous pourrez ensuite re-lier ce produit.",
      confirmLabel: "Oui, délier",
    });
    if (!ok) return;
    setUnlinkEfBusy(true);
    try {
      const res = await removeEfashionMatch(productId);
      if (res.success) {
        toast.success("Produit délié de eFashion Paris");
        router.refresh();
      } else {
        toast.error("Échec du déliage", res.error ?? "Erreur inconnue.");
      }
    } catch (err) {
      toast.error("Échec du déliage", err instanceof Error ? err.message : String(err));
    } finally {
      setUnlinkEfBusy(false);
    }
  };

  // Bloc affiché dès que la marketplace est CONFIGURÉE. Si le kill switch
  // global (Paramètres) est OFF, on affiche le badge barré (via `disabledOverall`)
  // au lieu de masquer complètement — la cliente veut voir visuellement quelles
  // marketplaces sont en pause. Les IconBtn deviennent disabled à ce moment-là.
  const showAnkorstore = hasAnkorstoreConfig;
  const showEfashion = hasEfashionConfig;
  const showFaire = hasFaireConfig;
  if (!hasPfsConfig && !showAnkorstore && !showEfashion && !showFaire) return null;

  // Maintenance = priorité max (contrôle Beli & Jolie, affecte toutes les boutiques).
  const pfsDisabledOverall = pfsMaintenance || !pfsEnabledForProduct || !pfsEnabled;
  const ankorsDisabledOverall = ankorstoreMaintenance || !ankorsEnabledForProduct || !ankorstoreEnabled;
  const efashionDisabledOverall = efashionMaintenance || !efashionEnabledForProduct || !efashionEnabled;
  const faireDisabledOverall = faireMaintenance || !faireEnabledForProduct || !faireEnabled;
  const pfsDisabledReason: "product" | "global" | "maintenance" =
    pfsMaintenance ? "maintenance" : !pfsEnabled ? "global" : "product";
  const ankorsDisabledReason: "product" | "global" | "maintenance" =
    ankorstoreMaintenance ? "maintenance" : !ankorstoreEnabled ? "global" : "product";
  const efashionDisabledReason: "product" | "global" | "maintenance" =
    efashionMaintenance ? "maintenance" : !efashionEnabled ? "global" : "product";
  const faireDisabledReason: "product" | "global" | "maintenance" =
    faireMaintenance ? "maintenance" : !faireEnabled ? "global" : "product";

  return (
    <>
      <div className="inline-flex items-center gap-2 flex-wrap">
        {/* ─── Paris Fashion Shop ──────────────────────────────────────── */}
        {hasPfsConfig && (
          <MarketplaceBlock>
            <StatusBadge
              state={pfsState}
              marketplace="pfs"
              label="PFS"
              sublabel={pfsProductId ? pfsBrandName : null}
              disabledForProduct={pfsDisabledOverall}
              disabledReason={pfsDisabledReason}
              onClick={() => {
                if (pfsDisabledOverall) return;
                if (pfsState.loading) return;
                if (pfsState.syncRequired) {
                  handleResyncPfs();
                  return;
                }
                if (pfsState.online) return;
                setConfirmPfsOpen(true);
              }}
              onCancelSyncRequired={() =>
                handleCancelSyncRequired("pfs", "Paris Fashion Shop")
              }
              title={
                pfsState.loading
                  ? "Publication en cours sur Paris Fashion Shop…"
                  : pfsState.syncRequired
                    ? "Synchronisation nécessaire — cliquez pour envoyer la mise à jour à Paris Fashion Shop"
                    : pfsState.online
                      ? "Disponible sur Paris Fashion Shop"
                      : "Non disponible — cliquez pour publier sur Paris Fashion Shop"
              }
              loadingLabel="Publication PFS en cours…"
            />

            {pfsProductId && (
              <IconBtn
                tone="success"
                icon={Icon.Refresh}
                onClick={() => {
                  if (pfsState.loading) return;
                  setResyncPfsOpen(true);
                }}
                disabled={pfsState.loading || pfsDisabledOverall}
                title={
                  pfsState.loading
                    ? "Une opération PFS est déjà en cours…"
                    : "Resynchroniser toutes les données sur Paris Fashion Shop"
                }
                ariaLabel="Resynchroniser sur Paris Fashion Shop"
              />
            )}

            {pfsProductId && !pfsBrandName && (
              <IconBtn
                tone="warning"
                icon={Icon.Tag}
                onClick={() => setBrandPickerOpen(true)}
                disabled={pfsDisabledOverall}
                title="Renseigner la marque PFS de ce produit"
                ariaLabel="Renseigner la marque PFS"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkPfsOpen(true)}
              disabled={pfsDisabledOverall}
              title={
                pfsProductId
                  ? "Re-lier vers une autre fiche Paris Fashion Shop"
                  : "Lier à une fiche Paris Fashion Shop existante"
              }
              ariaLabel={
                pfsProductId
                  ? "Re-lier à une autre fiche PFS"
                  : "Lier à une fiche PFS existante"
              }
            />

            {pfsProductId && (
              <IconBtn
                tone="danger"
                icon={Icon.Unlink}
                onClick={handleUnlinkPfs}
                busy={unlinkPfsBusy}
                disabled={pfsDisabledOverall}
                title="Délier ce produit de sa fiche PFS (efface la liaison côté site sans toucher à PFS)"
                ariaLabel="Délier ce produit de Paris Fashion Shop"
              />
            )}
          </MarketplaceBlock>
        )}

        {/* ─── Ankorstore ──────────────────────────────────────────────── */}
        {showAnkorstore && (
          <MarketplaceBlock>
            <StatusBadge
              state={ankorstoreState}
              marketplace="ankorstore"
              label="Ankorstore"
              sublabel={null}
              disabledForProduct={ankorsDisabledOverall}
              disabledReason={ankorsDisabledReason}
              onClick={() => {
                if (ankorsDisabledOverall) return;
                if (ankorstoreState.loading) return;
                if (ankorstoreState.syncRequired) {
                  handleResyncAnkorstore();
                  return;
                }
                if (ankorstoreState.online) return;
                setConfirmAkOpen(true);
              }}
              onCancelSyncRequired={() =>
                handleCancelSyncRequired("ankorstore", "Ankorstore")
              }
              title={
                ankorstoreState.loading
                  ? ankorstoreOp?.status === "awaiting_callback"
                    ? "Ankorstore traite votre demande (1 à 5 min)…"
                    : "Publication en cours sur Ankorstore…"
                  : ankorstoreState.syncRequired
                    ? "Synchronisation nécessaire — cliquez pour envoyer la mise à jour à Ankorstore"
                    : ankorstoreState.online
                      ? "Disponible sur Ankorstore"
                      : "Non disponible — cliquez pour publier sur Ankorstore"
              }
              loadingLabel="Publication Ankorstore en cours…"
            />

            {ankorsProductId && (
              <IconBtn
                tone="success"
                icon={Icon.Refresh}
                onClick={() => {
                  if (ankorstoreState.loading) return;
                  setResyncAkOpen(true);
                }}
                disabled={ankorstoreState.loading || ankorsDisabledOverall}
                title={
                  ankorstoreState.loading
                    ? "Une opération Ankorstore est déjà en cours…"
                    : "Resynchroniser toutes les données sur Ankorstore"
                }
                ariaLabel="Resynchroniser sur Ankorstore"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkAkOpen(true)}
              disabled={ankorsDisabledOverall}
              title={
                ankorsProductId
                  ? "Re-lier vers un autre produit Ankorstore"
                  : "Lier à un produit Ankorstore existant"
              }
              ariaLabel={
                ankorsProductId
                  ? "Re-lier à un autre produit Ankorstore"
                  : "Lier à un produit Ankorstore existant"
              }
            />

            {ankorsProductId && (
              <IconBtn
                tone="danger"
                icon={Icon.Unlink}
                onClick={handleUnlinkAnkorstore}
                busy={unlinkAkBusy}
                disabled={ankorsDisabledOverall}
                title="Délier ce produit de sa fiche Ankorstore (efface la liaison côté site sans toucher à Ankorstore)"
                ariaLabel="Délier ce produit de Ankorstore"
              />
            )}
          </MarketplaceBlock>
        )}

        {/* ─── eFashion Paris ──────────────────────────────────────────── */}
        {showEfashion && (
          <MarketplaceBlock>
            <StatusBadge
              state={efashionState}
              marketplace="efashion"
              label="eFashion"
              sublabel={null}
              disabledForProduct={efashionDisabledOverall}
              disabledReason={efashionDisabledReason}
              awaitingShooting={efashionAwaitingShooting}
              awaitingShootingLabel={efashionShootingBadgeLabel}
              onClick={() => {
                if (efashionDisabledOverall) return;
                if (efashionState.loading) return;
                if (efashionAwaitingShooting) return;
                if (efashionState.syncRequired) {
                  handleResyncEfashion();
                  return;
                }
                if (efashionLinked) return;
                setConfirmEfOpen(true);
              }}
              onCancelSyncRequired={() =>
                handleCancelSyncRequired("efashion", "eFashion Paris")
              }
              title={
                efashionState.loading
                  ? "Synchronisation eFashion en cours…"
                  : efashionAwaitingShooting
                    ? "Dans le lot shooting eFashion — en attente de validation avant envoi"
                    : efashionState.syncRequired
                      ? "Synchronisation nécessaire — cliquez pour envoyer la mise à jour à eFashion Paris"
                      : efashionLinked
                        ? "Produit lié à eFashion Paris"
                        : "Non disponible — cliquez pour publier sur eFashion Paris"
              }
              loadingLabel="Sync eFashion…"
            />

            {efashionLinked && (
              <IconBtn
                tone="success"
                icon={Icon.Refresh}
                onClick={() => {
                  if (efashionState.loading) return;
                  setResyncEfOpen(true);
                }}
                disabled={efashionState.loading || efashionDisabledOverall}
                title="Resynchroniser stock + visibilité + prix sur eFashion"
                ariaLabel="Resynchroniser sur eFashion"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkEfOpen(true)}
              disabled={efashionDisabledOverall}
              title={
                efashionLinked
                  ? "Re-lier vers une autre référence eFashion"
                  : "Lier à un produit eFashion existant"
              }
              ariaLabel={
                efashionLinked
                  ? "Re-lier à un autre produit eFashion"
                  : "Lier à un produit eFashion existant"
              }
            />

            {efashionLinked && (
              <IconBtn
                tone="danger"
                icon={Icon.Unlink}
                onClick={handleUnlinkEfashion}
                busy={unlinkEfBusy}
                disabled={efashionDisabledOverall}
                title="Délier ce produit de ses fiches eFashion (efface la liaison côté site sans toucher à eFashion)"
                ariaLabel="Délier ce produit de eFashion Paris"
              />
            )}
          </MarketplaceBlock>
        )}

        {/* ─── Faire ──────────────────────────────────────────────────── */}
        {showFaire && (
          <MarketplaceBlock>
            <StatusBadge
              state={faireState}
              marketplace="faire"
              label="Faire"
              sublabel={null}
              disabledForProduct={faireDisabledOverall}
              disabledReason={faireDisabledReason}
              onClick={() => {
                if (faireDisabledOverall) return;
                if (faireState.loading) return;
                if (faireState.syncRequired) {
                  handleResyncFaire();
                  return;
                }
                if (faireState.online) return;
                setConfirmFaireOpen(true);
              }}
              onCancelSyncRequired={() =>
                handleCancelSyncRequired("faire", "Faire")
              }
              title={
                faireState.loading
                  ? "Synchronisation Faire en cours…"
                  : faireState.syncRequired
                    ? "Synchronisation nécessaire — cliquez pour envoyer la mise à jour à Faire"
                    : faireProductId
                      ? "Disponible sur Faire"
                      : "Non disponible — cliquez pour publier sur Faire"
              }
              loadingLabel="Publication Faire en cours…"
            />

            {faireProductId && (
              <IconBtn
                tone="success"
                icon={Icon.Refresh}
                onClick={() => {
                  if (faireState.loading) return;
                  setResyncFaireOpen(true);
                }}
                disabled={faireState.loading || faireDisabledOverall}
                title={
                  faireState.loading
                    ? "Une opération Faire est déjà en cours…"
                    : "Resynchroniser toutes les données sur Faire"
                }
                ariaLabel="Resynchroniser sur Faire"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkFaireOpen(true)}
              disabled={faireDisabledOverall}
              title={
                faireProductId
                  ? "Re-lier vers une autre fiche Faire"
                  : "Lier à une fiche Faire existante (recherche par SKU)"
              }
              ariaLabel={
                faireProductId
                  ? "Re-lier à une autre fiche Faire"
                  : "Lier à une fiche Faire existante"
              }
            />

            {faireProductId && (
              <IconBtn
                tone="danger"
                icon={Icon.Unlink}
                onClick={handleUnlinkFaire}
                busy={unlinkFaireBusy}
                disabled={faireDisabledOverall}
                title="Délier ce produit de sa fiche Faire (efface la liaison côté site sans toucher à Faire)"
                ariaLabel="Délier ce produit de Faire"
              />
            )}
          </MarketplaceBlock>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────── */}
      {/*  Modales                                                         */}
      {/* ─────────────────────────────────────────────────────────────── */}

      <MarketplacePushModal
        open={confirmPfsOpen}
        marketplace="pfs"
        mode="publish"
        title="Publier ce produit sur Paris Fashion Shop ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        message="Ce produit n'existe pas encore sur Paris Fashion Shop. Une nouvelle fiche y sera créée avec les informations, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        onClose={() => setConfirmPfsOpen(false)}
        onConfirm={handlePublishPfs}
      />

      <MarketplacePushModal
        open={resyncPfsOpen}
        marketplace="pfs"
        mode="resync"
        title="Renvoyer les infos à Paris Fashion Shop ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        items={[
          "Nom & description",
          "Photos",
          "Prix",
          "Stock",
          "Statut en ligne",
          "Best Seller & variantes",
        ]}
        infoMessage="La fiche existante sur Paris Fashion Shop est gardée telle quelle — seul le contenu est mis à jour."
        confirmLabel="Envoyer maintenant"
        onClose={() => setResyncPfsOpen(false)}
        onConfirm={handleResyncPfs}
      />

      <MarketplacePushModal
        open={confirmAkOpen}
        marketplace="ankorstore"
        mode="publish"
        title="Publier ce produit sur Ankorstore ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        message="Ce produit n'existe pas encore sur Ankorstore. Une nouvelle fiche y sera créée avec les informations, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        onClose={() => setConfirmAkOpen(false)}
        onConfirm={handlePublishAnkorstore}
      />

      <MarketplacePushModal
        open={resyncAkOpen}
        marketplace="ankorstore"
        mode="resync"
        title="Renvoyer les infos à Ankorstore ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        items={[
          "Nom & description",
          "Photos",
          "Prix",
          "Stock",
          "Statut en ligne",
          "Variantes",
        ]}
        infoMessage="La fiche existante sur Ankorstore est gardée telle quelle — seul le contenu est mis à jour."
        confirmLabel="Envoyer maintenant"
        onClose={() => setResyncAkOpen(false)}
        onConfirm={handleResyncAnkorstore}
      />

      <MarketplacePushModal
        open={confirmEfOpen}
        marketplace="efashion"
        mode="publish"
        title="Publier ce produit sur eFashion Paris ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        message="Ce produit n'est pas encore lié à eFashion Paris. Une nouvelle fiche y sera créée pour chaque couleur (workflow shooting) avec les infos, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        onClose={() => setConfirmEfOpen(false)}
        onConfirm={handlePublishEfashion}
      />

      <MarketplacePushModal
        open={resyncEfOpen}
        marketplace="efashion"
        mode="resync"
        title="Renvoyer les infos à eFashion Paris ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        items={["Statut en ligne", "Prix", "Stock"]}
        infoMessage="Les liaisons existantes entre vos couleurs et eFashion ne changent pas."
        confirmLabel="Envoyer maintenant"
        onClose={() => setResyncEfOpen(false)}
        onConfirm={handleResyncEfashion}
      />

      <MarketplacePushModal
        open={confirmFaireOpen}
        marketplace="faire"
        mode="publish"
        title="Publier ce produit sur Faire ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        message="Ce produit n'existe pas encore sur Faire. Une nouvelle fiche (brouillon) y sera créée avec les informations, photos, prix et stock actuels."
        infoMessage="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
        subtitle="première publication"
        confirmLabel="Publier maintenant"
        onClose={() => setConfirmFaireOpen(false)}
        onConfirm={handlePublishFaire}
      />

      <MarketplacePushModal
        open={resyncFaireOpen}
        marketplace="faire"
        mode="resync"
        title="Renvoyer les infos à Faire ?"
        productName={productName}
        productReference={reference}
        productImage={firstImage}
        items={[
          "Nom & description",
          "Photos",
          "Prix",
          "Stock",
          "Statut en ligne",
          "Variantes",
        ]}
        infoMessage="La fiche existante sur Faire est gardée telle quelle — seul le contenu est mis à jour."
        confirmLabel="Envoyer maintenant"
        onClose={() => setResyncFaireOpen(false)}
        onConfirm={handleResyncFaire}
      />

      {linkPfsOpen && (
        <LinkPfsProductModal
          marketplace="pfs"
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkPfsOpen(false)}
        />
      )}

      {linkAkOpen && (
        <LinkAnkorstoreProductModal
          marketplace="ankorstore"
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkAkOpen(false)}
        />
      )}

      {brandPickerOpen && (
        <SetPfsBrandModal
          productId={productId}
          productName={productName}
          onClose={() => setBrandPickerOpen(false)}
        />
      )}

      {linkEfOpen && (
        <LinkEfashionProductModal
          marketplace="efashion"
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkEfOpen(false)}
        />
      )}

      {linkFaireOpen && (
        <LinkFaireProductModal
          marketplace="faire"
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkFaireOpen(false)}
        />
      )}
    </>
  );
}
