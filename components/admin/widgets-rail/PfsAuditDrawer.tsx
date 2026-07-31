"use client";

/**
 * Tiroir « Audit PFS » du widget flottant unique en bas à droite.
 *
 * Poll l'état de l'audit toutes les 2 s (1.5 s si RUNNING) et affiche :
 *  - Phase RUNNING → mini barre de progression en tête + liste des écarts
 *    remontés en temps réel (le runner flush toutes les 500 ms). Les filtres
 *    et le bouton « Détail » restent utilisables. Le bouton « Modifier depuis
 *    PFS » est actif dès qu'un écart apparaît (les workers ne repassent jamais
 *    sur un produit déjà audité, donc pas de collision).
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
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  getPfsAuditStateAction,
  cancelPfsAuditAction,
  dismissPfsAuditAction,
  dismissPfsAuditResultsAction,
  applyPfsAuditFixesForProductAction,
  bulkApplyPfsAuditFixesAction,
} from "@/app/actions/admin/pfs-audit";
import type {
  PfsAuditState,
  PfsAuditProductResult,
} from "@/lib/pfs-audit-runner";
import type { PfsVerifyIssue, PfsVerifyIssueField } from "@/lib/pfs-verify";
import {
  isPullSupportedLotB,
  countPullableIssues,
} from "@/lib/pfs-verify-apply-shared";
import { useRefreshMarketplacePrompt } from "@/components/admin/products/RefreshMarketplaceDialog";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";
import type { PfsPullEligibleMarketplace } from "@/lib/pfs-verify-eligible-marketplaces";

type Filter = "all" | "fixable" | "manual" | "error";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 60_000;

function labelForMarketplace(m: PfsPullEligibleMarketplace): string {
  if (m === "ankorstore") return "Ankorstore";
  if (m === "efashion") return "eFashion";
  return "Faire";
}

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
  const { ask: askRefreshOptions } = useRefreshMarketplacePrompt();
  const { enqueue } = useMarketplaceRefreshQueue();
  const [state, setState] = useState<PfsAuditState | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [isVisible, setIsVisible] = useState(true);
  // Loading unitaire : ID du produit dont on applique le fix actuellement
  // (spinner sur la carte + bouton désactivé).
  const [fixingProductId, setFixingProductId] = useState<string | null>(null);
  // Loading bulk : compteur { done, total } pendant « Tout modifier depuis PFS ».
  // Null = pas de bulk en cours. On remplace le body de la liste par un écran
  // dédié pour que la cliente sache ce qui se passe.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  // Visionneuse plein écran d'une image produit (déclenchée par le clic sur
  // l'icône loupe d'une tuile). Null = aucune image affichée.
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
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
  const isDrawerOpen = openWidget === "pfs-audit";

  // Refresh immédiat quand la cliente ouvre le tiroir — sinon on doit attendre
  // le prochain tick de poll (1.5 s) pour voir l'état à jour, notamment quand
  // un audit vient d'être lancé depuis le bouton « Auditer PFS ».
  useEffect(() => {
    if (isDrawerOpen) void load();
  }, [isDrawerOpen, load]);

  // Polling adaptatif :
  //  - Tiroir ouvert          → poll rapide (1.5 s) pour affichage temps réel.
  //  - Tiroir fermé + RUNNING → poll lent (15 s) juste pour maintenir le badge.
  //  - Tiroir fermé + IDLE    → pas de poll (économise CPU/BDD).
  useEffect(() => {
    if (!isVisible) return;
    if (!isDrawerOpen && status === "IDLE") return;
    const delay = isDrawerOpen ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(load, delay);
    return () => window.clearInterval(id);
  }, [isDrawerOpen, status, isVisible, load]);

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
  //
  // Important : ne se déclenche QUE sur une vraie transition (prev défini).
  // Au tout premier chargement (`prev === null`), on ne rouvre PAS le drawer
  // même si l'état persisté est déjà DONE — sinon la cliente qui a fermé le
  // tiroir et refresh la page se retrouve avec la fenêtre qui repop toute
  // seule à chaque visite.
  useEffect(() => {
    if (!state) return;
    const prev = previousStatusRef.current;
    previousStatusRef.current = state.status;
    if (prev === null) return;
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

  // ─── Révélation progressive (« un par un ») ──────────────────────────────
  // Pendant et après l'audit, on affiche les nouveaux produits en écart un à
  // un avec 150 ms d'intervalle — même si le serveur en flushe 5 d'un coup.
  // Cet effet rend l'apparition lisible plutôt que de faire pop plusieurs
  // cartes en même temps. Le drain se poursuit naturellement même après la
  // fin de l'audit (DONE / STOPPED) tant qu'il reste des IDs à révéler.
  const revealedIdsRef = useRef<Set<string>>(new Set());
  const pendingIdsRef = useRef<string[]>([]);
  const revealTimerRef = useRef<number | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const justRevealedIdRef = useRef<string | null>(null);
  // Traque le startedAt du dernier audit connu. Un changement de valeur =
  // nouvel audit démarré → il faut réinitialiser revealedIds, la file en
  // attente ET les dismissedIds (sinon un produit validé lors d'un audit
  // précédent reste masqué au nouvel audit — bug remonté par la cliente).
  const lastStartedAtRef = useRef<number | null>(null);

  const tickReveal = useCallback(() => {
    const id = pendingIdsRef.current.shift();
    if (id === undefined) {
      revealTimerRef.current = null;
      return;
    }
    revealedIdsRef.current.add(id);
    justRevealedIdRef.current = id;
    setRevealTick((t) => t + 1);
    revealTimerRef.current = window.setTimeout(tickReveal, 150);
  }, []);

  const resetRevealState = useCallback(() => {
    revealedIdsRef.current = new Set();
    pendingIdsRef.current = [];
    justRevealedIdRef.current = null;
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setRevealTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!state || state.status === "IDLE") {
      resetRevealState();
      lastStartedAtRef.current = null;
      setDismissedIds(new Set());
      return;
    }
    // Nouvel audit (startedAt a changé) → reset complet : révélation ET
    // dismissedIds (E841C validé au précédent audit doit pouvoir reréapparaître).
    if (state.startedAt !== lastStartedAtRef.current) {
      resetRevealState();
      setDismissedIds(new Set());
      lastStartedAtRef.current = state.startedAt;
    }
    // Enqueue les nouveaux IDs (par ordre d'apparition dans state.results).
    for (const r of state.results) {
      const id = r.productId;
      if (revealedIdsRef.current.has(id)) continue;
      if (pendingIdsRef.current.includes(id)) continue;
      pendingIdsRef.current.push(id);
    }
    if (revealTimerRef.current === null && pendingIdsRef.current.length > 0) {
      tickReveal();
    }
  }, [state, tickReveal, resetRevealState]);

  // Cleanup du timer au démontage.
  useEffect(() => {
    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

  const visibleResults = useMemo(() => {
    if (!state) return [] as PfsAuditProductResult[];
    return state.results.filter(
      (r) => !dismissedIds.has(r.productId) && revealedIdsRef.current.has(r.productId),
    );
    // revealTick force la re-évaluation quand un nouveau ID est révélé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, dismissedIds, revealTick]);

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
  }, [visibleResults, filter]);

  // Persiste en BDD que les cartes concernées ont été traitées (Ignorées ou
  // corrigées). Sans ça, elles reviennent au refresh. Si tout est traité et
  // l'audit était terminé, le serveur reset l'état → on ferme la fenêtre.
  const persistDismiss = useCallback(
    async (productIds: string[]) => {
      if (productIds.length === 0) return;
      const res = await dismissPfsAuditResultsAction(productIds);
      if (!res.success) return;
      if (res.autoReset) {
        setState(null);
        setDismissedIds(new Set());
        doneToastFiredRef.current = false;
        close();
      }
    },
    [close],
  );

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
      if (fixingProductId) return; // évite double clic pendant qu'une correction est en cours

      // Confirmation systématique. Récap récapitulant CE QUI CHANGE :
      //  - Champs fiche produit (name, description, composition…) → 1 ligne
      //  - Prix / stock / poids par couleur → 1 ligne par couleur
      //  - Couleurs ajoutées / supprimées → 1 ligne chacune (en gras)
      const pullable = r.issues.filter(
        (iss) => !iss.pullBlocked && isPullSupportedLotB(iss.scope, iss.field),
      );
      const productFields = pullable
        .filter((i) => i.scope === "product" && i.field !== "extraVariant" && i.field !== "missingVariant")
        .map((i) => i.fieldLabel);
      const variantFields = new Map<string, Set<string>>();
      for (const i of pullable) {
        if (i.scope !== "color") continue;
        if (i.field === "extraVariant" || i.field === "missingVariant") continue;
        const key = i.colorName ?? i.colorRef ?? "?";
        if (!variantFields.has(key)) variantFields.set(key, new Set());
        variantFields.get(key)!.add(i.fieldLabel);
      }
      const toAdd = pullable.filter((i) => i.field === "extraVariant");
      const toDelete = pullable.filter((i) => i.field === "missingVariant");

      const lines: string[] = [];
      if (productFields.length > 0) {
        lines.push(`• ${productFields.join(", ")}`);
      }
      for (const [color, fields] of variantFields) {
        lines.push(`• ${Array.from(fields).join(" / ")} de la couleur ${color}`);
      }
      for (const iss of toAdd) {
        lines.push(`• Couleur ${iss.colorName ?? iss.colorRef ?? "?"} sera AJOUTÉE`);
      }
      for (const iss of toDelete) {
        lines.push(`• Couleur ${iss.colorName ?? iss.colorRef ?? "?"} sera SUPPRIMÉE`);
      }
      const message =
        (lines.length > 0
          ? `Les valeurs suivantes vont être remplacées par celles de PFS :\n\n${lines.join("\n")}\n\n`
          : `Les valeurs de PFS vont être appliquées sur votre site.\n\n`) +
        `Cette action est irréversible.`;
      const ok = await confirm.confirm({
        type: "warning",
        title: `Modifier « ${r.name} » depuis PFS ?`,
        message,
        confirmLabel: "Modifier depuis PFS",
        cancelLabel: "Annuler",
      });
      if (!ok) return;

      // Loading : spinner sur la carte + bouton désactivé.
      setFixingProductId(r.productId);
      let res: Awaited<ReturnType<typeof applyPfsAuditFixesForProductAction>>;
      try {
        res = await applyPfsAuditFixesForProductAction(r.productId, r.issues);
      } finally {
        setFixingProductId(null);
      }
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
      void persistDismiss([r.productId]);
      router.refresh();

      // Propagation aux autres marketplaces : ouvre la modale de choix si le
      // produit est lié à Ankor/eFashion/Faire (PFS exclu — c'est la source).
      const eligible = res.result.eligibleMarketplaces;
      if (eligible.length === 0) return;
      const eligibleSet = new Set<PfsPullEligibleMarketplace>(eligible);
      const askMarketplaceOptions = () =>
        askRefreshOptions({
          count: 1,
          firstProductName: r.name,
          showPfs: false,
          showAnkorstore: eligibleSet.has("ankorstore"),
          showEfashion: eligibleSet.has("efashion"),
          showFaire: eligibleSet.has("faire"),
          showMicrostore: false,
          productIds: [r.productId],
          title: "Propager vers vos marketplaces ?",
          subtitle: `« ${r.name} » — envoyer aussi les nouvelles valeurs.`,
          eyebrow: "Synchronisation",
          confirmLabel: "Synchroniser",
          showBoutique: false,
          defaultAllChecked: true,
          actionLabel: "synchroniser",
          actionMode: "update",
        });
      let options = await askMarketplaceOptions();

      // Confirmation si la cliente annule ou décoche tout : les autres
      // marketplaces vont afficher le badge « Synchro nécessaire » car un pull
      // PFS a été appliqué. On lui donne une chance de rouvrir le modal.
      while (!options || (!options.ankorstore && !options.efashion && !options.faire)) {
        const proceed = await confirm.confirm({
          type: "info",
          title: "Ne pas propager aux marketplaces maintenant ?",
          message:
            `Les valeurs sont bien mises à jour sur votre site.\n\n` +
            `Les marketplaces liées (${eligible.map(labelForMarketplace).join(" · ")}) ` +
            `afficheront un badge orange « Synchro nécessaire » — vous pourrez les propager plus tard ` +
            `depuis la ligne du produit dans le tableau.`,
          confirmLabel: "OK, plus tard",
          cancelLabel: "Rouvrir le choix marketplace",
        });
        if (proceed) return;
        options = await askMarketplaceOptions();
      }
      const inputs: MarketplaceRefreshEnqueueInput[] = [];
      if (options.ankorstore && eligibleSet.has("ankorstore")) {
        inputs.push({
          productId: r.productId,
          reference: r.reference,
          productName: r.name,
          firstImage: r.firstImage,
          options: { local: false, pfs: false, ankorstore: true, efashion: false, faire: false },
          marketplace: "ankorstore",
          mode: "resync",
        });
      }
      if (options.efashion && eligibleSet.has("efashion")) {
        inputs.push({
          productId: r.productId,
          reference: r.reference,
          productName: r.name,
          firstImage: r.firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: true, faire: false },
          marketplace: "efashion",
          mode: "resync",
        });
      }
      if (options.faire && eligibleSet.has("faire")) {
        inputs.push({
          productId: r.productId,
          reference: r.reference,
          productName: r.name,
          firstImage: r.firstImage,
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
    },
    [toast, router, askRefreshOptions, enqueue, confirm, fixingProductId, persistDismiss],
  );

  const handleFixAll = useCallback(async () => {
    if (fixableResults.length === 0) return;

    // Compte les actions structurelles (variantes ajoutées / supprimées) pour
    // prévenir explicitement dans la confirmation — ces changements de
    // structure côté site sont bien plus impactants qu'un simple update de prix.
    let variantsToDelete = 0;
    let variantsToAdd = 0;
    for (const r of fixableResults) {
      if (!r.ok) continue;
      for (const iss of r.issues) {
        if (iss.pullBlocked) continue;
        if (!isPullSupportedLotB(iss.scope, iss.field)) continue;
        if (iss.field === "missingVariant") variantsToDelete++;
        else if (iss.field === "extraVariant") variantsToAdd++;
      }
    }
    const structuralLines: string[] = [];
    if (variantsToDelete > 0) {
      structuralLines.push(
        `• ${variantsToDelete} couleur${variantsToDelete > 1 ? "s" : ""} sera${variantsToDelete > 1 ? "ont" : ""} SUPPRIMÉE${variantsToDelete > 1 ? "S" : ""} de votre site`,
      );
    }
    if (variantsToAdd > 0) {
      structuralLines.push(
        `• ${variantsToAdd} couleur${variantsToAdd > 1 ? "s" : ""} sera${variantsToAdd > 1 ? "ont" : ""} AJOUTÉE${variantsToAdd > 1 ? "S" : ""} sur votre site`,
      );
    }

    const ok = await confirm.confirm({
      type: "warning",
      title: `Modifier ${fixableResults.length} produit${fixableResults.length > 1 ? "s" : ""} depuis PFS ?`,
      message:
        `Toutes les valeurs corrigeables seront remplacées par celles de PFS.\n\n` +
        (structuralLines.length > 0 ? structuralLines.join("\n") + "\n\n" : "") +
        `Les marketplaces liées (Ankorstore / eFashion / Faire) seront marquées « Synchro nécessaire ».\n\n` +
        `Cette action est irréversible.`,
      confirmLabel: "Tout modifier",
      cancelLabel: "Annuler",
    });
    if (!ok) return;

    const items = fixableResults
      .filter((r): r is Extract<PfsAuditProductResult, { ok: true }> => r.ok)
      .map((r) => ({ productId: r.productId, issues: r.issues }));

    // Loading bloquant : la cliente voit "Correction en cours…" pendant que
    // le server action tourne (peut prendre plusieurs secondes pour N produits).
    setBulkProgress({ done: 0, total: items.length });
    let res: Awaited<ReturnType<typeof bulkApplyPfsAuditFixesAction>>;
    try {
      res = await bulkApplyPfsAuditFixesAction(items);
    } finally {
      setBulkProgress(null);
    }
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
    void persistDismiss(items.map((it) => it.productId));
    router.refresh();

    // Propagation en masse aux autres marketplaces. On ne propose que les
    // marketplaces où AU MOINS UN produit corrigé est éligible. Pour chaque
    // marketplace cochée, on enqueue uniquement les produits éligibles à
    // cette marketplace (pas d'enqueue à blanc si le produit n'est pas lié).
    const okProducts = res.perProduct.filter((p) => p.ok);
    const hasAnkor = okProducts.some((p) => p.eligibleMarketplaces.includes("ankorstore"));
    const hasEfashion = okProducts.some((p) => p.eligibleMarketplaces.includes("efashion"));
    const hasFaire = okProducts.some((p) => p.eligibleMarketplaces.includes("faire"));
    if (!hasAnkor && !hasEfashion && !hasFaire) return;

    const affectedProductIds = okProducts.map((p) => p.productId);
    const eligibleLabels: string[] = [];
    if (hasAnkor) eligibleLabels.push("Ankorstore");
    if (hasEfashion) eligibleLabels.push("eFashion");
    if (hasFaire) eligibleLabels.push("Faire");
    const askMarketplaceOptions = () =>
      askRefreshOptions({
        count: okProducts.length,
        firstProductName: okProducts[0]?.productName,
        showPfs: false,
        showAnkorstore: hasAnkor,
        showEfashion: hasEfashion,
        showFaire: hasFaire,
        showMicrostore: false,
        productIds: affectedProductIds,
        title: `Propager sur vos marketplaces ?`,
        subtitle: `${okProducts.length} produit${okProducts.length > 1 ? "s" : ""} corrigé${okProducts.length > 1 ? "s" : ""} — envoyer aussi les nouvelles valeurs.`,
        eyebrow: "Synchronisation",
        confirmLabel: "Synchroniser",
        showBoutique: false,
        defaultAllChecked: true,
        actionLabel: "synchroniser",
        actionMode: "update",
      });
    let options = await askMarketplaceOptions();

    // Confirmation si la cliente annule / décoche tout : les marketplaces
    // vont passer en badge orange « Synchro nécessaire ». On lui laisse la
    // possibilité de rouvrir le modal si c'était un clic malheureux.
    while (!options || (!options.ankorstore && !options.efashion && !options.faire)) {
      const proceed = await confirm.confirm({
        type: "info",
        title: "Ne pas propager aux marketplaces maintenant ?",
        message:
          `Les ${okProducts.length} produits corrigés sont mis à jour sur votre site.\n\n` +
          `Chaque marketplace liée (${eligibleLabels.join(" · ")}) affichera un badge orange ` +
          `« Synchro nécessaire » — vous pourrez les propager plus tard depuis la ligne du produit dans le tableau.`,
        confirmLabel: "OK, plus tard",
        cancelLabel: "Rouvrir le choix marketplace",
      });
      if (proceed) return;
      options = await askMarketplaceOptions();
    }

    const inputs: MarketplaceRefreshEnqueueInput[] = [];
    for (const p of okProducts) {
      const set = new Set<PfsPullEligibleMarketplace>(p.eligibleMarketplaces);
      if (options.ankorstore && set.has("ankorstore")) {
        inputs.push({
          productId: p.productId,
          reference: p.reference,
          productName: p.productName,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: true, efashion: false, faire: false },
          marketplace: "ankorstore",
          mode: "resync",
        });
      }
      if (options.efashion && set.has("efashion")) {
        inputs.push({
          productId: p.productId,
          reference: p.reference,
          productName: p.productName,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: true, faire: false },
          marketplace: "efashion",
          mode: "resync",
        });
      }
      if (options.faire && set.has("faire")) {
        inputs.push({
          productId: p.productId,
          reference: p.reference,
          productName: p.productName,
          firstImage: p.firstImage,
          options: { local: false, pfs: false, ankorstore: false, efashion: false, faire: true },
          marketplace: "faire",
          mode: "resync",
        });
      }
    }
    if (inputs.length === 0) return;
    enqueue(inputs, { intervalMs: options.intervalMs ?? 0 });
    toast.info(
      `${inputs.length} synchronisation${inputs.length > 1 ? "s" : ""} lancée${inputs.length > 1 ? "s" : ""}`,
      "Suivez l'avancée dans le widget en bas à droite.",
    );
  }, [fixableResults, confirm, toast, router, askRefreshOptions, enqueue, persistDismiss]);

  const pct = state && state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;

  const title = isRunning
    ? counts.all > 0
      ? `Vérification… · ${counts.all} écart${counts.all > 1 ? "s" : ""}`
      : "Vérification en cours…"
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
      size="fullscreen"
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
              disabled={bulkProgress !== null}
              className="px-3 py-2 rounded-xl text-[12px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Fermer et oublier
            </button>
            <button
              type="button"
              onClick={handleFixAll}
              disabled={fixableResults.length === 0 || bulkProgress !== null}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition disabled:bg-slate-300 disabled:cursor-not-allowed"
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
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-slate-500">Vous pouvez continuer à travailler pendant l'audit.</span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-rose-600 hover:text-rose-700 underline font-semibold"
            >
              Arrêter l'audit
            </button>
          </div>
        ) : (
          <div className="text-[12px] text-slate-500 text-center">
            Aucun audit en cours. Lancez-en un depuis la page Produits.
          </div>
        )
      }
    >
      {/* Body — size="wide" désactive le scroll de DrawerShell, on le
          gère nous-mêmes sur la zone grille pour que le header (progression +
          filtres) reste sticky en haut. */}
      <div className="h-full flex flex-col min-h-0">
        {bulkProgress ? (
          <BulkApplyingScreen total={bulkProgress.total} />
        ) : !state || status === "IDLE" ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="text-center max-w-md">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-slate-900">Aucun audit lancé pour le moment</p>
              <p className="text-[13px] text-slate-500 mt-2 leading-relaxed">
                Cliquez sur « Auditer PFS » en haut de la page Produits pour vérifier tous vos produits liés à PFS.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* En-tête sticky : progression (si RUNNING) + tabs filtres */}
            <div className="px-5 pt-4 pb-3 bg-white border-b border-slate-200 flex-shrink-0 space-y-3">
              {isRunning && (
                <div>
                  <div className="flex items-center justify-between text-[12px] text-slate-600 mb-1.5">
                    <span>
                      <b className="text-slate-900 tabular-nums">{state.processed.toLocaleString("fr-FR")}</b>
                      <span className="text-slate-400"> / {state.total.toLocaleString("fr-FR")} produits vérifiés</span>
                    </span>
                    <span className="tabular-nums text-slate-500 font-semibold">{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center flex-wrap gap-1 p-1 rounded-xl bg-slate-50 ring-1 ring-slate-200 w-fit">
                <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>Tous ({counts.all})</FilterTab>
                <FilterTab active={filter === "fixable"} onClick={() => setFilter("fixable")}>Corrigeables ({counts.fixable})</FilterTab>
                <FilterTab active={filter === "manual"} onClick={() => setFilter("manual")}>À la main ({counts.manual})</FilterTab>
                {counts.error > 0 && (
                  <FilterTab active={filter === "error"} onClick={() => setFilter("error")}>Erreurs ({counts.error})</FilterTab>
                )}
              </div>
            </div>

            {/* Zone scrollable — la grille remplit de gauche à droite puis
                passe à la ligne suivante. Chaque carte s'anime à son tour
                (animate-pfs-appear) car les IDs sont révélés un par un
                toutes les 150 ms par tickReveal(). */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {filtered.length === 0 ? (
                <div className="text-center text-[13px] text-slate-500 py-16">
                  {isRunning
                    ? "Aucun écart pour l'instant — les produits s'afficheront ici au fur et à mesure."
                    : "Aucun résultat dans cette catégorie."}
                </div>
              ) : (
                <div className="grid items-start grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-8 p-8">
                  {filtered.map((r) => (
                    <ProductCard
                      key={r.productId}
                      result={r}
                      justRevealed={justRevealedIdRef.current === r.productId}
                      fixing={fixingProductId === r.productId}
                      onIgnore={() => {
                        setDismissedIds((prev) => new Set(prev).add(r.productId));
                        void persistDismiss([r.productId]);
                      }}
                      onFix={() => handleFixOne(r)}
                      onZoomImage={() => {
                        if (r.firstImage) setLightbox({ url: r.firstImage, alt: r.name });
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {lightbox && (
        <ImageLightbox
          url={lightbox.url}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
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

function BulkApplyingScreen({ total }: { total: number }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center h-full text-center gap-4">
      <div className="relative w-14 h-14">
        <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-emerald-500 border-r-emerald-500 animate-spin" />
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-900">
          Correction en cours…
        </div>
        <div className="text-[12px] text-slate-500 mt-1">
          {total} produit{total > 1 ? "s" : ""} en train d&apos;être mis à jour depuis PFS.
        </div>
        <div className="text-[11px] text-slate-400 mt-2">
          Ne fermez pas cette fenêtre — cela peut prendre quelques secondes.
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  result,
  justRevealed,
  fixing,
  onIgnore,
  onFix,
  onZoomImage,
}: {
  result: PfsAuditProductResult;
  justRevealed?: boolean;
  fixing?: boolean;
  onIgnore: () => void;
  onFix: () => void;
  onZoomImage: () => void;
}) {
  const image = result.firstImage;
  const showImage = !!image;
  const fixableCount = result.ok ? countPullableIssues(result.issues) : 0;
  const manualCount = result.ok ? result.issues.length - fixableCount : 0;
  // Mapping BJ manquant sur au moins un écart → carte rouge, bouton
  // « Modifier » désactivé, la cliente doit corriger côté site + relancer.
  const hasBlockingMapping = result.ok && result.issues.some((i) => i.blockingMappingIssue);
  const isRed = !result.ok || hasBlockingMapping;
  const badgeClass = isRed
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : fixableCount > 0
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-slate-100 text-slate-600 ring-slate-200";
  const badgeLabel = !result.ok
    ? "Erreur"
    : hasBlockingMapping
      ? "Bloqué · mapping requis"
      : fixableCount === 0
        ? `${manualCount} · à la main`
        : `${result.issues.length} écart${result.issues.length > 1 ? "s" : ""}`;
  const subtitle = !result.ok ? result.error : summarizeIssues(result.issues);

  return (
    <div
      className={`relative rounded-2xl bg-white shadow-md overflow-hidden flex flex-col ${isRed ? "ring-2 ring-rose-400" : "ring-1 ring-slate-200"} ${justRevealed ? "animate-pfs-appear" : ""}`}
    >
      {fixing && (
        <div className="absolute inset-0 z-20 bg-white/85 backdrop-blur-[2px] flex items-center justify-center gap-2 rounded-xl">
          <div className="relative w-5 h-5">
            <div className="absolute inset-0 rounded-full border-2 border-slate-200" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 border-r-emerald-500 animate-spin" />
          </div>
          <span className="text-[12px] font-semibold text-slate-700">
            Correction en cours…
          </span>
        </div>
      )}

      {/* Image en gros sur le dessus (aspect carré). Clic ou clic sur la loupe
          → ouverture de la visionneuse plein écran. La loupe est toujours
          visible (coin haut-droite) mais s'agrandit au survol. */}
      <button
        type="button"
        onClick={onZoomImage}
        disabled={!showImage}
        aria-label={showImage ? "Agrandir l'image" : "Pas d'image disponible"}
        className="group relative w-full aspect-square bg-slate-100 overflow-hidden disabled:cursor-default"
      >
        {showImage ? (
          // Double affichage volontaire : (1) background-image en CSS pour
          // garantir que la vignette apparaisse même si <img> a un souci de
          // rendu, (2) <img> par-dessus pour l'effet zoom au survol.
          <div
            className="w-full h-full transition-transform duration-300 group-hover:scale-105 bg-center bg-cover"
            style={{ backgroundImage: `url("${image}")` }}
            role="img"
            aria-label={result.name}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
        )}
        {showImage && (
          <>
            {/* Voile sombre au survol pour faire ressortir la loupe */}
            <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/20 transition-colors" />
            {/* Icône loupe — toujours visible en petit, s'agrandit au survol */}
            <span className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur ring-1 ring-slate-200 shadow-md flex items-center justify-center text-slate-700 group-hover:bg-white group-hover:scale-110 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 7.5v6m-3-3h6" />
              </svg>
            </span>
          </>
        )}
        {/* Badge écart en overlay bas-gauche pour rester lisible sur photo */}
        <span className={`absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ring-1 whitespace-nowrap ${badgeClass} shadow-sm`}>
          {badgeLabel}
        </span>
      </button>

      {/* Bloc infos + actions sous l'image */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400 truncate">
          {result.reference}
        </div>
        <div className="text-sm font-semibold text-slate-900 leading-tight truncate" title={result.name}>
          {result.name}
        </div>
        <div className={`text-[12px] line-clamp-2 ${!result.ok ? "text-rose-700" : "text-slate-500"}`}>
          {subtitle}
        </div>

        <div className="flex items-center gap-2 mt-auto pt-2 flex-wrap">
          <button
            type="button"
            onClick={onIgnore}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
          >
            Ignorer
          </button>
          {result.ok && !hasBlockingMapping && fixableCount > 0 && (
            <button
              type="button"
              onClick={onFix}
              disabled={fixing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-slate-900 hover:bg-black shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M6 5l7 7-7 7" />
              </svg>
              Modifier
            </button>
          )}
          {result.ok && hasBlockingMapping && (
            <span
              title="Corrigez le mapping côté site puis relancez l'audit."
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-rose-700 bg-rose-100 ring-1 ring-rose-200 cursor-not-allowed"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Bloqué
            </span>
          )}
        </div>
      </div>

      {result.ok && result.issues.length > 0 && (
        <IssueDetails issues={result.issues} />
      )}
    </div>
  );
}

/**
 * Visionneuse plein écran (lightbox) pour agrandir la photo produit.
 * ESC ou clic sur le fond noir ferment. Bouton croix en haut à droite.
 *
 * Rendue via createPortal dans document.body : le DrawerShell parent utilise
 * `transform` (translate-y pour l'animation), ce qui crée un containing block
 * qui piégerait un enfant `position: fixed`. Sans le portal, la lightbox était
 * limitée aux 440×760 du panneau du drawer.
 */
function ImageLightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Bloque le scroll de la page pendant que la lightbox est ouverte
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[10000] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur ring-1 ring-white/30 flex items-center justify-center text-white transition"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl"
      />
      {alt && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-white/10 backdrop-blur text-white text-sm font-medium max-w-[80vw] truncate ring-1 ring-white/20">
          {alt}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── Détails d'écarts (refonte 2026-07-28) ────────────────────────────────
//
// Rendu groupé par contexte :
//   1. Bandeau rouge « Mapping requis » (bloque toute la fiche).
//   2. Fiche produit : nom / description / composition / autres attributs.
//   3. Une carte par variante (couleur) avec KPI prix / stock / poids.
//   4. Couleurs en trop chez PFS (à ajouter chez nous).
//   5. Couleurs absentes de PFS (à supprimer chez nous).
//   6. Champs à corriger à la main (mapping Lot C non-bloquant).

const PRODUCT_LEVEL_FIELDS = new Set<PfsVerifyIssueField>([
  "name",
  "description",
  "dimensions",
  "composition",
  "country",
  "season",
  "gender",
  "category",
  "family",
  "isBestSeller",
  "productStatus",
]);

interface VariantGroup {
  colorRef: string;
  colorName: string;
  colorHex: string | null;
  variantType?: "UNIT" | "PACK";
  packQuantity?: number | null;
  issues: PfsVerifyIssue[];
}

function groupIssues(issues: PfsVerifyIssue[]) {
  const blockingMapping: PfsVerifyIssue[] = [];
  const productPullable: PfsVerifyIssue[] = [];
  const productManual: PfsVerifyIssue[] = [];
  const byColor = new Map<string, VariantGroup>();
  const extras: PfsVerifyIssue[] = [];
  const missing: PfsVerifyIssue[] = [];

  for (const iss of issues) {
    if (iss.blockingMappingIssue) {
      blockingMapping.push(iss);
      continue;
    }
    if (iss.field === "extraVariant") {
      extras.push(iss);
      continue;
    }
    if (iss.field === "missingVariant") {
      missing.push(iss);
      continue;
    }
    if (iss.scope === "product" && PRODUCT_LEVEL_FIELDS.has(iss.field)) {
      const pullable = !iss.pullBlocked && isPullSupportedLotB(iss.scope, iss.field);
      if (pullable) productPullable.push(iss);
      else productManual.push(iss);
      continue;
    }
    if (iss.scope === "color") {
      const key = iss.colorRef ?? iss.colorName ?? "?";
      const existing = byColor.get(key);
      if (existing) {
        existing.issues.push(iss);
      } else {
        byColor.set(key, {
          colorRef: iss.colorRef ?? "",
          colorName: iss.colorName ?? iss.colorRef ?? "?",
          colorHex: iss.colorHex ?? null,
          variantType: iss.variantType,
          packQuantity: iss.packQuantity,
          issues: [iss],
        });
      }
      continue;
    }
    // Fallback : traité comme manuel
    productManual.push(iss);
  }

  return {
    blockingMapping,
    productPullable,
    productManual,
    variants: Array.from(byColor.values()),
    extras,
    missing,
  };
}

function IssueDetails({ issues }: { issues: PfsVerifyIssue[] }) {
  const g = groupIssues(issues);
  return (
    <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/70 to-white p-3 space-y-3 max-h-[420px] overflow-y-auto scrollbar-light">
      {g.blockingMapping.length > 0 && <BlockingMappingBlock issues={g.blockingMapping} />}
      {g.productPullable.length > 0 && (
        <ProductFieldsBlock title="Fiche produit" issues={g.productPullable} tone="pullable" />
      )}
      {g.variants.map((v) => (
        <VariantBlock key={v.colorRef || v.colorName} group={v} />
      ))}
      {g.extras.length > 0 && <ExtraVariantsBlock issues={g.extras} />}
      {g.missing.length > 0 && <MissingVariantsBlock issues={g.missing} />}
      {g.productManual.length > 0 && (
        <ProductFieldsBlock title="À corriger à la main" issues={g.productManual} tone="manual" />
      )}
    </div>
  );
}

// ─── Bandeau bloquant : mapping BJ manquant ────────────────────────────────
function BlockingMappingBlock({ issues }: { issues: PfsVerifyIssue[] }) {
  return (
    <div className="rounded-lg bg-gradient-to-br from-rose-50 to-rose-100/40 ring-2 ring-rose-300 p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest font-bold text-rose-700">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        Mapping requis
      </div>
      {issues.map((iss, i) => (
        <div key={i} className="text-[13px] text-rose-900 leading-relaxed font-medium">
          {iss.blockingMappingIssue}
        </div>
      ))}
    </div>
  );
}

// ─── Groupe FICHE PRODUIT ──────────────────────────────────────────────────
function ProductFieldsBlock({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: PfsVerifyIssue[];
  tone: "pullable" | "manual";
}) {
  const isManual = tone === "manual";
  return (
    <div>
      <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold mb-2 ${isManual ? "text-slate-500" : "text-slate-500"}`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={isManual
            ? "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            : "M9 12h6m-6 4h6M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"} />
        </svg>
        {title}
      </div>
      <div className={`space-y-1.5 ${isManual ? "rounded-lg bg-slate-100/60 ring-1 ring-slate-200 border border-dashed border-slate-300 p-2" : ""}`}>
        {issues.map((iss, i) => (
          <ProductFieldCard key={i} issue={iss} manual={isManual} />
        ))}
      </div>
    </div>
  );
}

function fieldIcon(field: PfsVerifyIssueField): React.ReactNode {
  switch (field) {
    case "name":
      return <span className="inline-flex w-5 h-5 rounded-md bg-violet-100 text-violet-600 items-center justify-center text-[10px] font-black">Aa</span>;
    case "description":
      return (
        <span className="inline-flex w-5 h-5 rounded-md bg-violet-100 text-violet-600 items-center justify-center">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </span>
      );
    case "composition":
      return (
        <span className="inline-flex w-5 h-5 rounded-md bg-violet-100 text-violet-600 items-center justify-center">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v18M15 3v18M3 9h18M3 15h18" />
          </svg>
        </span>
      );
    case "dimensions":
      return (
        <span className="inline-flex w-5 h-5 rounded-md bg-sky-100 text-sky-600 items-center justify-center">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8v8m16-8v8M8 4h8M8 20h8" />
          </svg>
        </span>
      );
    case "isBestSeller":
      return <span className="inline-flex w-5 h-5 rounded-md bg-amber-100 text-amber-600 items-center justify-center text-xs">★</span>;
    default:
      return (
        <span className="inline-flex w-5 h-5 rounded-md bg-slate-100 text-slate-500 items-center justify-center text-[10px] font-bold">i</span>
      );
  }
}

function ProductFieldCard({ issue, manual }: { issue: PfsVerifyIssue; manual: boolean }) {
  const before = issue.expectedValue ?? "(vide)";
  const after = issue.pfsValue ?? "(vide)";
  const isCompositionOrCategory = issue.field === "composition" || issue.field === "category" || issue.field === "family";
  const longText = issue.field === "description";

  if (manual) {
    // Rendu compact pour les champs non-pullables (à faire à la main)
    return (
      <div className="flex items-start justify-between gap-2 text-[12px]">
        <div className="flex items-center gap-1.5 min-w-0">
          {fieldIcon(issue.field)}
          <span className="font-semibold text-slate-700 truncate">{issue.fieldLabel}</span>
        </div>
        <span className="text-[11px] italic text-slate-500 shrink-0">
          {issue.pullBlocked ? "à la main" : "Lot C"}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white ring-1 ring-slate-200 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        {fieldIcon(issue.field)}
        {issue.fieldLabel}
      </div>
      {isCompositionOrCategory ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold bg-rose-50 text-rose-700 ring-1 ring-rose-200 line-through">
            {before}
          </span>
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
          <span className="inline-flex items-center px-2 py-1 rounded-md text-[12px] font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            {after}
          </span>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-start gap-1.5">
            <span className="mt-1 shrink-0 w-3.5 h-3.5 rounded-full bg-rose-100 text-rose-600 text-[10px] font-bold flex items-center justify-center">−</span>
            <span className={`${longText ? "text-[12.5px] line-clamp-3" : "text-[13px]"} text-slate-500 line-through leading-snug`}>{before}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="mt-1 shrink-0 w-3.5 h-3.5 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-bold flex items-center justify-center">+</span>
            <span className={`${longText ? "text-[12.5px] line-clamp-3" : "text-base font-bold"} text-slate-900 leading-snug`}>{after}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bloc VARIANTE (couleur) avec KPI ──────────────────────────────────────
function VariantBlock({ group }: { group: VariantGroup }) {
  const priceIssue = group.issues.find((i) => i.field === "price");
  const stockIssue = group.issues.find((i) => i.field === "stock");
  const weightIssue = group.issues.find((i) => i.field === "weight");
  const otherIssues = group.issues.filter(
    (i) => i.field !== "price" && i.field !== "stock" && i.field !== "weight",
  );
  const patternHex = group.colorHex;
  const packLabel =
    group.variantType === "PACK" && group.packQuantity
      ? `Pack de ${group.packQuantity}`
      : group.variantType === "UNIT"
        ? null
        : null;

  return (
    <div>
      <div className="flex items-center flex-wrap gap-2 text-[11px] uppercase tracking-widest font-bold text-slate-500 mb-2">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM7 21h10a2 2 0 002-2v-4M17 21l-4-4" />
        </svg>
        Variante
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-white ring-1 ring-slate-200 normal-case tracking-normal">
          <span
            className="w-4 h-4 rounded-full ring-2 ring-white shadow"
            style={{ background: patternHex ?? "#94a3b8" }}
          />
          <span className="text-slate-900 text-[12px] font-bold">{group.colorName}</span>
        </span>
        {packLabel && (
          <span className="text-slate-400 normal-case text-[11px] tracking-normal font-normal">
            · {packLabel}
          </span>
        )}
      </div>
      {(priceIssue || stockIssue || weightIssue) && (
        <div className="grid grid-cols-3 gap-2 mb-1.5">
          <KpiTile label="Prix" issue={priceIssue} accent="emerald" icon={KpiIcons.price} unit="€" />
          <KpiTile label="Stock" issue={stockIssue} accent="sky" icon={KpiIcons.stock} unit="" />
          <KpiTile label="Poids" issue={weightIssue} accent="amber" icon={KpiIcons.weight} unit="" />
        </div>
      )}
      {otherIssues.length > 0 && (
        <div className="space-y-1">
          {otherIssues.map((iss, i) => (
            <div key={i} className="text-[12px] flex items-center justify-between gap-2 px-2 py-1 rounded bg-white ring-1 ring-slate-200">
              <span className="font-semibold text-slate-700">{iss.fieldLabel}</span>
              <span className="text-[12px] text-slate-500">
                <span className="line-through">{iss.expectedValue ?? "(vide)"}</span>
                <span className="mx-1 text-emerald-600">→</span>
                <span className="text-slate-900 font-semibold">{iss.pfsValue ?? "(vide)"}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KpiIcons = {
  price: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.66 0-3 .67-3 1.5S10.34 11 12 11s3 .67 3 1.5S13.66 14 12 14M12 6v12" />
    </svg>
  ),
  stock: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  weight: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 4v6c0 3.5-2.5 6.5-7 8-4.5-1.5-7-4.5-7-8V7l7-4z" />
    </svg>
  ),
};

function KpiTile({
  label,
  issue,
  accent,
  icon,
  unit,
}: {
  label: string;
  issue?: PfsVerifyIssue;
  accent: "emerald" | "sky" | "amber";
  icon: React.ReactNode;
  unit: string;
}) {
  const accentText = accent === "emerald" ? "text-emerald-500" : accent === "sky" ? "text-sky-500" : "text-amber-500";
  if (!issue) {
    // Pas d'écart → tuile grisée pour montrer "OK sur ce champ"
    return (
      <div className="rounded-lg bg-slate-50/50 ring-1 ring-slate-200 p-2 text-center opacity-60">
        <div className={`flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5`}>
          <span className={accentText}>{icon}</span>
          {label}
        </div>
        <div className="text-[11px] text-slate-400">OK</div>
      </div>
    );
  }
  const beforeRaw = parseNumericValue(issue.expectedValue);
  const afterRaw = parseNumericValue(issue.pfsValue);
  const showDelta = beforeRaw !== null && afterRaw !== null;
  const delta = showDelta ? afterRaw - beforeRaw : 0;
  const deltaTone = delta > 0 ? "emerald" : delta < 0 ? "rose" : "slate";
  return (
    <div className="rounded-lg bg-white ring-1 ring-slate-200 p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
        <span className={accentText}>{icon}</span>
        {label}
      </div>
      <div className="text-[11px] text-slate-400 line-through font-mono tabular-nums">{issue.expectedValue ?? "—"}</div>
      <div className="text-base font-black text-slate-900 font-mono tabular-nums leading-none mt-0.5">
        {issue.pfsValue ?? "—"}
      </div>
      {showDelta && (
        <div
          className={`mt-1 inline-flex items-center gap-0.5 text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
            deltaTone === "emerald"
              ? "text-emerald-700 bg-emerald-50"
              : deltaTone === "rose"
                ? "text-rose-700 bg-rose-50"
                : "text-slate-600 bg-slate-100"
          }`}
        >
          {delta > 0 ? "↑" : delta < 0 ? "↓" : "="} {Math.abs(delta).toFixed(unit === "€" ? 2 : delta % 1 === 0 ? 0 : 1)}
          {unit ? ` ${unit}` : ""}
        </div>
      )}
    </div>
  );
}

// Parse "15,00 €" ou "28" ou "0.004 kg" en nombre pour calculer le delta.
function parseNumericValue(v: string | null | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function ExtraVariantsBlock({ issues }: { issues: PfsVerifyIssue[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold text-emerald-600 mb-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Couleur{issues.length > 1 ? "s" : ""} à ajouter
      </div>
      <div className="space-y-1.5">
        {issues.map((iss, i) => (
          <div key={i} className="rounded-lg bg-gradient-to-br from-emerald-50 to-white ring-1 ring-emerald-200 p-2.5 flex items-center gap-3">
            <span
              className="relative w-10 h-10 rounded-full ring-2 ring-emerald-300 shrink-0 shadow-inner"
              style={{ background: iss.colorHex ?? "#94a3b8" }}
            >
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center ring-2 ring-white">+</span>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-slate-900 truncate">{iss.colorName ?? iss.colorRef ?? "?"}</div>
              <div className="text-[11px] text-emerald-700 font-medium">Sera ajoutée sur votre site</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingVariantsBlock({ issues }: { issues: PfsVerifyIssue[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-bold text-rose-600 mb-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
        </svg>
        Couleur{issues.length > 1 ? "s" : ""} à supprimer
      </div>
      <div className="space-y-1.5">
        {issues.map((iss, i) => (
          <div key={i} className="rounded-lg bg-gradient-to-br from-rose-50 to-white ring-1 ring-rose-200 p-2.5 flex items-center gap-3">
            <span
              className="relative w-10 h-10 rounded-full ring-2 ring-rose-300 shrink-0 shadow-inner"
              style={{ background: iss.colorHex ?? "#94a3b8" }}
            >
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center ring-2 ring-white">−</span>
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-slate-900 truncate">{iss.colorName ?? iss.colorRef ?? "?"}</div>
              <div className="text-[11px] text-rose-700 font-medium">Sera supprimée de votre site</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeIssues(issues: PfsVerifyIssue[]): string {
  const labels = issues.slice(0, 2).map((iss) => {
    const colorLbl = iss.colorName ?? iss.colorRef ?? "?";
    if (iss.field === "extraVariant") return `${colorLbl} → à ajouter chez nous`;
    if (iss.field === "missingVariant") return `${colorLbl} → à supprimer chez nous`;
    return iss.colorName ? `${iss.fieldLabel} (${iss.colorName})` : iss.fieldLabel;
  });
  const extra = issues.length - labels.length;
  return extra > 0 ? `${labels.join(" · ")} · +${extra} autres` : labels.join(" · ");
}
