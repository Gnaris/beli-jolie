"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMarketplaceRefreshQueue } from "./MarketplaceRefreshContext";
import {
  computeMarketplaceBadgeState,
  findLatestOpForProduct,
} from "./marketplaceBadgeState";
import LinkAnkorstoreProductModal from "./LinkAnkorstoreProductModal";
import OrphanAnkorstoreVariantsModal from "./OrphanAnkorstoreVariantsModal";
import SetPfsBrandModal from "./SetPfsBrandModal";
import LinkEfashionProductModal from "./LinkEfashionProductModal";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { removeAnkorstoreMatch } from "@/app/actions/admin/ankorstore";
import { removeEfashionMatch } from "@/app/actions/admin/efashion";

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
  /** True dès qu'au moins une couleur du produit a un efashionProductId renseigné. */
  efashionLinked: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
}

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
}: MarketplaceStatusButtonsProps) {
  const router = useRouter();
  const { enqueue, items } = useMarketplaceRefreshQueue();
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
  const [linkEfOpen, setLinkEfOpen] = useState(false);
  const [unlinkEfBusy, setUnlinkEfBusy] = useState(false);
  const [resyncEfOpen, setResyncEfOpen] = useState(false);

  const pfsOp = useMemo(
    () => findLatestOpForProduct(items, productId, "pfs"),
    [items, productId],
  );
  const ankorstoreOp = useMemo(
    () => findLatestOpForProduct(items, productId, "ankorstore"),
    [items, productId],
  );
  const efashionOp = useMemo(
    () => findLatestOpForProduct(items, productId, "efashion"),
    [items, productId],
  );

  const efashionState = useMemo(
    () =>
      computeMarketplaceBadgeState(
        // Pour eFashion on n'a pas d'« id produit unique » côté Product, on utilise
        // le flag de liaison comme signal "online".
        efashionLinked ? "linked" : null,
        efashionOp,
        "efashion",
      ),
    [efashionLinked, efashionOp],
  );
  const isEfashionLoading = efashionState.loading;

  const pfsState = useMemo(
    () => computeMarketplaceBadgeState(pfsProductId, pfsOp, "pfs"),
    [pfsProductId, pfsOp],
  );
  const ankorstoreState = useMemo(
    () => computeMarketplaceBadgeState(ankorsProductId, ankorstoreOp, "ankorstore"),
    [ankorsProductId, ankorstoreOp],
  );

  const isPfsLoading = pfsState.loading;
  const pfsOnline = pfsState.online;
  const isAnkorstoreLoading = ankorstoreState.loading;
  const ankorstoreOnline = ankorstoreState.online;

  useEffect(() => {
    if (pfsState.justPublishedOk && !pfsProductId) {
      router.refresh();
    }
  }, [pfsState.justPublishedOk, pfsProductId, router]);

  useEffect(() => {
    if (ankorstoreState.justPublishedOk && !ankorsProductId) {
      router.refresh();
    }
  }, [ankorstoreState.justPublishedOk, ankorsProductId, router]);

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

  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showEfashion = hasEfashionConfig && efashionEnabled;

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

  if (!hasPfsConfig && !showAnkorstore && !showEfashion) return null;

  return (
    <>
      <div className="inline-flex items-center gap-3 flex-wrap">
        {hasPfsConfig && (
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (pfsOnline || isPfsLoading) return;
                setConfirmPfsOpen(true);
              }}
              disabled={isPfsLoading}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-semibold font-body border transition-all ${
                isPfsLoading
                  ? "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE] cursor-wait"
                  : pfsOnline
                    ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] cursor-default"
                    : "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA] hover:bg-[#FEE2E2] cursor-pointer"
              }`}
              title={
                isPfsLoading
                  ? "Publication en cours sur Paris Fashion Shop…"
                  : pfsOnline
                    ? "Disponible sur Paris Fashion Shop"
                    : "Non disponible — cliquez pour publier sur Paris Fashion Shop"
              }
            >
              {isPfsLoading ? (
                <svg
                  className="w-3 h-3 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              ) : (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    pfsOnline ? "bg-[#22C55E]" : "bg-[#DC2626]"
                  }`}
                />
              )}
              {isPfsLoading ? (
                "Publication PFS en cours…"
              ) : pfsOnline ? (
                pfsBrandName ? (
                  <span>
                    Paris Fashion Shop <span className="opacity-60">·</span>{" "}
                    <span className="font-bold">{pfsBrandName}</span>
                  </span>
                ) : (
                  "Paris Fashion Shop"
                )
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Non publié PFS
                </>
              )}
            </button>

            {pfsProductId && !pfsBrandName && (
              <button
                type="button"
                onClick={() => setBrandPickerOpen(true)}
                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] hover:bg-[#FEF3C7] transition-colors"
                title="Renseigner la marque PFS de ce produit"
                aria-label="Renseigner la marque PFS"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}

            {pfsProductId && (
              <button
                type="button"
                onClick={() => {
                  if (isPfsLoading) return;
                  setResyncPfsOpen(true);
                }}
                disabled={isPfsLoading}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] transition-colors ${
                  isPfsLoading ? "opacity-50 cursor-wait" : "hover:bg-[#DCFCE7]"
                }`}
                title={
                  isPfsLoading
                    ? "Une opération PFS est déjà en cours…"
                    : "Resynchroniser toutes les données sur Paris Fashion Shop"
                }
                aria-label="Resynchroniser sur Paris Fashion Shop"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isPfsLoading ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </button>
            )}
          </div>
        )}

        {showAnkorstore && (
          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (ankorstoreOnline || isAnkorstoreLoading) return;
                setConfirmAkOpen(true);
              }}
              disabled={isAnkorstoreLoading}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-semibold font-body border transition-all ${
                isAnkorstoreLoading
                  ? "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE] cursor-wait"
                  : ankorstoreOnline
                    ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0] cursor-default"
                    : "bg-[#FEF2F2] text-[#DC2626] border-[#FECACA] hover:bg-[#FEE2E2] cursor-pointer"
              }`}
              title={
                isAnkorstoreLoading
                  ? ankorstoreOp?.status === "awaiting_callback"
                    ? "Ankorstore traite votre demande (1 à 5 min)…"
                    : "Publication en cours sur Ankorstore…"
                  : ankorstoreOnline
                    ? "Disponible sur Ankorstore"
                    : "Non disponible — cliquez pour publier sur Ankorstore"
              }
            >
              {isAnkorstoreLoading ? (
                <svg
                  className="w-3 h-3 animate-spin"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              ) : (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    ankorstoreOnline ? "bg-[#22C55E]" : "bg-[#DC2626]"
                  }`}
                />
              )}
              {isAnkorstoreLoading ? (
                "Publication Ankorstore en cours…"
              ) : ankorstoreOnline ? (
                "Ankorstore"
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Non publié Ankorstore
                </>
              )}
            </button>

            {ankorsProductId && (
              <button
                type="button"
                onClick={() => {
                  if (isAnkorstoreLoading) return;
                  setResyncAkOpen(true);
                }}
                disabled={isAnkorstoreLoading}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] transition-colors ${
                  isAnkorstoreLoading ? "opacity-50 cursor-wait" : "hover:bg-[#DCFCE7]"
                }`}
                title={
                  isAnkorstoreLoading
                    ? "Une opération Ankorstore est déjà en cours…"
                    : "Resynchroniser toutes les données sur Ankorstore"
                }
                aria-label="Resynchroniser sur Ankorstore"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isAnkorstoreLoading ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </button>
            )}

            {ankorsProductId && (
              <button
                type="button"
                onClick={() => setOrphanAkOpen(true)}
                className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] hover:bg-[#FEF3C7] transition-colors"
                title="Voir et lier manuellement les variantes orphelines (couleurs non encore liées entre votre site et Ankorstore)"
                aria-label="Variantes non liées entre votre site et Ankorstore"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
            )}

            <button
              type="button"
              onClick={() => setLinkAkOpen(true)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-secondary text-text-secondary border border-border hover:bg-bg-tertiary transition-colors"
              title={
                ankorsProductId
                  ? "Re-lier vers un autre produit Ankorstore (utile si la liaison actuelle pointe vers un produit archivé/disparu)"
                  : "Lier à un produit Ankorstore existant"
              }
              aria-label={ankorsProductId ? "Re-lier à un autre produit Ankorstore" : "Lier à un produit Ankorstore existant"}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </button>

            {ankorsProductId && (
              <button
                type="button"
                onClick={handleUnlinkAnkorstore}
                disabled={unlinkAkBusy}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] transition-colors ${
                  unlinkAkBusy ? "opacity-50 cursor-wait" : "hover:bg-[#FEE2E2]"
                }`}
                title="Délier ce produit de sa fiche Ankorstore (efface la liaison côté site sans toucher à Ankorstore)"
                aria-label="Délier ce produit de Ankorstore"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                </svg>
              </button>
            )}
          </div>
        )}

        {showEfashion && (
          <div className="inline-flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[11px] font-semibold font-body border ${
                isEfashionLoading
                  ? "bg-[#EEF2FF] text-[#4F46E5] border-[#C7D2FE]"
                  : efashionLinked
                    ? "bg-[#F0FDF4] text-[#15803D] border-[#BBF7D0]"
                    : "bg-bg-secondary text-text-muted border-border"
              }`}
              title={
                isEfashionLoading
                  ? "Synchronisation eFashion en cours…"
                  : efashionLinked
                    ? "Produit lié à eFashion Paris"
                    : "Pas encore lié à eFashion Paris — cliquez sur l'icône lien"
              }
            >
              {isEfashionLoading ? (
                <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              ) : (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    efashionLinked ? "bg-[#22C55E]" : "bg-text-muted"
                  }`}
                />
              )}
              {isEfashionLoading ? "Sync eFashion…" : efashionLinked ? "eFashion Paris" : "Non lié eFashion"}
            </span>

            {efashionLinked && (
              <button
                type="button"
                onClick={() => {
                  if (isEfashionLoading) return;
                  setResyncEfOpen(true);
                }}
                disabled={isEfashionLoading}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] transition-colors ${
                  isEfashionLoading ? "opacity-50 cursor-wait" : "hover:bg-[#DCFCE7]"
                }`}
                title="Resynchroniser stock + visibilité + prix sur eFashion"
                aria-label="Resynchroniser sur eFashion"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isEfashionLoading ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </button>
            )}

            <button
              type="button"
              onClick={() => setLinkEfOpen(true)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-bg-secondary text-text-secondary border border-border hover:bg-bg-tertiary transition-colors"
              title={
                efashionLinked
                  ? "Re-lier vers une autre référence eFashion"
                  : "Lier à un produit eFashion existant"
              }
              aria-label={efashionLinked ? "Re-lier à un autre produit eFashion" : "Lier à un produit eFashion existant"}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </button>

            {efashionLinked && (
              <button
                type="button"
                onClick={handleUnlinkEfashion}
                disabled={unlinkEfBusy}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA] transition-colors ${
                  unlinkEfBusy ? "opacity-50 cursor-wait" : "hover:bg-[#FEE2E2]"
                }`}
                title="Délier ce produit de ses fiches eFashion (efface la liaison côté site sans toucher à eFashion)"
                aria-label="Délier ce produit de eFashion Paris"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {confirmPfsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Publier sur Paris Fashion Shop ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Ce produit n&apos;existe pas encore sur Paris Fashion Shop.
              Voulez-vous le créer maintenant ?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmPfsOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handlePublishPfs}
                className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] rounded-none hover:bg-[#B91C1C] transition-colors font-body"
              >
                Oui, publier
              </button>
            </div>
          </div>
        </div>
      )}

      {resyncPfsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#F0FDF4] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#15803D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Resynchroniser sur Paris Fashion Shop ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Toutes les données du produit (nom, description, photos, prix, stock,
              statut, Best Seller, variantes) seront renvoyées à Paris Fashion Shop
              pour s&apos;assurer que les deux côtés sont identiques. L&apos;identifiant
              PFS du produit reste inchangé.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResyncPfsOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleResyncPfs}
                className="px-4 py-2 text-sm font-medium text-white bg-[#15803D] rounded-none hover:bg-[#166534] transition-colors font-body"
              >
                Oui, resynchroniser
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF2F2] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#DC2626]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Publier sur Ankorstore ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Ce produit n&apos;existe pas encore sur Ankorstore.
              Voulez-vous le créer maintenant ?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAkOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handlePublishAnkorstore}
                className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] rounded-none hover:bg-[#B91C1C] transition-colors font-body"
              >
                Oui, publier
              </button>
            </div>
          </div>
        </div>
      )}

      {resyncAkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#F0FDF4] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#15803D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Resynchroniser sur Ankorstore ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              Toutes les données du produit (nom, description, photos, prix, stock,
              statut, variantes) seront renvoyées à Ankorstore pour s&apos;assurer que
              les deux côtés sont identiques. L&apos;identifiant Ankorstore du produit
              reste inchangé.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResyncAkOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleResyncAnkorstore}
                className="px-4 py-2 text-sm font-medium text-white bg-[#15803D] rounded-none hover:bg-[#166534] transition-colors font-body"
              >
                Oui, resynchroniser
              </button>
            </div>
          </div>
        </div>
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

      {resyncEfOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-none shadow-lg p-6 max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#F0FDF4] flex items-center justify-center">
                <svg className="w-5 h-5 text-[#15803D]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                </svg>
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary">
                  Resynchroniser sur eFashion Paris ?
                </h3>
                <p className="text-sm text-text-secondary font-body">
                  {productName} ({reference})
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary font-body">
              On va renvoyer à eFashion la visibilité (en ligne / hors ligne),
              le prix et le stock de toutes les couleurs liées. Les liaisons existantes
              restent inchangées.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResyncEfOpen(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-bg-secondary border border-border rounded-none hover:bg-bg-tertiary transition-colors font-body"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleResyncEfashion}
                className="px-4 py-2 text-sm font-medium text-white bg-[#15803D] rounded-none hover:bg-[#166534] transition-colors font-body"
              >
                Oui, resynchroniser
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
