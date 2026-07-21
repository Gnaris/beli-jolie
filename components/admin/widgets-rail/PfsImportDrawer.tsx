"use client";

/**
 * Tiroir « Import commandes PFS » — remplace l'ancien pill flottant
 * `PfsImportPill`. Même UX que les autres widgets du rail (Marketplaces,
 * Shooting eFashion, Images, Traductions).
 *
 * Contenu :
 *  - Progression globale (X / Y commandes, page A/B, barre indigo)
 *  - Jusqu'à 5 commandes actuellement traitées en parallèle
 *  - Journal live des 30 dernières commandes traitées (importée /
 *    déjà à jour / erreur). Les événements sont affichés à un rythme
 *    régulier (1 toutes les 250 ms) pour un défilement fluide même
 *    quand le backend en publie 10 d'un coup.
 *  - Récap final quand l'import se termine : X nouvelles importées,
 *    X déjà à jour, X ignorées
 *
 * Poll le state persistant (SiteConfig) toutes les 1,5 s pendant un
 * import ; se calme à 6 s hors import pour ne pas surcharger la BDD.
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
import { useRightRail } from "./RightRailContext";
import { DrawerShell } from "./DrawerShell";

const POLL_ACTIVE_MS = 1500;
const POLL_IDLE_MS = 6000;
/** Délai minimum entre l'affichage de deux événements côté UI. */
const EVENT_DRIP_MS = 250;
/** Nombre max d'événements affichés dans la liste. */
const DISPLAYED_EVENTS_MAX = 30;

