"use client";

/**
 * Modale de liaison BJ ↔ Ankorstore (version back-office reverse-engineered).
 *
 * Interroge Ankor par référence produit et propose les candidats détectés.
 * Après clic sur « Lier », lance un publish complet qui écrase les SKU Ankor
 * au format BJ (`{REF}_{COULEUR}_{5CHARS}`).
 *
 * UI : header aurora sky, bloc contexte pédagogique, liste candidats détaillés
 * avec pastilles couleur BJ, timeline pendant la liaison. Responsive plein
 * écran sur mobile, dark-mode ready via variables CSS.
 */

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { getImageSrc } from "@/lib/image-utils";
import {
  searchAnkorstoreBoCandidatesForBjProduct,
  linkBjProductToAnkorstoreBo,
  type AnkorstoreBoLinkCandidate,
  type AnkorstoreBoLocalColorPreview,
} from "@/app/actions/admin/ankorstore-bo";

interface Props {
  productId: string;
  productName: string;
  reference: string;
  onClose: () => void;
  /** Compat legacy — ignoré. Cette modale sert uniquement Ankorstore. */
  marketplace?: string;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      candidates: AnkorstoreBoLinkCandidate[];
      localColors: AnkorstoreBoLocalColorPreview[];
    };

type LinkingState =
  | { kind: "idle" }
  | { kind: "linking"; ankorProductId: number; step: number; candidateName: string };

const LINKING_STEPS = [
  "Lien produit posé côté boutique",
  "Upload des photos vers Ankorstore",
  "Écrasement des variantes SKU chez Ankor",
  "Mise à jour du statut visible / masqué",
  "Enregistrement des identifiants variantes",
] as const;

