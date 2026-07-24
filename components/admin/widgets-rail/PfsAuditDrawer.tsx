"use client";

/**
 * Tiroir « Audit PFS » du widget flottant unique en bas à droite.
 *
 * Poll l'état de l'audit toutes les 2 s (1.5 s si RUNNING) et affiche :
 *  - Phase RUNNING → barre de progression + « X / N produits · Y% ». Aucun
 *    résultat listé pendant l'audit (le compteur incrémental prêtait à confusion).
 *  - Phase DONE ou STOPPED → filtres (Tous / Corrigeables / À la main / Erreurs)
 *    + liste scrollable de cartes produits avec boutons Ignorer, Modifier
 *    depuis PFS et Détail. Footer sticky : « Tout modifier depuis PFS ».
 *
 * Alimente le badge du rail : chiffre = nombre d'écarts détectés (compteur qui
 * grimpe pendant l'audit, cristallisé à la fin). Halo pulse tant que l'audit
 * tourne.
 *
 * Le drawer se rafraîchit également automatiquement à la fin de l'audit :
 * `router.refresh()` pour que la pastille verify PFS de chaque ligne du
 * tableau produits passe au vert (conforme) ou à l'orange (écart).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  getPfsAuditStateAction,
  cancelPfsAuditAction,
  dismissPfsAuditAction,
  applyPfsAuditFixesForProductAction,
  bulkApplyPfsAuditFixesAction,
} from "@/app/actions/admin/pfs-audit";
import type {
  PfsAuditState,
  PfsAuditProductResult,
} from "@/lib/pfs-audit-runner";
import type { PfsVerifyIssue } from "@/lib/pfs-verify";
import {
  isPullSupportedLotB,
  countPullableIssues,
} from "@/lib/pfs-verify-apply-shared";

type Filter = "all" | "fixable" | "manual" | "error";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 15_000;

const AUDIT_ICON = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

export function PfsAuditDrawer() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { openWidget, close, open, setBadge } = useRightRail();
  const [state, setState] = useState<PfsAuditState | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isVisible, setIsVisible] = useState(true);
  const isMounted = useRef(true);
  const previousStatusRef = useRef<string | null>(null);
  const doneToastFiredRef = useRef(false);

  useEffect(() => () => { isMounted.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const r = await getPfsAuditStateAction();
      if (!isMounted.current) return;
      if (r.success) setState(r.state);
    } catch {
      // silence — le prochain tick réessaie
    }
  }, []);

  // Chargement initial
  useEffect(() => {
    void load();
  }, [load]);

  // Suivi visibilité onglet
  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const status = state?.status ?? "IDLE";
  const isRunning = status === "RUNNING";
  const isDone = status === "DONE" || status === "STOPPED";

  // Polling adaptatif
  useEffect(() => {
    if (!isVisible) return;
    if (status === "IDLE") return;
    const delay = isRunning ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(load, delay);
    return () => window.clearInterval(id);
  }, [isRunning, status, isVisible, load]);

  // Alimente le badge du rail (compteur = écarts + erreurs, pulse si RUNNING)
  useEffect(() => {
    if (!state) {
      setBadge("pfs-audit", { count: 0 });
      return;
    }
    const count = state.diffCount + state.errorCount;
    setBadge("pfs-audit", { count, pulse: isRunning });
  }, [state, isRunning, setBadge]);

  // Transition RUNNING → DONE :
  //  - Ouvre automatiquement le tiroir si des écarts sont détectés.
  //  - Toast succès + reset si tout est conforme.
  //  - router.refresh() pour rafraîchir les pastilles verify PFS du tableau.
  useEffect(() => {
    if (!state) return;
    const prev = previousStatusRef.current;
    previousStatusRef.current = state.status;
    if (state.status !== "DONE" && state.status !== "STOPPED") return;
    if (prev === state.status) return;
    if (doneToastFiredRef.current) return;
    doneToastFiredRef.current = true;
    router.refresh();
    if (state.results.length === 0) {
      toast.success(
        "Audit PFS terminé",
        `${state.total} produit${state.total > 1 ? "s" : ""} vérifié${state.total > 1 ? "s" : ""} — tout est conforme.`,
      );
      void dismissPfsAuditAction().then(() => setState(null));
    } else {
      open("pfs-audit");
    }
  }, [state, open, router, toast]);

  // Reset le flag "toast déjà tiré" quand un nouvel audit démarre.
  useEffect(() => {
    if (state?.status === "RUNNING") {
      doneToastFiredRef.current = false;
    }
  }, [state?.status]);

  const visibleResults = useMemo(() => {
    if (!state) return [] as PfsAuditProductResult[];
    return state.results.filter((r) => !dismissedIds.has(r.productId));
  }, [state, dismissedIds]);

  const fixableResults = useMemo(
    () => visibleResults.filter((r) => r.ok && countPullableIssues(r.issues) > 0),
    [visibleResults],
  );

  const counts = useMemo(() => {
    let fixable = 0, manual = 0, error = 0;
    for (const r of visibleResults) {
      if (!r.ok) { error++; continue; }
      if (countPullableIssues(r.issues) > 0) fixable++;
      else manual++;
    }
    return { all: visibleResults.length, fixable, manual, error };
  }, [visibleResults]);

  const filtered = useMemo(() => {
    if (isRunning) return [];
    switch (filter) {
      case "fixable":
        return visibleResults.filter((r) => r.ok && countPullableIssues(r.issues) > 0);
      case "manual":
        return visibleResults.filter((r) => r.ok && countPullableIssues(r.issues) === 0);
      case "error":
        return visibleResults.filter((r) => !r.ok);
      case "all":
      default:
        return visibleResults;
    }
  }, [visibleResults, filter, isRunning]);

  const handleCancel = useCallback(async () => {
    const ok = await confirm.confirm({
      type: "warning",
      title: "Arrêter l'audit ?",
      message: "L'audit sera interrompu. Les produits déjà vérifiés gardent leur pastille à jour.",
      confirmLabel: "Arrêter",
      cancelLabel: "Continuer",
    });
    if (!ok) return;
    await cancelPfsAuditAction();
    void load();
  }, [confirm, load]);

  const handleDismissAudit = useCallback(async () => {
    await dismissPfsAuditAction();
    setState(null);
    setDismissedIds(new Set());
    doneToastFiredRef.current = false;
    close();
    router.refresh();
  }, [close, router]);

  const handleFixOne = useCallback(
    async (r: PfsAuditProductResult) => {
      if (!r.ok) return;
      const res = await applyPfsAuditFixesForProductAction(r.productId, r.issues);
      if (!res.success) {
        toast.error(`Correction impossible pour « ${r.name} »`, res.error);
        return;
      }
      toast.success(
        `« ${r.name} » corrigé depuis PFS`,
        res.result.appliedCount > 0
          ? `${res.result.appliedCount} champ${res.result.appliedCount > 1 ? "s" : ""} mis à jour.`
          : undefined,
      );
      setDismissedIds((prev) => new Set(prev).add(r.productId));
      router.refresh();
    },
    [toast, router],
  );

  const handleFixAll = useCallback(async () => {
    if (fixableResults.length === 0) return;
    const ok = await confirm.confirm({
      type: "warning",
      title: `Modifier ${fixableResults.length} produit${fixableResults.length > 1 ? "s" : ""} depuis PFS ?`,
      message:
        `Toutes les valeurs corrigeables seront remplacées par celles de PFS.\n\n` +
        `Les marketplaces liées (Ankorstore / eFashion / Faire) seront marquées « Synchro nécessaire ».\n\n` +
        `Cette action est irréversible.`,
      confirmLabel: "Tout modifier",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    const items = fixableResults
      .filter((r): r is Extract<PfsAuditProductResult, { ok: true }> => r.ok)
      .map((r) => ({ productId: r.productId, issues: r.issues }));
    const res = await bulkApplyPfsAuditFixesAction(items);
    if (!res.success) {
      toast.error("Correction en masse impossible", res.error);
      return;
    }
    toast.success(
      `${res.appliedProducts} produit${res.appliedProducts > 1 ? "s" : ""} corrigé${res.appliedProducts > 1 ? "s" : ""} depuis PFS`,
      res.failedProducts > 0
        ? `${res.failedProducts} en erreur — ${res.firstError ?? ""}`
        : undefined,
    );
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const it of items) next.add(it.productId);
      return next;
    });
    router.refresh();
  }, [fixableResults, confirm, toast, router]);

  const pct = state && state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;

  const title = isRunning
    ? "Vérification en cours…"
    : state?.status === "STOPPED"
      ? "Audit interrompu"
      : isDone
        ? `${counts.all} produit${counts.all > 1 ? "s" : ""} en écart`
        : "Aucun audit lancé";

  return (
    <DrawerShell
      open={openWidget === "pfs-audit"}
      onClose={close}
      accent="emerald"
      eyebrow="Audit PFS"
      title={
        <span className="flex items-center gap-1.5">
          {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
          {title}
        </span>
      }
      icon={AUDIT_ICON}
      footer={
        isDone && counts.all > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDismissAudit}
              className="px-3 py-2 rounded-xl text-[12px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
            >
              Fermer et oublier
            </button>
            <button
              type="button"
              onClick={handleFixAll}
              disabled={fixableResults.length === 0}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[12.5px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              {fixableResults.length === 0
                ? "Rien à corriger automatiquement"
                : `Tout modifier depuis PFS (${fixableResults.length})`}
            </button>
          </div>
        ) : isRunning ? (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Vous pouvez continuer à travailler</span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-rose-600 hover:text-rose-700 underline"
            >
              Arrêter l'audit
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 text-center">
            Aucun audit en cours. Lancez-en un depuis la page Produits.
          </div>
        )
      }
    >
      {/* Body */}
      {!state || status === "IDLE" ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun audit lancé pour le moment.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Cliquez sur « Auditer PFS » en haut de la page Produits pour vérifier tous les produits liés à PFS.
          </p>
        </div>
      ) : isRunning ? (
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1.5">
              <span>
                <b className="text-slate-900 tabular-nums">{state.processed.toLocaleString("fr-FR")}</b> / {state.total.toLocaleString("fr-FR")} produits
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="text-[11px] text-slate-500 leading-snug">
            Les écarts seront listés ici quand l'audit sera terminé.
          </div>
        </div>
      ) : (
        <>
          <div className="px-3 pt-3 pb-2 sticky top-0 bg-slate-50/95 backdrop-blur z-10 border-b border-slate-100">
            <div className="flex items-center flex-wrap gap-1 p-1 rounded-xl bg-white ring-1 ring-slate-200">
              <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>Tous ({counts.all})</FilterTab>
              <FilterTab active={filter === "fixable"} onClick={() => setFilter("fixable")}>Corrigeables ({counts.fixable})</FilterTab>
              <FilterTab active={filter === "manual"} onClick={() => setFilter("manual")}>À la main ({counts.manual})</FilterTab>
              {counts.error > 0 && (
                <FilterTab active={filter === "error"} onClick={() => setFilter("error")}>Erreurs ({counts.error})</FilterTab>
              )}
            </div>
          </div>

          <div className="px-3 py-3 space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center text-[12px] text-slate-500 py-8">
                Aucun résultat dans cette catégorie.
              </div>
            ) : (
              filtered.map((r) => (
                <ProductCard
                  key={r.productId}
                  result={r}
                  expanded={expandedIds.has(r.productId)}
                  onToggleExpand={() =>
                    setExpandedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.productId)) next.delete(r.productId);
                      else next.add(r.productId);
                      return next;
                    })
                  }
                  onIgnore={() => setDismissedIds((prev) => new Set(prev).add(r.productId))}
                  onFix={() => handleFixOne(r)}
                />
              ))
            )}
          </div>
        </>
      )}
    </DrawerShell>
  );
}

function FilterTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function ProductCard({
  result,
  expanded,
  onToggleExpand,
  onIgnore,
  onFix,
}: {
  result: PfsAuditProductResult;
  expanded: boolean;
  onToggleExpand: () => void;
  onIgnore: () => void;
  onFix: () => void;
}) {
  const fixableCount = result.ok ? countPullableIssues(result.issues) : 0;
  const manualCount = result.ok ? result.issues.length - fixableCount : 0;
  const badgeClass = !result.ok
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : fixableCount > 0
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-slate-100 text-slate-600 ring-slate-200";
  const badgeLabel = !result.ok
    ? "Erreur"
    : fixableCount === 0
      ? `${manualCount} · à la main`
      : `${result.issues.length} écart${result.issues.length > 1 ? "s" : ""}`;
  const subtitle = !result.ok ? result.error : summarizeIssues(result.issues);

  return (
    <div className={`rounded-xl bg-white ring-1 shadow-sm overflow-hidden ${!result.ok ? "ring-rose-200" : "ring-slate-200"}`}>
      <div className="flex items-start gap-2.5 p-2.5">
        <div className="w-11 h-11 rounded-lg bg-slate-100 overflow-hidden shrink-0">
          {result.firstImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.firstImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9.5px] uppercase tracking-wider font-bold text-slate-400 truncate">{result.reference}</span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold ring-1 whitespace-nowrap ${badgeClass}`}>
              {badgeLabel}
            </span>
          </div>
          <div className="text-[12.5px] font-semibold text-slate-900 leading-tight line-clamp-2">{result.name}</div>
          <div className={`text-[11px] mt-1 line-clamp-2 ${!result.ok ? "text-rose-700" : "text-slate-500"}`}>{subtitle}</div>

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <button
              type="button"
              onClick={onIgnore}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
            >
              Ignorer
            </button>
            {result.ok && fixableCount > 0 && (
              <button
                type="button"
                onClick={onFix}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-white bg-slate-900 hover:bg-black shadow-sm"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                </svg>
                Modifier
              </button>
            )}
            {result.ok && result.issues.length > 0 && (
              <button
                type="button"
                onClick={onToggleExpand}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              >
                <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                Détail
              </button>
            )}
          </div>
        </div>
      </div>

      {result.ok && expanded && result.issues.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 space-y-1.5">
          {result.issues.map((iss, i) => (
            <IssueLine key={i} issue={iss} />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueLine({ issue }: { issue: PfsVerifyIssue }) {
  const blocked = issue.pullBlocked || !isPullSupportedLotB(issue.scope, issue.field);
  const label = issue.field === "extraVariant"
    ? `Couleur en trop (${issue.colorName ?? issue.colorRef ?? "?"})`
    : issue.field === "missingVariant"
      ? `Couleur manquante (${issue.colorName ?? issue.colorRef ?? "?"})`
      : issue.colorName
        ? `${issue.fieldLabel} · ${issue.colorName}`
        : issue.fieldLabel;
  const before = issue.expectedValue ?? "(vide)";
  const after = issue.pfsValue ?? "(vide)";

  return (
    <div className={`text-[11px] leading-snug ${blocked ? "opacity-60" : ""}`}>
      <div className="font-semibold text-slate-700 truncate">{label}</div>
      <div className="text-slate-500 truncate">
        <span className="line-through">{before}</span>
        {!blocked && (
          <>
            <span className="mx-1 text-emerald-600">→</span>
            <span className="text-slate-900 font-semibold">{after}</span>
          </>
        )}
        {blocked && (
          <span className="ml-2 text-[10px] italic text-slate-400">(à la main)</span>
        )}
      </div>
    </div>
  );
}

function summarizeIssues(issues: PfsVerifyIssue[]): string {
  const labels = issues.slice(0, 2).map((iss) => {
    if (iss.field === "extraVariant") return `Couleur en trop (${iss.colorName ?? iss.colorRef})`;
    if (iss.field === "missingVariant") return `Couleur manquante (${iss.colorName ?? iss.colorRef})`;
    return iss.colorName ? `${iss.fieldLabel} (${iss.colorName})` : iss.fieldLabel;
  });
  const extra = issues.length - labels.length;
  return extra > 0 ? `${labels.join(" · ")} · +${extra} autres` : labels.join(" · ");
}