const PFS_ICON = (
  <span className="w-5 h-5 flex items-center justify-center text-[13px] font-heading font-bold text-white">
    P
  </span>
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

function eventKey(ev: PfsImportRecentEvent): string {
  return `${ev.orderNumber}-${ev.at}-${ev.result}`;
}

export function PfsImportDrawer() {
  const { openWidget, close, open, setBadge } = useRightRail();
  const isOpen = openWidget === "pfs-import";

  const [state, setState] = useState<PfsImportState | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStatusRef = useRef<string | null>(null);

  // ─── Buffer d'affichage des événements ─────────────────────────
  // Les events reçus du backend arrivent par salves (5 workers en parallèle).
  // On les fait « goutter » un par un dans la liste affichée, à cadence
  // régulière, pour que la cliente ait le temps de les lire.
  const [displayedEvents, setDisplayedEvents] = useState<PfsImportRecentEvent[]>([]);
  const pendingEventsRef = useRef<PfsImportRecentEvent[]>([]);
  const seenEventKeysRef = useRef<Set<string>>(new Set());
  const dripTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Poll d'état ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getPfsImportStateAction();
        if (cancelled) return;
        setState(s);
        const delay = s.status === "RUNNING" ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        pollTimerRef.current = setTimeout(tick, delay);
      } catch {
        pollTimerRef.current = setTimeout(tick, POLL_IDLE_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // ─── Alimentation de la file d'affichage à chaque poll ─────────
  useEffect(() => {
    if (!state) return;
    // Les events sont en ordre décroissant (plus récent d'abord) côté backend.
    // On les remet en ordre chronologique pour la queue de « drip ».
    const chronological = [...state.recentEvents].reverse();
    for (const ev of chronological) {
      const k = eventKey(ev);
      if (seenEventKeysRef.current.has(k)) continue;
      seenEventKeysRef.current.add(k);
      pendingEventsRef.current.push(ev);
    }
  }, [state]);

  // ─── Timer de « drip » : 1 event affiché toutes les EVENT_DRIP_MS ──
  useEffect(() => {
    const flushOne = () => {
      const pending = pendingEventsRef.current;
      if (pending.length === 0) return;
      // Si beaucoup d'events en attente (grosse salve), on accélère.
      const batchSize = pending.length > 20 ? 3 : pending.length > 8 ? 2 : 1;
      const flushed = pending.splice(0, batchSize);
      setDisplayedEvents((prev) => {
        // Ajout en tête (plus récent d'abord), coupe à DISPLAYED_EVENTS_MAX
        const next = [...flushed.reverse(), ...prev];
        return next.slice(0, DISPLAYED_EVENTS_MAX);
      });
    };
    dripTimerRef.current = setInterval(flushOne, EVENT_DRIP_MS);
    return () => {
      if (dripTimerRef.current) clearInterval(dripTimerRef.current);
    };
  }, []);

  // ─── Horloge locale pour les libellés relatifs ─────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ─── Badge + halo pulsant sur le rond dans le rail ─────────────
  useEffect(() => {
    if (!state) {
      setBadge("pfs-import", { count: 0 });
      return;
    }
    if (state.status === "RUNNING") {
      const remaining = Math.max(0, state.totalOrders - state.processedOrders);
      setBadge("pfs-import", { count: remaining, pulse: true });
    } else if (state.status === "ERROR") {
      setBadge("pfs-import", { count: 1, pulse: true });
    } else {
      setBadge("pfs-import", { count: 0 });
    }
  }, [state, setBadge]);

  // ─── Ouverture auto quand un import démarre depuis la page PFS ─
  useEffect(() => {
    if (!state) return;
    const prev = previousStatusRef.current;
    if (prev !== "RUNNING" && state.status === "RUNNING") {
      open("pfs-import");
    }
    previousStatusRef.current = state.status;
  }, [state, open]);

  // ─── Actions ───────────────────────────────────────────────────
  const onStart = useCallback(async () => {
    setStarting(true);
    try {
      // Nouveau run : on repart d'une file d'affichage vide.
      pendingEventsRef.current = [];
      seenEventKeysRef.current = new Set();
      setDisplayedEvents([]);
      const next = await startPfsHistoricalImport();
      setState(next);
      open("pfs-import");
    } finally {
      setStarting(false);
    }
  }, [open]);

  const onStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopPfsHistoricalImport();
    } finally {
      setStopping(false);
    }
  }, []);

  const onAcknowledge = useCallback(async () => {
    await acknowledgePfsHistoricalImport();
    setState((prev) =>
      prev
        ? {
            ...prev,
            status: "IDLE",
            currentOrders: [],
            recentEvents: [],
          }
        : prev,
    );
    pendingEventsRef.current = [];
    seenEventKeysRef.current = new Set();
    setDisplayedEvents([]);
  }, []);

  const percent = useMemo(() => {
    if (!state || state.totalOrders <= 0) return 0;
    return Math.min(100, Math.round((state.processedOrders / state.totalOrders) * 100));
  }, [state]);

  const isRunning = state?.status === "RUNNING";
  const isDone = state?.status === "DONE";
  const isError = state?.status === "ERROR";
  const isStopped = state?.status === "STOPPED";
  const showFinal = isDone || isError || isStopped;

  // ─── Header : titre dynamique + pastille selon état ───────────
  const title = (() => {
    if (isRunning)
      return (
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
          {state?.processedOrders}/{state?.totalOrders} commandes
        </span>
      );
    if (isDone) return "Import terminé";
    if (isStopped) return "Import annulé";
    if (isError) return "Import interrompu";
    return "Import PFS";
  })();

  const currentOrders = state?.currentOrders ?? [];

  return (
    <DrawerShell
      open={isOpen}
      onClose={close}
      accent="indigo"
      eyebrow="Import commandes PFS"
      title={title}
      icon={PFS_ICON}
      footer={
        state && (isRunning || showFinal) ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500 tabular-nums">
              {isRunning
                ? `Page ${state.currentPage}/${state.totalPages}`
                : `${state.processedOrders} commande${state.processedOrders > 1 ? "s" : ""} traitée${state.processedOrders > 1 ? "s" : ""}`}
            </p>
            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                disabled={stopping}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg disabled:opacity-50"
              >
                {stopping ? "Annulation…" : "Annuler l'import"}
              </button>
            ) : (
              <button
                type="button"
                onClick={onAcknowledge}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg"
              >
                Fermer le récap
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {!state ? (
        <div className="p-6 text-center text-sm text-slate-500">Chargement…</div>
      ) : state.status === "IDLE" ? (
        <IdleView onStart={onStart} starting={starting} />
      ) : (
        <>
          {/* Progression */}
          {isRunning && (
            <div className="px-4 py-3 border-b border-slate-100 bg-white">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${percent}%`,
                    background: "linear-gradient(90deg,#4f46e5,#6366f1)",
                  }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                <span>{percent} %</span>
                <span>
                  {state.processedOrders} / {state.totalOrders}
                </span>
              </div>
            </div>
          )}

          {/* Commandes en cours (jusqu'à 5 en parallèle) */}
          {isRunning && currentOrders.length > 0 && (
            <div className="px-4 py-3 border-b border-slate-100 bg-indigo-50/40">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.18em] text-indigo-700 font-semibold">
                  En cours d'import
                </p>
                <span className="text-[10px] text-indigo-600 font-medium">
                  {currentOrders.length} en parallèle
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                {currentOrders.map((c) => (
                  <div
                    key={c.pfsOrderId}
                    className="rounded-lg border border-indigo-100 bg-white px-2.5 py-1.5 flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate">
                        {c.orderNumber}
                      </p>
                      <p className="text-[11px] text-slate-600 truncate">
                        {c.customerName}
                        {c.country ? ` · ${c.country}` : ""}
                      </p>
                    </div>
                    {c.totalTTC != null && (
                      <p className="text-[11px] font-medium text-slate-700 tabular-nums flex-shrink-0">
                        {formatMoney(c.totalTTC)}
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
                  Import interrompu à votre demande. Les commandes déjà importées ont été conservées.
                </p>
              )}
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onStart}
                  disabled={starting}
                  className="text-xs text-indigo-700 hover:text-indigo-800 font-medium underline underline-offset-2"
                >
                  Relancer un import
                </button>
              </div>
            </div>
          )}

          {/* Historique événements (défilement lissé) */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
                Journal
              </p>
              {pendingEventsRef.current.length > 0 && (
                <span className="text-[10px] text-slate-400">
                  {pendingEventsRef.current.length} en attente d'affichage
                </span>
              )}
            </div>
            {displayedEvents.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Aucune commande traitée pour le moment.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {displayedEvents.map((ev) => (
                  <EventRow key={eventKey(ev)} event={ev} now={now} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </DrawerShell>
  );
}

// ────────────────────────────────────────────────────────
// Sous-composants
// ────────────────────────────────────────────────────────

function IdleView({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  return (
    <div className="p-6 text-center">
      <div
        className="mx-auto w-12 h-12 rounded-full flex items-center justify-center text-white font-heading font-bold text-lg shadow-lg"
        style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}
      >
        P
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">Aucun import en cours</p>
      <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
        Lancez le rattrapage historique pour importer toutes les commandes Paris Fashion Shop dans votre boutique. Vous pouvez continuer à travailler pendant l'import.
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
      >
        {starting ? "Démarrage…" : "Importer l'historique PFS"}
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

function EventRow({
  event,
  now,
}: {
  event: PfsImportRecentEvent;
  now: number;
}) {
  const badge =
    event.result === "imported"
      ? { text: "Importée", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200" }
      : event.result === "unchanged"
        ? { text: "Déjà à jour", cls: "bg-slate-100 text-slate-600 ring-slate-200" }
        : { text: "Erreur", cls: "bg-rose-100 text-rose-700 ring-rose-200" };
  return (
    <li
      className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 flex items-center gap-2"
      style={{
        animation: "pfsEventIn 260ms cubic-bezier(.16,1,.3,1) both",
      }}
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
        {event.totalTTC != null && (
          <p className="text-[11px] font-medium text-slate-700 tabular-nums">
            {formatMoney(event.totalTTC)}
          </p>
        )}
        <p className="text-[10px] text-slate-400 tabular-nums">{formatRelative(event.at, now)}</p>
      </div>
      <style jsx>{`
        @keyframes pfsEventIn {
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