export default function LinkAnkorstoreProductModal({
  productId,
  productName,
  reference,
  onClose,
}: Props) {
  const toast = useToast();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [linking, setLinking] = useState<LinkingState>({ kind: "idle" });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setView({ kind: "loading" });
    (async () => {
      const r = await searchAnkorstoreBoCandidatesForBjProduct(productId);
      if (cancelled) return;
      if (r.success) {
        setView({
          kind: "ready",
          candidates: r.candidates,
          localColors: r.localColorsPreview,
        });
      } else {
        setView({ kind: "error", message: r.error });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, reloadTick]);

  // Ferme la modale sur Échap (uniquement quand aucune liaison n'est en cours).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && linking.kind === "idle") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, linking.kind]);

  // Animation « step-by-step » de la timeline pendant la liaison (purement UI —
  // le server action est atomique donc on ne peut pas suivre la vraie progression).
  useEffect(() => {
    if (linking.kind !== "linking") return;
    const t = setInterval(() => {
      setLinking((cur) =>
        cur.kind === "linking" && cur.step < LINKING_STEPS.length - 1
          ? { ...cur, step: cur.step + 1 }
          : cur
      );
    }, 1400);
    return () => clearInterval(t);
  }, [linking.kind]);

  async function handleLink(candidate: AnkorstoreBoLinkCandidate) {
    setLinking({
      kind: "linking",
      ankorProductId: candidate.ankorProductId,
      step: 0,
      candidateName: candidate.name,
    });
    try {
      const r = await linkBjProductToAnkorstoreBo(productId, candidate.ankorProductId);
      if (r.success) {
        toast.success(
          "Produit lié",
          `Ankorstore #${candidate.ankorProductId} — ${r.linkedVariants ?? 0} variante(s) associée(s).`
        );
        onClose();
      } else {
        toast.error("Liaison échouée", r.error ?? "Erreur inconnue");
        setLinking({ kind: "idle" });
      }
    } catch (err) {
      toast.error("Liaison échouée", (err as Error).message);
      setLinking({ kind: "idle" });
    }
  }

  const localColorsCount =
    view.kind === "ready" ? view.localColors.length : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={() => linking.kind === "idle" && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ankor-link-title"
    >
      <div
        className="relative flex w-full sm:w-[min(860px,95vw)] max-h-full sm:max-h-[90vh] flex-col overflow-hidden bg-bg-primary sm:rounded-3xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <AnkorstoreLinkHeader
          productName={productName}
          reference={reference}
          localColorsCount={localColorsCount}
          disabled={linking.kind !== "idle"}
          onClose={onClose}
        />

        {linking.kind === "idle" && (
          <ContextExplainer reference={reference} colorsCount={localColorsCount} />
        )}

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
          {linking.kind === "linking" ? (
            <LinkingTimeline
              candidateName={linking.candidateName}
              ankorProductId={linking.ankorProductId}
              step={linking.step}
            />
          ) : view.kind === "loading" ? (
            <LoadingSkeleton />
          ) : view.kind === "error" ? (
            <ErrorPanel
              message={view.message}
              onRetry={() => setReloadTick((n) => n + 1)}
            />
          ) : view.candidates.length === 0 ? (
            <EmptyState
              reference={reference}
              onRetry={() => setReloadTick((n) => n + 1)}
            />
          ) : (
            <CandidatesList
              candidates={view.candidates}
              localColors={view.localColors}
              onLink={handleLink}
              disabled={false}
            />
          )}
        </div>

        <ModalFooter onClose={onClose} disabled={linking.kind !== "idle"} />
      </div>
    </div>
  );
}

// ─── Header aurora sky ──────────────────────────────────────────────────────

function AnkorstoreLinkHeader({
  productName,
  reference,
  localColorsCount,
  disabled,
  onClose,
}: {
  productName: string;
  reference: string;
  localColorsCount: number | null;
  disabled: boolean;
  onClose: () => void;
}) {
  return (
    <header className="relative overflow-hidden">
      <div className="ankor-link-header-bg absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="ankor-link-halo-primary absolute -top-24 -right-16 h-64 w-64 rounded-full opacity-60 blur-3xl" />
        <div className="ankor-link-halo-secondary absolute -bottom-20 -left-16 h-52 w-52 rounded-full opacity-40 blur-3xl" />
      </div>
      <div className="relative flex items-start justify-between gap-3 p-4 sm:p-6 text-white">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0">
          <div
            className="ankor-link-avatar-bg flex h-12 w-12 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl font-heading text-xl sm:text-2xl font-bold shadow-lg ring-2 ring-white/40"
            aria-hidden
          >
            A
          </div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs uppercase tracking-[0.22em] text-sky-100 font-medium">
              Ankorstore · Liaison manuelle
            </p>
            <h2
              id="ankor-link-title"
              className="mt-1 font-heading text-lg sm:text-2xl font-bold truncate"
            >
              Lier « {productName} »
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-sky-50">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-sm">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span>
                  Référence <strong className="ml-1 font-mono">{reference}</strong>
                </span>
              </span>
              {localColorsCount !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 backdrop-blur-sm">
                  {localColorsCount} couleur{localColorsCount > 1 ? "s" : ""} BJ
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={disabled}
          className="rounded-full p-2 text-white hover:bg-white/15 disabled:opacity-50"
          aria-label="Fermer"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// ─── Bloc contexte pédagogique ──────────────────────────────────────────────

function ContextExplainer({
  reference,
  colorsCount,
}: {
  reference: string;
  colorsCount: number | null;
}) {
  return (
    <div className="px-4 sm:px-6 pt-4 pb-3">
      <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-3 sm:p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-primary ring-1 ring-sky-200">
          <svg className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-xs sm:text-sm leading-relaxed text-text-secondary">
          <strong className="text-text-primary">Comment ça marche&nbsp;: </strong>
          Ankorstore est interrogé avec la référence{" "}
          <strong className="font-mono">{reference}</strong>. Choisis le produit
          qui correspond ci-dessous.{" "}
          {colorsCount !== null && colorsCount > 0 && (
            <>
              Une fois lié, tes <strong>{colorsCount} couleur{colorsCount > 1 ? "s" : ""} BJ</strong>{" "}
              écraseront les variantes Ankor et les renommeront au format{" "}
              <span className="whitespace-nowrap font-mono text-sky-700">
                {reference}_COULEUR
              </span>.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Skeleton loading ───────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="pt-2">
      <div className="mb-4 flex items-center gap-3 text-sm text-text-secondary">
        <svg className="h-5 w-5 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
        </svg>
        Interrogation d'Ankorstore…
      </div>
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl border border-border bg-bg-primary p-4 sm:p-5">
            <div className="flex gap-3 sm:gap-4">
              <div className="h-20 w-20 sm:h-24 sm:w-24 shrink-0 rounded-xl bg-bg-tertiary" />
              <div className="flex-1 space-y-3">
                <div className="h-4 w-1/3 rounded bg-bg-tertiary" />
                <div className="h-5 w-2/3 rounded bg-bg-tertiary" />
                <div className="flex gap-2">
                  <div className="h-6 w-16 rounded-full bg-bg-tertiary" />
                  <div className="h-6 w-16 rounded-full bg-bg-tertiary" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── État vide ──────────────────────────────────────────────────────────────

function EmptyState({
  reference,
  onRetry,
}: {
  reference: string;
  onRetry: () => void;
}) {
  return (
    <div className="pt-2">
      <div className="rounded-2xl border border-border bg-bg-primary p-6 sm:p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-bg-secondary">
          <svg className="h-7 w-7 sm:h-8 sm:w-8 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
        </div>
        <h3 className="mb-1 font-heading text-lg font-semibold text-text-primary">
          Aucun produit trouvé
        </h3>
        <p className="mx-auto mb-4 max-w-md text-sm text-text-secondary">
          Ankorstore n'a rien retourné pour la référence{" "}
          <strong className="font-mono">{reference}</strong>. Ce produit n'existe
          probablement pas encore chez eux.
        </p>
        <div className="mx-auto mb-4 max-w-md rounded-xl border border-sky-200 bg-sky-50 p-4 text-left">
          <p className="text-sm text-text-secondary">
            <strong className="text-text-primary">Deux possibilités&nbsp;:</strong>
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs text-text-secondary marker:text-sky-500">
            <li>
              Le produit existe sous un autre nom → vérifie la référence côté BJ
              et réessaie.
            </li>
            <li>
              Le produit n'existe pas → ferme cette fenêtre et clique sur{" "}
              <strong>« Publier chez Ankorstore »</strong>.
            </li>
          </ul>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
          </svg>
          Relancer la recherche
        </button>
      </div>
    </div>
  );
}

// ─── Panneau erreur ─────────────────────────────────────────────────────────

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="pt-2">
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-6">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100">
            <svg className="h-5 w-5 text-red-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-heading font-semibold text-red-900">
              Impossible d'interroger Ankorstore
            </h3>
            <p className="mt-1 text-sm text-red-800 break-words">{message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onRetry}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Réessayer
              </button>
              <a
                href="/admin/parametres?tab=marketplaces"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:border-red-300"
              >
                Ouvrir les paramètres
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Liste de candidats ─────────────────────────────────────────────────────

function CandidatesList({
  candidates,
  localColors,
  onLink,
  disabled,
}: {
  candidates: AnkorstoreBoLinkCandidate[];
  localColors: AnkorstoreBoLocalColorPreview[];
  onLink: (c: AnkorstoreBoLinkCandidate) => void;
  disabled: boolean;
}) {
  return (
    <div className="pt-2">
      <p className="mb-3 sm:mb-4 text-sm text-text-secondary">
        <strong className="text-text-primary">
          {candidates.length} candidat{candidates.length > 1 ? "s" : ""}
        </strong>{" "}
        trouvé{candidates.length > 1 ? "s" : ""} chez Ankorstore
      </p>
      <ul className="space-y-3">
        {candidates.map((c) => (
          <CandidateCard
            key={c.ankorProductId}
            candidate={c}
            localColors={localColors}
            onLink={onLink}
            disabled={disabled}
          />
        ))}
      </ul>
      <div className="mt-5 rounded-xl border border-dashed border-border bg-bg-secondary p-3 sm:p-4 text-xs leading-relaxed text-text-secondary">
        <strong className="text-text-primary">Aucun ne correspond&nbsp;? </strong>
        Ferme cette fenêtre et clique sur « Publier chez Ankorstore » pour créer
        une nouvelle fiche.
      </div>
    </div>
  );
}

// ─── Carte candidat ─────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  localColors,
  onLink,
  disabled,
}: {
  candidate: AnkorstoreBoLinkCandidate;
  localColors: AnkorstoreBoLocalColorPreview[];
  onLink: (c: AnkorstoreBoLinkCandidate) => void;
  disabled: boolean;
}) {
  const totalAnkorVariants = candidate.variants.length;

  const badge = useMemo(() => {
    switch (candidate.confidence) {
      case "high":
        return {
          cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
          label: "Correspondance forte",
          check: true,
        };
      case "medium":
        return {
          cls: "border-amber-200 bg-amber-50 text-amber-700",
          label: "Correspondance partielle",
          check: false,
        };
      default:
        return {
          cls: "border-border bg-bg-secondary text-text-secondary",
          label: "Correspondance faible",
          check: false,
        };
    }
  }, [candidate.confidence]);

  const matchedCountCls =
    candidate.confidence === "high"
      ? "text-emerald-700"
      : candidate.confidence === "medium"
        ? "text-amber-700"
        : "text-text-secondary";

  return (
    <li className="group rounded-2xl border border-border bg-bg-primary p-4 sm:p-5 transition-shadow hover:border-sky-300 hover:shadow-[0_8px_24px_-12px_rgba(14,165,233,0.4)]">
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="hidden sm:flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-bg-secondary to-bg-tertiary">
          <svg className="h-10 w-10 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21,15 16,10 5,21" />
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}
            >
              {badge.check && (
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
              {badge.label}
            </span>
            <span className="font-mono text-xs text-text-muted">
              #{candidate.ankorProductId}
            </span>
            <span className="text-xs text-text-muted">·</span>
            <span className="text-xs text-text-muted">
              <strong className={matchedCountCls}>
                {candidate.matchedVariantCount}/{totalAnkorVariants}
              </strong>{" "}
              variante{totalAnkorVariants > 1 ? "s" : ""} reconnue
              {candidate.matchedVariantCount > 1 ? "s" : ""}
            </span>
          </div>

          <p className="font-heading text-base sm:text-lg font-semibold leading-snug text-text-primary">
            {candidate.name}
          </p>

          {candidate.variants.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                Variantes chez Ankorstore
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {candidate.variants.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-text-secondary">
                        {v.sku}
                      </p>
                      {v.colorValue && (
                        <p className="truncate text-xs font-medium text-text-primary">
                          {v.colorValue}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localColors.length > 0 && (
            <RenamingPreview
              confidence={candidate.confidence}
              matchedCount={candidate.matchedVariantCount}
              totalAnkorVariants={totalAnkorVariants}
              localColors={localColors}
            />
          )}

          <div className="mt-4 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-between gap-2 sm:gap-3">
            <a
              href={`https://fr.ankorstore.com${candidate.link}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 self-start text-xs text-sky-700 hover:text-sky-900"
            >
              Voir la fiche chez Ankorstore
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17l10-10M7 7h10v10" />
              </svg>
            </a>
            <button
              onClick={() => onLink(candidate)}
              disabled={disabled}
              className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm disabled:opacity-50 ${
                candidate.confidence === "high"
                  ? "bg-slate-900 text-white hover:bg-slate-800"
                  : "border border-border bg-bg-primary text-text-primary hover:border-border-strong"
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
              {candidate.confidence === "high" ? "Lier ce produit" : "Lier quand même"}
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

// ─── Preview des SKU cibles après liaison ───────────────────────────────────

function RenamingPreview({
  confidence,
  matchedCount,
  totalAnkorVariants,
  localColors,
}: {
  confidence: AnkorstoreBoLinkCandidate["confidence"];
  matchedCount: number;
  totalAnkorVariants: number;
  localColors: AnkorstoreBoLocalColorPreview[];
}) {
  const isPartial = matchedCount < totalAnkorVariants || matchedCount < localColors.length;
  const boxCls =
    confidence === "high" || !isPartial
      ? "border-sky-200 bg-sky-50 text-text-secondary"
      : "border-amber-200 bg-amber-50 text-text-secondary";

  return (
    <div className={`mt-3 rounded-xl border p-3 ${boxCls}`}>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
        <svg
          className={`h-3.5 w-3.5 ${confidence === "high" || !isPartial ? "text-sky-600" : "text-amber-600"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        Après liaison
      </p>
      <p className="mb-2 text-xs leading-relaxed">
        Les variantes seront renommées :
      </p>
      <div className="flex flex-wrap gap-1.5">
        {localColors.map((c) => (
          <span
            key={c.productColorId}
            className="inline-flex items-center gap-1.5 rounded-md bg-bg-primary/70 px-2 py-1 text-[11px]"
            title={c.colorName}
          >
            <ColorDot color={c} />
            <span className="font-mono text-sky-700">{c.skuPreview}</span>
          </span>
        ))}
      </div>
      {isPartial && confidence !== "high" && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
          Les variantes Ankor non-reconnues seront écrasées, et les couleurs BJ
          manquantes seront créées.
        </p>
      )}
    </div>
  );
}

function ColorDot({ color }: { color: AnkorstoreBoLocalColorPreview }) {
  if (color.patternImage) {
    return (
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 bg-cover bg-center"
        style={{ backgroundImage: `url(${getImageSrc(color.patternImage)})` }}
        aria-label={color.colorName}
      />
    );
  }
  return (
    <span
      className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
      style={{ background: color.hex ?? "#e2e8f0" }}
      aria-label={color.colorName}
    />
  );
}

// ─── Timeline pendant la liaison ────────────────────────────────────────────

function LinkingTimeline({
  candidateName,
  ankorProductId,
  step,
}: {
  candidateName: string;
  ankorProductId: number;
  step: number;
}) {
  return (
    <div className="pt-4">
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:p-6">
        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-bg-primary ring-1 ring-sky-200">
            <svg className="h-6 w-6 animate-spin text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-sky-700 font-semibold">
              Liaison en cours
            </p>
            <h3 className="font-heading text-base sm:text-lg font-semibold text-text-primary truncate">
              {candidateName} <span className="text-text-muted">↔ #{ankorProductId}</span>
            </h3>
          </div>
        </div>

        <ol className="space-y-2.5">
          {LINKING_STEPS.map((label, i) => {
            const state: "done" | "current" | "pending" =
              i < step ? "done" : i === step ? "current" : "pending";
            return (
              <li key={i} className="flex items-center gap-3 text-sm">
                {state === "done" && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                )}
                {state === "current" && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white">
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
                {state === "pending" && (
                  <span className="h-6 w-6 shrink-0 rounded-full border-2 border-dashed border-border" />
                )}
                <span
                  className={
                    state === "current"
                      ? "font-medium text-text-primary"
                      : state === "done"
                        ? "text-text-secondary"
                        : "text-text-muted"
                  }
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-xs text-text-muted">
          Ne ferme pas la fenêtre — la liaison prend en général 15 à 30 secondes.
        </p>
      </div>
    </div>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function ModalFooter({
  onClose,
  disabled,
}: {
  onClose: () => void;
  disabled: boolean;
}) {
  return (
    <footer className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-border bg-bg-secondary px-4 sm:px-6 py-3 sm:py-4">
      <p className="text-xs text-text-muted">
        Astuce&nbsp;: après liaison, tes prochains « Rafraîchir » enverront les
        mises à jour chez Ankor.
      </p>
      <button
        onClick={onClose}
        disabled={disabled}
        className="rounded-xl border border-border bg-bg-primary px-4 py-2 text-sm font-medium text-text-primary hover:border-border-strong disabled:opacity-50"
      >
        {disabled ? "Liaison en cours…" : "Annuler"}
      </button>
    </footer>
  );
}
