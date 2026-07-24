"use client";

/**
 * Pastille de vérification PFS (variante C validée avec la cliente le 2026-07-21).
 *
 * Petite icône (5×5 px) affichée à côté du nom du produit dans le tableau
 * /admin/produits. 4 états :
 *   1. Non vérifié → carré gris pointillé + mini-tooltip « Cliquez pour vérifier ».
 *   2. En cours    → spinner sky + mini-tooltip « Vérification en cours… ».
 *   3. Conforme    → check emerald + mini-tooltip « Conforme · cliquez pour revérifier ».
 *   4. Divergences → triangle amber + tooltip riche (fiche produit + variantes
 *      groupées par couleur + variantes en trop côté PFS). Un clic sur le tooltip
 *      ne relance PAS la vérif (on laisse l'utilisatrice lire les écarts) — c'est
 *      le bouton « Revérifier » du footer qui rejoue la vérification.
 *
 * Le site local fait foi : PFS = « à corriger », Attendu = « côté site ».
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
import type { PfsPullEligibleMarketplace } from "@/lib/pfs-verify-eligible-marketplaces";
import {
  isPushSupportedLotB,
  isPullSupportedLotB,
  issueKey,
} from "@/lib/pfs-verify-apply-shared";

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
  /** Renseigné pour les issues `extraVariant` (id PFS de la variante en trop). */
  pfsVariantId?: string;
  pfsValue: string | null;
  expectedValue: string | null;
  note?: string;
  /** Raison de blocage « Envoyer PFS » (serveur). Non défini = envoi OK. */
  pushBlocked?: string;
  /** Raison de blocage « Prendre PFS » (serveur). Non défini = récup OK. */
  pullBlocked?: string;
}

interface Props {
  productId: string;
  productName: string;
  /** Référence produit — utilisée pour l'entrée widget marketplace. */
  productReference: string;
  /** Première image (URL) — utilisée pour l'entrée widget marketplace. */
  productFirstImage: string | null;
  /** Renseigné si le produit est lié à PFS (sinon on n'affiche rien du tout). */
  pfsProductId: string | null;
  /** Date ISO de la dernière vérif · null = jamais vérifié. */
  pfsCheckedAt: string | null;
  /** Statut de la dernière vérif · null tant que non vérifiée. */
  pfsCheckStatus: "ok" | "diff" | null;
  /** Écarts de la dernière vérif · null si aucun ou pas encore vérifiée. */
  pfsCheckIssues: PfsVerifyIssue[] | null;
}

