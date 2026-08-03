"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { getMarketplaceMarkupConfig } from "@/app/actions/admin/marketplace-pricing";
import {
  applyMarketplaceMarkup,
  type MarkupConfig,
} from "@/lib/marketplace-pricing-shared";
import { useToast } from "@/components/ui/Toast";
import { getImageSrc } from "@/lib/image-utils";
import { useMarketplaceLinkJobs } from "./MarketplaceLinkContext";
import { ZoomableImage } from "./ZoomableImage";
import {
  fetchLinkPreview,
  fetchLinkCandidates,
  fetchLinkPreviewByMarketplaceProductId,
  supportsCandidatePicker,
  executeLink,
  MARKETPLACE_META,
  type Marketplace,
  type MarketplaceMeta,
  type LinkPreview,
  type LinkCandidate,
  type LinkLocalColor,
  type LinkIntents,
  type LinkCandidateProduct,
} from "./linkMarketplaceAdapters";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  marketplace: Marketplace;
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export function shortMarkupLabel(m: MarkupConfig): string {
  if (m.value === 0) return "sans majoration";
  if (m.type === "percent") return `+${m.value} % Majoration`;
  if (m.type === "fixed") return `+ ${EUR.format(m.value)} Majoration`;
  return `× ${String(m.value).replace(".", ",")} Majoration`;
}

// ─── Composant principal ────────────────────────────────────────────────────

