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

interface Props {
  initialSyncMeta: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
}

export default function PfsOrdersView({ initialSyncMeta }: Props) {
  const [period, setPeriod] = useState<PfsPeriodKey>("month");
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
  const [importState, setImportState] = useState<{ status: string; processedOrders: number; totalOrders: number } | null>(
    null,
  );
  const [syncMeta, setSyncMeta] = useState(initialSyncMeta);
  const [, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const [nextStats, nextList] = await Promise.all([
      getPfsStats({ period, topClientsLimit: 10, topProductsLimit: 10 }),
      listPfsOrders({ page, q: q || undefined, status: statusFilter || null, period }),
    ]);
    setStats(nextStats);
    setList(nextList.items);
    setListMeta({ total: nextList.total, page: nextList.page, totalPages: nextList.totalPages });
  }, [page, q, statusFilter, period]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling du widget import — actif dès qu'un import RUNNING
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const state = await getPfsImportStateAction();
      if (cancelled) return;
      if (state.status === "RUNNING") {
        setImportState({
          status: state.status,
          processedOrders: state.processedOrders,
          totalOrders: state.totalOrders,
        });
        setTimeout(tick, 3000);
      } else if (state.status === "DONE" || state.status === "ERROR" || state.status === "STOPPED") {
        setImportState({
          status: state.status,
          processedOrders: state.processedOrders,
          totalOrders: state.totalOrders,
        });
        // recharge liste + stats une fois l'import fini
        void refresh();
      } else {
        setImportState(null);
      }
    };
    void tick();
    return () => {
      cancelled = true;
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
    setSyncing(true);
    try {
      await syncPfsOrdersNow();
      const meta = await getPfsSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const onStartImport = useCallback(async () => {
    const state = await startPfsHistoricalImport();
    setImportState({
      status: state.status,
      processedOrders: state.processedOrders,
      totalOrders: state.totalOrders,
    });
  }, []);

  const lastSyncedLabel = useMemo(() => {
    if (!syncMeta.lastSyncedAt) return "Jamais";
    const ts = new Date(syncMeta.lastSyncedAt);
    const min = Math.max(0, Math.round((Date.now() - ts.getTime()) / 60000));
    if (min === 0) return "À l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.round(min / 60);
    return `il y a ${h} h`;
  }, [syncMeta.lastSyncedAt]);

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
        <PfsPeriodBar value={period} onChange={setPeriod} />
        <div className="flex items-center gap-3">
          <div className="text-xs text-text-muted">
            Dernière synchro : <span className="text-text-primary font-medium">{lastSyncedLabel}</span>
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
            onClick={() => void onStartImport()}
            disabled={importState?.status === "RUNNING"}
            className="rounded-xl bg-slate-900 text-white text-sm px-4 py-2 hover:bg-slate-800 disabled:opacity-50"
          >
            {importState?.status === "RUNNING"
              ? `Import en cours (${importState.processedOrders}/${importState.totalOrders})`
              : "Importer l'historique PFS"}
          </button>
        </div>
      </section>

      {/* KPIs */}
      <PfsKpiRow stats={stats} />

      {/* Top clients + top produits */}
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
