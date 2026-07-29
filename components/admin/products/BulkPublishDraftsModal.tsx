"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  previewBulkPublishDrafts,
  type BulkPublishDraftPreviewItem,
} from "@/app/actions/admin/products";
import { useMarketplaceMaintenance } from "@/components/admin/products/MarketplaceMaintenanceContext";

export interface BulkPublishDraftsConfirm {
  eligibleIds: string[];
  publishPfs: boolean;
  publishAnkorstore: boolean;
  publishEfashion: boolean;
  publishFaire: boolean;
  publishMicrostore: boolean;
  /** ids des produits éligibles pour eFashion (pas encore liés) — sous-ensemble d'eligibleIds */
  efashionEligibleIds: string[];
  /** ids des produits éligibles pour Microstore (microstoreEnabled=true) */
  microstoreEligibleIds: string[];
}

interface Props {
  open: boolean;
  productIds: string[];
  hasPfsConfig: boolean;
  hasAnkorstoreConfig: boolean;
  ankorstoreEnabled: boolean;
  hasEfashionConfig: boolean;
  efashionEnabled: boolean;
  hasFaireConfig: boolean;
  faireEnabled: boolean;
  hasMicrostoreConfig: boolean;
  onCancel: () => void;
  onConfirm: (decision: BulkPublishDraftsConfirm) => void;
}

// Gradients FIGÉS du CLAUDE.md — mêmes qu'ailleurs pour cohérence visuelle.
type MarketplaceKey = "pfs" | "ankorstore" | "efashion" | "faire" | "microstore";

const CHIP_GRADIENT: Record<MarketplaceKey, string> = {
  pfs:        "linear-gradient(135deg,#4f46e5,#6366f1)",
  ankorstore: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  efashion:   "linear-gradient(135deg,#db2777,#ec4899)",
  faire:      "linear-gradient(135deg,#f59e0b,#fbbf24)",
  microstore: "linear-gradient(135deg,#0891b2,#22d3ee)",
};

const CHIP_INITIALS: Record<MarketplaceKey, string> = {
  pfs: "P",
  ankorstore: "A",
  efashion: "E",
  faire: "F",
  microstore: "M",
};

const LABEL: Record<MarketplaceKey, string> = {
  pfs: "Paris Fashion Shop",
  ankorstore: "Ankorstore",
  efashion: "eFashion Paris",
  faire: "Faire",
  microstore: "Microstore",
};

const DESCRIPTION: Record<MarketplaceKey, string> = {
  pfs: "Crée une nouvelle fiche PFS avec la référence en cours.",
  ankorstore: "Crée la fiche Ankorstore. Traitement en arrière-plan.",
  efashion: "Ajoute au ticket de shooting eFashion à valider en bas à droite.",
  faire: "Crée la fiche Faire avec toutes ses infos.",
  microstore: "Envoie la fiche Microstore (créée si absente, mise à jour sinon).",
};

