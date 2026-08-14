"use client";

/**
 * Widget flottant unifié « Import commandes / clients marketplaces ».
 *
 * Fusionne les 2 anciens tiroirs séparés (`pfs-import` + `efashion-import`) en
 * un seul panneau qui gère les 2 imports **en parallèle**. Chaque source a son
 * propre bloc avec la même grammaire visuelle que l'ancien PfsImportDrawer :
 *  - IdleView élégante (gros rond + description + gros bouton coloré)
 *  - Progression avec barre dégradée
 *  - Cartes commandes en cours avec pastille pulsante
 *  - Récap final en grid 3 colonnes (importées / déjà à jour / ignorées)
 *  - Journal live avec drip (1 event ajouté toutes les 250ms) + animation d'entrée
 *
 * Les 2 imports sont indépendants côté serveur — on peut lancer PFS pendant
 * qu'eFashion tourne. Le badge cumul + halo pulsant du rond flottant reflète
 * la somme des 2 workloads restants.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acknowledgePfsHistoricalImport,
  getPfsImportStateAction,
  startPfsHistoricalImport,
  stopPfsHistoricalImport,
  type PfsImportState,
  type PfsImportRecentEvent,
} from "@/app/actions/admin/pfs-orders";
import {
  acknowledgeEfashionHistoricalImport,
  getEfashionImportStateAction,
  startEfashionHistoricalImport,
  stopEfashionHistoricalImport,
  type EfashionImportState,
  type EfashionImportRecentEvent,
} from "@/app/actions/admin/efashion-orders";
import {
  acknowledgeFaireHistoricalImport,
  getFaireImportStateAction,
  startFaireHistoricalImport,
  stopFaireHistoricalImport,
  type FaireImportState,
  type FaireImportRecentEvent,
} from "@/app/actions/admin/faire-orders";
import {
  acknowledgeMicrostoreHistoricalImport,
  getMicrostoreImportStateAction,
  startMicrostoreHistoricalImport,
  stopMicrostoreHistoricalImport,
  type MicrostoreImportState,
} from "@/app/actions/admin/microstore-orders";
import {
  acknowledgeAnkorstoreHistoricalImport,
  getAnkorstoreImportStateAction,
  startAnkorstoreHistoricalImport,
  stopAnkorstoreHistoricalImport,
  type AnkorstoreImportState,
  type AnkorstoreImportRecentEvent,
} from "@/app/actions/admin/ankorstore-orders";
import {
  useRightRail,
  type ManualSyncEvent,
  type RailWidgetId,
} from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 30_000;
const EVENT_DRIP_MS = 250;
// En plein écran (2026-07-31), chaque colonne dispose d'une hauteur bien plus
// généreuse : on affiche davantage d'events + commandes en cours pour que la
// cliente voie la file avancer sans avoir à attendre des rotations.
const DISPLAYED_EVENTS_MAX = 8;
const CURRENT_ORDERS_MAX = 4;

const LEGACY_ALIASES: RailWidgetId[] = ["pfs-import", "efashion-import"];

type MarketplaceTabKey = "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE" | "MICROSTORE";

interface TabDef {
  key: MarketplaceTabKey;
  label: string;
  letter: string;
  /** Dégradé du rond initiale — figé par marketplace (cf. CLAUDE.md styling public). */
  gradient: string;
  /** Couleur de la barre active sous l'onglet + de l'accent bar de la colonne. */
  accent: string;
  activeText: string;
  activeBg: string;
}

const TABS: TabDef[] = [
  {
    key: "PFS",
    label: "Paris Fashion Shop",
    letter: "P",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
    accent: "bg-indigo-500",
    activeText: "text-indigo-700",
    activeBg: "bg-indigo-50",
  },
  {
    key: "ANKORSTORE",
    label: "Ankorstore",
    letter: "A",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    accent: "bg-sky-500",
    activeText: "text-sky-700",
    activeBg: "bg-sky-50",
  },
  {
    key: "EFASHION",
    label: "eFashion Paris",
    letter: "E",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
    accent: "bg-rose-500",
    activeText: "text-rose-700",
    activeBg: "bg-rose-50",
  },
  {
    key: "FAIRE",
    label: "Faire",
    letter: "F",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
    accent: "bg-amber-500",
    activeText: "text-amber-700",
    activeBg: "bg-amber-50",
  },
  {
    key: "MICROSTORE",
    label: "Microstore",
    letter: "M",
    gradient: "linear-gradient(135deg,#0891b2,#22d3ee)",
    accent: "bg-cyan-500",
    activeText: "text-cyan-700",
    activeBg: "bg-cyan-50",
  },
];

const ICON = (
  <svg
    className="w-5 h-5"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
  </svg>
);

