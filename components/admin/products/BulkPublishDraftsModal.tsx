"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** ids des produits éligibles pour eFashion (pas encore liés) — sous-ensemble d'eligibleIds */
  efashionEligibleIds: string[];
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
  onCancel: () => void;
  onConfirm: (decision: BulkPublishDraftsConfirm) => void;
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
  onCancel,
  onConfirm,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BulkPublishDraftPreviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const maintenance = useMarketplaceMaintenance();
  const [publishPfs, setPublishPfs] = useState(true);
  const [publishAnkorstore, setPublishAnkorstore] = useState(true);
  const [publishEfashion, setPublishEfashion] = useState(true);
  const [publishFaire, setPublishFaire] = useState(true);
  const backdropRef = useRef<HTMLDivElement>(null);
  const mouseDownOnBackdrop = useRef(false);
  // Liste des ids capturée à l'ouverture. La prop `productIds` change de
  // référence à chaque render parent (le widget marketplace poll la file et
  // déclenche router.refresh()), donc on la lit via ref et on ne dépend pas
  // d'elle dans le useEffect du fetch (sinon l'effet se relance en boucle).
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
  const frozenIdsRef = useRef<string[]>([]);

  useEffect(() => { setMounted(true); }, []);

  // Préchargement de l'éligibilité dès l'ouverture — une seule fois, avec les
  // ids figés au moment du clic. On ne dépend QUE de `open` pour ne pas
  // re-déclencher le fetch quand les props instables changent.
  useEffect(() => {
    if (!open) return;
    frozenIdsRef.current = [...productIdsRef.current];
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    setClosing(false);
    // Ne pas pré-cocher les marketplaces en maintenance : le serveur refuserait.
    setPublishPfs(hasPfsConfigRef.current && !maintenance.pfs);
    setPublishAnkorstore(showAnkorstoreRef.current && !maintenance.ankorstore);
    setPublishEfashion(showEfashionRef.current && !maintenance.efashion);
    setPublishFaire(showFaireRef.current && !maintenance.faire);
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

  if (!open || !mounted) return null;

  const eligible = items.filter((p) => p.eligible);
  const ineligible = items.filter((p) => !p.eligible);
  const eligibleCount = eligible.length;
  const ineligibleCount = ineligible.length;
  // Sous-ensemble eFashion : produits éligibles qui ne sont pas déjà liés à
  // eFashion (au moins une couleur sans efashionProductId). Les produits déjà
  // liés ne déclenchent pas de re-publication.
  const efashionEligible = eligible.filter((p) => !p.efashionAlreadyPublished);
  const efashionEligibleCount = efashionEligible.length;
  // Compteur du titre : on s'appuie sur les ids figés à l'ouverture pour ne pas
  // laisser le nombre changer si la prop `productIds` bouge entre-temps.
  const totalCount = frozenIdsRef.current.length || productIds.length;
  const noMarketplaceAvailable = !hasPfsConfig && !showAnkorstore && !showEfashion && !showFaire;
  const noMarketplaceChecked = !publishPfs && !publishAnkorstore && !publishEfashion && !publishFaire;
  const canContinue =
    !loading &&
    !error &&
    eligibleCount > 0 &&
    (noMarketplaceAvailable || !noMarketplaceChecked);

  const handleConfirm = () => {
    setClosing(true);
    setTimeout(() => {
      onConfirm({
        eligibleIds: eligible.map((p) => p.id),
        publishPfs: publishPfs && hasPfsConfig && !maintenance.pfs,
        publishAnkorstore: publishAnkorstore && showAnkorstore && !maintenance.ankorstore,
        publishEfashion: publishEfashion && showEfashion && !maintenance.efashion,
        publishFaire: publishFaire && showFaire && !maintenance.faire,
        efashionEligibleIds: efashionEligible.map((p) => p.id),
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
        closing ? "bg-black/0 backdrop-blur-0" : "bg-black/30 backdrop-blur-[3px]"
      }`}
      style={{ animation: closing ? undefined : "confirmFadeIn 0.2s ease-out" }}
    >
      <div
        className={`bg-bg-primary rounded-2xl shadow-xl border border-border w-full max-w-2xl overflow-hidden transition-all duration-200 ${
          closing ? "opacity-0 scale-95 translate-y-2" : "opacity-100 scale-100 translate-y-0"
        }`}
        style={{ animation: closing ? undefined : "confirmSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)" }}
      >
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[#EEF2FF]">
              <svg className="w-5 h-5" fill="none" stroke="#4F46E5" viewBox="0 0 24 24" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 className="font-heading text-[15px] font-semibold text-text-primary leading-tight">
                Publier {totalCount} brouillon{totalCount > 1 ? "s" : ""} sur les marketplaces
              </h3>
              <p className="text-sm font-body text-text-secondary mt-1.5 leading-relaxed">
                Les brouillons éligibles vont être mis en ligne sur votre boutique
                puis publiés sur les marketplaces cochées.
              </p>
            </div>
          </div>
        </div>

        {loading && (
          <div className="px-6 pb-6 flex items-center justify-center gap-3 text-text-secondary text-sm font-body">
            <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
            </svg>
            Vérification des fiches en cours…
          </div>
        )}

        {!loading && error && (
          <div className="mx-6 mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[13px] font-body text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Bilan en haut */}
            <div className="mx-6 mb-3 flex flex-wrap gap-2">
              {eligibleCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium font-body bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                  {eligibleCount} prêt{eligibleCount > 1 ? "s" : ""} à publier
                </span>
              )}
              {ineligibleCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium font-body bg-red-50 text-red-700 border border-red-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {ineligibleCount} ne peu{ineligibleCount > 1 ? "vent" : "t"} pas être publié{ineligibleCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Liste des non éligibles avec raisons */}
            {ineligibleCount > 0 && (
              <div className="mx-6 mb-4 rounded-xl border border-red-200 bg-red-50/50 overflow-hidden">
                <div className="px-4 py-2.5 bg-red-50 border-b border-red-200">
                  <p className="text-[12px] font-body font-semibold text-red-800 uppercase tracking-wide">
                    Brouillons incomplets — ils ne seront pas mis en ligne
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto divide-y divide-red-100">
                  {ineligible.map((p) => (
                    <div key={p.id} className="px-4 py-3">
                      <p className="text-[13px] font-body font-medium text-text-primary">
                        <span className="text-text-muted">Réf.</span> {p.reference}
                        {p.name && <span className="text-text-secondary"> — {p.name}</span>}
                      </p>
                      <ul className="mt-1.5 space-y-0.5">
                        {p.reasons.map((reason, i) => (
                          <li key={i} className="text-[12px] font-body text-red-700 flex items-start gap-1.5">
                            <span aria-hidden="true" className="mt-1 inline-block w-1 h-1 rounded-full bg-red-400 shrink-0" />
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Choix marketplaces pour les éligibles */}
            {eligibleCount > 0 && (
              <div className="mx-6 mb-4 rounded-xl bg-bg-secondary border border-border p-4">
                {noMarketplaceAvailable ? (
                  <p className="text-[12px] font-body text-text-muted">
                    Aucune marketplace n&apos;est configurée — les produits seront mis
                    en ligne sur la boutique uniquement.
                  </p>
                ) : (
                  <>
                    <p className="text-[12px] font-body font-semibold text-text-primary uppercase tracking-wide mb-2.5">
                      Publier également sur
                    </p>
                    <div className="space-y-2">
                      {hasPfsConfig && (
                        <label
                          className={`flex items-center gap-2.5 text-[13px] font-body ${
                            maintenance.pfs ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          }`}
                          title={maintenance.pfs ? "Paris Fashion Shop en maintenance sur la plateforme" : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={publishPfs && !maintenance.pfs}
                            disabled={maintenance.pfs}
                            onChange={(e) => setPublishPfs(e.target.checked)}
                            className="checkbox-custom"
                          />
                          <span className={maintenance.pfs ? "text-text-muted line-through" : "text-text-primary"}>
                            Paris Fashion Shop ({eligibleCount} produit{eligibleCount > 1 ? "s" : ""})
                            {maintenance.pfs && <span className="ml-2 text-[11px] font-semibold text-[#B91C1C]">· En maintenance</span>}
                          </span>
                        </label>
                      )}
                      {showAnkorstore && (
                        <label
                          className={`flex items-center gap-2.5 text-[13px] font-body ${
                            maintenance.ankorstore ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          }`}
                          title={maintenance.ankorstore ? "Ankorstore en maintenance sur la plateforme" : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={publishAnkorstore && !maintenance.ankorstore}
                            disabled={maintenance.ankorstore}
                            onChange={(e) => setPublishAnkorstore(e.target.checked)}
                            className="checkbox-custom"
                          />
                          <span className={maintenance.ankorstore ? "text-text-muted line-through" : "text-text-primary"}>
                            Ankorstore ({eligibleCount} produit{eligibleCount > 1 ? "s" : ""})
                            {maintenance.ankorstore && <span className="ml-2 text-[11px] font-semibold text-[#B91C1C]">· En maintenance</span>}
                          </span>
                        </label>
                      )}
                      {showEfashion && (
                        <label
                          className={`flex items-start gap-2.5 text-[13px] font-body ${
                            maintenance.efashion || efashionEligibleCount === 0
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer"
                          }`}
                          title={maintenance.efashion ? "eFashion Paris en maintenance sur la plateforme" : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={publishEfashion && efashionEligibleCount > 0 && !maintenance.efashion}
                            disabled={efashionEligibleCount === 0 || maintenance.efashion}
                            onChange={(e) => setPublishEfashion(e.target.checked)}
                            className="checkbox-custom mt-0.5"
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className={maintenance.efashion ? "text-text-muted line-through" : "text-text-primary"}>
                              eFashion Paris ({efashionEligibleCount} produit{efashionEligibleCount > 1 ? "s" : ""}
                              {efashionEligibleCount !== eligibleCount && ` sur ${eligibleCount}`})
                              {maintenance.efashion && <span className="ml-2 text-[11px] font-semibold text-[#B91C1C]">· En maintenance</span>}
                            </span>
                            <span className="text-[11px] text-text-muted">
                              {efashionEligibleCount === 0
                                ? "Tous les produits éligibles sont déjà liés à eFashion."
                                : "Ajoutés à la file shooting — à valider depuis la fenêtre eFashion en bas à droite."}
                            </span>
                          </span>
                        </label>
                      )}
                      {showFaire && (
                        <label
                          className={`flex items-center gap-2.5 text-[13px] font-body ${
                            maintenance.faire ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                          }`}
                          title={maintenance.faire ? "Faire en maintenance sur la plateforme" : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={publishFaire && !maintenance.faire}
                            disabled={maintenance.faire}
                            onChange={(e) => setPublishFaire(e.target.checked)}
                            className="checkbox-custom"
                          />
                          <span className={maintenance.faire ? "text-text-muted line-through" : "text-text-primary"}>
                            Faire ({eligibleCount} produit{eligibleCount > 1 ? "s" : ""})
                            {maintenance.faire && <span className="ml-2 text-[11px] font-semibold text-[#B91C1C]">· En maintenance</span>}
                          </span>
                        </label>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {eligibleCount === 0 && (
              <div className="mx-6 mb-4 rounded-xl bg-bg-secondary border border-border px-4 py-3 text-[13px] font-body text-text-secondary">
                Aucun brouillon n&apos;est prêt à être mis en ligne. Complétez les fiches d&apos;abord.
              </div>
            )}
          </>
        )}

        <div className="h-px bg-border mx-6" />

        <div className="px-6 py-4 flex flex-col sm:flex-row items-stretch gap-2.5">
          <button
            type="button"
            onClick={close}
            className="sm:flex-1 inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-[13px] font-medium font-body text-text-secondary bg-bg-primary border border-border rounded-lg hover:bg-bg-secondary hover:text-text-primary transition-all duration-150 active:scale-[0.98]"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => { if (canContinue) handleConfirm(); }}
            disabled={!canContinue}
            autoFocus={canContinue}
            className={`sm:flex-1 inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold font-body rounded-lg border transition-all duration-150 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-offset-1 ${
              !canContinue
                ? "text-text-muted border-border bg-bg-secondary opacity-50 cursor-not-allowed"
                : "bg-[#4F46E5] hover:bg-[#4338CA] text-white border-transparent focus:ring-[#6366F1]/30"
            }`}
          >
            {eligibleCount === 0
              ? "Continuer"
              : `Continuer (${eligibleCount} produit${eligibleCount > 1 ? "s" : ""})`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
