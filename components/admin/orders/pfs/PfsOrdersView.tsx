"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  listPfsOrders,
  getPfsStats,
  getPfsOrderDetail,
  syncPfsOrdersNow,
  startPfsHistoricalImport,
  getPfsImportStateAction,
  getPfsSyncMeta,
  type PfsPeriodKey,
  type PfsOrderListItem,
  type PfsStatsBundle,
  type PfsOrderDetailFull,
} from "@/app/actions/admin/pfs-orders";
import PfsOrderDrawer from "./PfsOrderDrawer";
import PfsPeriodBar from "./PfsPeriodBar";
import PfsKpiRow from "./PfsKpiRow";
import PfsTopClients from "./PfsTopClients";
import PfsTopProducts from "./PfsTopProducts";
import PfsOrdersTable from "./PfsOrdersTable";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useRightRail } from "@/components/admin/widgets-rail";

interface Props {
  initialSyncMeta: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
}

export default function PfsOrdersView({ initialSyncMeta }: Props) {
  const [period, setPeriod] = useState<PfsPeriodKey>("month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [stats, setStats] = useState<PfsStatsBundle | null>(null);
  const [list, setList] = useState<PfsOrderListItem[] | null>(null);
  const [listMeta, setListMeta] = useState<{ total: number; page: number; totalPages: number }>({
    total: 0,
    page: 1,
    totalPages: 1,
  });
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"NEW" | "VALIDATED" | "SENT" | "CANCELLED" | "">("");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<PfsOrderDetailFull | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importRunning, setImportRunning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncMeta, setSyncMeta] = useState(initialSyncMeta);
  // Init à 0 (identique SSR + client 1er render) pour éviter les erreurs
  // d'hydratation. La vraie valeur est posée dès le 1er effet côté client.
  const [nowTick, setNowTick] = useState(0);
  const [, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const { open: openWidget } = useRightRail();

  useEffect(() => {
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    // En mode personnalisé, on attend au moins une des deux dates ET une plage cohérente
    // avant d'appeler le serveur, sinon on affichrait un état vide trompeur pendant que la
    // cliente saisit la 2ᵉ date.
    if (period === "custom") {
      const bothEmpty = !customFrom && !customTo;
      const inverted = customFrom && customTo && customTo < customFrom;
      if (bothEmpty || inverted) return;
    }
    setIsRefreshing(true);
    try {
      const [nextStats, nextList] = await Promise.all([
        getPfsStats({ period, customFrom, customTo }),
        listPfsOrders({
          page,
          q: q || undefined,
          status: statusFilter || null,
          period,
          customFrom,
          customTo,
        }),
      ]);
      setStats(nextStats);
      setList(nextList.items);
      setListMeta({ total: nextList.total, page: nextList.page, totalPages: nextList.totalPages });
    } finally {
      setIsRefreshing(false);
    }
  }, [page, q, statusFilter, period, customFrom, customTo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling léger de l'état d'import — sert uniquement à :
  //  - désactiver le bouton « Importer l'historique PFS » pendant qu'un import tourne
  //  - rafraîchir liste/stats + compteur « commandes en base » quand un import
  //    se termine, sans que la cliente ait à recharger la page
  // Les détails (progression, commandes en cours, journal) sont dans le widget
  // rail (PfsImportDrawer) qui a son propre polling.
  useEffect(() => {
    let cancelled = false;
    let wasRunning = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const state = await getPfsImportStateAction();
        if (cancelled) return;
        const running = state.status === "RUNNING";
        setImportRunning(running);
        if (!running && wasRunning) {
          // Import qui vient de se terminer → refresh liste + stats.
          void refresh();
          void getPfsSyncMeta().then(setSyncMeta);
        }
        wasRunning = running;
        timer = setTimeout(tick, running ? 3000 : 8000);
      } catch {
        timer = setTimeout(tick, 8000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const onOpenOrder = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const detail = await getPfsOrderDetail(id);
      setSelectedOrder(detail);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const onSyncNow = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Synchroniser les commandes Paris Fashion Shop ?",
      message:
        "Nous allons récupérer les commandes récentes depuis Paris Fashion Shop et mettre à jour le tableau. Cela ne prend en général que quelques secondes.",
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setSyncing(true);
    try {
      await syncPfsOrdersNow();
      const meta = await getPfsSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh, confirm]);

  const onStartImport = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Importer tout l'historique Paris Fashion Shop ?",
      message:
        "Nous allons récupérer l'intégralité de vos commandes Paris Fashion Shop depuis le début. Cette opération peut durer plusieurs minutes selon le volume ; vous pouvez continuer à utiliser le site pendant ce temps. Un import est déjà quotidien en automatique — lancez-le uniquement si vous voulez rattraper un historique complet.",
      confirmLabel: "Lancer l'import",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await startPfsHistoricalImport();
    setImportRunning(true);
    // Ouvre le tiroir « Import commandes PFS » du rail widget pour suivre la progression en direct.
    openWidget("pfs-import");
  }, [confirm, openWidget]);

  const lastSyncedLabel = useMemo(() => {
    if (!syncMeta.lastSyncedAt) return "Jamais";
    // Tant que le client n'a pas encore posé nowTick (SSR + 1er render), on affiche
    // un placeholder identique côté serveur et client (évite hydration mismatch).
    if (nowTick === 0) return "…";
    const ts = new Date(syncMeta.lastSyncedAt);
    const min = Math.max(0, Math.round((nowTick - ts.getTime()) / 60000));
    if (min === 0) return "À l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    return `il y a ${h} h`;
  }, [syncMeta.lastSyncedAt, nowTick]);

  const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;
  const nextSyncLabel = useMemo(() => {
    if (!syncMeta.lastSyncedAt) return null;
    if (nowTick === 0) return null;
    const lastTs = new Date(syncMeta.lastSyncedAt).getTime();
    const remaining = lastTs + AUTO_SYNC_INTERVAL_MS - nowTick;
    if (remaining <= 0) return "à l'instant";
    const totalSec = Math.ceil(remaining / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return `${mm}:${ss.toString().padStart(2, "0")}`;
  }, [syncMeta.lastSyncedAt, nowTick]);

  // Rafraîchissement silencieux de l'horodatage quand le compteur passe à 0
  useEffect(() => {
    if (syncing || !syncMeta.lastSyncedAt) return;
    const lastTs = new Date(syncMeta.lastSyncedAt).getTime();
    const overdueBy = nowTick - (lastTs + AUTO_SYNC_INTERVAL_MS);
    if (overdueBy < 0) return;
    // Poll toutes les ~15 s tant que le worker n'a pas mis à jour le timestamp
    if (Math.floor(overdueBy / 1000) % 15 !== 0) return;
    void getPfsSyncMeta().then((meta) => {
      setSyncMeta(meta);
      if (meta.lastSyncedAt && meta.lastSyncedAt !== syncMeta.lastSyncedAt) {
        void refresh();
      }
    });
  }, [nowTick, syncMeta.lastSyncedAt, syncing, refresh]);

  if (!syncMeta.hasCredentials) {
    return (
      <div className="rounded-2xl bg-bg-primary border border-border p-10 text-center">
        <h2 className="font-heading text-xl font-bold">Identifiants Paris Fashion Shop manquants</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
          Pour récupérer vos commandes PFS, ouvrez « Paramètres → Marketplaces » et
          renseignez votre email + mot de passe Paris Fashion Shop.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barre période + import */}
      <section className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4 flex flex-wrap items-center gap-3 justify-between">
        <PfsPeriodBar
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setPage(1);
          }}
          customFrom={customFrom}
          customTo={customTo}
          onCustomFromChange={(v) => {
            setCustomFrom(v);
            setPage(1);
          }}
          onCustomToChange={(v) => {
            setCustomTo(v);
            setPage(1);
          }}
        />
        <div className="flex items-center gap-3">
          <div className="text-xs text-text-muted">
            Dernière synchro : <span className="text-text-primary font-medium">{lastSyncedLabel}</span>
            {nextSyncLabel && (
              <>
                <span className="mx-2 opacity-40">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Prochaine auto dans{" "}
                  <span className="text-text-primary font-medium tabular-nums">
                    {nextSyncLabel}
                  </span>
                </span>
              </>
            )}
            <span className="mx-2 opacity-40">·</span>
            <span className="text-text-primary font-medium">
              {syncMeta.totalOrdersInDb.toLocaleString("fr-FR")}
            </span>{" "}
            commandes en base
          </div>
          <button
            type="button"
            onClick={() => startTransition(() => void onSyncNow())}
            disabled={syncing}
            className="rounded-xl border border-border bg-white text-sm px-3 py-2 hover:bg-bg-secondary disabled:opacity-50"
          >
            {syncing ? "Synchro…" : "Synchroniser maintenant"}
          </button>
          <button
            type="button"
            onClick={() => (importRunning ? openWidget("pfs-import") : void onStartImport())}
            className="rounded-xl bg-slate-900 text-white text-sm px-4 py-2 hover:bg-slate-800"
          >
            {importRunning ? "Voir l'import en cours" : "Importer l'historique PFS"}
          </button>
        </div>
      </section>

      {/* KPIs */}
      <PfsKpiRow stats={stats} />

      {/* Top clients + top produits — grid stretch : les 2 cartes ont exactement la même hauteur.
          Chaque carte est en flex-col h-full, ses items en flex-1 pour combler le vide. */}
      <section className="grid lg:grid-cols-2 gap-4">
        <PfsTopClients stats={stats} onOpenOrder={onOpenOrder} />
        <PfsTopProducts stats={stats} />
      </section>

      {/* Table commandes */}
      <PfsOrdersTable
        items={list}
        total={listMeta.total}
        page={listMeta.page}
        totalPages={listMeta.totalPages}
        q={q}
        onQChange={setQ}
        statusFilter={statusFilter}
        onStatusChange={(s) => {
          setStatusFilter(s);
          setPage(1);
        }}
        onPageChange={setPage}
        onOpen={onOpenOrder}
        statusCounts={stats?.statusCounts ?? null}
      />

      {isRefreshing && (
        <div
          className="fixed inset-0 bg-slate-900/25 backdrop-blur-[1px] flex items-center justify-center z-[100]"
          aria-live="polite"
        >
          <div className="rounded-full bg-slate-900/90 text-white text-sm font-medium px-5 py-2.5 flex items-center gap-2.5 shadow-2xl">
            <span className="inline-block w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Chargement…
          </div>
        </div>
      )}

      {selectedOrder && (
        <PfsOrderDrawer
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
      {loadingDetail && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          Chargement du détail…
        </div>
      )}
    </div>
  );
}
