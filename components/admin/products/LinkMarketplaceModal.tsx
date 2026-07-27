"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { getMarketplaceMarkupConfig } from "@/app/actions/admin/marketplace-pricing";
import {
  applyMarketplaceMarkup,
  type MarkupConfig,
} from "@/lib/marketplace-pricing-shared";
import { useToast } from "@/components/ui/Toast";
import { getImageSrc } from "@/lib/image-utils";
import { useMarketplaceLinkJobs } from "./MarketplaceLinkContext";
import { useRightRail } from "@/components/admin/widgets-rail";
import { ZoomableImage } from "./ZoomableImage";
import {
  fetchLinkPreview,
  executeLink,
  MARKETPLACE_META,
  type Marketplace,
  type MarketplaceMeta,
  type LinkPreview,
  type LinkCandidate,
  type LinkLocalColor,
} from "./linkMarketplaceAdapters";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  marketplace: Marketplace;
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3 | 4 | "done";

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
  const { open: openRail } = useRightRail();
  const meta = MARKETPLACE_META[marketplace];

  const [step, setStep] = useState<Step>(1);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchInput, setSearchInput] = useState(reference);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [markup, setMarkup] = useState<MarkupConfig | null>(null);
  const [shopName, setShopName] = useState<string>("notre boutique");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Charge la config majoration + nom boutique du tenant courant une seule fois
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getMarketplaceMarkupConfig(meta.markupKey);
      if (!cancelled && res.success) {
        setMarkup(res.data.markup);
        setShopName(res.data.shopName);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta.markupKey]);

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

  const runSearch = useCallback(
    async (query: string) => {
      setSearchError(null);
      setIsSearching(true);
      try {
        const res = await fetchLinkPreview(marketplace, productId, query);
        if (res.success) {
          setPreview(res.data);
          setMapping(buildInitialMapping(res.data));
          if (res.data.marketplaceProductId) setStep(2);
        } else {
          setSearchError(res.error);
          setPreview(null);
        }
      } finally {
        setIsSearching(false);
      }
    },
    [marketplace, productId, buildInitialMapping],
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

    if (Object.keys(mapping).length === 0) {
      toast.error("Aucune couleur liée", `Sélectionne au moins une variante ${meta.name}.`);
      return;
    }

    // Overlay bloquant le temps que la demande soit vraiment enqueue,
    // puis on ferme et on laisse la suite se faire dans le widget flottant.
    setIsEnqueuing(true);
    const previewSnapshot = preview;
    const mappingSnapshot = { ...mapping };
    const productImage = preview.marketplaceProductImage;

    enqueueLinkJob(
      {
        marketplace,
        productId,
        productName,
        reference,
        productImage,
      },
      () => executeLink(previewSnapshot, mappingSnapshot),
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
    // Ouvre le tiroir Marketplaces du rail droit pour montrer la liaison en cours
    openRail("marketplaces");
  }

  const linkedCount = Object.keys(mapping).length;
  const totalLocal = preview?.localColors.length ?? 0;
  const alreadyLinking = hasActiveJobForProduct(productId, marketplace);
  const canLink = linkedCount > 0 && !!preview?.marketplaceProductId && !alreadyLinking;
  const canGoNext =
    (step === 1 && !!preview?.marketplaceProductId) ||
    (step === 2) ||
    (step === 3 && linkedCount > 0) ||
    step === 4;

  function goNext() {
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3) {
      if (linkedCount === 0) {
        toast.warning("Aucune couleur liée", "Sélectionnez au moins une variante PFS.");
        return;
      }
      setStep(4);
    } else if (step === 4) {
      handleLink();
    }
  }

  function goPrev() {
    if (step === 4) setStep(3);
    else if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
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
          step={step}
          shopName={shopName}
        />

        <div className="px-6 md:px-8 py-7 min-h-[420px]">
          {step === 1 && (
            <Step1Search
              meta={meta}
              searchInput={searchInput}
              onSearchInputChange={setSearchInput}
              onSearch={doSearch}
              isSearching={isSearching}
              searchError={searchError}
              preview={preview}
            />
          )}

          {step === 2 && preview && (
            <Step2Result
              meta={meta}
              preview={preview}
              markup={markup}
              shopName={shopName}
              onChangeSelection={() => {
                setStep(1);
                setPreview(null);
                setMapping({});
              }}
            />
          )}

          {step === 3 && preview && (
            <Step3Colors
              meta={meta}
              preview={preview}
              mapping={mapping}
              markup={markup}
              shopName={shopName}
              onToggleMapping={setColorMapping}
              onAutoMap={autoMap}
            />
          )}

          {step === 4 && preview && (
            <>
              <Step4Recap
                meta={meta}
                preview={preview}
                mapping={mapping}
                markup={markup}
              />
              {alreadyLinking && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 flex items-start gap-3">
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

          {step === "done" && <StepDone meta={meta} onClose={onClose} />}
        </div>

        {step !== "done" && (
          <div className="px-6 md:px-8 py-5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center gap-3">
            <div className="text-xs text-text-muted flex-1 min-w-[200px]">
              {step === 3 && (
                <>
                  <span className="font-semibold text-text-secondary">{linkedCount}</span>
                  {" / "}
                  <span className="text-text-secondary">{totalLocal}</span> couleur(s) liée(s)
                </>
              )}
              {step !== 3 && <>Étape <b>{step}</b> sur 4</>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isEnqueuing}
              className="px-4 py-2.5 rounded-xl text-sm text-text-secondary hover:text-text-primary hover:bg-white border border-transparent hover:border-slate-200 disabled:opacity-40"
            >
              Annuler
            </button>
            {step > 1 && (
              <button
                type="button"
                onClick={goPrev}
                disabled={isEnqueuing}
                className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-300 bg-white text-text-secondary hover:border-slate-900 hover:text-text-primary disabled:opacity-40"
              >
                ← Précédent
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext || isEnqueuing || (step === 4 && !canLink)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed ${
                step === 4
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-slate-900 hover:bg-slate-700"
              }`}
            >
              {step === 4
                ? isEnqueuing
                  ? "Liaison en cours…"
                  : `✓ Lier ${linkedCount} couleur${linkedCount > 1 ? "s" : ""}`
                : step === 3
                  ? "Voir le récap →"
                  : "Suivant →"}
            </button>
          </div>
        )}
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
  step,
  shopName,
}: {
  meta: MarketplaceMeta;
  productName: string;
  reference: string;
  onClose: () => void;
  disabledClose: boolean;
  step: Step;
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

      {/* Stepper */}
      <div className="relative mt-6">
        <Stepper step={step} />
      </div>
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const currentNum = step === "done" ? 4 : step;
  const labels = ["Recherche", "Résultat", "Couleurs", "Récap"];
  return (
    <div className="flex items-center gap-2 md:gap-4">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = currentNum > n || step === "done";
        const active = currentNum === n && step !== "done";
        return (
          <div key={label} className="flex items-center gap-2 md:gap-4 flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-sm transition-all ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-slate-900 text-white scale-110"
                      : "bg-white text-text-muted border border-slate-300"
                }`}
              >
                {done ? "✓" : n}
              </div>
              <span
                className={`hidden md:inline text-xs uppercase tracking-[0.14em] ${
                  active
                    ? "text-text-primary font-semibold"
                    : done
                      ? "text-emerald-700"
                      : "text-text-muted"
                }`}
              >
                {label}
              </span>
            </div>
            {n < labels.length && (
              <div
                className={`flex-1 h-0.5 rounded-full ${
                  done ? "bg-emerald-500" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Étape 1 : Recherche ────────────────────────────────────────────────────

function Step1Search({
  meta,
  searchInput,
  onSearchInputChange,
  onSearch,
  isSearching,
  searchError,
  preview,
}: {
  meta: MarketplaceMeta;
  searchInput: string;
  onSearchInputChange: (v: string) => void;
  onSearch: () => void;
  isSearching: boolean;
  searchError: string | null;
  preview: LinkPreview | null;
}) {
  const notFound = preview && !preview.marketplaceProductId;
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
              if (e.key === "Enter") onSearch();
            }}
            placeholder={meta.searchPlaceholder}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-300 bg-white text-text-primary focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 font-mono text-sm"
            disabled={isSearching}
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={isSearching || !searchInput.trim()}
            className="px-5 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-40"
          >
            {isSearching ? "Recherche…" : "Chercher"}
          </button>
        </div>
      </div>

      {isSearching && (
        <div className="rounded-2xl border border-slate-200 p-6 text-center bg-slate-50">
          <div className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <span className="w-4 h-4 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
            Recherche en cours…
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

      {/* Galerie côté boutique : les vignettes zoomables de chaque couleur BJ.
          La galerie marketplace a été retirée — les colorName marketplace sont
          souvent des SKUs bruts (Ankor/Faire), et les cartes de mapping en
          étape 3 exposent déjà toutes les images côté marketplace. */}
      <VariantsGallery
        label={`Images des couleurs ${shopName}`}
        entries={preview.localColors
          .filter((c) => c.productImage)
          .map((c) => ({ key: c.productColorId, name: c.name, image: c.productImage, raw: false }))}
      />

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
  shopName,
  onToggleMapping,
  onAutoMap,
}: {
  meta: MarketplaceMeta;
  preview: LinkPreview;
  mapping: Record<string, string>;
  markup: MarkupConfig | null;
  shopName: string;
  onToggleMapping: (productColorId: string, variantId: string) => void;
  onAutoMap: () => void;
}) {
  const linkedCount = Object.keys(mapping).length;
  const totalLocal = preview.localColors.length;
  const todo = totalLocal - linkedCount;
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
            Pour chaque couleur Beli & Jolie, clique sur la variante marketplace équivalente.
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Couleurs BJ" value={totalLocal} />
        <KpiTile label="Liées" value={linkedCount} tone={linkedCount > 0 ? "success" : undefined} />
        <KpiTile label="Restantes" value={todo} tone={todo > 0 ? "warning" : undefined} />
        <KpiTile label="Variantes non utilisées" value={orphanCount} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-[0.16em] text-text-muted font-semibold flex items-center gap-2 flex-wrap">
          <span>Couleur Beli & Jolie</span>
          <span className="text-text-muted">→</span>
          <span>Variante marketplace à lier</span>
        </div>
        {preview.localColors.map((local) => (
          <MappingRow
            key={local.productColorId}
            meta={meta}
            local={local}
            candidates={preview.candidates}
            mapping={mapping}
            markup={markup}
            shopName={shopName}
            onToggle={onToggleMapping}
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
  same,
  side,
  priceBreakdown,
  mktUnknown,
}: {
  label: string;
  value: string;
  targetValue?: string;
  same: boolean;
  side: "bj" | "mkt";
  priceBreakdown?: {
    bjRaw: number;
    markup: MarkupConfig;
    finalPrice: number;
  };
  mktUnknown?: boolean;
}) {
  if (side === "mkt" && mktUnknown) {
    return (
      <div className="flex items-baseline gap-2 py-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
          {label}
        </span>
        <span
          className="text-sm text-text-muted"
          title="Le marketplace ne renvoie pas cette information dans son API — la valeur boutique est écrasée à la sync."
        >
          —
        </span>
      </div>
    );
  }
  if (side === "bj" || same) {
    return (
      <div className="flex items-baseline gap-2 py-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
          {label}
        </span>
        <span className="text-sm font-semibold text-text-primary">{value}</span>
      </div>
    );
  }

  // Diff côté marketplace : PFS barré → cible en vert
  if (priceBreakdown && priceBreakdown.markup.value !== 0) {
    return (
      <div className="flex items-baseline gap-2 py-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
          {label}
        </span>
        <span className="text-sm text-text-muted line-through">{value}</span>
        <span className="text-sm text-text-primary">{EUR.format(priceBreakdown.bjRaw)}</span>
        <span className="text-xs text-text-muted">{markupOperatorLabel(priceBreakdown.markup)}</span>
        <span className="text-xs text-text-muted">=</span>
        <span className="text-sm font-semibold text-emerald-700">
          {EUR.format(priceBreakdown.finalPrice)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted font-semibold w-16 shrink-0">
        {label}
      </span>
      <span className="text-sm text-text-muted line-through">{value}</span>
      <span className="text-xs text-emerald-600">→</span>
      <span className="text-sm font-semibold text-emerald-700">{targetValue}</span>
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border-2 border-slate-900 rounded-xl shadow-xl overflow-hidden max-h-[360px] overflow-y-auto">
          {selected && (
            <button
              type="button"
              onClick={() => {
                onSelect("");
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-xs text-rose-700 hover:bg-rose-50 border-b border-slate-200"
            >
              ✕ Ne pas lier
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
        </div>
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
  shopName,
  onToggle,
}: {
  meta: MarketplaceMeta;
  local: LinkLocalColor;
  candidates: LinkCandidate[];
  mapping: Record<string, string>;
  markup: MarkupConfig | null;
  shopName: string;
  onToggle: (productColorId: string, variantId: string) => void;
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
  const weightSame = linkedCand ? weightsAlmostEqual(local.weightKg, linkedCand.weightKg) : true;
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
              <AttrRow label="Poids" value={formatWeight(local.weightKg)} same side="bj" />
              <AttrRow label="Stock" value={String(local.stock)} same side="bj" />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Colonne centrale : flèches bidirectionnelles + "Lier à" ─── */}
      <div className="flex md:flex-col items-center justify-center gap-2 py-2 md:py-0 md:min-w-[80px]">
        <div
          className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold shadow-sm transition-colors ${
            linkedCand
              ? "bg-emerald-500 text-white"
              : "bg-slate-100 text-text-muted"
          }`}
          aria-hidden
        >
          ↔
        </div>
        <div className={`text-[11px] uppercase tracking-[0.18em] font-semibold text-center ${
          linkedCand ? "text-emerald-700" : "text-text-muted"
        }`}>
          {linkedCand ? "Liée à" : "Lier à"}
        </div>
      </div>

      {/* ─── Colonne marketplace ─── */}
      <div
        className={`rounded-xl border p-4 ${
          linkedCand ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="px-2 py-0.5 rounded-full text-white text-[9px] font-semibold uppercase tracking-wider"
            style={{ background: pillMktBg }}
          >
            {meta.name}
          </span>
        </div>

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

        {linkedCand ? (
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
                  label="Prix/u"
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
                <AttrRow
                  label="Poids"
                  value={formatWeight(linkedCand.weightKg)}
                  targetValue={formatWeight(local.weightKg)}
                  same={weightSame}
                  side="mkt"
                  mktUnknown={linkedCand.weightKg === null}
                />
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
        ) : (
          <div className="text-center py-6 text-xs text-text-muted italic">
            Aucune variante sélectionnée pour l'instant
          </div>
        )}
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
}: {
  meta: MarketplaceMeta;
  preview: LinkPreview;
  mapping: Record<string, string>;
  markup: MarkupConfig | null;
}) {
  const linked = preview.localColors.filter((c) => c.productColorId in mapping);
  const usedVids = new Set(Object.values(mapping));
  const orphanCands = preview.candidates.filter((c) => !usedVids.has(c.id));
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
          {orphanCands.length > 0 && (
            <li className="px-5 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-slate-100 text-text-muted flex items-center justify-center text-sm">
                −
              </div>
              <div className="text-sm text-text-primary">
                <b>{orphanCands.length}</b> variante(s) marketplace ignorée(s) — sans équivalent
                dans le catalogue
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
    </section>
  );
}

// ─── Galerie horizontale des vignettes de couleurs (zoomables) ─────────────

function VariantsGallery({
  label,
  entries,
}: {
  label: string;
  entries: { key: string; name: string; image: string | null; raw: boolean }[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted font-semibold mb-2">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <div key={e.key} className="flex flex-col items-center gap-1 w-16">
            <ZoomableImage
              src={e.image}
              alt={e.name}
              className="w-14 h-14 rounded-lg object-cover border border-slate-200"
              raw={e.raw}
            />
            <span className="text-[10px] text-text-muted text-center leading-tight w-full truncate">
              {e.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Écran de succès ────────────────────────────────────────────────────────

function StepDone({
  meta,
  onClose,
}: {
  meta: MarketplaceMeta;
  onClose: () => void;
}) {
  return (
    <section className="py-8 text-center space-y-4">
      <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-4xl mx-auto shadow-md">
        ✓
      </div>
      <h3 className="font-heading text-2xl font-bold text-text-primary">
        Produit lié à {meta.name} !
      </h3>
      <p className="text-sm text-text-muted max-w-md mx-auto">
        La liaison est active. Le badge vert apparaît maintenant sur la fiche produit.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"
      >
        Fermer
      </button>
    </section>
  );
}
