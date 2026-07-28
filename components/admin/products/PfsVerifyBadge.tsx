"use client";

/**
 * Pastille de vérification PFS (variante « pull-only » validée avec la cliente
 * le 2026-07-24 — le vérificateur ne pousse plus rien vers PFS, il ne fait que
 * proposer de récupérer les valeurs PFS quand un écart est détecté).
 *
 * 4 états :
 *   1. Non vérifié → carré gris pointillé + mini-tooltip « Cliquez pour vérifier ».
 *   2. En cours    → spinner sky.
 *   3. Conforme    → check emerald.
 *   4. Divergences → triangle amber. Le clic ouvre la modale d'écarts avec un
 *                    seul choix par ligne : « Prendre depuis PFS » (ou
 *                    « Non corrigeable » pour les champs Lot C).
 *
 * Après application des pulls, les marketplaces éligibles (Ankor/eFashion/Faire)
 * sont proposées pour propager les nouvelles valeurs.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  verifySinglePfsProduct,
  applyPfsVerifyPullsAndCollect,
} from "@/app/actions/admin/pfs-verify";
import { useMarketplaceRefreshQueue } from "@/components/admin/products/MarketplaceRefreshContext";
import { useRefreshMarketplacePrompt } from "@/components/admin/products/RefreshMarketplaceDialog";
import { usePfsAuditActive } from "@/components/admin/products/PfsAuditActiveContext";
import type { PfsPullEligibleMarketplace } from "@/lib/pfs-verify-eligible-marketplaces";
import { isPullSupportedLotB, issueKey } from "@/lib/pfs-verify-apply-shared";

// ─── Types (miroir des types serveur pfs-verify) ───────────────────────────

export type PfsVerifyIssueField =
  | "name" | "description" | "dimensions" | "composition"
  | "country" | "season" | "gender" | "category" | "family" | "isBestSeller"
  | "productStatus"
  | "saleType" | "price" | "stock" | "weight" | "isActive"
  | "extraVariant" | "missingVariant";

export interface PfsVerifyIssue {
  scope: "product" | "color";
  field: PfsVerifyIssueField;
  fieldLabel: string;
  colorRef?: string;
  colorName?: string;
  colorHex?: string | null;
  variantType?: "UNIT" | "PACK";
  packQuantity?: number | null;
  pfsVariantId?: string;
  pfsValue: string | null;
  expectedValue: string | null;
  note?: string;
  /** Raison de blocage « Envoyer PFS » — conservée pour compat (ignorée UI). */
  pushBlocked?: string;
  /** Raison de blocage « Prendre PFS » (serveur). Non défini = récup OK. */
  pullBlocked?: string;
}

interface Props {
  productId: string;
  productName: string;
  productReference: string;
  productFirstImage: string | null;
  pfsProductId: string | null;
  pfsCheckedAt: string | null;
  pfsCheckStatus: "ok" | "diff" | null;
  pfsCheckIssues: PfsVerifyIssue[] | null;
}

