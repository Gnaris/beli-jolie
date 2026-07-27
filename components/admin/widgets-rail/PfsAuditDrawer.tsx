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
import { useRefreshMarketplacePrompt } from "@/components/admin/products/RefreshMarketplaceDialog";
import {
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";
import type { PfsPullEligibleMarketplace } from "@/lib/pfs-verify-eligible-marketplaces";

type Filter = "all" | "fixable" | "manual" | "error";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 15_000;

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isVisible, setIsVisible] = useState(true);
  // Loading unitaire : ID du produit dont on applique le fix actuellement
  // (spinner sur la carte + bouton désactivé).
  const [fixingProductId, setFixingProductId] = useState<string | null>(null);
  // Loading bulk : compteur { done, total } pendant « Tout modifier depuis PFS ».
  // Null = pas de bulk en cours. On remplace le body de la liste par un écran
  // dédié pour que la cliente sache ce qui se passe.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
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

      // Confirmation renforcée si le fix va supprimer / ajouter une variante
      // (missingVariant → suppression locale, extraVariant → ajout local). Ces
      // actions sont destructives / structurelles et méritent une alerte
      // explicite au lieu du clic-et-oubli habituel.
      const toDelete = r.issues.filter(
        (iss) =>
          iss.field === "missingVariant" &&
          !iss.pullBlocked &&
          isPullSupportedLotB(iss.scope, iss.field),
      );
      const toAdd = r.issues.filter(
        (iss) =>
          iss.field === "extraVariant" &&
          !iss.pullBlocked &&
          isPullSupportedLotB(iss.scope, iss.field),
      );
      if (toDelete.length > 0 || toAdd.length > 0) {
        const deleteList = toDelete
          .map((i) => `• ${i.colorName ?? i.colorRef ?? "?"} sera supprimée`)
          .join("\n");
        const addList = toAdd
          .map((i) => `• ${i.colorName ?? i.colorRef ?? "?"} sera ajoutée`)
          .join("\n");
        const ok = await confirm.confirm({
          type: "warning",
          title: `Modifier « ${r.name} » depuis PFS ?`,
          message:
            `Cette action va modifier des couleurs sur votre site :\n\n` +
            [deleteList, addList].filter(Boolean).join("\n") +
            `\n\nLes autres écarts (prix / stock / poids…) seront aussi corrigés.\n\n` +
            `Cette action est irréversible.`,
          confirmLabel: "Modifier",
          cancelLabel: "Annuler",
        });
        if (!ok) return;
      }

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
          productIds: [r.productId],
          title: "Propager vers vos marketplaces ?",
          subtitle: `« ${r.name} » — envoyer aussi les nouvelles valeurs.`,
          eyebrow: "Synchronisation",
          confirmLabel: "Synchroniser",
          showBoutique: false,
          defaultAllChecked: true,
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
    [toast, router, askRefreshOptions, enqueue, confirm, fixingProductId],
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
  }, [fixableResults, confirm, toast, router, askRefreshOptions, enqueue]);

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
      {bulkProgress ? (
        <BulkApplyingScreen total={bulkProgress.total} />
      ) : !state || status === "IDLE" ? (
        <div className="p-6 text-center">
          <p className="text-sm text-slate-500">Aucun audit lancé pour le moment.</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Cliquez sur « Auditer PFS » en haut de la page Produits pour vérifier tous les produits liés à PFS.
          </p>
        </div>
      ) : (
        <>
          {/* En-tête sticky : progression (si RUNNING) + tabs filtres */}
          <div className="px-3 pt-3 pb-2 sticky top-0 bg-slate-50/95 backdrop-blur z-10 border-b border-slate-100 space-y-2">
            {isRunning && (
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                  <span>
                    <b className="text-slate-900 tabular-nums">{state.processed.toLocaleString("fr-FR")}</b>
                    <span className="text-slate-400"> / {state.total.toLocaleString("fr-FR")}</span>
                  </span>
                  <span className="tabular-nums text-slate-500">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
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
                {isRunning
                  ? "Aucun écart pour l'instant — les produits s'afficheront ici au fur et à mesure."
                  : "Aucun résultat dans cette catégorie."}
              </div>
            ) : (
              filtered.map((r) => (
                <ProductCard
                  key={r.productId}
                  result={r}
                  expanded={expandedIds.has(r.productId)}
                  justRevealed={justRevealedIdRef.current === r.productId}
                  fixing={fixingProductId === r.productId}
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
  expanded,
  justRevealed,
  fixing,
  onToggleExpand,
  onIgnore,
  onFix,
}: {
  result: PfsAuditProductResult;
  expanded: boolean;
  justRevealed?: boolean;
  fixing?: boolean;
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
    <div
      className={`relative rounded-xl bg-white ring-1 shadow-sm overflow-hidden ${!result.ok ? "ring-rose-200" : "ring-slate-200"} ${justRevealed ? "animate-pfs-appear" : ""}`}
    >
      {fixing && (
        <div className="absolute inset-0 z-10 bg-white/85 backdrop-blur-[2px] flex items-center justify-center gap-2 rounded-xl">
          <div className="relative w-5 h-5">
            <div className="absolute inset-0 rounded-full border-2 border-slate-200" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-emerald-500 border-r-emerald-500 animate-spin" />
          </div>
          <span className="text-[12px] font-semibold text-slate-700">
            Correction en cours…
          </span>
        </div>
      )}
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
                disabled={fixing}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-white bg-slate-900 hover:bg-black shadow-sm disabled:bg-slate-400 disabled:cursor-not-allowed"
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
  const colorLbl = issue.colorName ?? issue.colorRef ?? "?";
  const isStructural = issue.field === "missingVariant" || issue.field === "extraVariant";
  const label = issue.field === "extraVariant"
    ? `Couleur en trop chez PFS (${colorLbl})`
    : issue.field === "missingVariant"
      ? `Couleur absente de PFS (${colorLbl})`
      : issue.colorName
        ? `${issue.fieldLabel} · ${issue.colorName}`
        : issue.fieldLabel;

  // Pour les actions structurelles, on affiche explicitement CE QUI VA SE
  // PASSER si la cliente clique « Modifier depuis PFS » (l'ancien rendu
  // "(vide) → (vide)" ne parlait à personne).
  const structuralAction = !isStructural
    ? null
    : issue.field === "missingVariant"
      ? { text: "Sera supprimée de votre site", tone: "rose" as const }
      : { text: "Sera ajoutée sur votre site", tone: "emerald" as const };

  const before = issue.expectedValue ?? "(vide)";
  const after = issue.pfsValue ?? "(vide)";

  return (
    <div className={`text-[11px] leading-snug ${blocked ? "opacity-60" : ""}`}>
      <div className="font-semibold text-slate-700 truncate">{label}</div>
      {structuralAction ? (
        <div
          className={`truncate font-semibold ${
            blocked
              ? "text-slate-500"
              : structuralAction.tone === "rose"
                ? "text-rose-700"
                : "text-emerald-700"
          }`}
        >
          {blocked ? "À faire à la main" : `→ ${structuralAction.text}`}
        </div>
      ) : (
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
      )}
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
