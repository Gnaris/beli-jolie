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
  acknowledgeAnkorstoreHistoricalImport,
  getAnkorstoreImportStateAction,
  startAnkorstoreHistoricalImport,
  stopAnkorstoreHistoricalImport,
  type AnkorstoreImportState,
  type AnkorstoreImportRecentEvent,
} from "@/app/actions/admin/ankorstore-orders";
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
  type MicrostoreImportRecentEvent,
} from "@/app/actions/admin/microstore-orders";
import {
  useRightRail,
  type ManualSyncEvent,
  type ManualSyncSource,
  type RailWidgetId,
} from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";
import {
  countMarketplaceClientCards,
  getRecentMarketplaceClientCards,
  type MarketplaceClientSource,
  type RecentClientCard,
} from "@/app/actions/admin/marketplace-clients";
import { useConfirm } from "@/components/ui/ConfirmDialog";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 6000;
const EVENT_DRIP_MS = 250;
// Bas volume par colonne : le widget doit tenir dans la fenêtre sans scroll
// (5 colonnes côte à côte). On plafonne à 3 events + 2 commandes en cours.
const DISPLAYED_EVENTS_MAX = 3;
const CURRENT_ORDERS_MAX = 2;

const LEGACY_ALIASES: RailWidgetId[] = ["pfs-import", "efashion-import", "ankorstore-import"];

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
    openWidget === "efashion-import" ||
    openWidget === "ankorstore-import";

  const [pfsState, setPfsState] = useState<PfsImportState | null>(null);
  const [efState, setEfState] = useState<EfashionImportState | null>(null);
  const [ankorState, setAnkorState] = useState<AnkorstoreImportState | null>(null);
  const [faireState, setFaireState] = useState<FaireImportState | null>(null);
  const [microstoreState, setMicrostoreState] = useState<MicrostoreImportState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollPfsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollEfRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAnkorRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFaireRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollMicrostoreRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getPfsImportStateAction();
        if (cancelled) return;
        setPfsState(s);
        pollPfsRef.current = setTimeout(
          tick,
          s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
        );
      } catch {
        pollPfsRef.current = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollPfsRef.current) clearTimeout(pollPfsRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getEfashionImportStateAction();
        if (cancelled) return;
        setEfState(s);
        pollEfRef.current = setTimeout(
          tick,
          s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
        );
      } catch {
        pollEfRef.current = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollEfRef.current) clearTimeout(pollEfRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getAnkorstoreImportStateAction();
        if (cancelled) return;
        setAnkorState(s);
        pollAnkorRef.current = setTimeout(
          tick,
          s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
        );
      } catch {
        pollAnkorRef.current = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollAnkorRef.current) clearTimeout(pollAnkorRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getFaireImportStateAction();
        if (cancelled) return;
        setFaireState(s);
        pollFaireRef.current = setTimeout(
          tick,
          s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
        );
      } catch {
        pollFaireRef.current = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollFaireRef.current) clearTimeout(pollFaireRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getMicrostoreImportStateAction();
        if (cancelled) return;
        setMicrostoreState(s);
        pollMicrostoreRef.current = setTimeout(
          tick,
          s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS,
        );
      } catch {
        pollMicrostoreRef.current = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollMicrostoreRef.current) clearTimeout(pollMicrostoreRef.current);
    };
  }, []);

  useEffect(() => {
    const pfsRun = pfsState?.status === "RUNNING";
    const efRun = efState?.status === "RUNNING";
    const ankorRun = ankorState?.status === "RUNNING";
    const faireRun = faireState?.status === "RUNNING";
    const microstoreRun = microstoreState?.status === "RUNNING";
    const running = pfsRun || efRun || ankorRun || faireRun || microstoreRun;
    const remainingPfs = pfsRun
      ? Math.max(0, (pfsState?.totalOrders ?? 0) - (pfsState?.processedOrders ?? 0))
      : 0;
    const remainingEf = efRun
      ? Math.max(0, (efState?.totalOrders ?? 0) - (efState?.processedOrders ?? 0))
      : 0;
    // Ankorstore & Faire : totalOrders inconnu tant que le curseur n'est pas fini →
    // fallback sur processedOrders pour montrer l'activité.
    const remainingAnkor = ankorRun && ankorState
      ? ankorState.totalOrders != null
        ? Math.max(0, ankorState.totalOrders - ankorState.processedOrders)
        : ankorState.processedOrders
      : 0;
    const remainingFaire = faireRun && faireState
      ? faireState.totalOrders > 0
        ? Math.max(0, faireState.totalOrders - faireState.processedOrders)
        : faireState.processedOrders
      : 0;
    const remainingMicrostore = microstoreRun && microstoreState
      ? microstoreState.totalOrders > 0
        ? Math.max(0, microstoreState.totalOrders - microstoreState.processedOrders)
        : microstoreState.processedOrders
      : 0;
    setBadge("orders-import", {
      count: remainingPfs + remainingEf + remainingAnkor + remainingFaire + remainingMicrostore,
      pulse: running,
    });
    for (const legacy of LEGACY_ALIASES) setBadge(legacy, { count: 0 });
  }, [pfsState, efState, ankorState, faireState, microstoreState, setBadge]);

  const prevPfsRunRef = useRef(false);
  const prevEfRunRef = useRef(false);
  const prevAnkorRunRef = useRef(false);
  const prevFaireRunRef = useRef(false);
  const prevMicrostoreRunRef = useRef(false);
  useEffect(() => {
    const pfsRun = pfsState?.status === "RUNNING";
    if (!prevPfsRunRef.current && pfsRun) open("orders-import");
    prevPfsRunRef.current = pfsRun;
  }, [pfsState, open]);
  useEffect(() => {
    const efRun = efState?.status === "RUNNING";
    if (!prevEfRunRef.current && efRun) open("orders-import");
    prevEfRunRef.current = efRun;
  }, [efState, open]);
  useEffect(() => {
    const ankorRun = ankorState?.status === "RUNNING";
    if (!prevAnkorRunRef.current && ankorRun) open("orders-import");
    prevAnkorRunRef.current = ankorRun;
  }, [ankorState, open]);
  useEffect(() => {
    const faireRun = faireState?.status === "RUNNING";
    if (!prevFaireRunRef.current && faireRun) open("orders-import");
    prevFaireRunRef.current = faireRun;
  }, [faireState, open]);
  useEffect(() => {
    const microstoreRun = microstoreState?.status === "RUNNING";
    if (!prevMicrostoreRunRef.current && microstoreRun) open("orders-import");
    prevMicrostoreRunRef.current = microstoreRun;
  }, [microstoreState, open]);

  const anyRunning =
    pfsState?.status === "RUNNING" ||
    efState?.status === "RUNNING" ||
    ankorState?.status === "RUNNING" ||
    faireState?.status === "RUNNING" ||
    microstoreState?.status === "RUNNING";
  const title = useMemo(() => {
    if (anyRunning) {
      const parts: string[] = [];
      if (pfsState?.status === "RUNNING") {
        parts.push(`PFS ${pfsState.processedOrders}/${pfsState.totalOrders}`);
      }
      if (efState?.status === "RUNNING") {
        parts.push(`eFashion ${efState.processedOrders}/${efState.totalOrders}`);
      }
      if (ankorState?.status === "RUNNING") {
        parts.push(
          `Ankor ${ankorState.processedOrders}${ankorState.totalOrders != null ? `/${ankorState.totalOrders}` : ""}`,
        );
      }
      if (faireState?.status === "RUNNING") {
        parts.push(
          `Faire ${faireState.processedOrders}${faireState.totalOrders > 0 ? `/${faireState.totalOrders}` : ""}`,
        );
      }
      if (microstoreState?.status === "RUNNING") {
        parts.push(
          `Microstore ${microstoreState.processedOrders}${microstoreState.totalOrders > 0 ? `/${microstoreState.totalOrders}` : ""}`,
        );
      }
      return (
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          {parts.join(" · ")}
        </span>
      );
    }
    return "Import commandes / clients marketplaces";
  }, [anyRunning, pfsState, efState, ankorState, faireState, microstoreState]);

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
        acknowledgeAnkorstoreHistoricalImport(),
        acknowledgeFaireHistoricalImport(),
        acknowledgeMicrostoreHistoricalImport(),
      ]);
      const [pfs, ef, ankor, faire, micro] = await Promise.all([
        getPfsImportStateAction(),
        getEfashionImportStateAction(),
        getAnkorstoreImportStateAction(),
        getFaireImportStateAction(),
        getMicrostoreImportStateAction(),
      ]);
      setPfsState(pfs);
      setEfState(ef);
      setAnkorState(ankor);
      setFaireState(faire);
      setMicrostoreState(micro);
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
      size="wide"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            Vider l'historique ne supprime aucune commande ni fiche client déjà importée — seul l'affichage (journal, compteurs, récaps) est remis à zéro.
          </p>
          <button
            type="button"
            onClick={handleClearAllHistory}
            disabled={clearing || anyRunning}
            title={
              anyRunning
                ? "Impossible pendant qu'un import tourne"
                : "Réinitialise l'affichage des 5 marketplaces"
            }
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            {clearing ? "Nettoyage…" : "Vider tout l'historique"}
          </button>
        </div>
      }
    >
      {/* Grille responsive — hauteur du body du DrawerShell entière (pas de
       *  scroll), chaque colonne prend la même hauteur et cape ses propres
       *  enfants pour ne pas déborder. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 p-3 h-full min-h-0">
        <MarketplaceColumn accentBar="bg-indigo-500">
          <PfsSection
            state={pfsState}
            onStateChange={setPfsState}
            now={now}
            manualSync={manualSyncs.PFS}
            onDismissManualSync={() => clearManualSync("PFS", "orders")}
          />
          <ClientsRow
            source="PFS"
            refreshTick={pfsState?.processedOrders ?? 0}
            isImporting={pfsState?.status === "RUNNING"}
          />
        </MarketplaceColumn>

        <MarketplaceColumn accentBar="bg-rose-500">
          <EfashionSection
            state={efState}
            onStateChange={setEfState}
            now={now}
            manualSync={manualSyncs.EFASHION}
            onDismissManualSync={() => clearManualSync("EFASHION", "orders")}
          />
          <ClientsRow
            source="EFASHION"
            refreshTick={efState?.processedOrders ?? 0}
            isImporting={efState?.status === "RUNNING"}
          />
        </MarketplaceColumn>

        <MarketplaceColumn accentBar="bg-sky-500">
          <AnkorstoreSection
            state={ankorState}
            onStateChange={setAnkorState}
            now={now}
            manualSync={manualSyncs.ANKORSTORE}
            onDismissManualSync={() => clearManualSync("ANKORSTORE", "orders")}
          />
          <ClientsRow
            source="ANKORSTORE"
            refreshTick={ankorState?.processedOrders ?? 0}
            isImporting={ankorState?.status === "RUNNING"}
          />
        </MarketplaceColumn>

        <MarketplaceColumn accentBar="bg-amber-500">
          <FaireSection
            state={faireState}
            onStateChange={setFaireState}
            now={now}
            manualSync={manualSyncs.FAIRE}
            onDismissManualSync={() => clearManualSync("FAIRE", "orders")}
          />
          <ClientsRow
            source="FAIRE"
            refreshTick={faireState?.processedOrders ?? 0}
            isImporting={faireState?.status === "RUNNING"}
          />
        </MarketplaceColumn>

        <MarketplaceColumn accentBar="bg-cyan-500">
          <MicrostoreSection
            state={microstoreState}
            onStateChange={setMicrostoreState}
            now={now}
            manualSync={manualSyncs.MICROSTORE}
            onDismissManualSync={() => clearManualSync("MICROSTORE", "orders")}
          />
          <ClientsRow
            source="MICROSTORE"
            refreshTick={microstoreState?.processedOrders ?? 0}
            isImporting={microstoreState?.status === "RUNNING"}
          />
        </MarketplaceColumn>
      </div>
    </DrawerShell>
  );
}

// ─────────────────────────────────────────────
// Enveloppe d'une colonne marketplace : bord + fond, deux enfants
// empilés verticalement (Commandes en haut, Clients en bas).
// ─────────────────────────────────────────────
function MarketplaceColumn({
  accentBar,
  children,
}: {
  accentBar: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col shadow-sm min-h-0 h-full">
      {/* Fine barre colorée en haut pour identifier le marketplace au coup d'œil */}
      <div className={`h-1 ${accentBar} flex-shrink-0`} />
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
  actionBtn: "bg-sky-600 hover:bg-sky-700",
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
        amount: ev.totalTTC,
        errorMessage: ev.errorMessage,
        at: ev.at,
      }))}
      currentOrders={
        state?.currentOrders.map((c) => ({
          key: c.ankorstoreOrderId,
          orderNumber: c.reference,
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

function MicrostoreSection({
  state,
  onStateChange,
  now,
  manualSync,
  onDismissManualSync,
}: {
  state: MicrostoreImportState | null;
  onStateChange: (s: MicrostoreImportState) => void;
  now: number;
  manualSync: ManualSyncEvent | null;
  onDismissManualSync: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [displayed, setDisplayed] = useState<MicrostoreImportRecentEvent[]>([]);
  const pendingRef = useRef<MicrostoreImportRecentEvent[]>([]);
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
    pendingRef.current = [];
    seenRef.current = new Set();
    setDisplayed([]);
  }, [onStateChange]);

  return (
    <SourceSection
      state={state}
      meta={MICROSTORE_META}
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
          key: c.microstoreOrderId,
          orderNumber: c.microstoreOrderId,
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
// Section commune — layout identique pour les 5 sources
// ─────────────────────────────────────────────

type CommonState =
  | PfsImportState
  | EfashionImportState
  | AnkorstoreImportState
  | FaireImportState
  | MicrostoreImportState;

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
  // Ankorstore n'a pas de totalOrders connu tant que l'import boucle sur le curseur.
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
      <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-100 flex-shrink-0">
        <span
          className="w-8 h-8 rounded-lg text-white font-heading font-bold text-sm flex items-center justify-center shadow-sm shrink-0"
          style={{ background: meta.gradient }}
        >
          {meta.letter}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{meta.name}</p>
          <p className="text-[11px] text-slate-500 truncate">
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
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 shrink-0"
          >
            {stopping ? "Annulation…" : "Annuler"}
          </button>
        ) : showFinal ? (
          <button
            type="button"
            onClick={onAck}
            className={`text-xs font-semibold rounded-lg px-3 py-1.5 text-white shrink-0 ${meta.actionBtn}`}
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
            <div className="px-4 py-3 bg-white border-b border-slate-100">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                {totalOrders != null ? (
                  <div
                    className="h-full transition-all duration-300"
                    style={{ width: `${percent}%`, background: meta.barGrad }}
                  />
                ) : (
                  // Ankorstore : total inconnu → barre indéterminée qui slide
                  <div
                    className="h-full w-1/3"
                    style={{
                      background: meta.barGrad,
                      animation: "ordersIndeterminate 1.4s ease-in-out infinite",
                    }}
                  />
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
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
            <div className={`px-4 py-3 ${meta.chipBg} border-b border-slate-100`}>
              <div className="flex items-center justify-between">
                <p
                  className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${meta.chipText}`}
                >
                  En cours d'import
                </p>
                <span className={`text-[10px] font-medium ${meta.chipText}`}>
                  {currentOrders.length} en parallèle
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {currentOrders.slice(0, CURRENT_ORDERS_MAX).map((c) => (
                  <div
                    key={c.key}
                    className={`rounded-lg border bg-white px-2.5 py-1.5 flex items-center gap-2 ${meta.chipRing}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full animate-pulse flex-shrink-0 ${meta.chipDot}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {c.orderNumber}
                      </p>
                      <p className="text-[11px] text-slate-600 truncate">
                        {c.customerName}
                        {c.country ? ` · ${c.country}` : ""}
                      </p>
                    </div>
                    {c.amount != null && (
                      <p className="text-[11px] font-medium text-slate-700 tabular-nums flex-shrink-0">
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
            <div className="px-4 py-3 border-b border-slate-100 bg-white">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
                Résultat
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
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
                <p className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {state.errorMessage}
                </p>
              )}
              {isStopped && (
                <p className="mt-3 text-xs text-slate-600">
                  Import interrompu. Les commandes déjà importées ont été conservées.
                </p>
              )}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onStart}
                  disabled={starting}
                  className={`text-xs font-medium underline underline-offset-2 ${meta.actionLink}`}
                >
                  Relancer un import
                </button>
              </div>
            </div>
          )}

          {/* Journal — capé à DISPLAYED_EVENTS_MAX pour rester compact.
              Pas de min-h-0/overflow ici : le parent gère déjà le scroll de
              tout le contenu de la moitié haute. */}
          <div className="px-4 py-3 flex flex-col flex-shrink-0">
            <div className="flex items-center justify-between flex-shrink-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
                Journal
              </p>
              {pending > 0 && (
                <span className="text-[10px] text-slate-400">
                  {pending} en attente
                </span>
              )}
            </div>
            {events.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Aucune commande traitée pour le moment.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
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
    <div className="p-6 text-center">
      <div
        className="mx-auto w-12 h-12 rounded-full flex items-center justify-center text-white font-heading font-bold text-lg shadow-lg"
        style={{ background: meta.gradient }}
      >
        {meta.letter}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">Aucun import en cours</p>
      <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
        Rattrapage historique complet {meta.name} — commandes et fiches clients importées ensemble. Vous pouvez continuer à travailler pendant l'import.
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className={`mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-white text-sm font-semibold rounded-lg disabled:opacity-50 ${meta.actionBtn}`}
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
    <div className={`rounded-xl border ${styles.border} ${styles.bg} px-2.5 py-2`}>
      <p className={`text-lg font-heading font-bold tabular-nums ${styles.text}`}>{value}</p>
      <p className="text-[10px] text-slate-600 leading-tight mt-0.5">
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
      className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 flex items-center gap-2"
      style={{ animation: "ordersEventIn 260ms cubic-bezier(.16,1,.3,1) both" }}
    >
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ${badge.cls} flex-shrink-0`}
      >
        {badge.text}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-900 truncate">{event.orderNumber}</p>
        <p className="text-[11px] text-slate-500 truncate">{event.customerName}</p>
        {event.result === "error" && event.errorMessage && (
          <p className="text-[10px] text-rose-600 truncate mt-0.5">{event.errorMessage}</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        {event.amount != null && (
          <p className="text-[11px] font-medium text-slate-700 tabular-nums">
            {formatMoney(event.amount)}
          </p>
        )}
        <p className="text-[10px] text-slate-400 tabular-nums">{formatRelative(event.at, now)}</p>
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
// ClientsRow — sous-carte "Clients" en bas de chaque colonne marketplace.
// ─────────────────────────────────────────────
//
// Rôle : afficher le nombre de fiches clients liées à ce marketplace et
// permettre à la cliente de lancer un import clients dédié. Techniquement
// c'est la même synchro que "Commandes" (les fiches sont créées par les
// upserts d'orders), mais présentée avec des stats client-centric.

const CLIENTS_META: Record<
  MarketplaceClientSource,
  { name: string; gradient: string; letter: string; accent: string }
> = {
  PFS: {
    name: "PFS",
    letter: "P",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
    accent: "text-indigo-700",
  },
  EFASHION: {
    name: "eFashion",
    letter: "E",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
    accent: "text-rose-700",
  },
  ANKORSTORE: {
    name: "Ankorstore",
    letter: "A",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
    accent: "text-sky-700",
  },
  FAIRE: {
    name: "Faire",
    letter: "F",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
    accent: "text-amber-700",
  },
  MICROSTORE: {
    name: "Microstore",
    letter: "M",
    gradient: "linear-gradient(135deg,#0891b2,#22d3ee)",
    accent: "text-cyan-700",
  },
};

function ClientsRow({
  source,
  refreshTick = 0,
  isImporting = false,
}: {
  source: MarketplaceClientSource;
  /** Compteur qui grimpe pendant un import historique — ClientsRow se
   *  rafraîchit automatiquement à chaque tick pour montrer les fiches
   *  créées en live. */
  refreshTick?: number;
  /** true quand un import historique tourne (spinner + label "en cours"). */
  isImporting?: boolean;
}) {
  const { manualSyncs } = useRightRail();
  const [count, setCount] = useState<number | null>(null);
  const [recent, setRecent] = useState<RecentClientCard[]>([]);
  const meta = CLIENTS_META[source];
  const manualSync = manualSyncs[source as ManualSyncSource];
  // Recharge sur : (a) fin d'une synchro manuelle "orders"
  //                (b) progression de l'import historique (refreshTick)
  const ordersEndedAt =
    manualSync?.target === "orders" && manualSync.phase !== "starting"
      ? manualSync.endedAt
      : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, r] = await Promise.all([
        countMarketplaceClientCards(source),
        getRecentMarketplaceClientCards(source, 3),
      ]);
      if (!cancelled) {
        setCount(c);
        setRecent(r);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, ordersEndedAt, refreshTick]);

  const isSyncing =
    isImporting ||
    (manualSync?.target === "orders" && manualSync.phase === "starting");

  return (
    <div className="px-3 py-2.5 bg-slate-50/70 flex-[2] basis-0 min-h-0 border-t border-slate-100 flex flex-col overflow-hidden">
      {/* Header carte : eyebrow + compteur — sticky en haut de la moitié
          basse pour que « Clients » soit toujours affiché juste sous la ligne
          du milieu, même si peu / pas de fiches à afficher. */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-5 h-5 rounded-md text-white font-bold text-[10px] flex items-center justify-center shrink-0"
            style={{ background: meta.gradient }}
          >
            {meta.letter}
          </span>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${meta.accent}`}>
            Clients
          </p>
          {isSyncing && (
            <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />
          )}
        </div>
        <span className="text-[11px] font-bold text-slate-800 tabular-nums">
          {count !== null ? `${count} fiche${count > 1 ? "s" : ""}` : "…"}
        </span>
      </div>

      {/* 3 dernières fiches touchées — preuve visible que la synchro passe.
          La zone est scrollable pour tenir dans la moitié basse fixe. */}
      {recent.length === 0 ? (
        <p className="text-[10.5px] text-slate-500 leading-snug italic flex-1 min-h-0">
          Aucune fiche pour l'instant — se remplit à la 1ʳᵉ synchro.
        </p>
      ) : (
        <ul className="space-y-1 flex-1 min-h-0 overflow-y-auto pr-0.5">
          {recent.map((c) => {
            const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || c.company || "—";
            const line2 = [c.email, [c.city, c.countryCode].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={c.id}
                className="rounded-md bg-white border border-slate-100 px-2 py-1.5"
              >
                <p className="text-[11px] font-semibold text-slate-900 truncate">{name}</p>
                {line2 && (
                  <p className="text-[10px] text-slate-500 truncate">{line2}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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
    <div className={`px-4 py-2.5 ${tone} flex items-start gap-2.5`}>
      <span className="shrink-0 mt-0.5">
        {isStarting ? (
          <span
            className={`inline-block w-3.5 h-3.5 rounded-full border-2 ${meta.chipDot.replace("bg-", "border-")} border-t-transparent animate-spin`}
          />
        ) : isSuccess ? (
          <svg
            className="w-4 h-4"
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
            className="w-4 h-4"
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
          {isStarting
            ? `Synchro ${targetLabel}…`
            : isSuccess
            ? `Synchro ${targetLabel} terminée`
            : event.sessionExpired
            ? "Session expirée"
            : `Synchro ${targetLabel} échouée`}
        </p>
        {summary && (
          <p className="text-xs mt-0.5">
            {summary}
            {relative && <span className="text-slate-500"> · {relative}</span>}
          </p>
        )}
        {isError && event.errorMessage && (
          <p className="text-xs mt-0.5 break-words">{event.errorMessage}</p>
        )}
      </div>
      {!isStarting && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-[11px] font-semibold underline underline-offset-2 opacity-70 hover:opacity-100"
        >
          Fermer
        </button>
      )}
    </div>
  );
}