export default function LinkMarketplaceModal({
  marketplace,
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { enqueueLinkJob, hasActiveJobForProduct } = useMarketplaceLinkJobs();
  const meta = MARKETPLACE_META[marketplace];

  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchInput, setSearchInput] = useState(reference);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Picker (Ankorstore + Faire) : liste des candidats à trancher quand la
  // référence a des suffixes marketplace (676A, 676GD, ED676P…). Null tant
  // qu'aucune recherche multi-résultat n'a été faite.
  const [candidatesList, setCandidatesList] = useState<LinkCandidateProduct[] | null>(null);
  const [candidatesTruncated, setCandidatesTruncated] = useState(false);
  const [candidatesPage, setCandidatesPage] = useState(1);
  const [pickingCandidateId, setPickingCandidateId] = useState<string | null>(null);
  // Compteur incrémenté à chaque nouvelle recherche OU annulation. Un résultat
  // qui arrive avec un `genId` obsolète est ignoré → laisse l'admin arrêter et
  // relancer sans que l'ancien résultat écrase le nouveau.
  const searchGenRef = useRef(0);
  const [markup, setMarkup] = useState<MarkupConfig | null>(null);
  const [secondaryMarkup, setSecondaryMarkup] = useState<MarkupConfig | null>(null);
  const [shopName, setShopName] = useState<string>("notre boutique");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // Intentions explicites de l'admin sur les couleurs non-mappées :
  //  - colorsToCreate : productColorId des couleurs BJ à créer côté marketplace (+ upload photo)
  //  - orphansToDelete : candidate.id des variantes marketplace à supprimer
  //  - orphansToImport : candidate.id des variantes marketplace à importer en tant que ProductColor BJ + lier
  // orphansToDelete et orphansToImport sont exclusifs. Chaque orpheline marketplace
  // DOIT être dans l'un des deux (validation étape 4 bloque sinon).
  const [colorsToCreate, setColorsToCreate] = useState<Set<string>>(() => new Set());
  const [orphansToDelete, setOrphansToDelete] = useState<Set<string>>(() => new Set());
  const [orphansToImport, setOrphansToImport] = useState<Set<string>>(() => new Set());

  // Charge la config majoration + nom boutique du tenant courant une seule fois.
  // Pour Ankorstore, on charge en plus la 2ᵉ majoration (retail) pour afficher
  // la ligne « Prix de vente/u ».
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const primary = await getMarketplaceMarkupConfig(meta.markupKey);
      if (cancelled) return;
      if (primary.success) {
        setMarkup(primary.data.markup);
        setShopName(primary.data.shopName);
      }
      if (meta.secondaryMarkupKey) {
        const secondary = await getMarketplaceMarkupConfig(meta.secondaryMarkupKey);
        if (!cancelled && secondary.success) {
          setSecondaryMarkup(secondary.data.markup);
        }
      } else if (!cancelled) {
        setSecondaryMarkup(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.markupKey, meta.secondaryMarkupKey]);

  // Fabrique le mapping initial : liens existants + suggestion auto par nom
  const buildInitialMapping = useCallback(
    (data: LinkPreview): Record<string, string> => {
      const initial: Record<string, string> = { ...data.existingLinks };
      const used = new Set(Object.values(initial));
      for (const cand of data.candidates) {
        if (
          cand.suggestedLocalColorId &&
          !(cand.suggestedLocalColorId in initial) &&
          !used.has(cand.id)
        ) {
          initial[cand.suggestedLocalColorId] = cand.id;
          used.add(cand.id);
        }
      }
      return initial;
    },
    [],
  );

  /** Applique une preview au state (mapping + reset des intentions). */
  const applyPreview = useCallback(
    (data: LinkPreview) => {
      setPreview(data);
      setMapping(buildInitialMapping(data));
      setColorsToCreate(new Set());
      setOrphansToDelete(new Set());
      setOrphansToImport(new Set());
    },
    [buildInitialMapping],
  );

  const runSearch = useCallback(
    async (query: string) => {
      const genId = ++searchGenRef.current;
      setSearchError(null);
      setPreview(null);
      setCandidatesList(null);
      setCandidatesTruncated(false);
      setCandidatesPage(1);
      setIsSearching(true);

      try {
        // Ankorstore + Faire : d'abord la liste complète des candidats. Si 1
        // seul match on charge sa preview direct. Sinon on montre le picker.
        if (supportsCandidatePicker(marketplace)) {
          const list = await fetchLinkCandidates(marketplace, query, productId);
          if (genId !== searchGenRef.current) return; // annulé ou remplacé

          if (!list.success) {
            setSearchError(list.error);
            return;
          }

          const cands = list.data.candidates;
          if (cands.length === 0) {
            // Aucune fiche trouvée : on charge une "preview vide" pour que
            // Step1Search affiche son message "aucune fiche pour X".
            const emptyPreview = await fetchLinkPreview(marketplace, productId, query);
            if (genId !== searchGenRef.current) return;
            if (emptyPreview.success) {
              applyPreview(emptyPreview.data);
            } else {
              setSearchError(emptyPreview.error);
            }
            return;
          }

          if (cands.length === 1) {
            // Un seul candidat → on skip le picker et on charge direct.
            const single = await fetchLinkPreviewByMarketplaceProductId(
              marketplace,
              productId,
              cands[0].id,
              query,
            );
            if (genId !== searchGenRef.current) return;
            if (single.success) {
              applyPreview(single.data);
            } else {
              setSearchError(single.error);
            }
            return;
          }

          // ≥ 2 candidats : on montre le picker.
          setCandidatesList(cands);
          setCandidatesTruncated(list.data.truncated);
          setCandidatesPage(1);
          return;
        }

        // PFS / eFashion : flow direct historique (référence propre).
        const res = await fetchLinkPreview(marketplace, productId, query);
        if (genId !== searchGenRef.current) return;
        if (res.success) {
          applyPreview(res.data);
        } else {
          setSearchError(res.error);
        }
      } finally {
        // Ne coupe le spinner que si on n'a pas été annulé/remplacé.
        if (genId === searchGenRef.current) {
          setIsSearching(false);
        }
      }
    },
    [marketplace, productId, applyPreview],
  );

  /** Coupe la recherche en cours : les résultats qui reviendront seront
   *  ignorés (searchGenRef bump). L'admin peut relancer immédiatement. */
  const cancelSearch = useCallback(() => {
    searchGenRef.current += 1;
    setIsSearching(false);
    setPickingCandidateId(null);
  }, []);

  /** Charge la preview du candidat que l'admin a choisi dans le picker. */
  const pickCandidate = useCallback(
    async (candidateId: string) => {
      if (!supportsCandidatePicker(marketplace)) return;
      const genId = ++searchGenRef.current;
      setPickingCandidateId(candidateId);
      setSearchError(null);
      try {
        const res = await fetchLinkPreviewByMarketplaceProductId(
          marketplace,
          productId,
          candidateId,
          searchInput.trim() || reference,
        );
        if (genId !== searchGenRef.current) return;
        if (res.success) {
          applyPreview(res.data);
          setCandidatesList(null); // ferme le picker
        } else {
          setSearchError(res.error);
        }
      } finally {
        if (genId === searchGenRef.current) {
          setPickingCandidateId(null);
        }
      }
    },
    [marketplace, productId, searchInput, reference, applyPreview],
  );

  // Auto-lance la recherche à l'ouverture si la référence produit est présente,
  // pour éviter à l'admin un clic « Chercher » sur une entrée déjà pré-remplie.
  useEffect(() => {
    if (!reference.trim()) return;
    void runSearch(reference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearch = useCallback(() => {
    const q = searchInput.trim();
    if (!q) {
      toast.warning("Référence manquante", "Tape une référence pour chercher.");
      return;
    }
    void runSearch(q);
  }, [searchInput, toast, runSearch]);

  function setColorMapping(productColorId: string, variantId: string) {
    setMapping((prev) => {
      const next = { ...prev };
      // Toggle : reclique = délie
      if (next[productColorId] === variantId) {
        delete next[productColorId];
        return next;
      }
      // Libère la variante si utilisée ailleurs (une variante ne peut être liée qu'à une seule couleur BJ)
      for (const [k, v] of Object.entries(next)) {
        if (v === variantId && k !== productColorId) delete next[k];
      }
      next[productColorId] = variantId;
      return next;
    });
    // Choisir une variante marketplace annule l'intention « créer » pour cette couleur.
    setColorsToCreate((prev) => {
      if (!prev.has(productColorId)) return prev;
      const next = new Set(prev);
      next.delete(productColorId);
      return next;
    });
  }

  function toggleCreateColor(productColorId: string) {
    setColorsToCreate((prev) => {
      const next = new Set(prev);
      if (next.has(productColorId)) next.delete(productColorId);
      else next.add(productColorId);
      return next;
    });
    // Marquer une couleur BJ « à créer » annule sa liaison à une variante marketplace.
    setMapping((prev) => {
      if (!(productColorId in prev)) return prev;
      const next = { ...prev };
      delete next[productColorId];
      return next;
    });
  }

  function setOrphanChoice(candidateId: string, choice: "delete" | "import") {
    // Choix exclusif : marquer « supprimer » enlève « importer », et inversement.
    setOrphansToDelete((prev) => {
      const next = new Set(prev);
      if (choice === "delete") next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
    setOrphansToImport((prev) => {
      const next = new Set(prev);
      if (choice === "import") next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
  }

  function autoMap() {
    if (!preview) return;
    const initial = buildInitialMapping(preview);
    setMapping(initial);
    const linked = Object.keys(initial).length;
    if (linked === 0) {
      toast.warning("Aucune correspondance", "Les noms de couleurs ne se ressemblent pas assez.");
    } else {
      toast.success(
        "Couleurs associées",
        `${linked} correspondance${linked > 1 ? "s" : ""} suggérée${linked > 1 ? "s" : ""}.`,
      );
    }
  }

  async function handleLink() {
    if (!preview || !preview.marketplaceProductId) return;

    // Empêche de relancer deux liaisons en parallèle pour le même produit —
    // le worker écraserait ses propres écritures en base sinon.
    if (hasActiveJobForProduct(productId, marketplace)) {
      toast.warning(
        "Liaison déjà en cours",
        "Attends que la liaison en cours soit terminée avant d'en relancer une pour ce produit.",
      );
      return;
    }

    // eFashion : attributs bloquants (catégorie, pays, saison, matières, couleurs manquantes)
    if (preview.missingAttributes.length > 0) {
      toast.error(
        "Attributs manquants",
        `Complète : ${preview.missingAttributes.join(", ")} avant de lier.`,
      );
      return;
    }

    const totalCoverage = Object.keys(mapping).length + colorsToCreate.size + orphansToImport.size;
    if (totalCoverage === 0) {
      toast.error(
        "Aucune couleur traitée",
        `Sélectionne au moins une variante ${meta.name} à lier, ou marque une couleur à créer/importer.`,
      );
      return;
    }

    // Validation dure : toute variante marketplace non-mappée doit être soit
    // supprimée soit importée. Aucune orpheline non-tranchée n'est autorisée.
    const linkedVariantIds = new Set(Object.values(mapping).filter(Boolean));
    const unresolvedOrphans = preview.candidates.filter(
      (c) => !linkedVariantIds.has(c.id) && !orphansToDelete.has(c.id) && !orphansToImport.has(c.id),
    );
    if (unresolvedOrphans.length > 0) {
      toast.error(
        `${unresolvedOrphans.length} variante(s) ${meta.name} non tranchée(s)`,
        `Pour chaque variante en trop chez ${meta.name}, choisis « Créer chez nous » ou « Supprimer chez ${meta.name} » à l'étape 4.`,
      );
      return;
    }

    // Garde-fou : si on supprime toutes les variantes marketplace ET qu'on ne
    // crée rien à leur place, la fiche marketplace se retrouverait vide.
    const remainingVariantsAfterDelete = preview.candidates.filter(
      (c) => !orphansToDelete.has(c.id) || linkedVariantIds.has(c.id),
    ).length;
    if (remainingVariantsAfterDelete === 0 && colorsToCreate.size === 0) {
      toast.error(
        "Fiche marketplace vide",
        `Impossible : toutes les variantes ${meta.name} seraient supprimées sans rien créer en remplacement.`,
      );
      return;
    }

    // Overlay bloquant le temps que la demande soit vraiment enqueue,
    // puis on ferme et on laisse la suite se faire dans le widget flottant.
    setIsEnqueuing(true);
    const previewSnapshot = preview;
    const mappingSnapshot = { ...mapping };
    const intentsSnapshot: LinkIntents = {
      colorsToCreate: Array.from(colorsToCreate),
      orphansToDelete: Array.from(orphansToDelete),
      orphansToImport: Array.from(orphansToImport),
    };
    const productImage = preview.marketplaceProductImage;

    enqueueLinkJob(
      {
        marketplace,
        productId,
        productName,
        reference,
        productImage,
      },
      () => executeLink(previewSnapshot, mappingSnapshot, intentsSnapshot),
    );

    // Petit délai UX pour que l'admin voie que sa demande est bien partie
    // (aussi laisse le temps au widget flottant d'apparaître avant de fermer le modal).
    await new Promise((resolve) => setTimeout(resolve, 500));

    toast.success(
      "Liaison lancée",
      "Elle continue en arrière-plan — suis-la dans le widget « Marketplaces » en bas à droite.",
    );
    setIsEnqueuing(false);
    onClose();
  }

  const linkedCount = Object.keys(mapping).length;
  const createCount = colorsToCreate.size;
  const importCount = orphansToImport.size;
  const totalLocal = preview?.localColors.length ?? 0;
  const totalCovered = linkedCount + createCount + importCount;
  const alreadyLinking = hasActiveJobForProduct(productId, marketplace);
  // Orphelines marketplace non tranchées (ni supprimer ni importer) — bloque la validation
  // finale car chaque variante marketplace doit avoir un sort.
  const linkedVariantIdsSet = new Set(Object.values(mapping).filter(Boolean));
  const unresolvedOrphanCount =
    preview?.candidates.filter(
      (c) =>
        !linkedVariantIdsSet.has(c.id) &&
        !orphansToDelete.has(c.id) &&
        !orphansToImport.has(c.id),
    ).length ?? 0;
  const canLink =
    totalCovered > 0 &&
    !!preview?.marketplaceProductId &&
    !alreadyLinking &&
    unresolvedOrphanCount === 0;
  const hasResult = !!preview?.marketplaceProductId;

  function clearResult() {
    setPreview(null);
    setMapping({});
    setColorsToCreate(new Set());
    setOrphansToDelete(new Set());
    setOrphansToImport(new Set());
    setCandidatesList(null);
    setCandidatesTruncated(false);
    setCandidatesPage(1);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center p-4 md:p-8 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Lier ce produit à ${meta.name}`}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer"
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm cursor-default"
        onClick={() => !isEnqueuing && onClose()}
      />

      <div className="relative w-full max-w-[1080px] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {isEnqueuing && (
          <div
            className="absolute inset-0 z-30 bg-white/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3"
            role="alertdialog"
            aria-label="Envoi de la demande en cours"
          >
            <div className="w-14 h-14 border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin" />
            <div className="font-heading font-semibold text-text-primary text-base">
              Envoi de la demande de liaison…
            </div>
            <div className="text-xs text-text-muted max-w-xs text-center">
              La liaison va continuer en arrière-plan. Tu pourras suivre son avancement
              dans le widget en bas à droite.
            </div>
          </div>
        )}
        <Hero
          meta={meta}
          productName={productName}
          reference={reference}
          onClose={onClose}
          disabledClose={isEnqueuing}
          shopName={shopName}
        />

        <div className="px-6 md:px-8 py-7 space-y-8">
          <Step1Search
            meta={meta}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onSearch={doSearch}
            onCancel={cancelSearch}
            isSearching={isSearching}
            searchError={searchError}
            preview={preview}
            hasCandidates={candidatesList !== null}
          />

          {candidatesList !== null && !isSearching && (
            <Step1bCandidatePicker
              meta={meta}
              candidates={candidatesList}
              truncated={candidatesTruncated}
              page={candidatesPage}
              onPageChange={setCandidatesPage}
              onPick={pickCandidate}
              pickingCandidateId={pickingCandidateId}
              query={searchInput.trim() || reference}
            />
          )}

          {hasResult && preview && (
            <>
              <Step2Result
                meta={meta}
                preview={preview}
                markup={markup}
                shopName={shopName}
                onChangeSelection={clearResult}
              />

              <Step3Colors
                meta={meta}
                preview={preview}
                mapping={mapping}
                markup={markup}
                secondaryMarkup={secondaryMarkup}
                shopName={shopName}
                colorsToCreate={colorsToCreate}
                onToggleMapping={setColorMapping}
                onToggleCreate={toggleCreateColor}
                onAutoMap={autoMap}
              />

              <Step4Recap
                meta={meta}
                preview={preview}
                mapping={mapping}
                markup={markup}
                shopName={shopName}
                colorsToCreate={colorsToCreate}
                orphansToDelete={orphansToDelete}
                orphansToImport={orphansToImport}
                onSetOrphanChoice={setOrphanChoice}
              />

              {alreadyLinking && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    ⏳
                  </div>
                  <div className="text-sm text-amber-900">
                    <b>Une liaison est déjà en cours</b> pour ce produit — attends
                    qu'elle finisse (widget « Marketplaces » en bas à droite) avant
                    d'en relancer une.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="sticky bottom-0 px-6 md:px-8 py-5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center gap-3">
          <div className="text-xs text-text-muted flex-1 min-w-[200px]">
            {hasResult ? (
              <>
                <span className="font-semibold text-text-secondary">{totalCovered}</span>
                {" / "}
                <span className="text-text-secondary">{totalLocal}</span> couleur(s) traitée(s)
                {createCount > 0 && (
                  <span className="ml-2 text-emerald-700 font-semibold">
                    · {createCount} à créer
                  </span>
                )}
                {importCount > 0 && (
                  <span className="ml-2 text-emerald-700 font-semibold">
                    · {importCount} à importer
                  </span>
                )}
                {unresolvedOrphanCount > 0 && (
                  <span className="ml-2 text-amber-700 font-semibold">
                    · {unresolvedOrphanCount} variante(s) {meta.name} à trancher
                  </span>
                )}
              </>
            ) : (
              <>Cherche la fiche <b>{meta.name}</b> correspondante ci-dessus.</>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isEnqueuing}
            className="px-4 py-2.5 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-white border border-transparent hover:border-slate-200 disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleLink}
            disabled={!canLink || isEnqueuing}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isEnqueuing
              ? "Liaison en cours…"
              : !hasResult
                ? "Valider la liaison"
                : unresolvedOrphanCount > 0
                  ? `${unresolvedOrphanCount} variante(s) ${meta.name} à trancher`
                  : `✓ Valider (${totalCovered} couleur${totalCovered > 1 ? "s" : ""})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Hero (header aurora + bandeau produit + stepper) ───────────────────────

function Hero({
  meta,
  productName,
  reference,
  onClose,
  disabledClose,
  shopName,
}: {
  meta: MarketplaceMeta;
  productName: string;
  reference: string;
  onClose: () => void;
  disabledClose: boolean;
  shopName: string;
}) {
  const auroraBg = {
    pfs: "linear-gradient(135deg,#eef2ff,#ffffff 60%,#e0e7ff)",
    ank: "linear-gradient(135deg,#e0f2fe,#ffffff 60%,#bae6fd)",
    efa: "linear-gradient(135deg,#fce7f3,#ffffff 60%,#fbcfe8)",
    fai: "linear-gradient(135deg,#fef3c7,#ffffff 60%,#fde68a)",
  }[meta.cls];
  const haloBg = {
    pfs: "#a5b4fc",
    ank: "#7dd3fc",
    efa: "#f9a8d4",
    fai: "#fcd34d",
  }[meta.cls];
  const initialBg = {
    pfs: "linear-gradient(135deg,#4f46e5,#6366f1)",
    ank: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    efa: "linear-gradient(135deg,#db2777,#ec4899)",
    fai: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  }[meta.cls];

  return (
    <div
      className="relative px-6 md:px-8 pt-7 pb-6 border-b border-slate-200"
      style={{ background: auroraBg }}
    >
      <div
        aria-hidden
        className="absolute w-56 h-56 rounded-full pointer-events-none"
        style={{
          background: haloBg,
          filter: "blur(60px)",
          opacity: 0.35,
          top: "-4rem",
          right: "-2.5rem",
        }}
      />
      <div className="relative flex flex-wrap items-start gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] font-semibold text-text-secondary">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Liaison marketplace
          </div>
          <h2 className="mt-2 font-heading text-2xl md:text-3xl font-bold text-text-primary">
            Lier ce produit à {meta.name}
          </h2>
          <p className="mt-1 text-sm text-text-secondary max-w-2xl">
            Associe une fiche déjà présente chez le marketplace à ton produit {shopName}.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white/70 backdrop-blur border border-white rounded-2xl px-4 py-3 shadow-sm">
          <div
            className="w-11 h-11 rounded-xl text-white font-heading text-lg font-bold flex items-center justify-center shadow-md"
            style={{ background: initialBg }}
          >
            {meta.initial}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
              Cible
            </div>
            <div className="font-heading font-semibold text-text-primary text-sm">
              {meta.full}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={disabledClose}
          aria-label="Fermer"
          className="absolute top-0 right-0 -m-1 w-9 h-9 rounded-full bg-white/70 hover:bg-white border border-white shadow-sm flex items-center justify-center text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          ✕
        </button>
      </div>

      {/* Bandeau produit BJ */}
      <div className="relative mt-6 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-center bg-white/85 backdrop-blur border border-white rounded-2xl p-4 shadow-sm">
        <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center text-xs uppercase tracking-wider text-text-muted font-semibold">
          B&J
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-full text-white text-[10px] font-semibold uppercase tracking-wider" style={{ background: "linear-gradient(135deg,#64748b,#334155)" }}>
              {shopName}
            </span>
            <span className="badge badge-neutral">Réf. {reference}</span>
          </div>
          <div className="mt-1 font-heading font-semibold text-text-primary text-base truncate">
            {productName}
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Étape 1 : Recherche ────────────────────────────────────────────────────

function Step1Search({
  meta,
  searchInput,
  onSearchInputChange,
  onSearch,
  onCancel,
  isSearching,
  searchError,
  preview,
  hasCandidates,
}: {
  meta: MarketplaceMeta;
  searchInput: string;
  onSearchInputChange: (v: string) => void;
  onSearch: () => void;
  onCancel: () => void;
  isSearching: boolean;
  searchError: string | null;
  preview: LinkPreview | null;
  hasCandidates: boolean;
}) {
  // "Aucune fiche trouvée" ne doit pas s'afficher quand le picker est ouvert
  // (auquel cas on a plein de candidats à trancher).
  const notFound = preview && !preview.marketplaceProductId && !hasCandidates;
  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
          1
        </div>
        <div>
          <h3 className="font-heading text-lg font-semibold text-text-primary">
            Retrouve la fiche marketplace
          </h3>
          <p className="text-sm text-text-muted mt-0.5">{meta.searchHelp}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 p-5 bg-slate-50/60">
        <label className="text-[11px] uppercase tracking-[0.18em] text-text-muted font-semibold">
          {meta.searchLabel}
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isSearching) onSearch();
            }}
            placeholder={meta.searchPlaceholder}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-300 bg-white text-text-primary focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 font-mono text-sm"
            disabled={isSearching}
          />
          {isSearching ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-3 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500"
              title="Arrête la recherche en cours pour en relancer une autre"
            >
              ⨯ Arrêter
            </button>
          ) : (
            <button
              type="button"
              onClick={onSearch}
              disabled={!searchInput.trim()}
              className="px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-40"
            >
              Chercher
            </button>
          )}
        </div>
      </div>

      {isSearching && (
        <div className="rounded-2xl border border-slate-200 p-6 text-center bg-slate-50">
          <div className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
            Recherche dans le catalogue {meta.name}… (peut prendre 5 à 20 s)
          </div>
          <div className="mt-2 text-xs text-text-muted">
            Clique sur <b className="text-rose-700">⨯ Arrêter</b> pour changer de référence sans attendre.
          </div>
        </div>
      )}

      {searchError && !isSearching && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">
              ⚠
            </div>
            <div>
              <div className="text-sm font-semibold text-rose-900">Erreur de recherche</div>
              <div className="text-xs text-rose-800 mt-0.5">{searchError}</div>
            </div>
          </div>
        </div>
      )}

      {notFound && !isSearching && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              ⚠
            </div>
            <div>
              <div className="text-sm font-semibold text-amber-900">
                Aucune fiche trouvée pour « {preview!.searchQuery} »
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                Essaie une autre référence, ou ferme cette fenêtre et clique sur <b>Publier</b> pour
                créer la fiche marketplace.
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Étape 1b : Picker de candidats (Ankorstore + Faire) ───────────────────
// Affichée quand la recherche renvoie ≥ 2 fiches marketplace qui matchent la
// référence — cas typique Faire/Ankorstore où la fiche a des suffixes de
// couleur/finition (676A, 676GD, ED676P…) et où la référence seule ne suffit
// pas à trancher automatiquement. 4 vignettes par page, pagination simple.

const CANDIDATES_PER_PAGE = 4;

function Step1bCandidatePicker({
  meta,
  candidates,
  truncated,
  page,
  onPageChange,
  onPick,
  pickingCandidateId,
  query,
}: {
  meta: MarketplaceMeta;
  candidates: LinkCandidateProduct[];
  truncated: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onPick: (candidateId: string) => void;
  pickingCandidateId: string | null;
  query: string;
}) {
  const totalPages = Math.max(1, Math.ceil(candidates.length / CANDIDATES_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * CANDIDATES_PER_PAGE;
  const pageItems = candidates.slice(start, start + CANDIDATES_PER_PAGE);

  const pillBg = {
    pfs: "linear-gradient(135deg,#4f46e5,#6366f1)",
    ank: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    efa: "linear-gradient(135deg,#db2777,#ec4899)",
    fai: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  }[meta.cls];

  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
          ?
        </div>
        <div className="flex-1">
          <h3 className="font-heading text-lg font-semibold text-text-primary">
            {candidates.length} fiche{candidates.length > 1 ? "s" : ""} {meta.name} trouvée{candidates.length > 1 ? "s" : ""} — choisis la bonne
          </h3>
          <p className="text-sm text-text-muted mt-0.5">
            Ces fiches contiennent « <b className="font-mono">{query}</b> » dans leur SKU ou leur nom.
            Clique sur celle qui correspond à ton produit.
          </p>
        </div>
      </div>

      {truncated && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900">
          ⚠ Plus de {candidates.length} fiches matchent — pense à préciser ta recherche
          (ajoute quelques lettres) si tu ne trouves pas la bonne.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {pageItems.map((c) => {
          const isPicking = pickingCandidateId === c.id;
          const isAnyPicking = pickingCandidateId !== null;
          return (
            <button
              type="button"
              key={c.id}
              onClick={() => onPick(c.id)}
              disabled={isAnyPicking}
              className="text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-emerald-500 hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-wait relative"
            >
              {isPicking && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex items-center justify-center gap-2 text-sm text-text-secondary z-10">
                  <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
                  Chargement…
                </div>
              )}
              <div className="flex gap-3 items-start">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt={c.name}
                    className="w-24 h-24 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-50"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-text-muted shrink-0">
                    Pas d&apos;image
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="px-2 py-0.5 rounded-full text-white text-[9px] font-semibold uppercase tracking-wider"
                      style={{ background: pillBg }}
                    >
                      {meta.name}
                    </span>
                    {c.lifecycleState && (
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                          c.lifecycleState === "PUBLISHED"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {c.lifecycleState === "PUBLISHED"
                          ? "En ligne"
                          : c.lifecycleState.toLowerCase()}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 font-semibold text-sm text-text-primary line-clamp-2">
                    {c.name}
                  </div>
                  {c.sampleSku && (
                    <div className="mt-1 font-mono text-[11px] text-text-muted truncate">
                      SKU · {c.sampleSku}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-text-muted">
                    {c.variantCount} variante{c.variantCount > 1 ? "s" : ""}
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    Choisir cette fiche →
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm text-text-secondary hover:text-text-primary hover:border-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Précédent
          </button>
          <div className="text-xs text-text-muted">
            Page <span className="font-semibold text-text-secondary">{safePage}</span> sur {totalPages}
            <span className="ml-2 text-text-muted">
              ({candidates.length} fiche{candidates.length > 1 ? "s" : ""} au total)
            </span>
          </div>
          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm text-text-secondary hover:text-text-primary hover:border-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Suivant →
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Étape 2 : Résultat ─────────────────────────────────────────────────────

function Step2Result({
  meta,
  preview,
  markup,
  shopName,
  onChangeSelection,
}: {
  meta: MarketplaceMeta;
  preview: LinkPreview;
  markup: MarkupConfig | null;
  shopName: string;
  onChangeSelection: () => void;
}) {
  const prices = preview.candidates.map((c) => c.priceUnit).filter((p) => p > 0);
  const bjPrices = preview.localColors.map((c) => c.unitPrice).filter((p) => p > 0);
  const minBj = bjPrices.length > 0 ? Math.min(...bjPrices) : null;
  const maxBj = bjPrices.length > 0 ? Math.max(...bjPrices) : null;
  const minMarked = minBj !== null && markup ? applyMarketplaceMarkup(minBj, markup) : null;
  const maxMarked = maxBj !== null && markup ? applyMarketplaceMarkup(maxBj, markup) : null;

  const pillBg = {
    pfs: "linear-gradient(135deg,#4f46e5,#6366f1)",
    ank: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    efa: "linear-gradient(135deg,#db2777,#ec4899)",
    fai: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  }[meta.cls];

  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
          2
        </div>
        <div>
          <h3 className="font-heading text-lg font-semibold text-text-primary">
            Fiche trouvée — vérifie que c'est la bonne
          </h3>
          <p className="text-sm text-text-muted mt-0.5">
            Compare les infos clés avant de continuer.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-stretch">
        {/* BJ */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-1 rounded-full text-white text-[10px] font-semibold uppercase tracking-wider" style={{ background: "linear-gradient(135deg,#64748b,#334155)" }}>
              {shopName}
            </span>
            <span className="badge badge-neutral">Réf. {preview.reference}</span>
          </div>
          <div className="mt-3 flex gap-3 items-start">
            <ZoomableImage
              src={preview.localColors.find((c) => c.productImage)?.productImage ?? null}
              alt={preview.productName}
              className="w-20 h-20 rounded-lg object-cover border border-slate-200"
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-text-primary truncate">
                {preview.productName}
              </div>
              <div className="text-xs text-text-muted mt-1 space-y-0.5">
                <div>
                  {preview.localColors.length} couleur(s)
                  {" "}
                  {preview.localColors.filter((c) => c.productImage).length === 0 &&
                    preview.localColors.length > 0 && (
                      <span className="text-amber-700 font-medium">
                        · Aucune photo côté boutique
                      </span>
                    )}
                </div>
                {minBj !== null && maxBj !== null && (
                  <div>
                    {minBj === maxBj
                      ? `${EUR.format(minBj)} HT`
                      : `de ${EUR.format(minBj)} à ${EUR.format(maxBj)} HT`}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center text-text-muted">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
            →
          </div>
        </div>

        {/* Marketplace */}
        <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/30 p-4 relative mt-5 md:mt-0">
          <div className="absolute -top-4 right-3 badge badge-success shadow-sm">
            Correspondance
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2.5 py-1 rounded-full text-white text-[10px] font-semibold uppercase tracking-wider"
              style={{ background: pillBg }}
            >
              {meta.name}
            </span>
            <span className="badge badge-neutral font-mono">Réf. {preview.searchQuery}</span>
            {(() => {
              const brand = preview.extras?.brand as { name: string | null } | undefined;
              return brand?.name ? (
                <span className="badge badge-info">Marque {brand.name}</span>
              ) : null;
            })()}
          </div>
          <div className="mt-3 flex gap-3 items-start">
            <ZoomableImage
              src={preview.marketplaceProductImage}
              alt={preview.marketplaceProductName ?? ""}
              className="w-20 h-20 rounded-lg object-cover border border-slate-200"
              raw
            />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-text-primary truncate">
                {preview.marketplaceProductName ?? preview.searchQuery}
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {preview.candidates.length} variante(s)
              </div>
              {minMarked !== null && maxMarked !== null && markup && (
                <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                  <span className="font-heading text-lg font-bold text-emerald-700">
                    {minMarked === maxMarked
                      ? EUR.format(minMarked)
                      : `de ${EUR.format(minMarked)} à ${EUR.format(maxMarked)}`}
                  </span>
                  <span className="text-[11px] text-text-muted font-medium">
                    ({shortMarkupLabel(markup)})
                  </span>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onChangeSelection}
            className="mt-3 text-xs text-text-secondary hover:text-text-primary underline"
          >
            ← Ce n'est pas le bon produit, relancer la recherche
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            ⚠
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-amber-900">Ce que la liaison va faire</div>
            <ul className="mt-1 text-xs text-amber-800 space-y-1">
              <li>• Les prix marketplace seront remplacés par les prix {shopName} majorés.</li>
              <li>• Les stocks marketplace seront écrasés par les stocks {shopName}.</li>
              <li>• Les poids marketplace seront écrasés par les poids {shopName}.</li>
              {preview.alreadyLinked && (
                <li>• Ce produit est déjà lié — la liaison actuelle sera remplacée.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Étape 3 : Mapping couleurs ─────────────────────────────────────────────

function Step3Colors({
  meta,
  preview,
  mapping,
  markup,
  secondaryMarkup,
  shopName,
  colorsToCreate,
  onToggleMapping,
  onToggleCreate,
  onAutoMap,
}: {
  meta: MarketplaceMeta;
  preview: LinkPreview;
  mapping: Record<string, string>;
  markup: MarkupConfig | null;
  secondaryMarkup: MarkupConfig | null;
  shopName: string;
  colorsToCreate: Set<string>;
  onToggleMapping: (productColorId: string, variantId: string) => void;
  onToggleCreate: (productColorId: string) => void;
  onAutoMap: () => void;
}) {
  const linkedCount = Object.keys(mapping).length;
  const createCount = colorsToCreate.size;
  const totalLocal = preview.localColors.length;
  const todo = Math.max(0, totalLocal - linkedCount - createCount);
  const usedVids = useMemo(() => new Set(Object.values(mapping)), [mapping]);
  const orphanCount = preview.candidates.filter((c) => !usedVids.has(c.id)).length;

  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
          3
        </div>
        <div className="flex-1">
          <h3 className="font-heading text-lg font-semibold text-text-primary">
            Fais correspondre les couleurs
          </h3>
          <p className="text-sm text-text-muted mt-0.5">
            Pour chaque couleur {shopName}, clique sur la variante marketplace équivalente.
          </p>
        </div>
        <button
          type="button"
          onClick={onAutoMap}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-text-secondary hover:border-slate-900 font-medium"
        >
          ✨ Correspondance automatique
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="Couleurs BJ" value={totalLocal} />
        <KpiTile label="Liées" value={linkedCount} tone={linkedCount > 0 ? "success" : undefined} />
        <KpiTile
          label={`À créer chez ${meta.name}`}
          value={createCount}
          tone={createCount > 0 ? "success" : undefined}
        />
        <KpiTile label="Restantes" value={todo} tone={todo > 0 ? "warning" : undefined} />
        <KpiTile label="Variantes non utilisées" value={orphanCount} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-[0.16em] text-text-muted font-semibold flex items-center gap-2 flex-wrap">
          <span>Couleur {shopName}</span>
          <span className="text-text-muted">→</span>
          <span>Variante {meta.name} à lier, ou création</span>
        </div>
        {preview.localColors.map((local) => (
          <MappingRow
            key={local.productColorId}
            meta={meta}
            local={local}
            candidates={preview.candidates}
            mapping={mapping}
            markup={markup}
            secondaryMarkup={secondaryMarkup}
            shopName={shopName}
            isToCreate={colorsToCreate.has(local.productColorId)}
            weightIsProductLevel={preview.weightIsProductLevel}
            onToggle={onToggleMapping}
            onToggleCreate={onToggleCreate}
          />
        ))}
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/60"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/60"
        : "border-slate-200 bg-white";
  const valCls =
    tone === "success"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-text-primary";
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-semibold">
        {label}
      </div>
      <div className={`mt-1 font-heading text-2xl font-bold ${valCls}`}>{value}</div>
    </div>
  );
}

function formatWeight(kg: number | null | undefined): string {
  if (kg === null || kg === undefined || kg <= 0) return "— g";
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  return `${kg.toString().replace(".", ",")} kg`;
}

function weightsAlmostEqual(a: number | null, b: number | null): boolean {
  // On considère les poids identiques à 1 g près. Deux null = égaux.
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.001;
}

/** Le type est déjà normalisé "UNIT"/"PACK" par les adapters — helper conservé pour lisibilité. */
function normalizeType(t: "UNIT" | "PACK"): "UNIT" | "PACK" {
  return t;
}

/** Format du libellé de majoration inline dans le calcul de prix côté MKT. */
function markupOperatorLabel(m: MarkupConfig): string {
  if (m.type === "percent") return `+${m.value}% de majoration`;
  if (m.type === "fixed") return `+ ${EUR.format(m.value)} de majoration`;
  return `× ${String(m.value).replace(".", ",")} de majoration`;
}

/** Format compact « (+30 % majoration) » affiché en parenthèses à côté du prix cible. */
function markupParenLabel(m: MarkupConfig): string {
  if (m.value === 0) return "sans majoration";
  if (m.type === "percent") return `+${m.value} % majoration`;
  if (m.type === "fixed") return `+${EUR.format(m.value)} majoration`;
  return `× ${String(m.value).replace(".", ",")} majoration`;
}

/** Attribut symétrique : libellé aligné + valeur.
 *  - Côté BJ : affiche juste la valeur (ou "—" si vide).
 *  - Côté marketplace : si valeur MKT ≠ valeur cible, barre la MKT et affiche la cible en vert.
 *  - Pour les prix côté MKT, on peut passer `priceBreakdown` pour afficher le calcul détaillé :
 *      ~PFS_actuel~ · BJ_brut + X% de majoration = TOTAL
 *  - `mktUnknown=true` : la valeur MKT n'est pas exposée par ce marketplace → on affiche "—".
 */
function AttrRow({
  label,
  value,
  targetValue,
  side,
  priceBreakdown,
  mktUnknown,
}: {
  label: string;
  /** Côté BJ = valeur boutique brute. Côté MKT = valeur brute marketplace (utilisée comme fallback si `targetValue` absent). */
  value: string;
  /** Côté MKT uniquement : valeur cible (ce qui sera envoyé au marketplace après majoration). Prioritaire sur `value`. */
  targetValue?: string;
  /** `same` est calculé par le caller mais n'a plus d'impact visuel : on n'affiche plus le diff barré. Conservé pour compat future. */
  same?: boolean;
  side: "bj" | "mkt";
  priceBreakdown?: {
    bjRaw: number;
    markup: MarkupConfig;
    finalPrice: number;
  };
  mktUnknown?: boolean;
}) {
  // Côté marketplace : on affiche UNIQUEMENT la valeur qui sera appliquée
  // (post-majoration pour les prix, boutique brute pour stock/poids). Plus de
  // valeur marketplace barrée — la cliente veut voir directement ce qui part.
  // La majoration éventuelle apparaît entre parenthèses.
  if (side === "mkt") {
    if (mktUnknown && !targetValue && !priceBreakdown) {
      return (
        <div className="flex items-baseline gap-2 py-1">
          <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
            {label}
          </span>
          <span
            className="text-sm text-text-muted"
            title="Le marketplace ne renvoie pas cette information — la valeur boutique est envoyée à la sync."
          >
            —
          </span>
        </div>
      );
    }
    const displayValue = priceBreakdown
      ? EUR.format(priceBreakdown.finalPrice)
      : targetValue ?? value;
    return (
      <div className="flex items-baseline gap-2 py-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
          {label}
        </span>
        <span className="text-sm font-semibold text-text-primary">{displayValue}</span>
        {priceBreakdown && (
          <span className="text-xs text-text-muted">
            ({markupParenLabel(priceBreakdown.markup)})
          </span>
        )}
      </div>
    );
  }

  // Côté boutique : valeur brute, sans habillage.
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
        {label}
      </span>
      <span className="text-sm font-semibold text-text-primary">{value}</span>
    </div>
  );
}

/** Dropdown personnalisé pour choisir une variante marketplace : bouton compact +
 *  liste de cartes visuelles (swatch couleur, nom, taille, badge type, stock).
 *  Remplace le CustomSelect car on veut voir les swatches directement. */
function VariantPicker({
  candidates,
  selectedId,
  onSelect,
  mapping,
  currentColorId,
  showType,
}: {
  candidates: LinkCandidate[];
  selectedId: string;
  onSelect: (variantId: string) => void;
  mapping: Record<string, string>;
  currentColorId: string;
  showType: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; openUp: boolean } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inWrapper = wrapperRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inWrapper && !inDropdown) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  // Recalcule la position en coordonnées viewport (position: fixed) à partir du trigger.
  // Ouvre vers le haut si pas assez de place en bas.
  const computePosition = useCallback(() => {
    if (!triggerRef.current) return null;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 380 && spaceAbove > spaceBelow;
    return {
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      openUp,
    };
  }, []);

  const handleToggle = () => {
    if (!open) setPos(computePosition());
    setOpen((v) => !v);
  };

  // Repositionne pendant scroll/resize pour rester collé au trigger.
  useEffect(() => {
    if (!open) return;
    const update = () => setPos(computePosition());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, computePosition]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 bg-white text-left text-sm transition-all ${
          open
            ? "border-slate-900 shadow-md"
            : selected
              ? "border-emerald-300 hover:border-emerald-500"
              : "border-slate-300 hover:border-slate-500"
        }`}
      >
        {selected ? (
          <>
            <ColorDot hex={selected.colorHex} patternImage={selected.colorImage} size={20} />
            <span className="font-semibold text-text-primary truncate flex-1">
              {selected.colorName}
            </span>
            <span className="text-xs text-text-muted">
              {selected.type === "PACK" && selected.packSizes.length > 0
                ? selected.packSizes.join(", ")
                : selected.sizeLabel}
              {showType && ` · ${normalizeType(selected.type)}`}
            </span>
          </>
        ) : (
          <span className="text-text-muted italic flex-1">Choisir une variante…</span>
        )}
        <span className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
            left: pos.left,
            width: pos.width,
            zIndex: 100,
          }}
          className="bg-white border-2 border-slate-900 rounded-xl shadow-xl overflow-hidden max-h-[360px] overflow-y-auto"
        >
          {selected && (
            <button
              type="button"
              onClick={() => {
                onSelect("");
                setOpen(false);
              }}
              className="w-full flex items-start gap-3 px-3 py-2.5 text-left border-b border-slate-200 text-rose-700 hover:bg-rose-50 transition-colors"
            >
              <span className="w-7 h-7 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-sm shrink-0">
                ✕
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Ne pas lier</div>
                <div className="mt-0.5 text-[11px] text-rose-600/80">
                  Retirer la variante actuellement mappée
                </div>
              </div>
            </button>
          )}
          {candidates.map((cand) => {
            const isSelected = cand.id === selectedId;
            const usedByOtherEntry = Object.entries(mapping).find(
              ([k, v]) => v === cand.id && k !== currentColorId,
            );
            const usedByOther = Boolean(usedByOtherEntry);
            return (
              <button
                key={cand.id}
                type="button"
                onClick={() => {
                  onSelect(cand.id);
                  setOpen(false);
                }}
                className={`w-full flex items-start gap-3 px-3 py-2.5 text-left border-b border-slate-100 last:border-b-0 transition-colors ${
                  isSelected
                    ? "bg-emerald-50"
                    : usedByOther
                      ? "bg-amber-50 hover:bg-amber-100"
                      : "hover:bg-slate-50"
                }`}
                title={
                  usedByOther
                    ? "Cliquer pour déplacer cette variante depuis l'autre couleur"
                    : undefined
                }
              >
                <ColorDot hex={cand.colorHex} patternImage={cand.colorImage} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary truncate">
                      {cand.colorName}
                    </span>
                    {isSelected && <span className="text-emerald-600">✓</span>}
                    {usedByOther && (
                      <span className="badge badge-warning text-[9px]">Déplacer</span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted">
                    {showType && (
                      <span className={`badge ${cand.type === "PACK" ? "badge-info" : "badge-neutral"}`}>
                        {normalizeType(cand.type)}
                      </span>
                    )}
                    <span>
                      Taille{" "}
                      {cand.type === "PACK" && cand.packSizes.length > 0
                        ? cand.packSizes.join(", ")
                        : cand.sizeLabel}
                    </span>
                    <span>· {EUR.format(cand.priceUnit)}</span>
                    <span>· {formatWeight(cand.weightKg)}</span>
                    <span>· stock {cand.stockQty}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

function MappingRow({
  meta,
  local,
  candidates,
  mapping,
  markup,
  secondaryMarkup,
  shopName,
  isToCreate,
  weightIsProductLevel,
  onToggle,
  onToggleCreate,
}: {
  meta: MarketplaceMeta;
  local: LinkLocalColor;
  candidates: LinkCandidate[];
  mapping: Record<string, string>;
  markup: MarkupConfig | null;
  secondaryMarkup: MarkupConfig | null;
  shopName: string;
  isToCreate: boolean;
  weightIsProductLevel: boolean;
  onToggle: (productColorId: string, variantId: string) => void;
  onToggleCreate: (productColorId: string) => void;
}) {
  const linkedVid = mapping[local.productColorId] ?? "";
  const linkedCand = linkedVid
    ? candidates.find((c) => c.id === linkedVid) ?? null
    : null;
  const showType = meta.cls === "pfs";

  // Prix cible : ce qui sera envoyé sur le marketplace (BJ majoré). C'est ce qu'on compare au prix actuel PFS.
  const targetPriceUnit = markup ? applyMarketplaceMarkup(local.unitPrice, markup) : local.unitPrice;
  // Pour un PACK, on majore le prix/u puis on recalcule le total (respect règle CLAUDE : markup jamais sur le total).
  const bjPackQty = local.saleType === "PACK" ? local.packQuantity ?? 1 : 1;
  const bjUnitPriceForPack = local.saleType === "PACK" ? local.unitPrice / bjPackQty : local.unitPrice;
  const bjUnitPriceMarked = markup ? applyMarketplaceMarkup(bjUnitPriceForPack, markup) : bjUnitPriceForPack;
  const bjTotalPriceMarked = bjUnitPriceMarked * bjPackQty;

  // Comparaisons : on compare le prix ACTUEL PFS avec ce qui SERA envoyé (donc BJ majoré)
  const priceSame = linkedCand
    ? Math.abs(linkedCand.priceUnit - bjUnitPriceMarked) < 0.005
    : true;
  const totalSame = linkedCand
    ? Math.abs(linkedCand.priceTotal - bjTotalPriceMarked) < 0.005
    : true;

  // Prix de vente conseillé (retail) — uniquement Ankorstore : on chaîne
  // wholesaleMarkup PUIS retailMarkup pour retomber sur ce qui sera vraiment
  // envoyé côté marketplace (cf. lib/ankorstore-pricing.ts). Sinon on affiche
  // simplement BJ raw × retail markup.
  const bjRetailPriceMarked =
    secondaryMarkup && markup
      ? applyMarketplaceMarkup(bjUnitPriceMarked, secondaryMarkup)
      : secondaryMarkup
        ? applyMarketplaceMarkup(local.unitPrice, secondaryMarkup)
        : null;
  const retailSame =
    linkedCand && linkedCand.retailPriceUnit != null && bjRetailPriceMarked != null
      ? Math.abs(linkedCand.retailPriceUnit - bjRetailPriceMarked) < 0.005
      : true;
  // Marketplaces qui stockent le poids au niveau produit (Ankorstore) : on
  // masque le diff par variante puisque la donnée n'existe pas à ce grain
  // côté marketplace — on affichera juste le poids boutique, en indiquant
  // que côté marketplace le poids est global.
  const weightSame =
    weightIsProductLevel || !linkedCand
      ? true
      : weightsAlmostEqual(local.weightKg, linkedCand.weightKg);
  const stockSame = linkedCand ? local.stock === linkedCand.stockQty : true;
  const packQtySame = linkedCand
    ? (local.packQuantity ?? null) === (linkedCand.packQuantity ?? null)
    : true;

  const bjType = local.saleType; // "UNIT" | "PACK"
  const bjSizeLabel = local.sizes.length > 0 ? local.sizes.join(", ") : "TU";
  const anyDiff = linkedCand && (!priceSame || !totalSame || !weightSame || !stockSame);

  const pillMktBg = {
    pfs: "linear-gradient(135deg,#4f46e5,#6366f1)",
    ank: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    efa: "linear-gradient(135deg,#db2777,#ec4899)",
    fai: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  }[meta.cls];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-3 px-5 py-5 border-b border-slate-100">
      {/* ─── Colonne notre boutique ─── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2 py-0.5 rounded-full text-white text-[9px] font-semibold uppercase tracking-wider" style={{ background: "linear-gradient(135deg,#64748b,#334155)" }}>
            {shopName}
          </span>
        </div>
        <div className="flex items-start gap-3">
          <ZoomableImage
            src={local.productImage}
            alt={local.name}
            className="w-16 h-16 rounded-lg object-cover border border-slate-200"
          />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-text-primary flex items-center gap-2 truncate">
              <ColorDot hex={local.hex} patternImage={local.patternImage} size={14} />
              <span className="truncate">{local.name}</span>
            </div>
            <div className="mt-2 divide-y divide-slate-100">
              {showType && (
                <AttrRow label="Type" value={bjType} same side="bj" />
              )}
              <AttrRow label="Taille" value={bjSizeLabel} same side="bj" />
              {bjType === "PACK" && local.packQuantity && (
                <AttrRow label="Paquet" value={`${local.packQuantity} pièces`} same side="bj" />
              )}
              {bjType === "PACK" && local.packQuantity ? (
                <>
                  <AttrRow label="Prix/u" value={EUR.format(bjUnitPriceForPack)} same side="bj" />
                  <AttrRow label="Total" value={EUR.format(local.unitPrice)} same side="bj" />
                </>
              ) : (
                <AttrRow label="Prix" value={EUR.format(local.unitPrice)} same side="bj" />
              )}
              {!meta.hideWeightRow && (
                <AttrRow label="Poids" value={formatWeight(local.weightKg)} same side="bj" />
              )}
              <AttrRow label="Stock" value={String(local.stock)} same side="bj" />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Colonne centrale : flèches bidirectionnelles + "Lier à" ─── */}
      <div className="flex md:flex-col items-center justify-center gap-2 py-2 md:py-0 md:min-w-[80px]">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold shadow-sm transition-colors ${
            isToCreate
              ? "bg-sky-500 text-white"
              : linkedCand
                ? "bg-emerald-500 text-white"
                : "bg-slate-100 text-text-muted"
          }`}
          aria-hidden
        >
          {isToCreate ? "＋" : "↔"}
        </div>
        <div className={`text-[11px] uppercase tracking-[0.18em] font-semibold text-center ${
          isToCreate
            ? "text-sky-700"
            : linkedCand
              ? "text-emerald-700"
              : "text-text-muted"
        }`}>
          {isToCreate ? "À créer" : linkedCand ? "Liée à" : "Lier à"}
        </div>
      </div>

      {/* ─── Colonne marketplace ─── */}
      <div
        className={`rounded-xl border p-4 ${
          isToCreate
            ? "border-sky-300 bg-sky-50/40"
            : linkedCand
              ? "border-emerald-300 bg-emerald-50/40"
              : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span
            className="px-2 py-0.5 rounded-full text-white text-[9px] font-semibold uppercase tracking-wider"
            style={{ background: pillMktBg }}
          >
            {meta.name}
          </span>
          {isToCreate && (
            <span className="badge badge-info text-[9px]">Nouvelle couleur</span>
          )}
        </div>

        {isToCreate ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <ZoomableImage
                src={local.productImage}
                alt={local.name}
                className="w-16 h-16 rounded-lg object-cover border border-sky-200"
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm text-text-primary flex items-center gap-2 truncate">
                  <ColorDot hex={local.hex} patternImage={local.patternImage} size={14} />
                  <span className="truncate">{local.name}</span>
                </div>
                <div className="mt-1 text-xs text-sky-800 leading-snug">
                  Cette couleur va être <b>créée chez {meta.name}</b> avec la photo boutique
                  {local.productImage ? "" : " (aucune photo boutique — la variante sera créée sans image)"}.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onToggleCreate(local.productColorId)}
              className="text-xs text-text-secondary hover:text-text-primary underline"
            >
              ← Annuler la création
            </button>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <VariantPicker
                candidates={candidates}
                selectedId={linkedVid}
                onSelect={(v) => onToggle(local.productColorId, v)}
                mapping={mapping}
                currentColorId={local.productColorId}
                showType={showType}
              />
            </div>
            {!linkedCand && (
              <button
                type="button"
                onClick={() => onToggleCreate(local.productColorId)}
                className="w-full mb-3 px-3 py-2.5 rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/40 text-sm text-sky-800 hover:border-sky-500 hover:bg-sky-50 font-medium flex items-center justify-center gap-2"
                disabled={!local.productImage}
                title={
                  !local.productImage
                    ? "Ajoute d'abord une photo à cette couleur côté boutique pour pouvoir la créer chez le marketplace."
                    : undefined
                }
              >
                ➕ Créer cette couleur chez {meta.name}
                {!local.productImage && (
                  <span className="text-[10px] text-amber-700">(photo manquante)</span>
                )}
              </button>
            )}
          </>
        )}

        {!isToCreate && linkedCand ? (
          <div className="flex items-start gap-3">
            {linkedCand.imageUrl ? (
              <ZoomableImage
                src={linkedCand.imageUrl}
                alt={linkedCand.colorName}
                className="w-16 h-16 rounded-lg object-cover border border-slate-200"
                raw
              />
            ) : (
              <div className="w-16 h-16 flex items-center justify-center rounded-lg bg-slate-50 border border-slate-200 shrink-0">
                <ColorDot hex={linkedCand.colorHex} patternImage={linkedCand.colorImage} size={40} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm text-text-primary flex items-center gap-2 truncate">
                <ColorDot hex={linkedCand.colorHex} patternImage={linkedCand.colorImage} size={14} />
                <span className="truncate">{linkedCand.colorName}</span>
              </div>
              <div className="mt-2 divide-y divide-slate-100">
                {showType && (
                  <AttrRow
                    label="Type"
                    value={normalizeType(linkedCand.type)}
                    same
                    side="mkt"
                  />
                )}
                <AttrRow
                  label="Taille"
                  value={
                    linkedCand.type === "PACK" && linkedCand.packSizes.length > 0
                      ? linkedCand.packSizes.join(", ")
                      : linkedCand.sizeLabel
                  }
                  same
                  side="mkt"
                />
                {linkedCand.type === "PACK" && linkedCand.packQuantity && (
                  <AttrRow
                    label="Paquet"
                    value={`${linkedCand.packQuantity} pièces`}
                    targetValue={local.packQuantity ? `${local.packQuantity} pièces` : "—"}
                    same={packQtySame}
                    side="mkt"
                  />
                )}
                <AttrRow
                  label={meta.primaryPriceLabel ?? "Prix/u"}
                  value={EUR.format(linkedCand.priceUnit)}
                  targetValue={EUR.format(bjUnitPriceMarked)}
                  same={priceSame}
                  side="mkt"
                  mktUnknown={linkedCand.priceUnit <= 0}
                  priceBreakdown={
                    markup
                      ? {
                          bjRaw: bjUnitPriceForPack,
                          markup,
                          finalPrice: bjUnitPriceMarked,
                        }
                      : undefined
                  }
                />
                {/* Ankorstore : seconde ligne « Prix de vente/u » (retail price)
                    avec sa propre majoration. Rendue uniquement quand le
                    marketplace expose ce concept (meta.secondaryMarkupKey). */}
                {secondaryMarkup &&
                  linkedCand.retailPriceUnit != null &&
                  bjRetailPriceMarked != null && (
                    <AttrRow
                      label={meta.secondaryPriceLabel ?? "Prix de vente/u"}
                      value={EUR.format(linkedCand.retailPriceUnit)}
                      targetValue={EUR.format(bjRetailPriceMarked)}
                      same={retailSame}
                      side="mkt"
                      mktUnknown={linkedCand.retailPriceUnit <= 0}
                      priceBreakdown={{
                        bjRaw: bjUnitPriceMarked,
                        markup: secondaryMarkup,
                        finalPrice: bjRetailPriceMarked,
                      }}
                    />
                  )}
                {linkedCand.type === "PACK" && (
                  <AttrRow
                    label="Total"
                    value={EUR.format(linkedCand.priceTotal)}
                    targetValue={EUR.format(bjTotalPriceMarked)}
                    same={totalSame}
                    side="mkt"
                    mktUnknown={linkedCand.priceTotal <= 0}
                    priceBreakdown={
                      markup
                        ? {
                            bjRaw: local.unitPrice,
                            markup,
                            finalPrice: bjTotalPriceMarked,
                          }
                        : undefined
                    }
                  />
                )}
                {!meta.hideWeightRow && (
                  <AttrRow
                    label="Poids"
                    value={formatWeight(linkedCand.weightKg)}
                    targetValue={formatWeight(local.weightKg)}
                    same={weightSame}
                    side="mkt"
                    mktUnknown={linkedCand.weightKg === null}
                  />
                )}
                <AttrRow
                  label="Stock"
                  value={String(linkedCand.stockQty)}
                  targetValue={String(local.stock)}
                  same={stockSame}
                  side="mkt"
                />
              </div>
              {anyDiff && (
                <div className="mt-2 pt-2 border-t border-emerald-200 text-[11px] text-emerald-800">
                  Les valeurs différentes seront écrasées à la liaison.
                </div>
              )}
            </div>
          </div>
        ) : !isToCreate ? (
          <div className="text-center py-4 text-xs text-text-muted italic">
            Lie à une variante ci-dessus, ou crée la couleur chez {meta.name}.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ColorDot({
  hex,
  patternImage,
  size,
}: {
  hex: string | null;
  patternImage: string | null;
  size: number;
}) {
  const style: CSSProperties = { width: size, height: size };
  if (patternImage) {
    style.backgroundImage = `url("${getImageSrc(patternImage, "thumb")}")`;
    style.backgroundSize = "cover";
    style.backgroundPosition = "center";
  } else {
    style.background = hex ?? "#e5e7eb";
  }
  return (
    <span
      aria-hidden
      className="inline-block rounded-full border-2 border-white shadow-sm shrink-0"
      style={{ ...style, boxShadow: "0 0 0 1px rgba(15,23,42,0.15)" }}
    />
  );
}

// ─── Étape 4 : Récap ────────────────────────────────────────────────────────

function Step4Recap({
  meta,
  preview,
  mapping,
  markup,
  shopName,
  colorsToCreate,
  orphansToDelete,
  orphansToImport,
  onSetOrphanChoice,
}: {
  meta: MarketplaceMeta;
  preview: LinkPreview;
  mapping: Record<string, string>;
  markup: MarkupConfig | null;
  shopName: string;
  colorsToCreate: Set<string>;
  orphansToDelete: Set<string>;
  orphansToImport: Set<string>;
  onSetOrphanChoice: (candidateId: string, choice: "delete" | "import") => void;
}) {
  const linked = preview.localColors.filter((c) => c.productColorId in mapping);
  const toCreate = preview.localColors.filter((c) => colorsToCreate.has(c.productColorId));
  const usedVids = new Set(Object.values(mapping));
  const orphanCands = preview.candidates.filter((c) => !usedVids.has(c.id));
  const orphansMarkedDelete = orphanCands.filter((c) => orphansToDelete.has(c.id));
  const orphansMarkedImport = orphanCands.filter((c) => orphansToImport.has(c.id));
  const orphansUnresolved = orphanCands.filter(
    (c) => !orphansToDelete.has(c.id) && !orphansToImport.has(c.id),
  );

  // Alerte anti-doublon : pour chaque orpheline marketplace, on vérifie si une
  // couleur BJ non-mappée (ni linked, ni to-create) porte le même nom normalisé.
  // Dans ce cas, l'admin devrait revenir à l'étape 3 pour lier au lieu de créer
  // un doublon local. Le serveur re-lie l'existante quand même (safety net),
  // mais on prévient dans l'UI pour clarté.
  function norm(s: string): string {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  }
  const unmappedBjColors = preview.localColors.filter(
    (c) => !(c.productColorId in mapping) && !colorsToCreate.has(c.productColorId),
  );
  const orphanBjMatchByCandId = new Map<string, { name: string }>();
  for (const cand of orphanCands) {
    const candNorm = norm(cand.colorName);
    const match = unmappedBjColors.find((bj) => norm(bj.name) === candNorm);
    if (match) orphanBjMatchByCandId.set(cand.id, { name: match.name });
  }
  const pillBg = {
    pfs: "linear-gradient(135deg,#4f46e5,#6366f1)",
    ank: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    efa: "linear-gradient(135deg,#db2777,#ec4899)",
    fai: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  }[meta.cls];

  return (
    <section className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
          4
        </div>
        <div>
          <h3 className="font-heading text-lg font-semibold text-text-primary">
            Récap avant de lier
          </h3>
          <p className="text-sm text-text-muted mt-0.5">
            Voici ce qui va se passer à la validation.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-full text-white text-[10px] font-semibold uppercase tracking-wider"
            style={{ background: pillBg }}
          >
            {meta.name}
          </span>
          <span className="text-sm font-semibold text-text-primary">
            Liaison avec la fiche <span className="font-mono">{preview.searchQuery}</span>
          </span>
        </div>
        <ul className="divide-y divide-slate-100">
          <li className="px-5 py-3 flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm">
              ✓
            </div>
            <div className="text-sm text-text-primary">
              <b>
                {linked.length} couleur{linked.length > 1 ? "s" : ""}
              </b>{" "}
              liée{linked.length > 1 ? "s" : ""} :{" "}
              <span className="text-text-secondary">
                {linked.length > 0 ? linked.map((c) => c.name).join(", ") : "—"}
              </span>
            </div>
          </li>
          {toCreate.length > 0 && (
            <li className="px-5 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-sm">
                ＋
              </div>
              <div className="text-sm text-text-primary">
                <b>
                  {toCreate.length} couleur{toCreate.length > 1 ? "s" : ""}
                </b>{" "}
                sera créée chez {meta.name} avec sa photo {shopName} :{" "}
                <span className="text-sky-800">
                  {toCreate.map((c) => c.name).join(", ")}
                </span>
              </div>
            </li>
          )}
          {orphansMarkedImport.length > 0 && (
            <li className="px-5 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm">
                ⇩
              </div>
              <div className="text-sm text-text-primary">
                <b>
                  {orphansMarkedImport.length} variante{orphansMarkedImport.length > 1 ? "s" : ""}
                </b>{" "}
                sera importée dans {shopName} et liée :{" "}
                <span className="text-emerald-800">
                  {orphansMarkedImport.map((c) => c.colorName).join(", ")}
                </span>
              </div>
            </li>
          )}
          {orphansMarkedDelete.length > 0 && (
            <li className="px-5 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-sm">
                −
              </div>
              <div className="text-sm text-text-primary">
                <b>
                  {orphansMarkedDelete.length} variante{orphansMarkedDelete.length > 1 ? "s" : ""}
                </b>{" "}
                sera supprimée chez {meta.name} :{" "}
                <span className="text-rose-800">
                  {orphansMarkedDelete.map((c) => c.colorName).join(", ")}
                </span>
              </div>
            </li>
          )}
          {meta.syncsAtLink && (
            <li className="px-5 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm">
                ↺
              </div>
              <div className="text-sm text-text-primary">
                <b>Stock, prix et poids synchronisés immédiatement</b>
                {markup && markup.value !== 0 && (
                  <span className="text-text-muted"> — prix envoyés avec {shortMarkupLabel(markup)}</span>
                )}
              </div>
            </li>
          )}
          <li className="px-5 py-3 flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-slate-100 text-text-secondary flex items-center justify-center text-sm">
              🏷
            </div>
            <div className="text-sm text-text-primary">
              Badge vert « lié » affiché sur la fiche produit
            </div>
          </li>
        </ul>
      </div>

      {/* Bloc orphelines : la fiche marketplace a des variantes sans équivalent chez nous.
          L'admin DOIT choisir par ligne : « Créer chez nous » (import + lien) OU
          « Supprimer chez le marketplace ». Aucune orpheline ne peut être laissée sans choix
          (validation bloquante à la validation finale — cf. handleLink). */}
      {orphanCands.length > 0 && (
        <div
          className={`rounded-2xl border overflow-hidden ${
            orphansUnresolved.length > 0
              ? "border-amber-400 bg-amber-50/60"
              : "border-slate-200 bg-white"
          }`}
        >
          <div
            className={`px-5 py-3 border-b flex items-center gap-2 ${
              orphansUnresolved.length > 0
                ? "bg-amber-100 border-amber-300"
                : "bg-slate-50 border-slate-200"
            }`}
          >
            <span className="text-lg">{orphansUnresolved.length > 0 ? "⚠" : "✓"}</span>
            <div>
              <div className="text-sm font-semibold text-amber-900">
                {orphanCands.length} variante{orphanCands.length > 1 ? "s" : ""} chez {meta.name} sans équivalent chez {shopName}
              </div>
              <div className="text-xs text-amber-800 mt-0.5">
                {orphansUnresolved.length > 0 ? (
                  <>
                    Choisis obligatoirement <b>Créer chez nous</b> ou <b>Supprimer chez {meta.name}</b> pour chaque ligne — tu ne peux pas laisser une variante marketplace sans lien.
                  </>
                ) : (
                  <>Toutes les orphelines ont un choix — tu peux valider.</>
                )}
              </div>
            </div>
          </div>
          <ul className="divide-y divide-amber-200">
            {orphanCands.map((cand) => {
              const willDelete = orphansToDelete.has(cand.id);
              const willImport = orphansToImport.has(cand.id);
              const unresolved = !willDelete && !willImport;
              const bjMatch = orphanBjMatchByCandId.get(cand.id);
              return (
                <li
                  key={cand.id}
                  className={`px-5 py-3 flex items-start gap-3 flex-wrap ${
                    unresolved ? "bg-amber-50/40" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-[220px]">
                    {cand.imageUrl ? (
                      <ZoomableImage
                        src={cand.imageUrl}
                        alt={cand.colorName}
                        className="w-12 h-12 rounded-lg object-cover border border-amber-200"
                        raw
                      />
                    ) : (
                      <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-white border border-amber-200 shrink-0">
                        <ColorDot hex={cand.colorHex} patternImage={cand.colorImage} size={28} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text-primary truncate flex items-center gap-2">
                        {cand.colorName}
                        {unresolved && (
                          <span className="badge badge-warning text-[9px]">À trancher</span>
                        )}
                      </div>
                      <div className="text-[11px] text-text-muted">
                        {cand.type === "PACK" && cand.packSizes.length > 0
                          ? cand.packSizes.join(", ")
                          : cand.sizeLabel}
                        {" · "}
                        {EUR.format(cand.priceUnit)}
                        {" · stock "}
                        {cand.stockQty}
                      </div>
                      {bjMatch && (
                        <div className="mt-1 text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-1 leading-snug">
                          💡 La couleur <b>{bjMatch.name}</b> existe déjà chez {shopName} mais n'est pas mappée — reviens à l'étape 3 pour la <b>lier</b> plutôt que d'en créer un doublon.
                          <br />
                          <span className="text-text-muted">(Si tu choisis quand même « Créer chez nous », la variante existante sera reliée automatiquement — pas de doublon créé.)</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 cursor-pointer text-xs font-medium transition-all ${
                        willImport
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-white/60 border-emerald-200 text-emerald-700 hover:border-emerald-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`orphan-${cand.id}`}
                        checked={willImport}
                        onChange={() => onSetOrphanChoice(cand.id, "import")}
                        className="sr-only"
                      />
                      <span aria-hidden>{willImport ? "●" : "○"}</span>
                      Créer chez nous
                    </label>
                    <label
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-2 cursor-pointer text-xs font-medium transition-all ${
                        willDelete
                          ? "bg-rose-600 border-rose-600 text-white"
                          : "bg-white/60 border-rose-200 text-rose-700 hover:border-rose-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`orphan-${cand.id}`}
                        checked={willDelete}
                        onChange={() => onSetOrphanChoice(cand.id, "delete")}
                        className="sr-only"
                      />
                      <span aria-hidden>{willDelete ? "●" : "○"}</span>
                      Supprimer chez {meta.name}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