function formatMoney(n: number | null): string {
  if (n == null) return "";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatRelative(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h}h`;
}

export function OrdersImportDrawer() {
  const { openWidget, open, close, setBadge, manualSyncs, clearManualSync } = useRightRail();
  const { confirm } = useConfirm();
  const [clearing, setClearing] = useState(false);
  const isOpen =
    openWidget === "orders-import" ||
    openWidget === "pfs-import" ||
    openWidget === "efashion-import";

  const [pfsState, setPfsState] = useState<PfsImportState | null>(null);
  const [efState, setEfState] = useState<EfashionImportState | null>(null);
  const [faireState, setFaireState] = useState<FaireImportState | null>(null);
  const [microstoreState, setMicrostoreState] = useState<MicrostoreImportState | null>(null);
  const [ankorstoreState, setAnkorstoreState] = useState<AnkorstoreImportState | null>(null);
  const [activeTab, setActiveTab] = useState<MarketplaceTabKey>("PFS");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Un seul useEffect qui gère les 4 pollers (PFS, eFashion, Faire,
  // Microstore) avec garde visibility partagée. Onglet caché → pollers en pause
  // (aucune requête tant que la cliente n'est pas revenue). Retour de visibilité
  // → tick immédiat pour chaque source pour capter l'état à jour.
  useEffect(() => {
    let cancelled = false;
    let isVisible =
      typeof document === "undefined" ? true : document.visibilityState === "visible";
    const timers: Record<string, ReturnType<typeof setTimeout> | null> = {
      pfs: null, ef: null, faire: null, microstore: null, ankorstore: null,
    };
    const tickers: Record<string, () => Promise<void>> = {};

    function makeTick<T extends { status: string }>(
      key: string,
      fetchState: () => Promise<T>,
      setState: (s: T) => void,
    ): () => Promise<void> {
      const tick = async () => {
        if (cancelled) return;
        if (!isVisible) return; // stoppé, sera relancé au retour de visibilité
        try {
          const s = await fetchState();
          if (cancelled) return;
          setState(s);
          timers[key] = setTimeout(
            () => void tick(),
            s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
          );
        } catch {
          if (cancelled) return;
          timers[key] = setTimeout(() => void tick(), POLL_IDLE_MS);
        }
      };
      return tick;
    }

    tickers.pfs = makeTick("pfs", getPfsImportStateAction, setPfsState);
    tickers.ef = makeTick("ef", getEfashionImportStateAction, setEfState);
    tickers.faire = makeTick("faire", getFaireImportStateAction, setFaireState);
    tickers.microstore = makeTick("microstore", getMicrostoreImportStateAction, setMicrostoreState);
    tickers.ankorstore = makeTick("ankorstore", getAnkorstoreImportStateAction, setAnkorstoreState);

    const startAll = () => {
      for (const t of Object.values(tickers)) void t();
    };
    const stopAll = () => {
      for (const key of Object.keys(timers)) {
        const timer = timers[key];
        if (timer) {
          clearTimeout(timer);
          timers[key] = null;
        }
      }
    };

    startAll();

    const onVisibilityChange = () => {
      const nextVisible = document.visibilityState === "visible";
      if (nextVisible === isVisible) return;
      isVisible = nextVisible;
      if (isVisible) {
        stopAll();
        startAll();
      } else {
        stopAll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      stopAll();
    };
  }, []);

  // Refresh immédiat au moment où le widget s'ouvre — sans ça, si un import
  // vient d'être lancé depuis la page marketplace, le widget affiche encore
  // l'ancien état IDLE jusqu'à 30 s (POLL_IDLE_MS), et la cliente voit un
  // bouton "Démarrer" alors que l'import tourne déjà en fond.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      void Promise.all([
        getPfsImportStateAction().then(setPfsState).catch(() => {}),
        getEfashionImportStateAction().then(setEfState).catch(() => {}),
        getFaireImportStateAction().then(setFaireState).catch(() => {}),
        getMicrostoreImportStateAction().then(setMicrostoreState).catch(() => {}),
        getAnkorstoreImportStateAction().then(setAnkorstoreState).catch(() => {}),
      ]);
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    const pfsRun = pfsState?.status === "RUNNING";
    const efRun = efState?.status === "RUNNING";
    const faireRun = faireState?.status === "RUNNING";
    const microstoreRun = microstoreState?.status === "RUNNING";
    const ankorstoreRun = ankorstoreState?.status === "RUNNING";
    const running = pfsRun || efRun || faireRun || microstoreRun || ankorstoreRun;
    const remainingPfs = pfsRun
      ? Math.max(0, (pfsState?.totalOrders ?? 0) - (pfsState?.processedOrders ?? 0))
      : 0;
    const remainingEf = efRun
      ? Math.max(0, (efState?.totalOrders ?? 0) - (efState?.processedOrders ?? 0))
      : 0;
    // Faire : totalOrders inconnu tant que le curseur n'est pas fini →
    // fallback sur processedOrders pour montrer l'activité.
    const remainingFaire = faireRun && faireState
      ? faireState.totalOrders > 0
        ? Math.max(0, faireState.totalOrders - faireState.processedOrders)
        : faireState.processedOrders
      : 0;
    // Microstore : phase CUSTOMERS puis phase ORDERS — le "restant" à afficher
    // dépend de la phase en cours pour être honnête (sinon on affiche 0 pendant
    // toute la phase clients).
    const remainingMicrostore = microstoreRun && microstoreState
      ? microstoreState.phase === "CUSTOMERS"
        ? Math.max(
            0,
            (microstoreState.customersTotal ?? 0) - (microstoreState.customersProcessed ?? 0),
          )
        : microstoreState.totalOrders > 0
          ? Math.max(0, microstoreState.totalOrders - microstoreState.processedOrders)
          : microstoreState.processedOrders
      : 0;
    const remainingAnkorstore = ankorstoreRun
      ? Math.max(
          0,
          (ankorstoreState?.totalOrders ?? 0) - (ankorstoreState?.processedOrders ?? 0),
        )
      : 0;
    setBadge("orders-import", {
      count:
        remainingPfs +
        remainingEf +
        remainingFaire +
        remainingMicrostore +
        remainingAnkorstore,
      pulse: running,
    });
    for (const legacy of LEGACY_ALIASES) setBadge(legacy, { count: 0 });
  }, [pfsState, efState, faireState, microstoreState, ankorstoreState, setBadge]);

  const prevPfsRunRef = useRef(false);
  const prevEfRunRef = useRef(false);
  const prevFaireRunRef = useRef(false);
  const prevMicrostoreRunRef = useRef(false);
  const prevAnkorstoreRunRef = useRef(false);
  useEffect(() => {
    const pfsRun = pfsState?.status === "RUNNING";
    if (!prevPfsRunRef.current && pfsRun) {
      open("orders-import");
      setActiveTab("PFS");
    }
    prevPfsRunRef.current = pfsRun;
  }, [pfsState, open]);
  useEffect(() => {
    const efRun = efState?.status === "RUNNING";
    if (!prevEfRunRef.current && efRun) {
      open("orders-import");
      setActiveTab("EFASHION");
    }
    prevEfRunRef.current = efRun;
  }, [efState, open]);
  useEffect(() => {
    const faireRun = faireState?.status === "RUNNING";
    if (!prevFaireRunRef.current && faireRun) {
      open("orders-import");
      setActiveTab("FAIRE");
    }
    prevFaireRunRef.current = faireRun;
  }, [faireState, open]);
  useEffect(() => {
    const ankorstoreRun = ankorstoreState?.status === "RUNNING";
    if (!prevAnkorstoreRunRef.current && ankorstoreRun) {
      open("orders-import");
      setActiveTab("ANKORSTORE");
    }
    prevAnkorstoreRunRef.current = ankorstoreRun;
  }, [ankorstoreState, open]);
  useEffect(() => {
    const microstoreRun = microstoreState?.status === "RUNNING";
    if (!prevMicrostoreRunRef.current && microstoreRun) {
      open("orders-import");
      setActiveTab("MICROSTORE");
    }
    prevMicrostoreRunRef.current = microstoreRun;
  }, [microstoreState, open]);

  const anyRunning =
    pfsState?.status === "RUNNING" ||
    efState?.status === "RUNNING" ||
    faireState?.status === "RUNNING" ||
    microstoreState?.status === "RUNNING" ||
    ankorstoreState?.status === "RUNNING";
  const title = useMemo(() => {
    if (anyRunning) {
      const parts: string[] = [];
      if (pfsState?.status === "RUNNING") {
        parts.push(`PFS ${pfsState.processedOrders}/${pfsState.totalOrders}`);
      }
      if (efState?.status === "RUNNING") {
        parts.push(`eFashion ${efState.processedOrders}/${efState.totalOrders}`);
      }
      if (ankorstoreState?.status === "RUNNING") {
        parts.push(
          `Ankorstore ${ankorstoreState.processedOrders}${ankorstoreState.totalOrders > 0 ? `/${ankorstoreState.totalOrders}` : ""}`,
        );
      }
      if (faireState?.status === "RUNNING") {
        parts.push(
          `Faire ${faireState.processedOrders}${faireState.totalOrders > 0 ? `/${faireState.totalOrders}` : ""}`,
        );
      }
      if (microstoreState?.status === "RUNNING") {
        // Phase CUSTOMERS → compteur clients ; phase ORDERS → compteur commandes
        if (microstoreState.phase === "CUSTOMERS") {
          parts.push(
            `Microstore ${microstoreState.customersProcessed ?? 0}/${microstoreState.customersTotal ?? 0} clients`,
          );
        } else {
          parts.push(
            `Microstore ${microstoreState.processedOrders}${microstoreState.totalOrders > 0 ? `/${microstoreState.totalOrders}` : ""} commandes`,
          );
        }
      }
      return (
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          {parts.join(" · ")}
        </span>
      );
    }
    return "Import commandes / clients marketplaces";
  }, [anyRunning, pfsState, efState, faireState, microstoreState, ankorstoreState]);

  // Compteur affiché sur chaque onglet quand un import tourne (X/Y ou juste X
   // pour Faire/Microstore quand le total n'est pas encore connu).
  const tabBadges = useMemo(() => {
    const pfsRun = pfsState?.status === "RUNNING";
    const efRun = efState?.status === "RUNNING";
    const faireRun = faireState?.status === "RUNNING";
    const microstoreRun = microstoreState?.status === "RUNNING";
    const ankorstoreRun = ankorstoreState?.status === "RUNNING";
    return {
      PFS: {
        running: pfsRun,
        counter: pfsRun
          ? `${pfsState?.processedOrders ?? 0}/${pfsState?.totalOrders ?? 0}`
          : "",
      },
      ANKORSTORE: {
        running: ankorstoreRun,
        counter: ankorstoreRun
          ? ankorstoreState && ankorstoreState.totalOrders > 0
            ? `${ankorstoreState.processedOrders}/${ankorstoreState.totalOrders}`
            : `${ankorstoreState?.processedOrders ?? 0}`
          : "",
      },
      EFASHION: {
        running: efRun,
        counter: efRun
          ? `${efState?.processedOrders ?? 0}/${efState?.totalOrders ?? 0}`
          : "",
      },
      FAIRE: {
        running: faireRun,
        counter: faireRun
          ? faireState && faireState.totalOrders > 0
            ? `${faireState.processedOrders}/${faireState.totalOrders}`
            : `${faireState?.processedOrders ?? 0}`
          : "",
      },
      MICROSTORE: {
        running: microstoreRun,
        counter: microstoreRun && microstoreState
          ? microstoreState.phase === "CUSTOMERS"
            ? `${microstoreState.customersProcessed ?? 0}/${microstoreState.customersTotal ?? 0} clients`
            : microstoreState.totalOrders > 0
              ? `${microstoreState.processedOrders}/${microstoreState.totalOrders}`
              : `${microstoreState.processedOrders}`
          : "",
      },
    } satisfies Record<MarketplaceTabKey, { running: boolean; counter: string }>;
  }, [pfsState, efState, faireState, microstoreState, ankorstoreState]);

  const handleClearAllHistory = useCallback(async () => {
    if (anyRunning) return;
    const ok = await confirm({
      type: "danger",
      title: "Vider tout l'historique d'import ?",
      message:
        "Les journaux, compteurs et récaps des 5 marketplaces (PFS, eFashion, Ankorstore, Faire, Microstore) seront remis à zéro. Les commandes et clients déjà importés en base ne sont pas supprimés.",
      confirmLabel: "Vider l'historique",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setClearing(true);
    try {
      await Promise.all([
        acknowledgePfsHistoricalImport(),
        acknowledgeEfashionHistoricalImport(),
        acknowledgeFaireHistoricalImport(),
        acknowledgeMicrostoreHistoricalImport(),
        acknowledgeAnkorstoreHistoricalImport(),
      ]);
      const [pfs, ef, faire, micro, ankor] = await Promise.all([
        getPfsImportStateAction(),
        getEfashionImportStateAction(),
        getFaireImportStateAction(),
        getMicrostoreImportStateAction(),
        getAnkorstoreImportStateAction(),
      ]);
      setPfsState(pfs);
      setEfState(ef);
      setFaireState(faire);
      setMicrostoreState(micro);
      setAnkorstoreState(ankor);
    } finally {
      setClearing(false);
    }
  }, [anyRunning, confirm]);

  if (!isOpen) return null;

  return (
    <DrawerShell
      open={isOpen}
      onClose={close}
      accent="indigo"
      eyebrow="Marketplaces"
      title={title}
      icon={ICON}
      size="fullscreen"
      footer={
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            Vider l&apos;historique ne supprime aucune commande ni fiche client déjà importée — seul l&apos;affichage (journal, compteurs, récaps) est remis à zéro.
          </p>
          <button
            type="button"
            onClick={handleClearAllHistory}
            disabled={clearing || anyRunning}
            title={
              anyRunning
                ? "Impossible pendant qu'un import tourne"
                : "Réinitialise l'affichage des 4 marketplaces"
            }
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            {clearing ? "Nettoyage…" : "Vider tout l'historique"}
          </button>
        </div>
      }
    >
      {/* Vue en onglets (2026-08-14) — la grille 5 colonnes devenait trop
       *  serrée. Chaque marketplace a son onglet coloré ; un seul est actif
       *  à la fois. L'onglet actif reçoit un compteur X/Y si son import
       *  tourne, un point animé si un run est en cours. */}
      <div className="h-full flex flex-col min-h-0">
        {/* Tab bar */}
        <div
          role="tablist"
          aria-label="Marketplaces"
          className="flex-shrink-0 border-b border-slate-200 bg-white overflow-x-auto"
        >
          <div className="flex items-stretch min-w-max">
            {TABS.map((tab) => {
              const badge = tabBadges[tab.key];
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative flex items-center gap-2.5 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    isActive
                      ? `${tab.activeText} ${tab.activeBg} border-transparent`
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-transparent"
                  }`}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0"
                    style={{ background: tab.gradient }}
                  >
                    {tab.letter}
                  </span>
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {badge.running && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tabular-nums">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      {badge.counter}
                    </span>
                  )}
                  {isActive && (
                    <span
                      className={`absolute inset-x-0 bottom-0 h-0.5 ${tab.accent} rounded-t`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Colonne unique — le marketplace actif prend toute la largeur */}
        <div className="flex-1 min-h-0 overflow-hidden p-5">
          <div className="h-full min-h-0">
            {activeTab === "PFS" && (
              <MarketplaceColumn accentBar="bg-indigo-500">
                <PfsSection
                  state={pfsState}
                  onStateChange={setPfsState}
                  now={now}
                  manualSync={manualSyncs.PFS?.target === "orders" ? manualSyncs.PFS : null}
                  onDismissManualSync={() => clearManualSync("PFS", "orders")}
                />
              </MarketplaceColumn>
            )}
            {activeTab === "ANKORSTORE" && (
              <MarketplaceColumn accentBar="bg-sky-500">
                <AnkorstoreSection
                  state={ankorstoreState}
                  onStateChange={setAnkorstoreState}
                  now={now}
                  manualSync={manualSyncs.ANKORSTORE?.target === "orders" ? manualSyncs.ANKORSTORE : null}
                  onDismissManualSync={() => clearManualSync("ANKORSTORE", "orders")}
                />
              </MarketplaceColumn>
            )}
            {activeTab === "EFASHION" && (
              <MarketplaceColumn accentBar="bg-rose-500">
                <EfashionSection
                  state={efState}
                  onStateChange={setEfState}
                  now={now}
                  manualSync={manualSyncs.EFASHION?.target === "orders" ? manualSyncs.EFASHION : null}
                  onDismissManualSync={() => clearManualSync("EFASHION", "orders")}
                />
              </MarketplaceColumn>
            )}
            {activeTab === "FAIRE" && (
              <MarketplaceColumn accentBar="bg-amber-500">
                <FaireSection
                  state={faireState}
                  onStateChange={setFaireState}
                  now={now}
                  manualSync={manualSyncs.FAIRE?.target === "orders" ? manualSyncs.FAIRE : null}
                  onDismissManualSync={() => clearManualSync("FAIRE", "orders")}
                />
              </MarketplaceColumn>
            )}
            {activeTab === "MICROSTORE" && (
              <MarketplaceColumn accentBar="bg-cyan-500">
                <MicrostoreSection
                  state={microstoreState}
                  onStateChange={setMicrostoreState}
                  now={now}
                  manualSync={manualSyncs.MICROSTORE?.target === "orders" ? manualSyncs.MICROSTORE : null}
                  onDismissManualSync={() => clearManualSync("MICROSTORE", "orders")}
                />
              </MarketplaceColumn>
            )}
          </div>
        </div>
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────
// Enveloppe d'une colonne marketplace : bord + fond, un seul enfant plein.
// ─────────────────────────────────────────────
function MarketplaceColumn({
  accentBar,
  children,
}: {
  accentBar: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden flex flex-col shadow-sm min-h-0 h-full">
      {/* Fine barre colorée en haut pour identifier le marketplace au coup d'œil */}
      <div className={`h-1.5 ${accentBar} flex-shrink-0`} />
      <div className="flex flex-col divide-y divide-slate-100 flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Bloc PFS
// ─────────────────────────────────────────────

const PFS_META = {
  name: "Paris Fashion Shop",
  letter: "P",
  gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
  barGrad: "linear-gradient(90deg,#4f46e5,#6366f1)",
  chipBg: "bg-indigo-50/40",
  chipRing: "border-indigo-100",
  chipText: "text-indigo-700",
  chipDot: "bg-indigo-500",
  actionBtn: "bg-indigo-600 hover:bg-indigo-700",
  actionLink: "text-indigo-700 hover:text-indigo-800",
};

function PfsSection({
  state,
  onStateChange,
  now,
  manualSync,
  onDismissManualSync,
}: {
  state: PfsImportState | null;
  onStateChange: (s: PfsImportState) => void;
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Drip d'événements
  const [displayed, setDisplayed] = useState<PfsImportRecentEvent[]>([]);
  const pendingRef = useRef<PfsImportRecentEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!state) return;
    const chronological = [...state.recentEvents].reverse();
    for (const ev of chronological) {
      const k = `${ev.orderNumber}-${ev.at}-${ev.result}`;
      if (seenRef.current.has(k)) continue;
      seenRef.current.add(k);
      pendingRef.current.push(ev);
    }
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      const batch = pending.length > 20 ? 3 : pending.length > 8 ? 2 : 1;
      const flushed = pending.splice(0, batch);
      setDisplayed((prev) =>
        [...flushed.reverse(), ...prev].slice(0, DISPLAYED_EVENTS_MAX),
      );
    }, EVENT_DRIP_MS);
    return () => clearInterval(t);
  }, []);

  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      pendingRef.current = [];
      seenRef.current = new Set();
      setDisplayed([]);
      const next = await startPfsHistoricalImport();
      onStateChange(next);
    } finally {
      setStarting(false);
    }
  }, [onStateChange]);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopPfsHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAck = useCallback(async () => {
    await acknowledgePfsHistoricalImport();
    const s = await getPfsImportStateAction();
    onStateChange(s);
    pendingRef.current = [];
    seenRef.current = new Set();
    setDisplayed([]);
  }, [onStateChange]);

  return (
    <SourceSection
      state={state}
      meta={PFS_META}
      starting={starting}
      stopping={stopping}
      onStart={onStart}
      onStop={onStop}
      onAck={onAck}
      pending={pendingRef.current.length}
      events={displayed.map((ev) => ({
        key: `${ev.orderNumber}-${ev.at}-${ev.result}`,
        orderNumber: ev.orderNumber,
        customerName: ev.customerName,
        result: ev.result,
        amount: ev.totalTTC,
        errorMessage: ev.errorMessage,
        at: ev.at,
      }))}
      currentOrders={
        state?.currentOrders.map((c) => ({
          key: c.pfsOrderId,
          orderNumber: c.orderNumber,
          customerName: c.customerName,
          country: c.country,
          amount: c.totalTTC,
        })) ?? []
      }
      now={now}
      manualSync={manualSync}
      onDismissManualSync={onDismissManualSync}
    />
  );
}

