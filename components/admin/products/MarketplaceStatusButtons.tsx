"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMarketplaceRefreshQueue } from "./MarketplaceRefreshContext";
import { useEfashionShootingBatch } from "./EfashionShootingBatchContext";
import {
  computeMarketplaceBadgeState,
  findLatestOpForProduct,
  type MarketplaceBadgeState,
} from "./marketplaceBadgeState";
import SetPfsBrandModal from "./SetPfsBrandModal";

// Modales lourdes — chargées à l'ouverture pour alléger le bundle initial.
const LinkAnkorstoreProductModal = dynamic(() => import("./LinkAnkorstoreProductModal"));
const OrphanAnkorstoreVariantsModal = dynamic(() => import("./OrphanAnkorstoreVariantsModal"));
const LinkEfashionProductModal = dynamic(() => import("./LinkEfashionProductModal"));
const LinkPfsProductModal = dynamic(() => import("./LinkPfsProductModal"));
const LinkFaireProductModal = dynamic(() => import("./LinkFaireProductModal"));
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
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
}) {
  const mp = MARKETPLACE_META[marketplace];

  const chipClasses = state.loading
    ? "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE] cursor-wait"
    : state.syncRequired
      ? "bg-[#FEF3C7] text-[#B45309] border-[#FDE68A] hover:bg-[#FDE68A] cursor-pointer"
      : state.online
        ? "bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0] cursor-default"
        : "bg-bg-tertiary text-text-muted border-border hover:bg-bg-secondary cursor-pointer";

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={state.loading}
        className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full text-[11px] font-semibold font-body border transition-all ${chipClasses}`}
        title={title}
      >
        {/* Logo rond avec initiale du marketplace */}
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[8.5px] font-extrabold flex-shrink-0"
          style={{ background: mp.gradient }}
          aria-hidden
        >
          {mp.letter}
        </span>

        {/* Label */}
        {state.loading ? (
          <span className="inline-flex items-center gap-1.5">
            {Icon.Spinner}
            {loadingLabel}
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
        {!state.loading && (
          state.syncRequired ? (
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
      </button>
      {state.syncRequired && onCancelSyncRequired && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancelSyncRequired();
          }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-[#B45309] border border-[#FDE68A] shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[#FDE68A] hover:text-[#78350F] transition-opacity"
          title="Ignorer cette synchronisation (le badge orange disparaîtra sans rien envoyer)"
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
}: MarketplaceStatusButtonsProps) {
  const router = useRouter();
  const { enqueue, items } = useMarketplaceRefreshQueue();
  const { addProduct: addToEfashionShootingBatch } = useEfashionShootingBatch();
  const { confirm } = useConfirm();
  const toast = useToast();

  const [confirmPfsOpen, setConfirmPfsOpen] = useState(false);
  const [resyncPfsOpen, setResyncPfsOpen] = useState(false);
  const [confirmAkOpen, setConfirmAkOpen] = useState(false);
  const [resyncAkOpen, setResyncAkOpen] = useState(false);
  const [linkAkOpen, setLinkAkOpen] = useState(false);
  const [orphanAkOpen, setOrphanAkOpen] = useState(false);
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

  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showEfashion = hasEfashionConfig && efashionEnabled;
  const showFaire = hasFaireConfig && faireEnabled;
  if (!hasPfsConfig && !showAnkorstore && !showEfashion && !showFaire) return null;

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
              onClick={() => {
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
                disabled={pfsState.loading}
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
                title="Renseigner la marque PFS de ce produit"
                ariaLabel="Renseigner la marque PFS"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkPfsOpen(true)}
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
              onClick={() => {
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
                disabled={ankorstoreState.loading}
                title={
                  ankorstoreState.loading
                    ? "Une opération Ankorstore est déjà en cours…"
                    : "Resynchroniser toutes les données sur Ankorstore"
                }
                ariaLabel="Resynchroniser sur Ankorstore"
              />
            )}

            {ankorsProductId && (
              <IconBtn
                tone="warning"
                icon={Icon.Eye}
                onClick={() => setOrphanAkOpen(true)}
                title="Voir et lier manuellement les variantes orphelines (couleurs non encore liées entre votre site et Ankorstore)"
                ariaLabel="Variantes non liées entre votre site et Ankorstore"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkAkOpen(true)}
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
              onClick={() => {
                if (efashionState.loading) return;
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
                disabled={efashionState.loading}
                title="Resynchroniser stock + visibilité + prix sur eFashion"
                ariaLabel="Resynchroniser sur eFashion"
              />
            )}

            <IconBtn
              tone="neutral"
              icon={Icon.Link}
              onClick={() => setLinkEfOpen(true)}
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
              onClick={() => {
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
                disabled={faireState.loading}
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

      {confirmPfsOpen && (
        <ConfirmModal
          marketplace="pfs"
          mode="publish"
          title="Publier ce produit sur Paris Fashion Shop ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          message="Ce produit n'existe pas encore sur Paris Fashion Shop. Une nouvelle fiche y sera créée avec les informations, photos, prix et stock actuels."
          infoNote="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
          confirmLabel="Publier maintenant"
          onCancel={() => setConfirmPfsOpen(false)}
          onConfirm={handlePublishPfs}
        />
      )}

      {resyncPfsOpen && (
        <ConfirmModal
          marketplace="pfs"
          mode="resync"
          title="Renvoyer les infos à Paris Fashion Shop ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          items={[
            "Nom & description",
            "Photos",
            "Prix",
            "Stock",
            "Statut en ligne",
            "Best Seller & variantes",
          ]}
          infoNote="La fiche existante sur Paris Fashion Shop est gardée telle quelle — seul le contenu est mis à jour."
          confirmLabel="Envoyer maintenant"
          onCancel={() => setResyncPfsOpen(false)}
          onConfirm={handleResyncPfs}
        />
      )}

      {confirmAkOpen && (
        <ConfirmModal
          marketplace="ankorstore"
          mode="publish"
          title="Publier ce produit sur Ankorstore ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          message="Ce produit n'existe pas encore sur Ankorstore. Une nouvelle fiche y sera créée avec les informations, photos, prix et stock actuels."
          infoNote="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
          confirmLabel="Publier maintenant"
          onCancel={() => setConfirmAkOpen(false)}
          onConfirm={handlePublishAnkorstore}
        />
      )}

      {resyncAkOpen && (
        <ConfirmModal
          marketplace="ankorstore"
          mode="resync"
          title="Renvoyer les infos à Ankorstore ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          items={[
            "Nom & description",
            "Photos",
            "Prix",
            "Stock",
            "Statut en ligne",
            "Variantes",
          ]}
          infoNote="La fiche existante sur Ankorstore est gardée telle quelle — seul le contenu est mis à jour."
          confirmLabel="Envoyer maintenant"
          onCancel={() => setResyncAkOpen(false)}
          onConfirm={handleResyncAnkorstore}
        />
      )}

      {confirmEfOpen && (
        <ConfirmModal
          marketplace="efashion"
          mode="publish"
          title="Publier ce produit sur eFashion Paris ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          message="Ce produit n'est pas encore lié à eFashion Paris. Une nouvelle fiche y sera créée pour chaque couleur (workflow shooting) avec les infos, photos, prix et stock actuels."
          infoNote="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
          confirmLabel="Publier maintenant"
          onCancel={() => setConfirmEfOpen(false)}
          onConfirm={handlePublishEfashion}
        />
      )}

      {resyncEfOpen && (
        <ConfirmModal
          marketplace="efashion"
          mode="resync"
          title="Renvoyer les infos à eFashion Paris ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          items={["Statut en ligne", "Prix", "Stock"]}
          infoNote="Les liaisons existantes entre vos couleurs et eFashion ne changent pas."
          confirmLabel="Envoyer maintenant"
          onCancel={() => setResyncEfOpen(false)}
          onConfirm={handleResyncEfashion}
        />
      )}

      {confirmFaireOpen && (
        <ConfirmModal
          marketplace="faire"
          mode="publish"
          title="Publier ce produit sur Faire ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          message="Ce produit n'existe pas encore sur Faire. Une nouvelle fiche (brouillon) y sera créée avec les informations, photos, prix et stock actuels."
          infoNote="Une fois publiée, la fiche restera liée à ce produit. Vos futures modifications pourront être renvoyées en un clic."
          confirmLabel="Publier maintenant"
          onCancel={() => setConfirmFaireOpen(false)}
          onConfirm={handlePublishFaire}
        />
      )}

      {resyncFaireOpen && (
        <ConfirmModal
          marketplace="faire"
          mode="resync"
          title="Renvoyer les infos à Faire ?"
          productName={productName}
          reference={reference}
          firstImage={firstImage}
          items={[
            "Nom & description",
            "Photos",
            "Prix",
            "Stock",
            "Statut en ligne",
            "Variantes",
          ]}
          infoNote="La fiche existante sur Faire est gardée telle quelle — seul le contenu est mis à jour."
          confirmLabel="Envoyer maintenant"
          onCancel={() => setResyncFaireOpen(false)}
          onConfirm={handleResyncFaire}
        />
      )}

      {linkPfsOpen && (
        <LinkPfsProductModal
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkPfsOpen(false)}
        />
      )}

      {linkAkOpen && (
        <LinkAnkorstoreProductModal
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkAkOpen(false)}
        />
      )}

      {orphanAkOpen && (
        <OrphanAnkorstoreVariantsModal
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setOrphanAkOpen(false)}
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
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkEfOpen(false)}
        />
      )}

      {linkFaireOpen && (
        <LinkFaireProductModal
          productId={productId}
          productName={productName}
          reference={reference}
          onClose={() => setLinkFaireOpen(false)}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modale de confirmation (publish / resync) — style cockpit moderne
// ──────────────────────────────────────────────────────────────────────────

type ConfirmMode = "publish" | "resync";

const MARKETPLACE_MODAL_META: Record<
  MarketplaceKey,
  {
    label: string;
    gradientFrom: string;
    gradientTo: string;
    haloClass: string;
    haloLightClass: string;
    accentTextClass: string;
    accentDotClass: string;
    infoBarClass: string;
    infoTextClass: string;
    infoIconClass: string;
  }
> = {
  pfs: {
    label: "Paris Fashion Shop",
    gradientFrom: "#4f46e5",
    gradientTo: "#6366f1",
    haloClass: "bg-indigo-200",
    haloLightClass: "bg-indigo-100",
    accentTextClass: "text-indigo-700",
    accentDotClass: "bg-indigo-500",
    infoBarClass: "bg-indigo-50/70 border-indigo-100",
    infoTextClass: "text-indigo-900/80",
    infoIconClass: "text-indigo-600",
  },
  ankorstore: {
    label: "Ankorstore",
    gradientFrom: "#0ea5e9",
    gradientTo: "#38bdf8",
    haloClass: "bg-sky-200",
    haloLightClass: "bg-sky-100",
    accentTextClass: "text-sky-700",
    accentDotClass: "bg-sky-500",
    infoBarClass: "bg-sky-50/70 border-sky-100",
    infoTextClass: "text-sky-900/80",
    infoIconClass: "text-sky-600",
  },
  efashion: {
    label: "eFashion Paris",
    gradientFrom: "#db2777",
    gradientTo: "#ec4899",
    haloClass: "bg-pink-200",
    haloLightClass: "bg-pink-100",
    accentTextClass: "text-pink-700",
    accentDotClass: "bg-pink-500",
    infoBarClass: "bg-pink-50/70 border-pink-100",
    infoTextClass: "text-pink-900/80",
    infoIconClass: "text-pink-600",
  },
  faire: {
    label: "Faire",
    gradientFrom: "#f59e0b",
    gradientTo: "#fbbf24",
    haloClass: "bg-amber-200",
    haloLightClass: "bg-amber-100",
    accentTextClass: "text-amber-700",
    accentDotClass: "bg-amber-500",
    infoBarClass: "bg-amber-50/80 border-amber-100",
    infoTextClass: "text-amber-900/80",
    infoIconClass: "text-amber-600",
  },
};

export function ConfirmModal({
  marketplace,
  mode,
  title,
  productName,
  reference,
  firstImage,
  items,
  message,
  infoNote,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  marketplace: MarketplaceKey;
  mode: ConfirmMode;
  title: string;
  productName: string;
  reference: string;
  firstImage: string | null;
  /** Liste des éléments qui seront renvoyés (mode resync). */
  items?: string[];
  /** Texte plein (mode publish, ou fallback si pas d'items). */
  message?: string;
  infoNote: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const meta = MARKETPLACE_MODAL_META[marketplace];
  const letter = MARKETPLACE_META[marketplace].letter;
  const gradient = `linear-gradient(135deg,${meta.gradientFrom},${meta.gradientTo})`;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketplace-confirm-title"
      >
        <div
          className="h-1.5"
          style={{ background: `linear-gradient(90deg,${meta.gradientFrom},${meta.gradientTo})` }}
        />

        <div
          className={`absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl opacity-60 pointer-events-none ${meta.haloClass}`}
          aria-hidden
        />
        <div
          className={`absolute -bottom-20 -left-16 w-56 h-56 rounded-full blur-3xl opacity-50 pointer-events-none ${meta.haloLightClass}`}
          aria-hidden
        />

        <div className="relative p-6 sm:p-7">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-lg"
                style={{ background: gradient }}
                aria-hidden
              >
                {letter}
              </div>
              <div
                className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white ring-2 ring-white flex items-center justify-center ${meta.accentTextClass}`}
                aria-hidden
              >
                {mode === "resync" ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                )}
              </div>
            </div>
            <div className="min-w-0 pt-1">
              <div
                className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase mb-1 font-body ${meta.accentTextClass}`}
                style={{ letterSpacing: "0.18em" }}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${meta.accentDotClass}`} />
                {meta.label}
                {mode === "publish" ? " · première publication" : ""}
              </div>
              <h3
                id="marketplace-confirm-title"
                className="font-heading text-[22px] font-bold text-text-primary leading-tight"
              >
                {title}
              </h3>
            </div>
          </div>

          {/* Fiche produit */}
          <div className="mt-5 flex items-center gap-3 p-3 rounded-2xl bg-bg-secondary border border-border">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-50 to-rose-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {firstImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firstImage} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-primary truncate font-body">{productName}</div>
              <div className="text-xs text-text-muted mt-0.5 font-mono">{reference}</div>
            </div>
          </div>

          {/* Corps : liste (resync) ou paragraphe (publish) */}
          {items && items.length > 0 ? (
            <div className="mt-5">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-3 font-body"
                style={{ letterSpacing: "0.18em" }}
              >
                Ce qui sera renvoyé
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                {items.map((it) => (
                  <div key={it} className="flex items-center gap-2 text-sm text-text-secondary font-body">
                    <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {it}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            message && (
              <p className="mt-5 text-sm text-text-secondary leading-relaxed font-body">{message}</p>
            )
          )}

          {/* Bandeau info */}
          <div className={`mt-5 flex items-start gap-2.5 p-3 rounded-xl border ${meta.infoBarClass}`}>
            <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${meta.infoIconClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className={`text-xs leading-relaxed font-body ${meta.infoTextClass}`}>{infoNote}</p>
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 text-sm font-semibold text-text-secondary rounded-xl hover:bg-bg-secondary transition-colors font-body"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="group inline-flex items-center gap-2 pl-4 pr-5 py-2.5 text-sm font-semibold text-white rounded-xl shadow-md hover:shadow-lg transition-all font-body"
              style={{ background: gradient }}
            >
              {mode === "resync" ? (
                <svg
                  className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.4}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.4}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
                </svg>
              )}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
