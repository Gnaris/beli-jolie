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

import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { verifySinglePfsProduct } from "@/app/actions/admin/pfs-verify";
import { useMarketplaceRefreshQueue } from "@/components/admin/products/MarketplaceRefreshContext";
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
  const [loading, setLoading] = useState(false);
  // Le badge est « en cours » (spinner PFS) tant que le job verify-apply pour
  // ce produit est actif dans la file marketplace — on s'aligne sur la même
  // notion que les autres rafraîchissements.
  const applying = inFlightProductIds.has(props.productId);
  // État local pour rafraîchir la pastille sans full reload après revérif.
  const [checkedAt, setCheckedAt] = useState(props.pfsCheckedAt);
  const [status, setStatus] = useState<"ok" | "diff" | null>(props.pfsCheckStatus);
  const [issues, setIssues] = useState<PfsVerifyIssue[] | null>(props.pfsCheckIssues);

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
          `« ${props.productName} » : ${o.issueCount} écart${(o.issueCount ?? 0) > 1 ? "s" : ""} avec PFS`,
        );
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
          // Diff : un clic dans l'icône ne relance pas (on laisse lire).
          if (state === "loading") return;
          if (state === "diff") return; // on affiche le tooltip riche, pas de re-run
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

      {/* Tooltip riche — state diff */}
      {state === "diff" && issues && issues.length > 0 && (
        <RichDiffTooltip
          issues={issues}
          checkedAt={checkedAt}
          loading={loading}
          applying={applying}
          directions={directions}
          onToggleDirection={(k, d) => setDirections((prev) => ({ ...prev, [k]: d }))}
          onReverify={runVerify}
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
                (pushCount > 0 ? `• ${pushCount} envoi${pushCount > 1 ? "s" : ""} vers PFS (nos valeurs remplacent les leurs)\n` : "") +
                (pullCount > 0 ? `• ${pullCount} récupération${pullCount > 1 ? "s" : ""} depuis PFS (leurs valeurs remplacent les nôtres — Ankorstore/eFashion/Faire seront marqués « Synchro nécessaire »)\n` : "") +
                `\nCette action est irréversible depuis le tooltip.`,
              confirmLabel: "Appliquer",
              cancelLabel: "Annuler",
            });
            if (confirmed !== true) return;
            // Enqueue un job PFS marketplace : le widget flottant l'affiche et
            // le badge P sur la ligne du produit passe en spinner via
            // `inFlightProductIds`. Le worker (runPfsJob) détecte
            // `payload.verifyActions` et appelle applyPfsVerifyActionsCore.
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
          }}
        />
      )}
      {/* Cas edge : status=diff mais aucun issue reçu (ne devrait plus arriver
          depuis que la server action renvoie la liste complète). Sécurité. */}
      {state === "diff" && (!issues || issues.length === 0) && (
        <MiniTooltip>
          {`Divergences détectées${checkedAt ? ` · ${formatRelative(checkedAt)}` : ""}`}
        </MiniTooltip>
      )}

      <style jsx>{`
        .pfs-verify-wrap :global(.pv-mini),
        .pfs-verify-wrap :global(.pv-rich) {
          position: absolute;
          z-index: 60;
          opacity: 0;
          pointer-events: none;
          transform: translateY(2px);
          transition: opacity 0.15s, transform 0.15s;
          padding-top: 8px;
        }
        .pfs-verify-wrap:hover :global(.pv-mini),
        .pfs-verify-wrap:hover :global(.pv-rich),
        .pfs-verify-wrap:focus-within :global(.pv-mini),
        .pfs-verify-wrap:focus-within :global(.pv-rich) {
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

function RichDiffTooltip({
  issues,
  checkedAt,
  loading,
  applying,
  directions,
  onToggleDirection,
  onReverify,
  onValidate,
}: {
  issues: PfsVerifyIssue[];
  checkedAt: string | null;
  loading: boolean;
  applying: boolean;
  directions: Record<string, "push" | "pull">;
  onToggleDirection: (key: string, dir: "push" | "pull") => void;
  onReverify: () => void;
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

  return (
    <div className="pv-rich top-full left-0 w-[420px]">
      <div className="rounded-xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-100 rounded-t-xl">
          <div className="w-6 h-6 rounded-md bg-amber-100 flex items-center justify-center text-amber-700">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2L1 21h22L12 2zm0 6l7.53 12H4.47L12 8z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold text-amber-900 leading-tight">
              {issues.length} écart{issues.length > 1 ? "s" : ""} détecté{issues.length > 1 ? "s" : ""}
            </div>
            <div className="text-[10px] text-amber-700">
              {checkedAt ? `Vérifié ${formatRelative(checkedAt)}` : "Vérifié à l'instant"} · défaut : nos valeurs remplacent celles de PFS
            </div>
          </div>
        </div>

        {/* Liste scrollable */}
        <div className="max-h-[360px] overflow-y-auto text-[12px] pv-scroll">
          {grouped.productIssues.length > 0 && (
            <div className="border-b border-slate-100">
              <div className="px-3.5 pt-2 pb-1 text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500">
                Fiche produit
              </div>
              <ul className="divide-y divide-slate-100">
                {grouped.productIssues.map((iss, i) => (
                  <ProductIssueRow
                    key={i}
                    issue={iss}
                    direction={directions[issueKey(iss)] ?? "push"}
                    onToggle={(d) => onToggleDirection(issueKey(iss), d)}
                    disabled={applying}
                  />
                ))}
              </ul>
            </div>
          )}

          {grouped.colorBlocks.map((block) => (
            <div key={block.key} className="border-b border-slate-100 last:border-b-0">
              <div className="px-3.5 pt-2 pb-1 flex items-center gap-2">
                <ColorDot hex={block.colorHex} />
                <span className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 truncate">
                  Couleur {block.colorName ?? block.colorRef}
                </span>
                {block.variantGroups.length > 0 && (
                  <span className="text-[10px] text-slate-400">
                    · {block.variantGroups.length} variante{block.variantGroups.length > 1 ? "s" : ""} en écart
                  </span>
                )}
              </div>
              <ul className="divide-y divide-slate-100">
                {block.variantGroups.map((vg) => (
                  <li key={vg.variantType + (vg.packQuantity ?? "")} className="px-3.5 py-2">
                    <div className="text-slate-700 font-semibold text-[11px] mb-1 flex items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          vg.variantType === "PACK"
                            ? "bg-violet-50 text-violet-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {vg.variantType === "UNIT"
                          ? "Unité"
                          : vg.packQuantity && vg.packQuantity > 1
                            ? `Pack de ${vg.packQuantity}`
                            : "Pack"}
                      </span>
                      <span className="text-slate-400 text-[10px] font-normal">
                        {vg.issues.length} champ{vg.issues.length > 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {vg.issues.map((iss, i) => (
                        <VariantFieldRow
                          key={i}
                          issue={iss}
                          direction={directions[issueKey(iss)] ?? "push"}
                          onToggle={(d) => onToggleDirection(issueKey(iss), d)}
                          disabled={applying}
                        />
                      ))}
                    </div>
                  </li>
                ))}
                {block.extras.map((iss, i) => (
                  <li key={`extra-${i}`} className="px-3.5 py-2 flex items-start gap-2">
                    <svg
                      className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-800 font-semibold text-[12px]">
                        À retirer de PFS
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {iss.note ?? "Cette variante n'existe plus sur notre site."}
                      </div>
                    </div>
                  </li>
                ))}
                {block.missing.map((iss, i) => (
                  <li key={`missing-${i}`} className="px-3.5 py-2 flex items-start gap-2">
                    <svg
                      className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2.5}
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-800 font-semibold text-[12px]">
                        À ajouter sur PFS
                      </div>
                      <div className="text-[11px] text-slate-600 mt-0.5">
                        {iss.note ?? "Cette variante existe chez nous mais pas sur PFS."}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer — compteurs + revérifier + valider */}
        <div className="px-4 py-3 border-t border-slate-100 rounded-b-xl bg-slate-50/60 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-600">
            <div>
              <b>{pushCount}</b> à envoyer sur PFS · <b>{pullCount}</b> à récupérer de PFS
              {blockedCount > 0 && (
                <> · <span className="text-rose-700 font-semibold">{blockedCount} à débloquer</span></>
              )}
            </div>
          </div>
          {blockedCount > 0 && (
            <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 leading-snug">
              <b>Impossible de valider :</b> {blockedCount} écart{blockedCount > 1 ? "s" : ""} ne peu{blockedCount > 1 ? "vent" : "t"} pas être appliqué{blockedCount > 1 ? "s" : ""} dans la direction choisie.
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {blockedReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onReverify}
              disabled={loading || applying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
              disabled={applying || loading || totalActionable === 0 || blockedCount > 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-slate-900 hover:bg-slate-800 shadow-sm transition disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {applying ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Application…
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

      <style jsx>{`
        .pv-scroll::-webkit-scrollbar { width: 6px; }
        .pv-scroll::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.3); border-radius: 6px; }
        .pv-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}