// ─────────────────────────────────────────────
// Bloc eFashion
// ─────────────────────────────────────────────

const EFASHION_META = {
  name: "eFashion Paris",
  letter: "E",
  gradient: "linear-gradient(135deg,#db2777,#ec4899)",
  barGrad: "linear-gradient(90deg,#db2777,#ec4899)",
  chipBg: "bg-rose-50/40",
  chipRing: "border-rose-100",
  chipText: "text-rose-700",
  chipDot: "bg-rose-500",
  actionBtn: "bg-rose-600 hover:bg-rose-700",
  actionLink: "text-rose-700 hover:text-rose-800",
};

function EfashionSection({
  state,
  onStateChange,
  now,
  manualSync,
  onDismissManualSync,
}: {
  state: EfashionImportState | null;
  onStateChange: (s: EfashionImportState) => void;
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [displayed, setDisplayed] = useState<EfashionImportRecentEvent[]>([]);
  const pendingRef = useRef<EfashionImportRecentEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!state) return;
    const chronological = [...state.recentEvents].reverse();
    for (const ev of chronological) {
      const k = `${ev.orderNumber}-${ev.at}-${ev.result}`;
      if (seenRef.current.has(k)) continue;
      seenRef.current.add(k);
      pendingRef.current.push(ev);
    }
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      const batch = pending.length > 20 ? 3 : pending.length > 8 ? 2 : 1;
      const flushed = pending.splice(0, batch);
      setDisplayed((prev) =>
        [...flushed.reverse(), ...prev].slice(0, DISPLAYED_EVENTS_MAX),
      );
    }, EVENT_DRIP_MS);
    return () => clearInterval(t);
  }, []);

  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      pendingRef.current = [];
      seenRef.current = new Set();
      setDisplayed([]);
      const next = await startEfashionHistoricalImport();
      onStateChange(next);
    } finally {
      setStarting(false);
    }
  }, [onStateChange]);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopEfashionHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAck = useCallback(async () => {
    await acknowledgeEfashionHistoricalImport();
    const s = await getEfashionImportStateAction();
    onStateChange(s);
    pendingRef.current = [];
    seenRef.current = new Set();
    setDisplayed([]);
  }, [onStateChange]);

  return (
    <SourceSection
      state={state}
      meta={EFASHION_META}
      starting={starting}
      stopping={stopping}
      onStart={onStart}
      onStop={onStop}
      onAck={onAck}
      pending={pendingRef.current.length}
      events={displayed.map((ev) => ({
        key: `${ev.orderNumber}-${ev.at}-${ev.result}`,
        orderNumber: ev.orderNumber,
        customerName: ev.customerName,
        result: ev.result,
        amount: ev.totalHT,
        errorMessage: ev.errorMessage,
        at: ev.at,
      }))}
      currentOrders={
        state?.currentOrders.map((c) => ({
          key: c.efashionOrderId,
          orderNumber: c.orderNumber,
          customerName: c.customerName,
          country: c.country,
          amount: c.totalHT,
        })) ?? []
      }
      now={now}
      manualSync={manualSync}
      onDismissManualSync={onDismissManualSync}
    />
  );
}