function Switch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`relative inline-flex items-center h-[22px] w-[40px] rounded-full transition-colors duration-200 shrink-0 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${checked ? "bg-bg-dark" : "bg-border-dark"}`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${
          checked ? "translate-x-[21px]" : "translate-x-[3px]"
        }`}
      />
    </span>
  );
}

function MarketplaceCard({
  mkKey,
  checked,
  onToggle,
  eligibleCount,
  totalEligible,
  inMaintenance = false,
  showShootingWarning = false,
  extraHint,
}: {
  mkKey: MarketplaceKey;
  checked: boolean;
  onToggle: (v: boolean) => void;
  eligibleCount: number;
  totalEligible: number;
  inMaintenance?: boolean;
  showShootingWarning?: boolean;
  extraHint?: string;
}) {
  const allDisabled = inMaintenance || eligibleCount === 0;

  return (
    <div
      onClick={() => !allDisabled && onToggle(!checked)}
      className={`relative overflow-hidden rounded-2xl border transition-colors ${
        allDisabled
          ? "border-border bg-bg-secondary cursor-not-allowed opacity-70"
          : checked
            ? "border-border-dark bg-bg-secondary cursor-pointer"
            : "border-border bg-bg-primary hover:border-border-dark cursor-pointer"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex items-center justify-center w-[42px] h-[42px] rounded-xl text-white font-heading font-bold text-sm shrink-0"
          style={{
            background: CHIP_GRADIENT[mkKey],
            filter: allDisabled ? "grayscale(1) brightness(0.85)" : undefined,
          }}
        >
          {CHIP_INITIALS[mkKey]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span
                className={`font-semibold text-sm ${
                  allDisabled ? "text-text-muted line-through" : "text-text-primary"
                }`}
              >
                {LABEL[mkKey]}
              </span>
              {inMaintenance && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
                  En maintenance
                </span>
              )}
              {!inMaintenance && eligibleCount === 0 && totalEligible > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] border border-[#FDE68A]">
                  Rien à publier
                </span>
              )}
            </div>
            {!allDisabled && (
              <Switch checked={checked} onChange={onToggle} />
            )}
          </div>
          <p className="text-xs text-text-secondary leading-relaxed">
            {DESCRIPTION[mkKey]}
          </p>

          {totalEligible > 0 && (
            <div className="flex items-center gap-3 mt-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1 text-[color:var(--color-success)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-success)]" />
                {eligibleCount} à publier
              </span>
              {eligibleCount < totalEligible && (
                <span className="inline-flex items-center gap-1 text-text-muted">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
                  {totalEligible - eligibleCount} sauté(s)
                </span>
              )}
            </div>
          )}

          {extraHint && !allDisabled && (
            <p className="text-[11px] text-text-muted mt-1.5 leading-tight">{extraHint}</p>
          )}

          {showShootingWarning && !allDisabled && (
            <div className="inline-flex items-start gap-1.5 mt-2 px-2 py-1 rounded-lg bg-[color:var(--color-warning-bg)] border border-[#FDE68A]">
              <svg
                className="w-3 h-3 text-[color:var(--color-warning)] flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="text-[10px] text-[color:var(--color-warning)] leading-tight">
                Créera un <span className="font-semibold">ticket de shooting</span> à valider dans la fenêtre eFashion en bas à droite.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BulkPublishDraftsModal({
  open,
  productIds,
  hasPfsConfig,
  hasAnkorstoreConfig,
  ankorstoreEnabled,
  hasEfashionConfig,
  efashionEnabled,
  hasFaireConfig,
  faireEnabled,
  hasMicrostoreConfig,
  onCancel,
  onConfirm,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BulkPublishDraftPreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const maintenance = useMarketplaceMaintenance();
  const [publishPfs, setPublishPfs] = useState(false);
  const [publishAnkorstore, setPublishAnkorstore] = useState(false);
  const [publishEfashion, setPublishEfashion] = useState(false);
  const [publishFaire, setPublishFaire] = useState(false);
  const [publishMicrostore, setPublishMicrostore] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);
  const productIdsRef = useRef<string[]>(productIds);
  productIdsRef.current = productIds;
  const hasPfsConfigRef = useRef(hasPfsConfig);
  hasPfsConfigRef.current = hasPfsConfig;
  const showAnkorstore = hasAnkorstoreConfig && ankorstoreEnabled;
  const showAnkorstoreRef = useRef(showAnkorstore);
  showAnkorstoreRef.current = showAnkorstore;
  const showEfashion = hasEfashionConfig && efashionEnabled;
  const showEfashionRef = useRef(showEfashion);
  showEfashionRef.current = showEfashion;
  const showFaire = hasFaireConfig && faireEnabled;
  const showFaireRef = useRef(showFaire);
  showFaireRef.current = showFaire;
  const showMicrostore = hasMicrostoreConfig;
  const showMicrostoreRef = useRef(showMicrostore);
  showMicrostoreRef.current = showMicrostore;
  const frozenIdsRef = useRef<string[]>([]);

  useEffect(() => { setMounted(true); }, []);

  // Préchargement de l'éligibilité — une seule fois par ouverture, avec les
  // ids figés au moment du clic (les props peuvent bouger pendant le poll widget).
  useEffect(() => {
    if (!open) return;
    frozenIdsRef.current = [...productIdsRef.current];
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setClosing(false);
    // Pré-coche toutes les marketplaces configurées et non en maintenance —
    // aligné sur la modale « Propager » (defaultAllChecked).
    setPublishPfs(hasPfsConfigRef.current && !maintenance.pfs);
    setPublishAnkorstore(showAnkorstoreRef.current && !maintenance.ankorstore);
    setPublishEfashion(showEfashionRef.current && !maintenance.efashion);
    setPublishFaire(showFaireRef.current && !maintenance.faire);
    setPublishMicrostore(showMicrostoreRef.current);
    (async () => {
      try {
        const res = await previewBulkPublishDrafts(frozenIdsRef.current);
        if (!cancelled) setItems(res);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erreur de chargement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => onCancel(), 200);
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const {
    eligible,
    ineligible,
    eligibleCount,
    ineligibleCount,
    efashionEligibleIds,
    efashionEligibleCount,
    microstoreEligibleIds,
    microstoreEligibleCount,
    pfsEligibleCount,
    ankorsEligibleCount,
    faireEligibleCount,
  } = useMemo(() => {
    const eligibleItems = items.filter((p) => p.eligible);
    const ineligibleItems = items.filter((p) => !p.eligible);
    // eFashion : uniquement les produits pas encore liés à eFashion.
    const efaEligible = eligibleItems.filter((p) => !p.efashionAlreadyPublished);
    // Microstore : uniquement les produits avec toggle Microstore activé.
    const msEligible = eligibleItems.filter((p) => p.microstoreEnabled);
    // PFS / Ankor : tous les brouillons éligibles sont candidats (ils n'ont
    // par définition pas d'ID marketplace puisque ce sont des OFFLINE).
    return {
      eligible: eligibleItems,
      ineligible: ineligibleItems,
      eligibleCount: eligibleItems.length,
      ineligibleCount: ineligibleItems.length,
      efashionEligibleIds: efaEligible.map((p) => p.id),
      efashionEligibleCount: efaEligible.length,
      microstoreEligibleIds: msEligible.map((p) => p.id),
      microstoreEligibleCount: msEligible.length,
      pfsEligibleCount: eligibleItems.filter((p) => !p.pfsAlreadyPublished).length,
      ankorsEligibleCount: eligibleItems.filter((p) => !p.ankorsAlreadyPublished).length,
      faireEligibleCount: eligibleItems.length,
    };
  }, [items]);

  if (!open || !mounted) return null;

  const totalCount = frozenIdsRef.current.length || productIds.length;
  const noMarketplaceAvailable =
    !hasPfsConfig && !showAnkorstore && !showEfashion && !showFaire && !showMicrostore;
  const noMarketplaceChecked =
    !publishPfs && !publishAnkorstore && !publishEfashion && !publishFaire && !publishMicrostore;
  const canContinue =
    !loading &&
    !error &&
    eligibleCount > 0 &&
    (noMarketplaceAvailable || !noMarketplaceChecked);

  const selectedMarketplaceCount =
    Number(publishPfs && hasPfsConfig && !maintenance.pfs) +
    Number(publishAnkorstore && showAnkorstore && !maintenance.ankorstore) +
    Number(publishEfashion && showEfashion && !maintenance.efashion && efashionEligibleCount > 0) +
    Number(publishFaire && showFaire && !maintenance.faire) +
    Number(publishMicrostore && showMicrostore && microstoreEligibleCount > 0);

  const handleConfirm = () => {
    setClosing(true);
    setTimeout(() => {
      onConfirm({
        eligibleIds: eligible.map((p) => p.id),
        publishPfs: publishPfs && hasPfsConfig && !maintenance.pfs,
        publishAnkorstore: publishAnkorstore && showAnkorstore && !maintenance.ankorstore,
        publishEfashion: publishEfashion && showEfashion && !maintenance.efashion,
        publishFaire: publishFaire && showFaire && !maintenance.faire,
        publishMicrostore: publishMicrostore && showMicrostore,
        efashionEligibleIds,
        microstoreEligibleIds,
      });
    }, 200);
  };

  const modal = (
    <div
      ref={backdropRef}
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === backdropRef.current; }}
      onMouseUp={(e) => {
        if (e.target === backdropRef.current && mouseDownOnBackdrop.current) close();
        mouseDownOnBackdrop.current = false;
      }}
      role="dialog"
      aria-modal="true"
      className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 transition-all duration-200 ${
        closing ? "bg-black/0 backdrop-blur-0" : "bg-black/40 backdrop-blur-[3px]"
      }`}
      style={{ animation: closing ? undefined : "publishDraftsFadeIn 0.2s ease-out" }}
    >
      <div
        className={`relative w-full max-w-2xl bg-bg-primary rounded-3xl shadow-2xl border border-border overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "publishDraftsSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        {/* Header */}
        <div className="px-6 md:px-8 pt-5 pb-5 bg-bg-primary border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div
                className="text-[10.5px] font-bold uppercase text-text-muted mb-2"
                style={{ letterSpacing: "0.2em" }}
              >
                Publier brouillons
              </div>
              <h2 className="font-heading text-xl md:text-2xl font-bold text-text-primary leading-tight">
                Publier {totalCount} brouillon{totalCount > 1 ? "s" : ""}
                {totalCount > 1 ? " sur les marketplaces" : ""} ?
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                Les brouillons éligibles seront mis en ligne sur votre boutique,
                puis publiés sur les marketplaces cochées.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="w-8 h-8 rounded-full hover:bg-bg-secondary flex items-center justify-center text-text-muted hover:text-text-primary transition shrink-0"
              aria-label="Fermer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto" style={{ maxHeight: "60vh" }}>
          {loading && (
            <div className="px-6 md:px-8 py-10 flex items-center justify-center gap-3 text-text-secondary text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
              </svg>
              Vérification des fiches en cours…
            </div>
          )}

          {!loading && error && (
            <div className="mx-6 md:mx-8 my-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] text-red-700">
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* KPI tiles */}
              <div className="px-6 md:px-8 pt-5">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl p-3 bg-bg-secondary border border-border">
                    <div
                      className="text-[10px] font-bold uppercase text-text-muted mb-1"
                      style={{ letterSpacing: "0.18em" }}
                    >
                      Sélectionnés
                    </div>
                    <div className="font-heading text-2xl font-bold text-text-primary">
                      {totalCount}
                    </div>
                  </div>
                  <div className="rounded-2xl p-3 bg-[color:var(--color-success-bg)] border border-[#BBF7D0]">
                    <div
                      className="text-[10px] font-bold uppercase text-[color:var(--color-success)] mb-1"
                      style={{ letterSpacing: "0.18em" }}
                    >
                      Prêts à publier
                    </div>
                    <div className="font-heading text-2xl font-bold text-[color:var(--color-success)]">
                      {eligibleCount}
                    </div>
                  </div>
                  <div className="rounded-2xl p-3 bg-[color:var(--color-warning-bg)] border border-[#FDE68A]">
                    <div
                      className="text-[10px] font-bold uppercase text-[color:var(--color-warning)] mb-1"
                      style={{ letterSpacing: "0.18em" }}
                    >
                      Incomplets
                    </div>
                    <div className="font-heading text-2xl font-bold text-[color:var(--color-warning)]">
                      {ineligibleCount}
                    </div>
                  </div>
                </div>
              </div>

              {/* Marketplaces section */}
              {eligibleCount > 0 && !noMarketplaceAvailable && (
                <div className="px-6 md:px-8 pt-5 pb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-1 h-4 rounded-full bg-bg-dark" />
                    <span
                      className="text-[10px] font-bold uppercase text-text-muted"
                      style={{ letterSpacing: "0.18em" }}
                    >
                      Marketplaces
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {hasPfsConfig && (
                      <MarketplaceCard
                        mkKey="pfs"
                        checked={publishPfs && !maintenance.pfs}
                        onToggle={(v) => setPublishPfs(v)}
                        eligibleCount={pfsEligibleCount}
                        totalEligible={eligibleCount}
                        inMaintenance={maintenance.pfs}
                      />
                    )}
                    {showAnkorstore && (
                      <MarketplaceCard
                        mkKey="ankorstore"
                        checked={publishAnkorstore && !maintenance.ankorstore}
                        onToggle={(v) => setPublishAnkorstore(v)}
                        eligibleCount={ankorsEligibleCount}
                        totalEligible={eligibleCount}
                        inMaintenance={maintenance.ankorstore}
                      />
                    )}
                    {showEfashion && (
                      <MarketplaceCard
                        mkKey="efashion"
                        checked={publishEfashion && !maintenance.efashion && efashionEligibleCount > 0}
                        onToggle={(v) => setPublishEfashion(v)}
                        eligibleCount={efashionEligibleCount}
                        totalEligible={eligibleCount}
                        inMaintenance={maintenance.efashion}
                        showShootingWarning={efashionEligibleCount > 0}
                        extraHint={
                          efashionEligibleCount === 0
                            ? "Tous les produits éligibles sont déjà liés à eFashion."
                            : undefined
                        }
                      />
                    )}
                    {showFaire && (
                      <MarketplaceCard
                        mkKey="faire"
                        checked={publishFaire && !maintenance.faire}
                        onToggle={(v) => setPublishFaire(v)}
                        eligibleCount={faireEligibleCount}
                        totalEligible={eligibleCount}
                        inMaintenance={maintenance.faire}
                      />
                    )}
                    {showMicrostore && (
                      <MarketplaceCard
                        mkKey="microstore"
                        checked={publishMicrostore && microstoreEligibleCount > 0}
                        onToggle={(v) => setPublishMicrostore(v)}
                        eligibleCount={microstoreEligibleCount}
                        totalEligible={eligibleCount}
                        extraHint={
                          microstoreEligibleCount === 0
                            ? "Aucun produit éligible n'a Microstore activé (à cocher sur chaque fiche)."
                            : "Les photos ne sont pas envoyées — à ajouter côté Microstore si besoin."
                        }
                      />
                    )}
                  </div>
                </div>
              )}

              {eligibleCount > 0 && noMarketplaceAvailable && (
                <div className="mx-6 md:mx-8 mt-4 mb-2 rounded-2xl bg-bg-secondary border border-border px-4 py-3 text-[13px] text-text-secondary">
                  Aucune marketplace n&apos;est configurée — les produits seront mis
                  en ligne sur la boutique uniquement.
                </div>
              )}

              {eligibleCount === 0 && (
                <div className="mx-6 md:mx-8 mt-4 mb-2 rounded-2xl bg-bg-secondary border border-border px-4 py-3 text-[13px] text-text-secondary">
                  Aucun brouillon n&apos;est prêt à être mis en ligne. Complétez d&apos;abord les fiches ci-dessous.
                </div>
              )}

              {/* Incomplet — liste détaillée */}
              {ineligibleCount > 0 && (
                <div className="px-6 md:px-8 pb-6">
                  <details open className="rounded-2xl border border-[#FDE68A] bg-[color:var(--color-warning-bg)] overflow-hidden">
                    <summary className="px-4 py-2.5 cursor-pointer list-none flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-warning)]" />
                        <span className="text-[12px] font-semibold text-[color:var(--color-warning)] uppercase tracking-wide">
                          {ineligibleCount} brouillon{ineligibleCount > 1 ? "s" : ""} incomplet{ineligibleCount > 1 ? "s" : ""} — non publié{ineligibleCount > 1 ? "s" : ""}
                        </span>
                      </div>
                      <svg className="w-4 h-4 text-[color:var(--color-warning)] transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </summary>
                    <div className="max-h-64 overflow-y-auto divide-y divide-[#FDE68A]/60 bg-bg-primary">
                      {ineligible.map((p) => (
                        <div key={p.id} className="px-4 py-3">
                          <p className="text-[13px] font-medium text-text-primary">
                            <span className="text-text-muted">Réf.</span> {p.reference}
                            {p.name && <span className="text-text-secondary"> — {p.name}</span>}
                          </p>
                          <ul className="mt-1.5 space-y-0.5">
                            {p.reasons.map((reason, i) => (
                              <li key={i} className="text-[12px] text-[color:var(--color-warning)] flex items-start gap-1.5">
                                <span aria-hidden="true" className="mt-1 inline-block w-1 h-1 rounded-full bg-[color:var(--color-warning)] shrink-0" />
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-bg-primary px-6 md:px-8 py-4 flex items-center justify-between gap-3">
          <div className="text-xs text-text-muted">
            {selectedMarketplaceCount === 0 && !noMarketplaceAvailable ? (
              "Aucune destination sélectionnée"
            ) : (
              <>
                <span className="font-semibold text-text-primary">
                  {eligibleCount} produit{eligibleCount > 1 ? "s" : ""}
                </span>{" "}
                à mettre en ligne
                {selectedMarketplaceCount > 0 && (
                  <>
                    {" · "}
                    <span className="font-semibold text-text-primary">
                      {selectedMarketplaceCount} destination{selectedMarketplaceCount > 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition rounded-lg"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => { if (canContinue) handleConfirm(); }}
              disabled={!canContinue}
              autoFocus={canContinue}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-xl transition ${
                !canContinue
                  ? "bg-bg-tertiary text-text-muted cursor-not-allowed"
                  : "bg-bg-dark text-text-inverse hover:bg-black"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {eligibleCount === 0
                ? "Continuer"
                : `Publier (${eligibleCount})`}
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes publishDraftsFadeIn {
          from { background-color: rgba(0, 0, 0, 0); }
          to { background-color: rgba(0, 0, 0, 0.4); }
        }
        @keyframes publishDraftsSlideUp {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
}