function ProductIssueRow({
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
  return (
    <li className="px-3.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-slate-900 font-bold text-[13.5px] underline underline-offset-2 decoration-amber-400 decoration-2">
            {issue.fieldLabel}
          </div>
          <div className="mt-1 space-y-0.5 text-[12px]">
            <div className="flex items-baseline gap-1.5">
              <span className="text-amber-700 w-14 flex-shrink-0">PFS</span>
              <span className="text-slate-500 line-through truncate">
                {issue.pfsValue ?? "(vide)"}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-emerald-700 w-14 flex-shrink-0">Attendu</span>
              <span className="text-slate-800 font-medium truncate">
                {issue.expectedValue ?? "(vide)"}
              </span>
            </div>
          </div>
        </div>
        <DirectionToggle
          direction={direction}
          onToggle={onToggle}
          pushBlock={pushBlock}
          pullBlock={pullBlock}
          disabled={disabled}
        />
      </div>
      {activeBlock && (
        <div className="mt-2 text-[11px] leading-snug text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
          ⚠ {activeBlock}
        </div>
      )}
    </li>
  );
}

function VariantFieldRow({
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
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-slate-900 font-bold text-[13px] underline underline-offset-2 decoration-amber-400 decoration-2">
            {issue.fieldLabel}
          </div>
          <div className="mt-0.5 space-y-0.5 text-[12px]">
            <div className="flex items-baseline gap-1.5">
              <span className="text-amber-700 w-14 flex-shrink-0">PFS</span>
              <span className="text-slate-500 line-through truncate">
                {issue.pfsValue ?? "(vide)"}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-emerald-700 w-14 flex-shrink-0">Attendu</span>
              <span className="text-slate-800 font-medium truncate">
                {issue.expectedValue ?? "(vide)"}
              </span>
            </div>
          </div>
        </div>
        <DirectionToggle
          direction={direction}
          onToggle={onToggle}
          pushBlock={pushBlock}
          pullBlock={pullBlock}
          disabled={disabled}
        />
      </div>
      {activeBlock && (
        <div className="mt-1.5 text-[11px] leading-snug text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
          ⚠ {activeBlock}
        </div>
      )}
    </div>
  );
}

/**
 * Toggle segmenté 2 boutons (« Envoyer PFS » / « Prendre PFS »).
 * Un côté grisé signifie que le champ n'est pas encore pris en charge dans
 * cette direction — un titre au survol explique ce qui manque (Lot C).
 */
function DirectionToggle({
  direction,
  onToggle,
  pushBlock,
  pullBlock,
  disabled,
}: {
  direction: "push" | "pull";
  onToggle: (d: "push" | "pull") => void;
  /** null = OK, string = raison humaine du blocage. */
  pushBlock: string | null;
  pullBlock: string | null;
  disabled: boolean;
}) {
  const base = "px-2 py-0.5 text-[10.5px] font-semibold rounded transition inline-flex items-center gap-1";
  const activePush = "bg-indigo-600 text-white shadow-sm";
  const activePull = "bg-emerald-600 text-white shadow-sm";
  // Selected + will-fail : couleur ambre pour signaler visuellement le
  // problème, tout en restant sélectionnable.
  const activePushBlocked = "bg-amber-500 text-white shadow-sm";
  const activePullBlocked = "bg-amber-500 text-white shadow-sm";
  const inactive = "text-slate-500 hover:text-slate-800";
  // Not selected, will-fail : reste cliquable, mais indique visuellement le
  // risque (texte ambre + icône ⚠). On n'ajoute PAS de grayed cursor pour
  // que la cliente comprenne que le clic est possible.
  const inactiveBlocked = "text-amber-600 hover:text-amber-700";
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-slate-100 border border-slate-200 shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!disabled) onToggle("push"); }}
        disabled={disabled}
        title={pushBlock ?? "Envoyer notre valeur sur PFS"}
        className={`${base} ${
          pushBlock
            ? direction === "push" ? activePushBlocked : inactiveBlocked
            : direction === "push" ? activePush : inactive
        }`}
      >
        {pushBlock && <DangerIcon />}
        ↑ Envoyer
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!disabled) onToggle("pull"); }}
        disabled={disabled}
        title={pullBlock ?? "Récupérer la valeur PFS sur notre site"}
        className={`${base} ${
          pullBlock
            ? direction === "pull" ? activePullBlocked : inactiveBlocked
            : direction === "pull" ? activePull : inactive
        }`}
      >
        {pullBlock && <DangerIcon />}
        ↓ Prendre
      </button>
    </div>
  );
}

/**
 * Petit triangle danger (⚠) 10×10 pour signaler qu'une direction va échouer.
 * Hérite de la couleur de texte du bouton parent (ambre sur bouton inactif
 * ambre, blanc sur bouton actif ambre).
 */
function DangerIcon() {
  return (
    <svg
      className="w-2.5 h-2.5 shrink-0"
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 2L1 21h22L12 2zm0 6l7.53 12H4.47L12 8zm-1 4v4h2v-4h-2zm0 5v2h2v-2h-2z" />
    </svg>
  );
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