// ─────────────────────────────────────────────
// Bloc Ankorstore
// ─────────────────────────────────────────────

const ANKORSTORE_META = {
  name: "Ankorstore",
  letter: "A",
  gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  barGrad: "linear-gradient(90deg,#0ea5e9,#38bdf8)",
  chipBg: "bg-sky-50/40",
  chipRing: "border-sky-100",
  chipText: "text-sky-700",
  chipDot: "bg-sky-500",
  actionBtn: "bg-sky-500 hover:bg-sky-600",
  actionLink: "text-sky-700 hover:text-sky-800",
};

function AnkorstoreSection({
  state,
  onStateChange,
  now,
  manualSync,
  onDismissManualSync,
}: {
  state: AnkorstoreImportState | null;
  onStateChange: (s: AnkorstoreImportState) => void;
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [displayed, setDisplayed] = useState<AnkorstoreImportRecentEvent[]>([]);
  const pendingRef = useRef<AnkorstoreImportRecentEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!state) return;
    const chronological = [...state.recentEvents].reverse();
    for (const ev of chronological) {
      const k = `${ev.reference}-${ev.at}-${ev.result}`;
      if (seenRef.current.has(k)) continue;
      seenRef.current.add(k);
      pendingRef.current.push(ev);
    }
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      const batch = pending.length > 20 ? 3 : pending.length > 8 ? 2 : 1;
      const flushed = pending.splice(0, batch);
      setDisplayed((prev) =>
        [...flushed.reverse(), ...prev].slice(0, DISPLAYED_EVENTS_MAX),
      );
    }, EVENT_DRIP_MS);
    return () => clearInterval(t);
  }, []);

  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      pendingRef.current = [];
      seenRef.current = new Set();
      setDisplayed([]);
      const next = await startAnkorstoreHistoricalImport();
      onStateChange(next);
    } finally {
      setStarting(false);
    }
  }, [onStateChange]);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopAnkorstoreHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAck = useCallback(async () => {
    await acknowledgeAnkorstoreHistoricalImport();
    const s = await getAnkorstoreImportStateAction();
    onStateChange(s);
    pendingRef.current = [];
    seenRef.current = new Set();
    setDisplayed([]);
  }, [onStateChange]);

  return (
    <SourceSection
      state={state}
      meta={ANKORSTORE_META}
      starting={starting}
      stopping={stopping}
      onStart={onStart}
      onStop={onStop}
      onAck={onAck}
      pending={pendingRef.current.length}
      events={displayed.map((ev) => ({
        key: `${ev.reference}-${ev.at}-${ev.result}`,
        orderNumber: ev.reference,
        customerName: ev.customerName,
        result: ev.result,
        amount: ev.totalHT,
        errorMessage: ev.errorMessage,
        at: ev.at,
      }))}
      currentOrders={
        state?.currentOrders.map((c) => ({
          key: c.uuid,
          orderNumber: c.reference,
          customerName: c.customerName,
          country: c.country,
          amount: c.totalHT,
        })) ?? []
      }
      now={now}
      manualSync={manualSync}
      onDismissManualSync={onDismissManualSync}
    />
  );
}

