"use client";

/**
 * Modale de liaison BJ ↔ Microstore.
 *
 * Contexte : quand un produit BJ n'a pas encore d'ID Microstore mais existe
 * déjà côté MC Gérant (import CSV historique, saisie manuelle, migration),
 * cette modale permet de le rattacher sans re-publier.
 *
 * Recherche par référence exacte (l'API H5 Microstore ne supporte pas la
 * recherche partielle). Si trouvée : affiche la fiche + les couleurs. Un
 * clic sur « Lier » matche les couleurs BJ ↔ Microstore par nom normalisé
 * et persiste `Product.microstoreProductId` + `ProductColor.microstoreVariantId`.
 *
 * Sur produit déjà lié : bouton « Délier » qui reset les IDs locaux (sans
 * toucher à la fiche Microstore).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useBackdropClose } from "@/hooks/useBackdropClose";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  searchMicrostoreProductsByRef,
  linkMicrostoreProductManually,
  unlinkMicrostoreProduct,
  type MicrostoreLinkCandidate,
} from "@/app/actions/admin/microstore-linking";
import { useMarketplaceLinkJobs } from "@/components/admin/products/MarketplaceLinkContext";

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  reference: string;
  productName: string;
  /** ID Microstore actuel — null si non lié ou si legacy CSV (pas d'ID stocké). */
  currentMicrostoreProductId: number | null;
  /** Date du dernier push. Non-null même quand `microstoreProductId` est null
   *  (cas legacy CSV) — permet d'afficher le bouton « Délier » et l'état lié
   *  même sans ID Microstore. */
  microstoreLastPushedAt?: Date | string | null;
}

type ViewState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "searched"; results: MicrostoreLinkCandidate[]; query: string }
  | { kind: "error"; message: string };