export default function PfsVerifyBadge(props: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const { enqueue, inFlightProductIds } = useMarketplaceRefreshQueue();
  const { ask: askRefreshOptions } = useRefreshMarketplacePrompt();
  const { auditRunning } = usePfsAuditActive();
  const [loading, setLoading] = useState(false);
  const applying = inFlightProductIds.has(props.productId);
  const [submitting, setSubmitting] = useState(false);
  const [checkedAt, setCheckedAt] = useState(props.pfsCheckedAt);
  const [status, setStatus] = useState<"ok" | "diff" | null>(props.pfsCheckStatus);
  const [issues, setIssues] = useState<PfsVerifyIssue[] | null>(props.pfsCheckIssues);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  useEffect(() => {
    setCheckedAt(props.pfsCheckedAt);
    setStatus(props.pfsCheckStatus);
    setIssues(props.pfsCheckIssues);
  }, [props.pfsCheckedAt, props.pfsCheckStatus, props.pfsCheckIssues]);

  if (!props.pfsProductId) return null;

  // Pendant un audit de masse, on force TOUTES les pastilles en "loading"
  // — l'utilisatrice voit d'un coup d'œil que la vérif tourne partout.
  // Le state réel (ok/diff/unchecked) reprend automatiquement à la fin
  // de l'audit via router.refresh() déclenché par le drawer.
  const state: "unchecked" | "loading" | "ok" | "diff" = loading || auditRunning
    ? "loading"
    : status === "ok"
      ? "ok"
      : status === "diff"
        ? "diff"
        : "unchecked";

  const runVerify = async () => {
    if (loading) return;
    // Bloque un verify unitaire pendant qu'un audit de masse tourne — sinon
    // les 2 lectures PFS peuvent se marcher dessus et l'audit remplacera
    // ensuite la valeur écrite par le clic manuel.
    if (auditRunning) return;
    setLoading(true);
    try {
      const res = await verifySinglePfsProduct(props.productId);
      if (!res.success) {
        toast.error(`Vérification échouée : ${res.error}`);
        return;
      }
      const o = res.outcome;
      if (!o.ok) {
        const msg = o.error?.message ?? "Erreur inconnue";
        toast.error(`« ${props.productName} » : ${msg}`);
        return;
      }
      setCheckedAt(o.checkedAt ?? new Date().toISOString());
      setStatus(o.status ?? "ok");
      setIssues(o.issues ?? null);
      if (o.status === "ok") {
        toast.success(`« ${props.productName} » conforme à PFS`);
      } else if (o.status === "diff" && (o.issueCount ?? 0) > 0) {
        toast.info(
          `${o.issueCount} écart${(o.issueCount ?? 0) > 1 ? "s" : ""} détecté${(o.issueCount ?? 0) > 1 ? "s" : ""} — ouverture du détail`,
        );
        setModalOpen(true);
      }
    } catch (err) {
      toast.error(
        `Vérification échouée : ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pfs-verify-wrap relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (state === "loading") return;
          if (state === "diff") { setModalOpen(true); return; }
          void runVerify();
        }}
        className={badgeButtonClass(state)}
        aria-label={ariaLabelForState(state)}
      >
        {state === "loading" && (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {state === "ok" && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        {state === "unchecked" && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
          </svg>
        )}
        {state === "diff" && (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2L1 21h22L12 2zm0 6l7.53 12H4.47L12 8z" />
          </svg>
        )}
      </button>

      {state !== "diff" && (
        <MiniTooltip>
          {state === "unchecked" && "Cliquez pour vérifier"}
          {state === "loading" && "Vérification en cours…"}
          {state === "ok" && (
            <>
              Conforme
              {checkedAt && ` · ${formatRelative(checkedAt)}`}
              <br />
              <span className="opacity-70">Cliquez pour revérifier</span>
            </>
          )}
        </MiniTooltip>
      )}

      {state === "diff" && (
        <MiniTooltip>
          {`${issues?.length ?? 0} écart${(issues?.length ?? 0) > 1 ? "s" : ""} — cliquez pour voir le détail`}
        </MiniTooltip>
      )}

      {state === "diff" && modalOpen && issues && issues.length > 0 && (
        <DiffModal
          productName={props.productName}
          productReference={props.productReference}
          issues={issues}
          checkedAt={checkedAt}
          loading={loading}
          applying={applying}
          submitting={submitting}
          onClose={() => setModalOpen(false)}
          onReverify={runVerify}
          onValidate={async () => {
            if (!issues) return;
            // Toutes les actions sont "pull" — on n'envoie plus rien vers PFS.
            const supportedActions = issues
              .filter((iss) => isPullActionable(iss))
              .map((iss) => ({ key: issueKey(iss), direction: "pull" as const }));
            if (supportedActions.length === 0) {
              toast.info("Aucune correction applicable — tous les écarts sont à corriger à la main.");
              return;
            }
            const confirmed = await confirm.confirm({
              type: "warning",
              title: "Récupérer les valeurs PFS ?",
              message:
                `${supportedActions.length} valeur${supportedActions.length > 1 ? "s" : ""} de notre fiche vont être remplacée${supportedActions.length > 1 ? "s" : ""} par celles de PFS.\n\n` +
                `Les autres marketplaces (Ankorstore / eFashion / Faire) seront marquées « Synchro nécessaire ».\n\n` +
                `Cette action est irréversible.`,
              confirmLabel: "Récupérer",
              cancelLabel: "Annuler",
            });
            if (confirmed !== true) return;

            setSubmitting(true);
            try {
              const res = await applyPfsVerifyPullsAndCollect(props.productId, supportedActions);
              if (!res.success) {
                toast.error("Récupération depuis PFS échouée", res.error);
                return;
              }

              setCheckedAt(res.outcome.checkedAt ?? new Date().toISOString());
              setStatus(res.outcome.status ?? null);
              setIssues(res.outcome.issues ?? null);

              if (res.pulledCount === 0) {
                const firstErr = res.report.errors[0]?.error;
                if (firstErr) {
                  toast.error("Aucune correction locale appliquée", firstErr);
                } else {
                  toast.info("Aucune correction locale appliquée");
                }
                return;
              }

              if (res.eligibleMarketplaces.length === 0) {
                toast.success(
                  "Modifications appliquées",
                  "Aucune marketplace à synchroniser pour ce produit.",
                );
                return;
              }

              const eligibleSet = new Set<PfsPullEligibleMarketplace>(res.eligibleMarketplaces);
              const options = await askRefreshOptions({
                count: 1,
                firstProductName: props.productName,
                showPfs: false,
                showAnkorstore: eligibleSet.has("ankorstore"),
                showEfashion: eligibleSet.has("efashion"),
                showFaire: eligibleSet.has("faire"),
                productIds: [props.productId],
                title: "Propager vers vos marketplaces ?",
                subtitle: `« ${props.productName} » — les valeurs récupérées depuis PFS peuvent être envoyées.`,
                eyebrow: "Synchronisation",
                confirmLabel: "Synchroniser",
                showBoutique: false,
                defaultAllChecked: true,
                actionLabel: "synchroniser",
                actionMode: "update",
              });
              if (!options) return;

              const inputs = [] as Parameters<typeof enqueue>[0];
              if (options.ankorstore && eligibleSet.has("ankorstore")) {
                inputs.push({
                  productId: props.productId,
                  reference: props.productReference,
                  productName: props.productName,
                  firstImage: props.productFirstImage,
                  options: { local: false, pfs: false, ankorstore: true, efashion: false, faire: false },
                  marketplace: "ankorstore",
                  mode: "resync",
                });
              }
              if (options.efashion && eligibleSet.has("efashion")) {
                inputs.push({
                  productId: props.productId,
                  reference: props.productReference,
                  productName: props.productName,
                  firstImage: props.productFirstImage,
                  options: { local: false, pfs: false, ankorstore: false, efashion: true, faire: false },
                  marketplace: "efashion",
                  mode: "resync",
                });
              }
              if (options.faire && eligibleSet.has("faire")) {
                inputs.push({
                  productId: props.productId,
                  reference: props.productReference,
                  productName: props.productName,
                  firstImage: props.productFirstImage,
                  options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
                  marketplace: "faire",
                  mode: "resync",
                });
              }
              if (inputs.length === 0) return;
              enqueue(inputs);
              toast.info(
                `${inputs.length} synchronisation${inputs.length > 1 ? "s" : ""} lancée${inputs.length > 1 ? "s" : ""}`,
                "Suivez l'avancée dans le widget en bas à droite.",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        />
      )}
      <style jsx>{`
        .pfs-verify-wrap :global(.pv-mini) {
          position: absolute;
          z-index: 60;
          opacity: 0;
          pointer-events: none;
          transform: translateY(2px);
          transition: opacity 0.15s, transform 0.15s;
          padding-top: 8px;
        }
        .pfs-verify-wrap:hover :global(.pv-mini),
        .pfs-verify-wrap:focus-within :global(.pv-mini) {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}

// ─── Sous-composants ───────────────────────────────────────────────────────

function MiniTooltip({ children }: { children: React.ReactNode }) {
  return (
    <div className="pv-mini top-full left-1/2 -translate-x-1/2 whitespace-nowrap">
      <span className="inline-block bg-slate-900 text-white text-[11px] leading-[1.4] px-2.5 py-1.5 rounded-md shadow-lg">
        {children}
      </span>
    </div>
  );
}

function DiffModal({
  productName,
  productReference,
  issues,
  checkedAt,
  loading,
  applying,
  submitting,
  onClose,
  onReverify,
  onValidate,
}: {
  productName: string;
  productReference: string;
  issues: PfsVerifyIssue[];
  checkedAt: string | null;
  loading: boolean;
  applying: boolean;
  submitting: boolean;
  onClose: () => void;
  onReverify: () => void;
  onValidate: () => void | Promise<void>;
}) {
  const grouped = useMemo(() => groupIssuesByBlock(issues), [issues]);

  const { pullableCount, blockedCount, blockedReasons } = useMemo(() => {
    let pullable = 0, blocked = 0;
    const reasons = new Set<string>();
    for (const iss of issues) {
      const reason = pullBlockReason(iss);
      if (reason) {
        blocked++;
        reasons.add(reason);
      } else {
        pullable++;
      }
    }
    return { pullableCount: pullable, blockedCount: blocked, blockedReasons: Array.from(reasons) };
  }, [issues]);

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div className="w-full max-w-4xl pointer-events-auto rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="relative px-6 sm:px-8 pt-5 pb-4 border-b border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 ring-1 ring-slate-200 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-700">
                    Vérification PFS · {productReference}
                  </span>
                </div>
                <h2 className="font-heading text-xl sm:text-2xl font-bold text-slate-900 leading-tight truncate">
                  {productName}
                </h2>
                <p className="text-[13px] text-slate-600 mt-0.5">
                  <b>{issues.length}</b> écart{issues.length > 1 ? "s" : ""} détecté{issues.length > 1 ? "s" : ""}
                  {checkedAt && ` · vérifié ${formatRelative(checkedAt)}`}
                  <span className="hidden sm:inline"> · les valeurs PFS remplaceront celles de notre site.</span>
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"
                aria-label="Fermer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* KPI récap */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200">
                ↓ {pullableCount} récupérable{pullableCount > 1 ? "s" : ""} depuis PFS
              </span>
              {blockedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 ring-1 ring-slate-300">
                  ⚠ {blockedCount} à corriger à la main
                </span>
              )}
            </div>

            {/* En-têtes de colonnes */}
            <div className="grid grid-cols-[1fr_80px_1fr] gap-3 mt-5">
              <div className="rounded-t-xl bg-slate-200/70 ring-1 ring-slate-300 px-3 py-2 flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-600 text-white flex items-center justify-center font-heading font-bold text-[11px]">P</div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Côté PFS</div>
                  <div className="text-[11px] text-slate-800">Paris Fashion Shop</div>
                </div>
              </div>
              <div />
              <div className="rounded-t-xl bg-slate-900 ring-1 ring-slate-900 px-3 py-2 flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-white text-slate-900 flex items-center justify-center font-heading font-bold text-[11px]">N</div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Chez nous</div>
                  <div className="text-[11px] text-white">Notre site (avant / après)</div>
                </div>
              </div>
            </div>
          </div>

          {/* Body scrollable */}
          <div className="flex-1 overflow-y-auto pv-scroll bg-slate-50 px-6 sm:px-8 pt-4 pb-6 space-y-6">
            {grouped.productIssues.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-1 h-4 rounded-full bg-slate-800" />
                  <span className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-slate-500">
                    Fiche produit
                  </span>
                  <span className="text-[10.5px] text-slate-400">
                    · {grouped.productIssues.length} écart{grouped.productIssues.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="space-y-3">
                  {grouped.productIssues.map((iss, i) => (
                    <DiffRow key={i} issue={iss} disabled={applying} />
                  ))}
                </div>
              </section>
            )}

            {grouped.colorBlocks.map((block) => (
              <section key={block.key}>
                {block.variantGroups.map((vg) => (
                  <div key={vg.variantType + (vg.packQuantity ?? "")} className="mb-4 last:mb-0">
                    <div className="flex items-center gap-2 mb-3">
                      <ColorDot hex={block.colorHex} />
                      <span className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-slate-500 truncate">
                        Couleur {block.colorName ?? block.colorRef}
                      </span>
                      <span className="text-[10.5px] text-slate-500">·</span>
                      <span className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-slate-500">
                        {vg.variantType === "UNIT"
                          ? "unité"
                          : vg.packQuantity && vg.packQuantity > 1
                            ? `pack de ${vg.packQuantity}`
                            : "pack"}
                      </span>
                      {vg.issues.length > 1 && (
                        <span className="text-[10.5px] text-slate-400">
                          · {vg.issues.length} champs
                        </span>
                      )}
                    </div>
                    <div className="space-y-3">
                      {vg.issues.map((iss, i) => (
                        <DiffRow key={i} issue={iss} disabled={applying} />
                      ))}
                    </div>
                  </div>
                ))}

                {block.extras.length > 0 && (
                  <div className="mt-2 space-y-3">
                    {block.extras.map((iss, i) => (
                      <DiffRow key={`extra-${i}`} issue={iss} disabled={applying} />
                    ))}
                  </div>
                )}

                {block.missing.length > 0 && (
                  <div className="mt-2 space-y-3">
                    {block.missing.map((iss, i) => (
                      <DiffRow key={`missing-${i}`} issue={iss} disabled={applying} />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {blockedCount > 0 && (
              <div className="rounded-2xl bg-slate-100 ring-1 ring-slate-200 p-3 text-[11.5px] text-slate-700 leading-snug">
                <b>À corriger à la main :</b> {blockedCount} écart{blockedCount > 1 ? "s" : ""} ne peu{blockedCount > 1 ? "vent" : "t"} pas être récupéré{blockedCount > 1 ? "s" : ""} automatiquement depuis PFS.
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {blockedReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 sm:px-8 py-4 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11.5px] text-slate-600">
              <b>{pullableCount}</b> valeur{pullableCount > 1 ? "s" : ""} à récupérer depuis PFS
              {blockedCount > 0 && ` · ${blockedCount} à la main`}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onReverify}
                disabled={loading || applying || submitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-slate-700 bg-white ring-1 ring-slate-300 hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Vérification…
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.015 4.356v4.992" />
                    </svg>
                    Revérifier
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => { void onValidate(); }}
                disabled={applying || loading || submitting || pullableCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {submitting || applying ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {submitting ? "Application en cours…" : "Application…"}
                  </>
                ) : (
                  <>Prendre depuis PFS {pullableCount > 0 ? `(${pullableCount})` : ""}</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .pv-scroll::-webkit-scrollbar { width: 6px; }
        .pv-scroll::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.3); border-radius: 6px; }
        .pv-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}

/**
 * Ligne d'écart — 3 colonnes : carte PFS (gauche) · flèche unique vers notre
 * site (centre) · carte « Chez nous » divisée en Avant/Après (droite).
 * Plus de bascule direction : le flux est toujours PFS → nous.
 */
function DiffRow({ issue, disabled }: { issue: PfsVerifyIssue; disabled: boolean }) {
  const blockReason = pullBlockReason(issue);
  const displays = describeIssueForDiffRow(issue);
  void disabled;

  return (
    <div>
      <div className="grid grid-cols-[1fr_60px_1fr] gap-2 sm:gap-3 items-center">
        {/* Carte PFS */}
        <div className={`rounded-xl bg-slate-100 ring-1 ring-slate-300 p-3 min-w-0 ${blockReason ? "opacity-60" : ""}`}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 truncate">
            {displays.leftLabel}
          </div>
          <div className="text-[13px] text-slate-700 font-medium break-words">
            {displays.leftValue}
          </div>
        </div>

        {/* Flèche pull (PFS → nous) */}
        <div className="flex items-center justify-center">
          {blockReason ? (
            <div
              className="w-10 h-10 rounded-full bg-slate-100 text-slate-400 ring-1 ring-slate-200 flex items-center justify-center"
              title={blockReason}
              aria-label={blockReason}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-full bg-emerald-600 text-white shadow ring-2 ring-white flex items-center justify-center"
              title="La valeur PFS remplacera notre valeur"
              aria-label="Prendre depuis PFS"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
              </svg>
            </div>
          )}
        </div>

        {/* Carte « Chez nous » : Avant (barré) → Après (bold) */}
        <div className={`rounded-xl bg-white ring-2 ring-emerald-500 overflow-hidden min-w-0 ${blockReason ? "ring-slate-300 opacity-60" : ""}`}>
          <div className="px-3 pt-2.5 pb-1.5 bg-slate-50/70">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5 truncate">
              Avant · {displays.rightLabel}
            </div>
            <div className="text-[12.5px] text-slate-500 line-through break-words">
              {displays.rightValue}
            </div>
          </div>
          {!blockReason && (
            <>
              <div className="flex items-center justify-center py-0.5 text-emerald-500">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.6} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
              <div className="px-3 pt-1 pb-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-0.5 truncate">
                  Après · {displays.rightLabel}
                </div>
                <div className="text-[12.5px] text-slate-900 font-semibold break-words">
                  {displays.leftValue}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {blockReason && (
        <div className="mt-2 text-[11px] leading-snug text-slate-700 bg-slate-100 border border-slate-200 rounded-md px-2.5 py-1.5">
          À corriger à la main : {blockReason}
        </div>
      )}
    </div>
  );
}

/**
 * Prépare les 2 zones textuelles (label + valeur) affichées de part et d'autre.
 * Pour missing/extra la carte "vide" affiche « (absente) » et la carte
 * "présente" décrit la variante.
 */
export function describeIssueForDiffRow(iss: PfsVerifyIssue): {
  leftLabel: string;
  leftValue: ReactNode;
  rightLabel: string;
  rightValue: ReactNode;
} {
  const emptyBadge = (
    <span className="italic text-slate-400">(absente)</span>
  );
  const describeVariant = () => {
    const type =
      iss.variantType === "PACK"
        ? iss.packQuantity && iss.packQuantity > 1
          ? `pack de ${iss.packQuantity}`
          : "pack"
        : "unité";
    const label = iss.colorName ?? iss.colorRef ?? "?";
    return (
      <span>
        Variante « {label} »{" "}
        <span className="text-[11px] text-slate-500">— {type}</span>
      </span>
    );
  };

  if (iss.field === "missingVariant") {
    return {
      leftLabel: "Couleur absente sur PFS",
      leftValue: emptyBadge,
      rightLabel: "Couleur présente chez nous",
      rightValue: describeVariant(),
    };
  }
  if (iss.field === "extraVariant") {
    return {
      leftLabel: "Couleur présente sur PFS",
      leftValue: describeVariant(),
      rightLabel: "Couleur absente chez nous",
      rightValue: emptyBadge,
    };
  }
  return {
    leftLabel: iss.fieldLabel,
    leftValue: iss.pfsValue ?? <span className="italic text-slate-400">(vide)</span>,
    rightLabel: iss.fieldLabel,
    rightValue: iss.expectedValue ?? <span className="italic text-slate-400">(vide)</span>,
  };
}

export { issueKey };

/** Un écart est-il applicable en pull (récupération depuis PFS) ? */
function isPullActionable(iss: PfsVerifyIssue): boolean {
  return pullBlockReason(iss) === null;
}

/**
 * Raison qui empêche la récupération PFS sur cet écart, ou `null` si OK.
 * Combine la whitelist Lot B côté client + les blocages ad hoc (`pullBlocked`)
 * remontés par le serveur.
 */
function pullBlockReason(iss: PfsVerifyIssue): string | null {
  if (iss.pullBlocked) return iss.pullBlocked;
  if (!isPullSupportedLotB(iss.scope, iss.field)) {
    return `Récupération non prise en charge pour « ${iss.fieldLabel} ».`;
  }
  return null;
}

function ColorDot({ hex }: { hex?: string | null }) {
  const bg = hex && hex.trim() ? hex : "#94a3b8";
  return (
    <span
      className="w-3 h-3 rounded-full border border-slate-200 flex-shrink-0"
      style={{ background: bg }}
      aria-hidden="true"
    />
  );
}

// ─── Utils ─────────────────────────────────────────────────────────────────

function badgeButtonClass(state: "unchecked" | "loading" | "ok" | "diff"): string {
  const base =
    "w-5 h-5 rounded-md flex items-center justify-center transition shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1";
  switch (state) {
    case "unchecked":
      return `${base} bg-slate-100 border border-dashed border-slate-300 text-slate-400 hover:bg-slate-200 focus:ring-slate-400`;
    case "loading":
      return `${base} bg-sky-50 border border-sky-200 text-sky-600 cursor-wait focus:ring-sky-400`;
    case "ok":
      return `${base} bg-emerald-50 border border-emerald-200 text-emerald-600 hover:bg-emerald-100 focus:ring-emerald-400`;
    case "diff":
      return `${base} bg-amber-50 border border-amber-300 text-amber-600 hover:bg-amber-100 cursor-help focus:ring-amber-400`;
  }
}

function ariaLabelForState(state: "unchecked" | "loading" | "ok" | "diff"): string {
  switch (state) {
    case "unchecked": return "Vérification PFS non lancée · cliquer pour vérifier";
    case "loading":   return "Vérification PFS en cours";
    case "ok":        return "Conforme à PFS · cliquer pour revérifier";
    case "diff":      return "Divergences avec PFS · voir le détail";
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "récemment";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "à l'instant";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `il y a ${diffD} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

interface VariantGroup {
  variantType: "UNIT" | "PACK";
  packQuantity?: number | null;
  issues: PfsVerifyIssue[];
}

interface ColorBlock {
  key: string;
  colorRef: string;
  colorName?: string;
  colorHex?: string | null;
  variantGroups: VariantGroup[];
  extras: PfsVerifyIssue[];
  missing: PfsVerifyIssue[];
}

export interface GroupedIssues {
  productIssues: PfsVerifyIssue[];
  colorBlocks: ColorBlock[];
}

export function groupIssuesByBlock(issues: PfsVerifyIssue[]): GroupedIssues {
  const productIssues: PfsVerifyIssue[] = [];
  const byColor = new Map<string, ColorBlock>();

  const getBlock = (iss: PfsVerifyIssue): ColorBlock => {
    const key = iss.colorRef ?? "?";
    let b = byColor.get(key);
    if (!b) {
      b = {
        key,
        colorRef: iss.colorRef ?? "?",
        colorName: iss.colorName,
        colorHex: iss.colorHex ?? null,
        variantGroups: [],
        extras: [],
        missing: [],
      };
      byColor.set(key, b);
    }
    return b;
  };

  for (const iss of issues) {
    if (iss.scope === "product") {
      productIssues.push(iss);
      continue;
    }
    const b = getBlock(iss);
    if (iss.field === "extraVariant") {
      b.extras.push(iss);
      continue;
    }
    if (iss.field === "missingVariant") {
      b.missing.push(iss);
      continue;
    }
    const groupKey = `${iss.variantType}|${iss.packQuantity ?? ""}`;
    let vg = b.variantGroups.find(
      (g) => `${g.variantType}|${g.packQuantity ?? ""}` === groupKey,
    );
    if (!vg) {
      vg = {
        variantType: (iss.variantType ?? "UNIT") as "UNIT" | "PACK",
        packQuantity: iss.packQuantity,
        issues: [],
      };
      b.variantGroups.push(vg);
    }
    vg.issues.push(iss);
  }

  return { productIssues, colorBlocks: Array.from(byColor.values()) };
}