// ─────────────────────────────────────────────
// Bloc Faire
// ─────────────────────────────────────────────

const FAIRE_META = {
  name: "Faire",
  letter: "F",
  gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  barGrad: "linear-gradient(90deg,#f59e0b,#fbbf24)",
  chipBg: "bg-amber-50/40",
  chipRing: "border-amber-100",
  chipText: "text-amber-700",
  chipDot: "bg-amber-500",
  actionBtn: "bg-amber-500 hover:bg-amber-600",
  actionLink: "text-amber-700 hover:text-amber-800",
};

function FaireSection({
  state,
  onStateChange,
  now,
  manualSync,
  onDismissManualSync,
}: {
  state: FaireImportState | null;
  onStateChange: (s: FaireImportState) => void;
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [displayed, setDisplayed] = useState<FaireImportRecentEvent[]>([]);
  const pendingRef = useRef<FaireImportRecentEvent[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!state) return;
    const chronological = [...state.recentEvents].reverse();
    for (const ev of chronological) {
      const k = `${ev.orderNumber}-${ev.at}-${ev.result}`;
      if (seenRef.current.has(k)) continue;
      seenRef.current.add(k);
      pendingRef.current.push(ev);
    }
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      const batch = pending.length > 20 ? 3 : pending.length > 8 ? 2 : 1;
      const flushed = pending.splice(0, batch);
      setDisplayed((prev) =>
        [...flushed.reverse(), ...prev].slice(0, DISPLAYED_EVENTS_MAX),
      );
    }, EVENT_DRIP_MS);
    return () => clearInterval(t);
  }, []);

  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      pendingRef.current = [];
      seenRef.current = new Set();
      setDisplayed([]);
      const next = await startFaireHistoricalImport();
      onStateChange(next);
    } finally {
      setStarting(false);
    }
  }, [onStateChange]);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopFaireHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAck = useCallback(async () => {
    await acknowledgeFaireHistoricalImport();
    const s = await getFaireImportStateAction();
    onStateChange(s);
    pendingRef.current = [];
    seenRef.current = new Set();
    setDisplayed([]);
  }, [onStateChange]);

  return (
    <SourceSection
      state={state}
      meta={FAIRE_META}
      starting={starting}
      stopping={stopping}
      onStart={onStart}
      onStop={onStop}
      onAck={onAck}
      pending={pendingRef.current.length}
      events={displayed.map((ev) => ({
        key: `${ev.orderNumber}-${ev.at}-${ev.result}`,
        orderNumber: ev.orderNumber,
        customerName: ev.customerName,
        result: ev.result,
        amount: ev.totalHT,
        errorMessage: ev.errorMessage,
        at: ev.at,
      }))}
      currentOrders={
        state?.currentOrders.map((c) => ({
          key: c.faireOrderId,
          orderNumber: c.displayId,
          customerName: c.customerName,
          country: c.country,
          amount: c.totalHT,
        })) ?? []
      }
      now={now}
      manualSync={manualSync}
      onDismissManualSync={onDismissManualSync}
    />
  );
}

// ─────────────────────────────────────────────
// Bloc Microstore
// ─────────────────────────────────────────────

const MICROSTORE_META = {
  name: "Microstore",
  letter: "M",
  gradient: "linear-gradient(135deg,#0891b2,#22d3ee)",
  barGrad: "linear-gradient(90deg,#0891b2,#22d3ee)",
  chipBg: "bg-cyan-50/40",
  chipRing: "border-cyan-100",
  chipText: "text-cyan-700",
  chipDot: "bg-cyan-500",
  actionBtn: "bg-cyan-500 hover:bg-cyan-600",
  actionLink: "text-cyan-700 hover:text-cyan-800",
};