export default function LinkMicrostoreProductModal({
  open,
  onClose,
  productId,
  reference,
  productName,
  currentMicrostoreProductId,
  microstoreLastPushedAt = null,
}: Props) {
  const hasLegacyLink = microstoreLastPushedAt != null;
  const isLinked = currentMicrostoreProductId != null || hasLegacyLink;
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { enqueueLinkJob, hasActiveJobForProduct } = useMarketplaceLinkJobs();
  const backdrop = useBackdropClose(onClose);

  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState(reference);
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-recherche à l'ouverture si aucun ID Microstore stocké côté BJ.
  // Couvre les 2 cas où l'admin voudra lier : jamais poussé, ou legacy CSV
  // (poussé sans ID). Pas de recherche auto si l'ID est déjà connu.
  useEffect(() => {
    if (!open) return;
    setQuery(reference);
    setView({ kind: "idle" });
    if (currentMicrostoreProductId == null && reference) {
      void handleSearch(reference);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reference, currentMicrostoreProductId]);

  async function handleSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setView({ kind: "searching" });
    const res = await searchMicrostoreProductsByRef(trimmed);
    if (res.success && res.data) {
      setView({ kind: "searched", results: res.data, query: trimmed });
    } else {
      setView({ kind: "error", message: res.error ?? "Erreur inconnue." });
    }
  }

  async function handleLink(candidate: MicrostoreLinkCandidate) {
    // Refuse une deuxième liaison en parallèle sur le même produit — évite
    // que 2 push Microstore se marchent dessus.
    if (hasActiveJobForProduct(productId, "microstore")) {
      toast.warning(
        "Liaison déjà en cours",
        "Attends que la liaison Microstore en cours soit terminée avant d'en relancer une pour ce produit.",
      );
      return;
    }
    const ok = await confirm({
      type: "info",
      title: `Lier ce produit à Microstore #${candidate.microstoreProductId} ?`,
      message:
        `Le produit BJ « ${productName} » sera rattaché à la fiche Microstore « ${candidate.name} » (référence ${candidate.itemRef}). Les couleurs BJ seront reliées aux SKUs Microstore par nom (${candidate.colors.length} couleur${candidate.colors.length > 1 ? "s" : ""} détectée${candidate.colors.length > 1 ? "s" : ""}). Une synchronisation complète de la fiche + des photos sera lancée dans la foulée pour aligner Microstore sur tes données BJ.`,
      confirmLabel: "Oui, lier et synchroniser",
    });
    if (!ok) return;

    // Enqueue le job dans le widget « Marketplaces » (colonne Liaison). La
    // liaison + le push tournent en fond, le résultat (succès / erreur avec
    // détail) s'affiche dans le tiroir, plus dans un toast fugace. Cohérent
    // avec la façon dont PFS / Ankor / eFa / Faire enregistrent leurs liaisons.
    setLinking(true);
    enqueueLinkJob(
      {
        marketplace: "microstore",
        productId,
        productName,
        reference,
        productImage: null,
      },
      async () => {
        const res = await linkMicrostoreProductManually(
          productId,
          candidate.microstoreProductId,
        );
        if (!res.success || !res.data) {
          return { success: false, error: res.error ?? "Erreur inconnue." };
        }
        const { matched, orphansBj, orphansMicrostore, sync } = res.data;
        const orphanParts: string[] = [];
        if (orphansBj.length > 0) {
          orphanParts.push(`Sans équivalent Microstore : ${orphansBj.join(", ")}.`);
        }
        if (orphansMicrostore.length > 0) {
          orphanParts.push(`Sans équivalent BJ : ${orphansMicrostore.join(", ")}.`);
        }
        const orphanTail = orphanParts.length > 0 ? ` ${orphanParts.join(" ")}` : "";
        // Cas 1 : push échoué (pays manquant, station expirée, incomplète…)
        //   → remonté en erreur rouge dans la colonne Liaison, avec le motif.
        // Cas 2 : succès partiel (fiche OK, photos KO)
        //   → remonté aussi en erreur : la cliente doit voir que les photos
        //     ne sont pas passées (LinkJobRow n'affiche `error` que si status
        //     = "error", donc un "success + warning" resterait invisible).
        if (sync.ran && (!sync.success || sync.error)) {
          const prefix = sync.success
            ? "Fiche synchronisée, photos non uploadées"
            : "Synchro échouée";
          return {
            success: false,
            error: `${matched} couleur(s) reliée(s).${orphanTail} ${prefix} : ${sync.error ?? "erreur inconnue"}.`,
            linked: matched,
          };
        }
        return { success: true, linked: matched };
      },
    );

    // Petit délai UX pour que la modale reste ~500 ms — le temps que le job
    // apparaisse dans le widget flottant avant qu'on ferme la modale.
    await new Promise((resolve) => setTimeout(resolve, 500));
    toast.success(
      "Liaison Microstore lancée",
      "Suis son avancement dans le widget « Marketplaces » en bas à droite.",
    );
    setLinking(false);
    router.refresh();
    onClose();
  }

  async function handleUnlink() {
    const ok = await confirm({
      type: "warning",
      title: "Délier ce produit de Microstore ?",
      message:
        "Les identifiants Microstore (produit + variantes) seront effacés côté BJ. La fiche Microstore n'est pas supprimée — elle reste chez toi. Prochain envoi = création d'une nouvelle fiche Microstore (avec risque de doublon).",
      confirmLabel: "Oui, délier",
    });
    if (!ok) return;
    setUnlinking(true);
    try {
      const res = await unlinkMicrostoreProduct(productId);
      if (res.success) {
        toast.success("Produit délié de Microstore");
        router.refresh();
        onClose();
      } else {
        toast.error("Impossible de délier", res.error ?? "Erreur inconnue.");
      }
    } finally {
      setUnlinking(false);
    }
  }

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={backdrop.onMouseDown}
      onMouseUp={backdrop.onMouseUp}
    >
      <div
        className="w-full max-w-[720px] bg-bg-primary rounded-[24px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] flex flex-col max-h-[92vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative overflow-hidden border-b border-border shrink-0">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 80% at 10% 0%, rgba(8,145,178,0.10), transparent 60%)," +
                "radial-gradient(50% 70% at 90% 10%, rgba(34,211,238,0.10), transparent 60%)",
            }}
          />
          <div className="relative px-7 pt-6 pb-5">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 text-white shadow-sm"
                  style={{ background: "linear-gradient(135deg,#0891b2,#22d3ee)" }}
                >
                  <span className="font-heading font-bold text-[13px]">M</span>
                </span>
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-cyan-50 border border-cyan-100 text-cyan-800 text-[10.5px] font-bold uppercase tracking-[0.14em]">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
                    Microstore · Liaison manuelle
                  </span>
                  <h3 className="font-heading text-[20px] font-bold text-text-primary leading-tight mt-2 truncate">
                    {currentMicrostoreProductId != null
                      ? `Liaison Microstore — ${productName}`
                      : `Lier « ${productName} » à Microstore`}
                  </h3>
                  <p className="text-[12.5px] text-text-secondary mt-1 leading-relaxed">
                    Référence BJ&nbsp;: <span className="font-mono font-semibold">{reference}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-secondary transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-7 space-y-5">
          {/* État lié : afficher badge + option de délier */}
          {isLinked && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-emerald-900">
                    {currentMicrostoreProductId != null
                      ? `Actuellement lié à Microstore #${currentMicrostoreProductId}`
                      : "Produit déjà envoyé à Microstore (import CSV historique)"}
                  </p>
                  <p className="text-[12.5px] text-emerald-800 mt-1 leading-relaxed">
                    {currentMicrostoreProductId != null
                      ? "Les prochains envois mettront à jour cette fiche (pas de doublon)."
                      : "Aucun identifiant Microstore stocké côté BJ — les prochains envois risquent de créer un doublon. Utilise « Lier manuellement » ci-dessous pour rattacher à la bonne fiche, ou « Délier » pour recommencer à zéro."}
                  </p>
                  <button
                    type="button"
                    onClick={handleUnlink}
                    disabled={unlinking}
                    className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    {unlinking ? "Suppression du lien…" : "Délier ce produit"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Recherche par référence */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">
                {currentMicrostoreProductId != null
                  ? "Rattacher à une autre fiche Microstore"
                  : "Référence Microstore à rattacher"}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSearch(query);
                    }
                  }}
                  placeholder="Ex : A2630"
                  className="field-input flex-1 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleSearch(query)}
                  disabled={view.kind === "searching" || !query.trim()}
                  className="inline-flex items-center justify-center h-10 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-semibold hover:bg-black transition-colors disabled:opacity-50"
                >
                  {view.kind === "searching" ? "Recherche…" : "Chercher"}
                </button>
              </div>
              <p className="text-[11px] text-text-muted mt-1.5">
                La recherche Microstore est exacte : tape la référence Microstore telle qu'elle apparaît côté MC Gérant.
              </p>
            </div>

            {/* Résultats */}
            {view.kind === "error" && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-[12.5px] text-rose-800">
                {view.message}
              </div>
            )}

            {view.kind === "searched" && view.results.length === 0 && (
              <div className="rounded-xl border border-border bg-bg-secondary p-4 text-[12.5px] text-text-secondary">
                Aucun produit trouvé sur Microstore pour la référence «&nbsp;<span className="font-mono font-semibold">{view.query}</span>&nbsp;». Vérifie la casse et l'orthographe côté MC Gérant.
              </div>
            )}

            {view.kind === "searched" && view.results.length > 0 && (
              <div className="space-y-2">
                {view.results.map((c) => {
                  const alreadyLinked = c.microstoreProductId === currentMicrostoreProductId;
                  return (
                    <div
                      key={c.microstoreProductId}
                      className={`rounded-xl border p-4 ${alreadyLinked ? "border-emerald-200 bg-emerald-50/60" : "border-border bg-bg-primary"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-text-primary truncate">
                            {c.name || "(sans nom)"}
                          </p>
                          <p className="text-[11.5px] text-text-secondary mt-1">
                            Microstore #{c.microstoreProductId} · Référence <span className="font-mono">{c.itemRef}</span>
                          </p>
                          {c.colors.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {c.colors.map((col) => (
                                <span
                                  key={col.colorId}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary text-[10.5px]"
                                >
                                  {col.colorName}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleLink(c)}
                          disabled={linking || alreadyLinked}
                          className={`shrink-0 inline-flex items-center h-9 px-4 rounded-lg text-[12.5px] font-semibold transition-colors ${
                            alreadyLinked
                              ? "bg-emerald-100 text-emerald-800 cursor-default"
                              : "bg-bg-dark text-text-inverse hover:bg-black"
                          } disabled:opacity-50 disabled:cursor-wait`}
                        >
                          {alreadyLinked ? "Déjà lié" : linking ? "Liaison…" : "Lier"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-7 py-4 border-t border-border shrink-0 bg-bg-primary">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center h-10 px-4 border border-border text-text-secondary hover:border-ink hover:text-text-primary text-sm font-medium rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