export default function PfsVerifyBadge(props: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const { enqueue, inFlightProductIds } = useMarketplaceRefreshQueue();
  const { ask: askRefreshOptions } = useRefreshMarketplacePrompt();
  const [loading, setLoading] = useState(false);
  // Le badge est « en cours » (spinner PFS) tant que le job verify-apply pour
  // ce produit est actif dans la file marketplace — on s'aligne sur la même
  // notion que les autres rafraîchissements.
  const applying = inFlightProductIds.has(props.productId);
  // Feedback pendant la phase asynchrone du bouton « Valider » : couvre le
  // temps entre le clic (post-confirmation) et l'ouverture de la modale de
  // push marketplaces. Sans ça, la cliente clique et rien ne bouge pendant
  // le call serveur → sensation de bug (2026-07-24).
  const [submitting, setSubmitting] = useState(false);
  // État local pour rafraîchir la pastille sans full reload après revérif.
  const [checkedAt, setCheckedAt] = useState(props.pfsCheckedAt);
  const [status, setStatus] = useState<"ok" | "diff" | null>(props.pfsCheckStatus);
  const [issues, setIssues] = useState<PfsVerifyIssue[] | null>(props.pfsCheckIssues);
  // Ouverture de la modale d'écarts (2026-07-22 : passage tooltip → modale).
  const [modalOpen, setModalOpen] = useState(false);
  // ESC ferme la modale.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setModalOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  // Choix « Envoyer PFS » (push, défaut) / « Prendre PFS » (pull) par écart.
  // Clé = issueKey(iss). Reset à chaque changement de liste d'écarts.
  const [directions, setDirections] = useState<Record<string, "push" | "pull">>({});
  useEffect(() => {
    if (!issues) return;
    setDirections((prev) => {
      const next: Record<string, "push" | "pull"> = {};
      for (const iss of issues) {
        const k = issueKey(iss);
        next[k] = prev[k] === "pull" ? "pull" : "push";
      }
      return next;
    });
  }, [issues]);

  // Re-synchroniser avec les props quand elles changent (cas bulk verify :
  // le parent re-rend avec les nouvelles valeurs après router.refresh()).
  // Sans ça, l'état local figé masque les nouvelles données serveur.
  useEffect(() => {
    setCheckedAt(props.pfsCheckedAt);
    setStatus(props.pfsCheckStatus);
    setIssues(props.pfsCheckIssues);
  }, [props.pfsCheckedAt, props.pfsCheckStatus, props.pfsCheckIssues]);

  if (!props.pfsProductId) return null;

  const state: "unchecked" | "loading" | "ok" | "diff" = loading
    ? "loading"
    : status === "ok"
      ? "ok"
      : status === "diff"
        ? "diff"
        : "unchecked";

  const runVerify = async () => {
    if (loading) return;
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
      // Depuis 2026-07-21 : la server action renvoie la liste complète des
      // écarts dans `outcome.issues` — on peuple le tooltip immédiatement,
      // sans aucun rechargement de page.
      setIssues(o.issues ?? null);
      if (o.status === "ok") {
        toast.success(`« ${props.productName} » conforme à PFS`);
      } else if (o.status === "diff" && (o.issueCount ?? 0) > 0) {
        toast.info(
          `${o.issueCount} écart${(o.issueCount ?? 0) > 1 ? "s" : ""} détecté${(o.issueCount ?? 0) > 1 ? "s" : ""} — ouverture du détail`,
        );
        // Ouverture directe de la modale d'écarts après vérif unitaire
        // (bulk verify passe par BulkActionBar, ne déclenche pas ce chemin).
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
          // Vert / Non vérifié / Loading (no-op) : un clic relance.
          // Diff : un clic ouvre la modale d'écarts (2026-07-22).
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

      {/* Mini-tooltip sombre — states unchecked / loading / ok */}
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

      {/* Mini-tooltip d'invite pour l'état diff (survol) */}
      {state === "diff" && (
        <MiniTooltip>
          {`${issues?.length ?? 0} écart${(issues?.length ?? 0) > 1 ? "s" : ""} — cliquez pour voir le détail`}
        </MiniTooltip>
      )}

      {/* Modale d'écarts — state diff, ouverte au clic */}
      {state === "diff" && modalOpen && issues && issues.length > 0 && (
        <DiffModal
          productName={props.productName}
          productReference={props.productReference}
          issues={issues}
          checkedAt={checkedAt}
          loading={loading}
          applying={applying}
          submitting={submitting}
          directions={directions}
          onToggleDirection={(k, d) => setDirections((prev) => ({ ...prev, [k]: d }))}
          onClose={() => setModalOpen(false)}
          onReverify={runVerify}
          onSetAllDirections={(dir) => {
            if (!issues) return;
            setDirections((prev) => {
              const next = { ...prev };
              for (const iss of issues) {
                if (actionBlockReason(iss, dir) !== null) continue;
                next[issueKey(iss)] = dir;
              }
              return next;
            });
          }}
          onValidate={async () => {
            if (!issues) return;
            const supportedActions = issues
              .map((iss) => ({ iss, k: issueKey(iss), dir: (directions[issueKey(iss)] ?? "push") as "push" | "pull" }))
              .filter(({ iss, dir }) => actionBlockReason(iss, dir) === null)
              .map(({ k, dir }) => ({ key: k, direction: dir }));
            if (supportedActions.length === 0) {
              toast.info("Aucune action à appliquer (tous les écarts choisis sont non pris en charge).");
              return;
            }
            const pushCount = supportedActions.filter((a) => a.direction === "push").length;
            const pullCount = supportedActions.length - pushCount;
            const confirmed = await confirm.confirm({
              type: "warning",
              title: "Appliquer les corrections ?",
              message: `${supportedActions.length} correction${supportedActions.length > 1 ? "s" : ""} vont être appliquée${supportedActions.length > 1 ? "s" : ""} :\n\n` +
                (pushCount > 0 ? `• ${pushCount} action${pushCount > 1 ? "s" : ""} sur PFS (envoi/ajout/retrait selon la ligne)\n` : "") +
                (pullCount > 0 ? `• ${pullCount} action${pullCount > 1 ? "s" : ""} chez nous (récupération/ajout/retrait — Ankorstore/eFashion/Faire seront marqués « Synchro nécessaire »)\n` : "") +
                `\nCette action est irréversible depuis la modale.`,
              confirmLabel: "Appliquer",
              cancelLabel: "Annuler",
            });
            if (confirmed !== true) return;

            setSubmitting(true);
            try {
              // Cas 1 — Aucun pull : comportement historique. Un seul job PFS
              // marketplace qui embarque tous les pushs, worker se débrouille.
              if (pullCount === 0) {
                enqueue([
                  {
                    productId: props.productId,
                    reference: props.productReference,
                    productName: props.productName,
                    firstImage: props.productFirstImage,
                    options: { local: false, pfs: true, ankorstore: false, efashion: false, faire: false },
                    marketplace: "pfs",
                    mode: "resync",
                    verifyActions: supportedActions,
                  },
                ]);
                toast.info(
                  `${supportedActions.length} correction${supportedActions.length > 1 ? "s" : ""} en cours d'envoi sur PFS`,
                  "Suivez l'avancée dans le widget en bas à droite.",
                );
                return;
              }

              // Cas 2 — Au moins un pull : on applique les pulls SYNCHRONIQUEMENT
              // (la BDD est à jour au moment où la modale s'ouvre), on récupère
              // les marketplaces éligibles à la propagation, et on enqueue les
              // pushs PFS séparément si présents (widget progrès en parallèle).
              const res = await applyPfsVerifyPullsAndCollect(props.productId, supportedActions);
              if (!res.success) {
                toast.error("Application des « Prendre PFS » échouée", res.error);
                return;
              }

              // Rafraîchit la pastille localement (pas de reload).
              setCheckedAt(res.outcome.checkedAt ?? new Date().toISOString());
              setStatus(res.outcome.status ?? null);
              setIssues(res.outcome.issues ?? null);

              // Pushs PFS restants : envoyés en tâche de fond via le widget.
              if (res.remainingPushActions.length > 0) {
                enqueue([
                  {
                    productId: props.productId,
                    reference: props.productReference,
                    productName: props.productName,
                    firstImage: props.productFirstImage,
                    options: { local: false, pfs: true, ankorstore: false, efashion: false, faire: false },
                    marketplace: "pfs",
                    mode: "resync",
                    verifyActions: res.remainingPushActions.map((a) => ({
                      key: a.key,
                      direction: a.direction,
                    })),
                  },
                ]);
              }

              if (res.pulledCount === 0) {
                // Tous les pulls ont été skipped/errored côté serveur — rien à
                // propager. On informe et on s'arrête.
                const firstErr = res.report.errors[0]?.error;
                if (firstErr) {
                  toast.error("Aucune correction locale appliquée", firstErr);
                } else {
                  toast.info("Aucune correction locale appliquée");
                }
                return;
              }

              // Cas 2a — Pulls appliqués mais aucune marketplace tierce à
              // proposer : toast rassurant et on s'arrête là.
              if (res.eligibleMarketplaces.length === 0) {
                toast.success(
                  "Modifications appliquées",
                  "Aucune marketplace à synchroniser pour ce produit.",
                );
                return;
              }

              // Cas 2b — Pulls appliqués + marketplaces éligibles : ouvrir la
              // modale de push, réutilisation stricte de RefreshMarketplaceDialog.
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
              });
              if (!options) {
                // Refus : les flags *SyncRequired restent posés, les badges
                // marketplace resteront en orange « Synchro nécessaire ».
                return;
              }

              // Confirmation : un job par marketplace cochée, mode "resync"
              // (update en place, pas de nouvelle fiche).
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
              if (inputs.length === 0) {
                // Cliente a tout décoché — équivalent à un refus silencieux.
                return;
              }
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
  directions,
  onToggleDirection,
  onClose,
  onReverify,
  onSetAllDirections,
  onValidate,
}: {
  productName: string;
  productReference: string;
  issues: PfsVerifyIssue[];
  checkedAt: string | null;
  loading: boolean;
  applying: boolean;
  submitting: boolean;
  directions: Record<string, "push" | "pull">;
  onToggleDirection: (key: string, dir: "push" | "pull") => void;
  onClose: () => void;
  onReverify: () => void;
  onSetAllDirections: (dir: "push" | "pull") => void;
  onValidate: () => void | Promise<void>;
}) {
  // Regroupement : produit / par couleur (variantes + extras + missing)
  const grouped = useMemo(() => groupIssuesByBlock(issues), [issues]);

  // Compteurs pour le footer + détection d'un blocage bloquant Valider.
  // Un écart contribue au blocage si la direction actuellement choisie n'est
  // pas supportée (soit par la whitelist Lot B, soit par un pushBlocked/
  // pullBlocked renvoyé par le serveur).
  const { pushCount, pullCount, blockedCount, blockedReasons } = useMemo(() => {
    let push = 0, pull = 0, blocked = 0;
    const reasons = new Set<string>();
    for (const iss of issues) {
      const k = issueKey(iss);
      const dir = directions[k] ?? "push";
      const reason = actionBlockReason(iss, dir);
      if (reason) {
        blocked++;
        reasons.add(reason);
        continue;
      }
      if (dir === "push") push++;
      else pull++;
    }
    return { pushCount: push, pullCount: pull, blockedCount: blocked, blockedReasons: Array.from(reasons) };
  }, [issues, directions]);
  const totalActionable = pushCount + pullCount;

  // Compteurs pour les boutons « tout envoyer » / « tout prendre » : combien
  // d'écarts peuvent basculer dans la direction visée (les non-bloqués).
  const { pushableTotal, pullableTotal, allPush, allPull } = useMemo(() => {
    let pushable = 0, pullable = 0, currentPush = 0, currentPull = 0;
    for (const iss of issues) {
      const k = issueKey(iss);
      const dir = directions[k] ?? "push";
      if (actionBlockReason(iss, "push") === null) pushable++;
      if (actionBlockReason(iss, "pull") === null) pullable++;
      if (dir === "push") currentPush++;
      else currentPull++;
    }
    return {
      pushableTotal: pushable,
      pullableTotal: pullable,
      allPush: pushable > 0 && currentPush === issues.length,
      allPull: pullable > 0 && currentPull === issues.length,
    };
  }, [issues, directions]);

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Fenêtre */}
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
                  <span className="hidden sm:inline"> · pour chaque ligne, choisissez qui a raison.</span>
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

            {/* Barre bascule groupée — appliquer un choix à toutes les lignes
                d'un seul clic (2026-07-24). Bloqué si aucune ligne éligible
                ou si toutes sont déjà dans la direction visée. */}
            <div className="flex justify-center mt-4">
              <div className="inline-flex items-center gap-2 px-2 py-1.5 rounded-2xl bg-slate-100 ring-1 ring-slate-200">
                <span className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-slate-500 pl-2 pr-1">
                  Tout choisir
                </span>
                <button
                  type="button"
                  onClick={() => onSetAllDirections("push")}
                  disabled={applying || loading || pushableTotal === 0 || allPush}
                  title={
                    pushableTotal === 0
                      ? "Aucun écart ne peut être envoyé sur PFS."
                      : allPush
                        ? "Toutes les lignes sont déjà en envoi."
                        : `Basculer les ${pushableTotal} lignes possibles en « Envoyer sur PFS »`
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white bg-slate-900 hover:bg-black transition disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                  </svg>
                  Tout envoyer sur PFS
                </button>
                <button
                  type="button"
                  onClick={() => onSetAllDirections("pull")}
                  disabled={applying || loading || pullableTotal === 0 || allPull}
                  title={
                    pullableTotal === 0
                      ? "Aucun écart ne peut être récupéré depuis PFS."
                      : allPull
                        ? "Toutes les lignes sont déjà en récupération."
                        : `Basculer les ${pullableTotal} lignes possibles en « Prendre depuis PFS »`
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white bg-slate-900 hover:bg-black transition disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5 rotate-180" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                  </svg>
                  Tout prendre depuis PFS
                </button>
              </div>
            </div>

            {/* KPI récap */}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-900 text-white">
                ↑ {pushCount} à envoyer
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 ring-1 ring-slate-300">
                ↓ {pullCount} à récupérer
              </span>
              {blockedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                  ⚠ {blockedCount} bloqué{blockedCount > 1 ? "s" : ""}
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
                  <div className="text-[11px] text-white">Notre site</div>
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
                <div className="space-y-2">
                  {grouped.productIssues.map((iss, i) => (
                    <DiffRow
                      key={i}
                      issue={iss}
                      direction={directions[issueKey(iss)] ?? "push"}
                      onToggle={(d) => onToggleDirection(issueKey(iss), d)}
                      disabled={applying}
                    />
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
                    <div className="space-y-2">
                      {vg.issues.map((iss, i) => (
                        <DiffRow
                          key={i}
                          issue={iss}
                          direction={directions[issueKey(iss)] ?? "push"}
                          onToggle={(d) => onToggleDirection(issueKey(iss), d)}
                          disabled={applying}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {block.extras.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {block.extras.map((iss, i) => (
                      <DiffRow
                        key={`extra-${i}`}
                        issue={iss}
                        direction={directions[issueKey(iss)] ?? "push"}
                        onToggle={(d) => onToggleDirection(issueKey(iss), d)}
                        disabled={applying}
                      />
                    ))}
                  </div>
                )}

                {block.missing.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {block.missing.map((iss, i) => (
                      <DiffRow
                        key={`missing-${i}`}
                        issue={iss}
                        direction={directions[issueKey(iss)] ?? "push"}
                        onToggle={(d) => onToggleDirection(issueKey(iss), d)}
                        disabled={applying}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}

            {blockedCount > 0 && (
              <div className="rounded-2xl bg-rose-50 ring-1 ring-rose-200 p-3 text-[11.5px] text-rose-800 leading-snug">
                <b>Impossible de valider :</b> {blockedCount} écart{blockedCount > 1 ? "s" : ""} ne peu{blockedCount > 1 ? "vent" : "t"} pas être appliqué{blockedCount > 1 ? "s" : ""} dans la direction choisie.
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
              <b>{pushCount}</b> à envoyer sur PFS · <b>{pullCount}</b> à récupérer de PFS
              {blockedCount === 0 ? " · aucun blocage" : ""}
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
                disabled={applying || loading || submitting || totalActionable === 0 || blockedCount > 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-slate-900 hover:bg-black shadow-sm transition disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {submitting || applying ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {submitting ? "Application en cours…" : "Application…"}
                  </>
                ) : blockedCount > 0 ? (
                  <>Valider (bloqué)</>
                ) : (
                  <>Valider {totalActionable > 0 ? `${totalActionable} action${totalActionable > 1 ? "s" : ""}` : ""}</>
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
 * Ligne d'écart — 2 cartes côte à côte (PFS gris à gauche, Nous blanc à droite)
 * avec une flèche centrale cliquable qui bascule la direction (push/pull).
 *
 * - direction = "push" (envoyer) : la carte Nous est retenue (ring slate-900
 *   + badge « Choix ») et la flèche pointe vers PFS (bouton foncé plein).
 * - direction = "pull" (prendre) : la carte PFS est retenue et la flèche
 *   pointe vers nous (bouton blanc avec ring foncé).
 *
 * Un clic sur la flèche bascule si la direction inverse n'est pas bloquée.
 */
function DiffRow({
  issue,
  direction,
  onToggle,
  disabled,
}: {
  issue: PfsVerifyIssue;
  direction: "push" | "pull";
  onToggle: (d: "push" | "pull") => void;
  disabled: boolean;
}) {
  const pushBlock = actionBlockReason(issue, "push");
  const pullBlock = actionBlockReason(issue, "pull");
  const activeBlock = direction === "push" ? pushBlock : pullBlock;
  const otherBlock = direction === "push" ? pullBlock : pushBlock;
  const canToggle = !disabled && !otherBlock;
  const nousChosen = direction === "push";
  const pfsChosen = direction === "pull";

  const pfsCardRing = pfsChosen ? "ring-2 ring-slate-900" : "ring-1 ring-slate-300";
  const nousCardRing = nousChosen ? "ring-2 ring-slate-900" : "ring-1 ring-slate-300";

  // Rendu contextuel des 2 cartes selon la nature de l'écart (scalaire vs
  // structurel). Pour missing/extra la carte "vide" affiche une pastille
  // grisée « absente » et la carte "présente" décrit la variante.
  const displays = describeIssueForDiffRow(issue);
  // Libellés d'action contextualisés (« Envoyer/Prendre » pour les scalaires,
  // « Ajouter/Retirer » pour les structurelles).
  const pushLabel = actionShortLabel(issue, "push");
  const pullLabel = actionShortLabel(issue, "pull");
  const currentLabel = direction === "push" ? pushLabel : pullLabel;
  const oppositeLabel = direction === "push" ? pullLabel : pushLabel;

  return (
    <div>
      <div className="grid grid-cols-[1fr_80px_1fr] gap-2 sm:gap-3 items-stretch">
        {/* Carte PFS */}
        <div className={`rounded-xl bg-slate-100 ${pfsCardRing} p-3 relative min-w-0`}>
          {pfsChosen && (
            <div className="absolute -top-2 right-2 text-[9px] font-bold uppercase tracking-wider bg-slate-900 text-white px-1.5 py-0.5 rounded">
              Choix
            </div>
          )}
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 truncate">
            {displays.leftLabel}
          </div>
          <div className="text-[13px] text-slate-700 font-medium break-words">
            {displays.leftValue}
          </div>
        </div>

        {/* Flèche centrale */}
        <div className="flex flex-col items-center justify-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!canToggle) return;
              onToggle(direction === "push" ? "pull" : "push");
            }}
            disabled={!canToggle}
            title={
              otherBlock
                ? `Bascule impossible : ${otherBlock}`
                : `Cliquer pour basculer en « ${oppositeLabel} »`
            }
            aria-label={`${currentLabel} — cliquer pour basculer en « ${oppositeLabel} »`}
            className={
              direction === "push"
                ? `w-10 h-10 rounded-full bg-slate-900 text-white shadow ring-2 ring-white flex items-center justify-center transition ${canToggle ? "hover:bg-black" : "opacity-60 cursor-not-allowed"}`
                : `w-10 h-10 rounded-full bg-white text-slate-900 shadow ring-2 ring-slate-900 flex items-center justify-center transition ${canToggle ? "hover:bg-slate-50" : "opacity-60 cursor-not-allowed"}`
            }
          >
            <svg
              className={`w-4 h-4 ${direction === "pull" ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
            </svg>
          </button>
          <div className="text-[9px] uppercase tracking-wider font-bold text-slate-600 text-center leading-tight">
            {currentLabel}
          </div>
        </div>

        {/* Carte Nous */}
        <div className={`rounded-xl bg-white ${nousCardRing} p-3 relative min-w-0`}>
          {nousChosen && (
            <div className="absolute -top-2 right-2 text-[9px] font-bold uppercase tracking-wider bg-slate-900 text-white px-1.5 py-0.5 rounded">
              Choix
            </div>
          )}
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-1 truncate">
            {displays.rightLabel}
          </div>
          <div className="text-[13px] text-slate-900 font-semibold break-words">
            {displays.rightValue}
          </div>
        </div>
      </div>

      {activeBlock && (
        <div className="mt-2 text-[11px] leading-snug text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
          ⚠ {activeBlock}
        </div>
      )}
    </div>
  );
}

/**
 * Retourne le libellé court affiché sous la flèche centrale (et dans les
 * titres/tooltips). Contextualisé selon la nature de l'écart :
 *
 *   - Scalaire (prix / stock / etc.)  → « Envoyer » / « Prendre »
 *   - missingVariant + push           → « Ajouter sur PFS »
 *   - missingVariant + pull           → « Retirer chez nous »
 *   - extraVariant   + push           → « Retirer de PFS »
 *   - extraVariant   + pull           → « Ajouter chez nous »
 */
export function actionShortLabel(iss: PfsVerifyIssue, dir: "push" | "pull"): string {
  if (iss.field === "missingVariant") {
    return dir === "push" ? "Ajouter sur PFS" : "Retirer chez nous";
  }
  if (iss.field === "extraVariant") {
    return dir === "push" ? "Retirer de PFS" : "Ajouter chez nous";
  }
  return dir === "push" ? "Envoyer" : "Prendre";
}

/**
 * Prépare les 4 zones textuelles (label + valeur pour chaque carte) d'une
 * DiffRow. Pour un écart scalaire, on affiche PFS/expected tels quels. Pour
 * missing/extra on remplace les valeurs vides par « (absente) » et on
 * décrit la variante existante côté opposé.
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

// `issueKey` est importé depuis `@/lib/pfs-verify-apply-shared` — même clé
// côté client et serveur.
export { issueKey };

/**
 * Retourne la raison qui empêche d'appliquer une action dans la direction
 * donnée sur cet écart, ou `null` si tout est OK. Combine la whitelist
 * client (Lot B) et les blocages ad hoc que le serveur peut poser sur une
 * issue précise (`pushBlocked` / `pullBlocked`).
 */
function actionBlockReason(iss: PfsVerifyIssue, dir: "push" | "pull"): string | null {
  if (dir === "push") {
    if (iss.pushBlocked) return iss.pushBlocked;
    if (!isPushSupportedLotB(iss.scope, iss.field)) {
      return `Envoi non pris en charge pour « ${iss.fieldLabel} ».`;
    }
    return null;
  }
  if (iss.pullBlocked) return iss.pullBlocked;
  if (!isPullSupportedLotB(iss.scope, iss.field)) {
    return `Récupération non prise en charge pour « ${iss.fieldLabel} » (arrivera dans un prochain lot).`;
  }
  return null;
}

function ColorDot({ hex }: { hex?: string | null }) {
  const bg = hex && hex.trim() ? hex : "#94a3b8"; // slate-400 fallback
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

/**
 * Groupement pour l'affichage : bloc "Fiche produit" en premier, puis 1 bloc
 * par couleur avec les variantes concernées regroupées (Unité + Pack ensemble),
 * puis les variantes en trop / manquantes. Exporté pour les tests.
 */
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
    // Champ de variante classique → grouper par (variantType, packQuantity)
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