/**
 * Version compacte de la colonne Microstore — remplace la vue « journal +
 * commandes en cours + liste clients » des autres marketplaces par 2 simples
 * compteurs (clients puis commandes), affichés séquentiellement selon la
 * phase du rattrapage.
 *
 * Rationale (demande cliente 2026-07-31) : Microstore fait 2 passes claires
 * (clients complets d'abord, commandes ensuite) et le détail des events
 * n'apporte rien à la cliente. Un `X / total` en chargement suffit.
 */
function MicrostoreSection({
  state,
  onStateChange,
  now: _now,
  manualSync: _manualSync,
  onDismissManualSync: _onDismissManualSync,
}: {
  state: MicrostoreImportState | null;
  onStateChange: (s: MicrostoreImportState) => void;
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      const next = await startMicrostoreHistoricalImport();
      onStateChange(next);
    } finally {
      setStarting(false);
    }
  }, [onStateChange]);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopMicrostoreHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAck = useCallback(async () => {
    await acknowledgeMicrostoreHistoricalImport();
    const s = await getMicrostoreImportStateAction();
    onStateChange(s);
  }, [onStateChange]);

  const isRunning = state?.status === "RUNNING";
  const isDone = state?.status === "DONE";
  const isError = state?.status === "ERROR";
  const isStopped = state?.status === "STOPPED";
  const showFinal = isDone || isError || isStopped;

  const customersDone = (state?.customersProcessed ?? 0) >= (state?.customersTotal ?? 0)
    && (state?.customersTotal ?? 0) > 0;

  return (
    <div className="flex-1 basis-0 min-h-0 flex flex-col overflow-hidden">
      {/* Header source */}
      <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-100 flex-shrink-0">
        <span
          className="w-11 h-11 rounded-xl text-white font-heading font-bold text-lg flex items-center justify-center shadow-sm shrink-0"
          style={{ background: MICROSTORE_META.gradient }}
        >
          {MICROSTORE_META.letter}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-slate-900 truncate">
            {MICROSTORE_META.name}
          </p>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {isRunning
              ? state?.phase === "CUSTOMERS"
                ? "Import des clients…"
                : "Import des commandes…"
              : isDone
              ? "Import terminé"
              : isStopped
              ? "Import annulé"
              : isError
              ? "Erreur d'import"
              : "En attente"}
          </p>
        </div>
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="text-sm font-semibold rounded-lg px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 shrink-0"
          >
            {stopping ? "Annulation…" : "Annuler"}
          </button>
        ) : showFinal ? (
          <button
            type="button"
            onClick={onAck}
            className={`text-sm font-semibold rounded-lg px-3.5 py-2 text-white shrink-0 ${MICROSTORE_META.actionBtn}`}
          >
            Fermer récap
          </button>
        ) : null}
      </div>

      {/* Corps — soit IDLE (grand bouton), soit 2 compteurs empilés. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col p-5 gap-4">
        {!state ? (
          <div className="text-center text-sm text-slate-500 py-10">Chargement…</div>
        ) : state.status === "IDLE" ? (
          <div className="text-center py-8">
            <div
              className="mx-auto w-20 h-20 rounded-full flex items-center justify-center text-white font-heading font-bold text-3xl shadow-lg"
              style={{ background: MICROSTORE_META.gradient }}
            >
              {MICROSTORE_META.letter}
            </div>
            <p className="mt-4 text-lg font-semibold text-slate-900">
              Aucun import en cours
            </p>
            <p className="mt-2 text-sm text-slate-500 max-w-xs mx-auto leading-relaxed">
              Rattrapage historique complet Microstore — d&apos;abord tous les
              clients, puis toutes les commandes.
            </p>
            <button
              type="button"
              onClick={onStart}
              disabled={starting}
              className={`mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-50 ${MICROSTORE_META.actionBtn}`}
            >
              {starting ? "Démarrage…" : "Importer clients + commandes"}
            </button>
          </div>
        ) : (
          <>
            <MicrostoreCounter
              label="Clients"
              processed={state.customersProcessed ?? 0}
              total={state.customersTotal ?? 0}
              active={isRunning && state.phase === "CUSTOMERS"}
              done={customersDone || (state.phase === "ORDERS" || showFinal)}
              meta={MICROSTORE_META}
            />
            <MicrostoreCounter
              label="Commandes"
              processed={state.processedOrders ?? 0}
              total={state.totalOrders ?? 0}
              active={isRunning && state.phase === "ORDERS"}
              done={showFinal && !isError && !isStopped}
              meta={MICROSTORE_META}
              // Le total commandes n'est pas connu à l'avance — grimpe au fil des chunks
              totalIsGrowing
            />
            {isError && state.errorMessage && (
              <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {state.errorMessage}
              </p>
            )}
            {isStopped && (
              <p className="text-sm text-slate-600">
                Import interrompu. Les données déjà importées sont conservées.
              </p>
            )}
            {showFinal && (
              <button
                type="button"
                onClick={onStart}
                disabled={starting}
                className={`text-sm font-medium underline underline-offset-2 self-start ${MICROSTORE_META.actionLink}`}
              >
                Relancer un import
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Compteur d'une phase (clients ou commandes) — grosse valeur + barre de
 * progression + libellé d'état. Une seule phase est « active » à la fois
 * (spinner + halo). L'autre est soit `done` (coche verte) soit `pending`
 * (grisée).
 */
function MicrostoreCounter({
  label,
  processed,
  total,
  active,
  done,
  meta,
  totalIsGrowing = false,
}: {
  label: string;
  processed: number;
  total: number;
  active: boolean;
  done: boolean;
  meta: typeof MICROSTORE_META;
  totalIsGrowing?: boolean;
}) {
  const hasTotal = total > 0;
  const percent = hasTotal ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const state: "active" | "done" | "pending" = active ? "active" : done ? "done" : "pending";
  const tone =
    state === "active"
      ? `${meta.chipBg} border ${meta.chipRing}`
      : state === "done"
      ? "bg-emerald-50/60 border border-emerald-100"
      : "bg-slate-50 border border-slate-100";
  const labelColor =
    state === "active" ? meta.chipText : state === "done" ? "text-emerald-700" : "text-slate-500";
  const valueColor =
    state === "active" ? "text-slate-900" : state === "done" ? "text-emerald-800" : "text-slate-400";

  return (
    <div className={`rounded-2xl px-4 py-4 ${tone}`}>
      <div className="flex items-center gap-2">
        <span
          className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${labelColor}`}
        >
          {label}
        </span>
        {state === "active" && (
          <span
            className={`inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin ${meta.chipDot.replace("bg-", "border-")}`}
          />
        )}
        {state === "done" && (
          <svg
            className="w-4 h-4 text-emerald-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5 tabular-nums">
        <p className={`font-heading font-bold text-3xl leading-none ${valueColor}`}>
          {processed}
        </p>
        {hasTotal && (
          <p className={`text-lg font-semibold ${valueColor} opacity-70`}>
            / {total}
            {totalIsGrowing && active && (
              <span className="text-xs font-normal text-slate-400 ml-1">
                (grimpe…)
              </span>
            )}
          </p>
        )}
        {!hasTotal && state === "pending" && (
          <span className="text-sm text-slate-400">— en attente</span>
        )}
      </div>
      <div className="mt-2 h-2 bg-white/70 rounded-full overflow-hidden">
        {hasTotal ? (
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${percent}%`,
              background: state === "done"
                ? "linear-gradient(90deg,#10b981,#34d399)"
                : meta.barGrad,
            }}
          />
        ) : active ? (
          <div
            className="h-full w-1/3"
            style={{
              background: meta.barGrad,
              animation: "ordersIndeterminate 1.4s ease-in-out infinite",
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Section commune — layout identique pour les 5 sources
// ─────────────────────────────────────────────

type CommonState =
  | PfsImportState
  | EfashionImportState
  | FaireImportState
  | MicrostoreImportState
  | AnkorstoreImportState;

interface SectionMeta {
  name: string;
  letter: string;
  gradient: string;
  barGrad: string;
  chipBg: string;
  chipRing: string;
  chipText: string;
  chipDot: string;
  actionBtn: string;
  actionLink: string;
}

interface CurrentOrder {
  key: string;
  orderNumber: string;
  customerName: string;
  country: string | null;
  amount: number | null;
}

interface EventItem {
  key: string;
  orderNumber: string;
  customerName: string;
  result: "imported" | "unchanged" | "error";
  amount: number | null;
  errorMessage?: string;
  at: number;
}

function SourceSection({
  state,
  meta,
  starting,
  stopping,
  onStart,
  onStop,
  onAck,
  pending,
  events,
  currentOrders,
  now,
  manualSync,
  onDismissManualSync,
}: {
  state: CommonState | null;
  meta: SectionMeta;
  starting: boolean;
  stopping: boolean;
  onStart: () => void;
  onStop: () => void;
  onAck: () => void;
  pending: number;
  events: EventItem[];
  currentOrders: CurrentOrder[];
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const isRunning = state?.status === "RUNNING";
  const isDone = state?.status === "DONE";
  const isError = state?.status === "ERROR";
  const isStopped = state?.status === "STOPPED";
  const showFinal = isDone || isError || isStopped;
  // Faire n'a pas de totalOrders connu tant que l'import boucle sur le curseur.
  const totalOrders = state?.totalOrders ?? null;
  const percent =
    state && typeof totalOrders === "number" && totalOrders > 0
      ? Math.min(100, Math.round((state.processedOrders / totalOrders) * 100))
      : 0;
  const hasTotalPages =
    state && "totalPages" in state && typeof (state as { totalPages?: number }).totalPages === "number";

  return (
    // Répartition ~60/40 avec la carte Clients en dessous : la partie
    // « Commandes » a besoin d'un peu plus de place (progression + commandes
    // en cours + récap + journal).
    <div className="flex-[3] basis-0 min-h-0 flex flex-col overflow-hidden">
      {/* Header source */}
      <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-100 flex-shrink-0">
        <span
          className="w-11 h-11 rounded-xl text-white font-heading font-bold text-lg flex items-center justify-center shadow-sm shrink-0"
          style={{ background: meta.gradient }}
        >
          {meta.letter}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-slate-900 truncate">{meta.name}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {isRunning
              ? hasTotalPages
                ? `Page ${state?.currentPage ?? "?"} / ${(state as { totalPages?: number }).totalPages ?? "?"}`
                : `Page ${state?.currentPage ?? "?"}`
              : isDone
              ? "Import terminé"
              : isStopped
              ? "Import annulé"
              : isError
              ? "Erreur d'import"
              : "En attente"}
          </p>
        </div>
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="text-sm font-semibold rounded-lg px-3.5 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 shrink-0"
          >
            {stopping ? "Annulation…" : "Annuler"}
          </button>
        ) : showFinal ? (
          <button
            type="button"
            onClick={onAck}
            className={`text-sm font-semibold rounded-lg px-3.5 py-2 text-white shrink-0 ${meta.actionBtn}`}
          >
            Fermer récap
          </button>
        ) : null}
      </div>

      {/* Bannière synchro manuelle — n'apparaît que si la cliente vient de
          cliquer sur « Synchro » dans la page Commandes → onglet marketplace.
          Les synchros auto (workers, cron) n'affichent rien ici. */}
      {manualSync && (
        <ManualSyncBanner
          event={manualSync}
          meta={meta}
          now={now}
          onDismiss={onDismissManualSync}
        />
      )}

      {/* Contenu selon état — scrollable pour que rien ne soit tronqué quand
          progression + commandes en cours + récap + journal s'empilent dans la
          moitié haute (partagée 50/50 avec la carte Clients). */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {!state ? (
        <div className="px-4 py-6 text-center text-sm text-slate-500">Chargement…</div>
      ) : state.status === "IDLE" ? (
        <IdleView meta={meta} onStart={onStart} starting={starting} />
      ) : (
        <>
          {/* Progression */}
          {isRunning && (
            <div className="px-5 py-4 bg-white border-b border-slate-100">
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                {totalOrders != null ? (
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${percent}%`, background: meta.barGrad }}
                  />
                ) : (
                  // Faire : total inconnu → barre indéterminée qui slide
                  <div
                    className="h-full w-1/3"
                    style={{
                      background: meta.barGrad,
                      animation: "ordersIndeterminate 1.4s ease-in-out infinite",
                    }}
                  />
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500 tabular-nums">
                <span>{totalOrders != null ? `${percent} %` : "en cours…"}</span>
                <span>
                  {state.processedOrders}
                  {totalOrders != null ? ` / ${totalOrders}` : ""}
                </span>
              </div>
              <style jsx>{`
                @keyframes ordersIndeterminate {
                  0% {
                    transform: translateX(-100%);
                  }
                  100% {
                    transform: translateX(300%);
                  }
                }
              `}</style>
            </div>
          )}

          {/* Commandes en cours */}
          {isRunning && currentOrders.length > 0 && (
            <div className={`px-5 py-4 ${meta.chipBg} border-b border-slate-100`}>
              <div className="flex items-center justify-between">
                <p
                  className={`text-[11px] uppercase tracking-[0.18em] font-semibold ${meta.chipText}`}
                >
                  En cours d&apos;import
                </p>
                <span className={`text-[11px] font-medium ${meta.chipText}`}>
                  {currentOrders.length} en parallèle
                </span>
              </div>
              <div className="mt-2.5 space-y-2">
                {currentOrders.slice(0, CURRENT_ORDERS_MAX).map((c) => (
                  <div
                    key={c.key}
                    className={`rounded-lg border bg-white px-3 py-2 flex items-center gap-2.5 ${meta.chipRing}`}
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0 ${meta.chipDot}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {c.orderNumber}
                      </p>
                      <p className="text-xs text-slate-600 truncate mt-0.5">
                        {c.customerName}
                        {c.country ? ` · ${c.country}` : ""}
                      </p>
                    </div>
                    {c.amount != null && (
                      <p className="text-xs font-medium text-slate-700 tabular-nums flex-shrink-0">
                        {formatMoney(c.amount)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Récap final */}
          {showFinal && (
            <div className="px-5 py-4 border-b border-slate-100 bg-white">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
                Résultat
              </p>
              <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                <StatCard
                  color="emerald"
                  value={state.imported}
                  label="nouvelle commande importée"
                  labelPlural="nouvelles commandes importées"
                />
                <StatCard
                  color="slate"
                  value={state.unchanged}
                  label="déjà à jour"
                  labelPlural="déjà à jour"
                />
                <StatCard
                  color="rose"
                  value={state.skipped}
                  label="commande ignorée"
                  labelPlural="commandes ignorées"
                />
              </div>
              {isError && state.errorMessage && (
                <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {state.errorMessage}
                </p>
              )}
              {isStopped && (
                <p className="mt-3 text-sm text-slate-600">
                  Import interrompu. Les commandes déjà importées ont été conservées.
                </p>
              )}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onStart}
                  disabled={starting}
                  className={`text-sm font-medium underline underline-offset-2 ${meta.actionLink}`}
                >
                  Relancer un import
                </button>
              </div>
            </div>
          )}

          {/* Journal — capé à DISPLAYED_EVENTS_MAX pour rester compact.
              Pas de min-h-0/overflow ici : le parent gère déjà le scroll de
              tout le contenu de la moitié haute. */}
          <div className="px-5 py-4 flex flex-col flex-shrink-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
                Journal
              </p>
              {pending > 0 && (
                <span className="text-xs text-slate-400">
                  {pending} en attente
                </span>
              )}
            </div>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Aucune commande traitée pour le moment.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {events.slice(0, DISPLAYED_EVENTS_MAX).map((ev) => (
                  <EventRow key={ev.key} event={ev} now={now} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sous-composants partagés
// ─────────────────────────────────────────────

function IdleView({
  meta,
  onStart,
  starting,
}: {
  meta: SectionMeta;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <div className="p-8 text-center">
      <div
        className="mx-auto w-20 h-20 rounded-full flex items-center justify-center text-white font-heading font-bold text-3xl shadow-lg"
        style={{ background: meta.gradient }}
      >
        {meta.letter}
      </div>
      <p className="mt-4 text-lg font-semibold text-slate-900">Aucun import en cours</p>
      <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto leading-relaxed">
        Rattrapage historique complet {meta.name} — commandes et fiches clients importées ensemble. Vous pouvez continuer à travailler pendant l&apos;import.
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className={`mt-5 inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-50 ${meta.actionBtn}`}
      >
        {starting ? "Démarrage…" : `Importer commandes + clients ${meta.name}`}
      </button>
    </div>
  );
}

function StatCard({
  color,
  value,
  label,
  labelPlural,
}: {
  color: "emerald" | "slate" | "rose";
  value: number;
  label: string;
  labelPlural: string;
}) {
  const styles = {
    emerald: {
      bg: "bg-emerald-50",
      border: "border-emerald-100",
      text: "text-emerald-700",
    },
    slate: {
      bg: "bg-slate-50",
      border: "border-slate-200",
      text: "text-slate-700",
    },
    rose: {
      bg: "bg-rose-50",
      border: "border-rose-100",
      text: "text-rose-700",
    },
  }[color];
  return (
    <div className={`rounded-xl border ${styles.border} ${styles.bg} px-3 py-2.5`}>
      <p className={`text-2xl font-heading font-bold tabular-nums leading-tight ${styles.text}`}>{value}</p>
      <p className="text-[11px] text-slate-600 leading-tight mt-1">
        {value > 1 ? labelPlural : label}
      </p>
    </div>
  );
}

function EventRow({ event, now }: { event: EventItem; now: number }) {
  const badge =
    event.result === "imported"
      ? { text: "Importée", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" }
      : event.result === "unchanged"
      ? { text: "Déjà à jour", cls: "bg-slate-100 text-slate-600 ring-slate-200" }
      : { text: "Erreur", cls: "bg-rose-100 text-rose-700 ring-rose-200" };
  return (
    <li
      className="rounded-lg border border-slate-100 bg-white px-3 py-2 flex items-center gap-2.5"
      style={{ animation: "ordersEventIn 260ms cubic-bezier(.16,1,.3,1) both" }}
    >
      <span
        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ring-1 ${badge.cls} flex-shrink-0`}
      >
        {badge.text}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{event.orderNumber}</p>
        <p className="text-xs text-slate-500 truncate mt-0.5">{event.customerName}</p>
        {event.result === "error" && event.errorMessage && (
          <p className="text-[11px] text-rose-600 truncate mt-0.5">{event.errorMessage}</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        {event.amount != null && (
          <p className="text-xs font-medium text-slate-700 tabular-nums">
            {formatMoney(event.amount)}
          </p>
        )}
        <p className="text-[11px] text-slate-400 tabular-nums mt-0.5">{formatRelative(event.at, now)}</p>
      </div>
      <style jsx>{`
        @keyframes ordersEventIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </li>
  );
}

/**
 * Petite bannière au-dessus d'une section, affichée après un clic manuel sur
 * « Synchro » depuis la page Commandes → onglet marketplace. Trois états :
 *  - starting : spinner + « Synchronisation en cours… »
 *  - success  : compteur créées / mises à jour + relatif « il y a Xs »
 *  - error    : message d'erreur (ou « session expirée » pour Microstore)
 */

// ─────────────────────────────────────────────
// ManualSyncBanner — bandeau haut de carte commande (bloc 1)
// ─────────────────────────────────────────────

function ManualSyncBanner({
  event,
  meta,
  now,
  onDismiss,
}: {
  event: ManualSyncEvent;
  meta: SectionMeta;
  now: number;
  onDismiss: () => void;
}) {
  const isStarting = event.phase === "starting";
  const isSuccess = event.phase === "success";
  const isError = event.phase === "error";
  const targetLabel = event.target === "clients" ? "clients" : "commandes";
  const tone = isStarting
    ? `${meta.chipBg} border-b ${meta.chipRing} ${meta.chipText}`
    : isSuccess
    ? "bg-emerald-50/60 border-b border-emerald-100 text-emerald-800"
    : "bg-rose-50/60 border-b border-rose-100 text-rose-800";

  const total = (event.created ?? 0) + (event.updated ?? 0);
  const summary = isSuccess
    ? total === 0
      ? `Aucune nouvelle ${targetLabel}.`
      : `${event.created ?? 0} nouvelle${(event.created ?? 0) > 1 ? "s" : ""}, ${event.updated ?? 0} mise${(event.updated ?? 0) > 1 ? "s" : ""} à jour.`
    : null;

  const relative = event.endedAt ? formatRelative(event.endedAt, now) : null;

  return (
    <div className={`px-5 py-3 ${tone} flex items-start gap-3`}>
      <span className="shrink-0 mt-0.5">
        {isStarting ? (
          <span
            className={`inline-block w-4 h-4 rounded-full border-2 ${meta.chipDot.replace("bg-", "border-")} border-t-transparent animate-spin`}
          />
        ) : isSuccess ? (
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.14em]">
          {isStarting
            ? `Synchro ${targetLabel}…`
            : isSuccess
            ? `Synchro ${targetLabel} terminée`
            : event.sessionExpired
            ? "Session expirée"
            : `Synchro ${targetLabel} échouée`}
        </p>
        {summary && (
          <p className="text-sm mt-1">
            {summary}
            {relative && <span className="text-slate-500"> · {relative}</span>}
          </p>
        )}
        {isError && event.errorMessage && (
          <p className="text-sm mt-1 break-words">{event.errorMessage}</p>
        )}
      </div>
      {!isStarting && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs font-semibold underline underline-offset-2 opacity-70 hover:opacity-100"
        >
          Fermer
        </button>
      )}
    </div>
  );
}
