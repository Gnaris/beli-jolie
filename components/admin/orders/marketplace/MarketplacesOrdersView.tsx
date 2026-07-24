"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  listMarketplaceOrders,
  getMarketplaceStats,
  getMarketplaceSyncMeta,
  type MarketplacePeriodKey,
  type MarketplaceOrderListItem,
  type MarketplaceStatsBundle,
  type MarketplaceStockFilter,
  type MarketplaceSource,
  type MarketplaceUnifiedStatus,
} from "@/app/actions/admin/marketplace-orders";
import {
  syncPfsOrdersNow,
  startPfsHistoricalImport,
  getPfsImportStateAction,
  getPfsOrderDetail,
  type PfsOrderDetailFull,
} from "@/app/actions/admin/pfs-orders";
import {
  syncEfashionOrdersNow,
  startEfashionHistoricalImport,
  getEfashionImportStateAction,
  getEfashionOrderDetail,
  type EfashionOrderDetailFull,
} from "@/app/actions/admin/efashion-orders";
import {
  syncAnkorstoreOrdersNow,
  startAnkorstoreHistoricalImport,
  getAnkorstoreImportStateAction,
  getAnkorstoreOrderDetail,
  type AnkorstoreOrderDetailFull,
} from "@/app/actions/admin/ankorstore-orders";
import {
  syncFaireOrdersNow,
  startFaireHistoricalImport,
  getFaireImportStateAction,
  getFaireOrderDetail,
  type FaireOrderDetailFull,
} from "@/app/actions/admin/faire-orders";
import {
  syncMicrostoreOrdersNow,
  startMicrostoreHistoricalImport,
  getMicrostoreOrderDetail,
  type MicrostoreOrderDetailFull,
} from "@/app/actions/admin/microstore-orders";
import MicrostoreOrderDrawer from "./MicrostoreOrderDrawer";
import PfsOrderDrawer from "@/components/admin/orders/pfs/PfsOrderDrawer";
import PfsStockDeductionModal from "@/components/admin/orders/pfs/PfsStockDeductionModal";
import EfashionOrderDrawer from "./EfashionOrderDrawer";
import EfashionStockDeductionModal from "./EfashionStockDeductionModal";
import AnkorstoreOrderDrawer from "./AnkorstoreOrderDrawer";
import AnkorstoreStockDeductionModal from "./AnkorstoreStockDeductionModal";
import FaireOrderDrawer from "./FaireOrderDrawer";
import FaireStockDeductionModal from "./FaireStockDeductionModal";
import MarketplacePeriodBar from "./MarketplacePeriodBar";
import MarketplaceKpiRow from "./MarketplaceKpiRow";
import MarketplaceTopClients from "./MarketplaceTopClients";
import MarketplaceTopProducts from "./MarketplaceTopProducts";
import MarketplaceOrdersTable from "./MarketplaceOrdersTable";
import MarketplaceBadge from "./MarketplaceBadge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useRightRail } from "@/components/admin/widgets-rail";

interface Props {
  initialSyncMeta: {
    pfs: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
    efashion: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
    ankorstore: {
      lastSyncedAt: string | null;
      totalOrdersInDb: number;
      hasCredentials: boolean;
    };
    faire: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
    microstore: { lastSyncedAt: string | null; totalOrdersInDb: number; hasCredentials: boolean };
  };
}

export default function MarketplacesOrdersView({ initialSyncMeta }: Props) {
  const [period, setPeriod] = useState<MarketplacePeriodKey>("month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [stats, setStats] = useState<MarketplaceStatsBundle | null>(null);
  const [list, setList] = useState<MarketplaceOrderListItem[] | null>(null);
  const [listMeta, setListMeta] = useState<{
    total: number;
    page: number;
    totalPages: number;
    countsBySource: {
      PFS: number;
      EFASHION: number;
      ANKORSTORE: number;
      FAIRE: number;
      MICROSTORE: number;
    };
  }>({
    total: 0,
    page: 1,
    totalPages: 1,
    countsBySource: { PFS: 0, EFASHION: 0, ANKORSTORE: 0, FAIRE: 0, MICROSTORE: 0 },
  });
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<MarketplaceUnifiedStatus | "">("");
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSource | "">("");
  const [stockFilter, setStockFilter] = useState<MarketplaceStockFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedPfs, setSelectedPfs] = useState<PfsOrderDetailFull | null>(null);
  const [selectedEfashion, setSelectedEfashion] = useState<EfashionOrderDetailFull | null>(null);
  const [selectedAnkorstore, setSelectedAnkorstore] = useState<AnkorstoreOrderDetailFull | null>(
    null,
  );
  const [selectedFaire, setSelectedFaire] = useState<FaireOrderDetailFull | null>(null);
  const [selectedMicrostore, setSelectedMicrostore] =
    useState<MicrostoreOrderDetailFull | null>(null);
  const [deductionSource, setDeductionSource] = useState<{
    source: MarketplaceSource;
    orderId: string;
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [syncingPfs, setSyncingPfs] = useState(false);
  const [syncingEfashion, setSyncingEfashion] = useState(false);
  const [syncingAnkorstore, setSyncingAnkorstore] = useState(false);
  const [syncingFaire, setSyncingFaire] = useState(false);
  const [syncingMicrostore, setSyncingMicrostore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncMeta, setSyncMeta] = useState(initialSyncMeta);
  const [nowTick, setNowTick] = useState(0);
  const [, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const { open: openWidget } = useRightRail();
  const toast = useToast();

  useEffect(() => {
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (period === "custom") {
      const bothEmpty = !customFrom && !customTo;
      const inverted = customFrom && customTo && customTo < customFrom;
      if (bothEmpty || inverted) return;
    }
    setIsRefreshing(true);
    try {
      const sources: MarketplaceSource[] | undefined = sourceFilter ? [sourceFilter] : undefined;
      // Limites généreuses : le filtre local par marketplace (chip dans les
      // cartes Top clients / Top produits) fait de l'intersection sur ce que le
      // serveur a renvoyé. Si on limite à 50, les marketplaces minoritaires
      // (Ankor, eFashion, Faire) peuvent être totalement absentes du top 50.
      // 500 couvre tous les cas réalistes.
      const [nextStats, nextList] = await Promise.all([
        getMarketplaceStats({
          period,
          customFrom,
          customTo,
          sources,
          topClientsLimit: 500,
          topProductsLimit: 500,
        }),
        listMarketplaceOrders({
          page,
          perPage: 10,
          q: q || undefined,
          status: statusFilter || null,
          sources,
          stockFilter,
          period,
          customFrom,
          customTo,
        }),
      ]);
      setStats(nextStats);
      setList(nextList.items);
      setListMeta({
        total: nextList.total,
        page: nextList.page,
        totalPages: nextList.totalPages,
        countsBySource: nextList.countsBySource,
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [page, q, statusFilter, sourceFilter, stockFilter, period, customFrom, customTo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling léger de l'état d'import (PFS + eFashion + Ankorstore + Faire)
  // pour rafraîchir la vue à la fin de chaque import historique.
  useEffect(() => {
    let cancelled = false;
    let pfsWasRunning = false;
    let efashionWasRunning = false;
    let ankorWasRunning = false;
    let faireWasRunning = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const [pfsState, efState, ankorState, faireState] = await Promise.all([
          getPfsImportStateAction().catch(() => null),
          getEfashionImportStateAction().catch(() => null),
          getAnkorstoreImportStateAction().catch(() => null),
          getFaireImportStateAction().catch(() => null),
        ]);
        if (cancelled) return;
        const pfsRun = pfsState?.status === "RUNNING";
        const efRun = efState?.status === "RUNNING";
        const ankorRun = ankorState?.status === "RUNNING";
        const faireRun = faireState?.status === "RUNNING";
        if (
          (!pfsRun && pfsWasRunning) ||
          (!efRun && efashionWasRunning) ||
          (!ankorRun && ankorWasRunning) ||
          (!faireRun && faireWasRunning)
        ) {
          void refresh();
          void getMarketplaceSyncMeta().then(setSyncMeta);
        }
        pfsWasRunning = pfsRun;
        efashionWasRunning = efRun;
        ankorWasRunning = ankorRun;
        faireWasRunning = faireRun;
        timer = setTimeout(
          tick,
          pfsRun || efRun || ankorRun || faireRun ? 3000 : 8000,
        );
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

  const onOpenOrder = useCallback(async (row: MarketplaceOrderListItem) => {
    setLoadingDetail(true);
    try {
      if (row.source === "PFS") {
        const detail = await getPfsOrderDetail(row.id);
        setSelectedPfs(detail);
      } else if (row.source === "EFASHION") {
        const detail = await getEfashionOrderDetail(row.id);
        setSelectedEfashion(detail);
      } else if (row.source === "ANKORSTORE") {
        const detail = await getAnkorstoreOrderDetail(row.id);
        setSelectedAnkorstore(detail);
      } else if (row.source === "MICROSTORE") {
        const detail = await getMicrostoreOrderDetail(row.id);
        setSelectedMicrostore(detail);
      } else {
        const detail = await getFaireOrderDetail(row.id);
        setSelectedFaire(detail);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const onDeductClick = useCallback((row: MarketplaceOrderListItem) => {
    setDeductionSource({ source: row.source, orderId: row.id });
  }, []);

  const onSyncPfs = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Synchroniser Paris Fashion Shop ?",
      message: "Récupérer les commandes récentes depuis PFS.",
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setSyncingPfs(true);
    try {
      const res = await syncPfsOrdersNow();
      if (!res.success) {
        toast.error("Synchro PFS échouée", res.error);
      } else if (res.created + res.updated === 0) {
        toast.success("Synchro PFS OK", "Aucune nouvelle commande.");
      } else {
        toast.success(
          "Synchro PFS OK",
          `${res.created} nouvelles, ${res.updated} mises à jour.`,
        );
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingPfs(false);
    }
  }, [refresh, confirm, toast]);

  const onSyncEfashion = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Synchroniser eFashion Paris ?",
      message: "Récupérer les commandes récentes depuis eFashion.",
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setSyncingEfashion(true);
    try {
      const res = await syncEfashionOrdersNow();
      if (!res.success) {
        toast.error("Synchro eFashion échouée", res.error);
      } else if (res.created + res.updated === 0) {
        toast.success("Synchro eFashion OK", "Aucune nouvelle commande.");
      } else {
        toast.success(
          "Synchro eFashion OK",
          `${res.created} nouvelles, ${res.updated} mises à jour.`,
        );
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingEfashion(false);
    }
  }, [refresh, confirm, toast]);

  const onSyncAnkorstore = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Synchroniser Ankorstore ?",
      message: "Récupérer les commandes récentes depuis Ankorstore.",
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setSyncingAnkorstore(true);
    try {
      const res = await syncAnkorstoreOrdersNow();
      if (!res.success) {
        toast.error("Synchro Ankorstore échouée", res.error);
      } else if (res.created + res.updated === 0) {
        toast.success("Synchro Ankorstore OK", "Aucune nouvelle commande.");
      } else {
        toast.success(
          "Synchro Ankorstore OK",
          `${res.created} nouvelles, ${res.updated} mises à jour.`,
        );
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingAnkorstore(false);
    }
  }, [refresh, confirm, toast]);

  const onStartImportPfs = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Importer tout l'historique Paris Fashion Shop ?",
      message: "Rattrapage complet — peut durer plusieurs minutes.",
      confirmLabel: "Lancer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await startPfsHistoricalImport();
    openWidget("orders-import");
  }, [confirm, openWidget]);

  const onStartImportEfashion = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Importer tout l'historique eFashion Paris ?",
      message: "Rattrapage complet — peut durer plusieurs minutes.",
      confirmLabel: "Lancer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await startEfashionHistoricalImport();
    // Ouvre le widget si dispo, sinon on n'ouvre rien (le worker tourne en fond).
    try {
      openWidget("orders-import");
    } catch {
      /* widget pas encore intégré */
    }
  }, [confirm, openWidget]);

  const onStartImportAnkorstore = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Importer tout l'historique Ankorstore ?",
      message: "Rattrapage complet — peut durer plusieurs minutes.",
      confirmLabel: "Lancer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await startAnkorstoreHistoricalImport();
    try {
      openWidget("orders-import");
    } catch {
      /* widget pas encore intégré */
    }
  }, [confirm, openWidget]);

  const onSyncFaire = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Synchroniser Faire ?",
      message: "Récupérer les commandes récentes depuis Faire.",
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setSyncingFaire(true);
    try {
      const res = await syncFaireOrdersNow();
      if (!res.success) {
        toast.error("Synchro Faire échouée", res.error);
      } else if (res.created + res.updated === 0) {
        toast.success("Synchro Faire OK", "Aucune nouvelle commande.");
      } else {
        toast.success(
          "Synchro Faire OK",
          `${res.created} nouvelles, ${res.updated} mises à jour.`,
        );
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingFaire(false);
    }
  }, [refresh, confirm, toast]);

  const onSyncMicrostore = useCallback(async () => {
    const ok = await confirm({
      type: "info",
      title: "Synchroniser Microstore ?",
      message: "Récupérer les commandes récentes depuis Microstore.",
      confirmLabel: "Synchroniser",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setSyncingMicrostore(true);
    try {
      const res = await syncMicrostoreOrdersNow();
      if (res.sessionExpired) {
        toast.error(
          "Session Microstore expirée",
          "Reconnectez-vous depuis Paramètres → Microstore.",
        );
      } else if (!res.success) {
        toast.error("Synchro Microstore échouée", res.error);
      } else if ((res.created ?? 0) + (res.updated ?? 0) === 0) {
        toast.success("Synchro Microstore OK", "Aucune nouvelle commande.");
      } else {
        toast.success(
          "Synchro Microstore OK",
          `${res.created ?? 0} nouvelles, ${res.updated ?? 0} mises à jour.`,
        );
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingMicrostore(false);
    }
  }, [refresh, confirm, toast]);

  const onStartImportMicrostore = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Rattrapage complet Microstore ?",
      message:
        "Récupère toutes les commandes des 5 dernières années en tâche de fond. Suivez la progression dans le widget en bas à droite.",
      confirmLabel: "Lancer le rattrapage",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await startMicrostoreHistoricalImport();
    try {
      openWidget("orders-import");
    } catch {
      /* widget pas encore intégré */
    }
  }, [confirm, openWidget]);

  const onStartImportFaire = useCallback(async () => {
    const ok = await confirm({
      type: "warning",
      title: "Importer tout l'historique Faire ?",
      message: "Rattrapage complet — peut durer plusieurs minutes.",
      confirmLabel: "Lancer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    await startFaireHistoricalImport();
    try {
      openWidget("orders-import");
    } catch {
      /* widget pas encore intégré */
    }
  }, [confirm, openWidget]);

  const lastSyncLabel = useCallback(
    (lastSyncedAt: string | null) => {
      if (!lastSyncedAt) return "Jamais";
      if (nowTick === 0) return "…";
      const ts = new Date(lastSyncedAt);
      const min = Math.max(0, Math.round((nowTick - ts.getTime()) / 60000));
      if (min === 0) return "À l'instant";
      if (min < 60) return `il y a ${min} min`;
      const h = Math.round(min / 60);
      return `il y a ${h} h`;
    },
    [nowTick],
  );

  // Le worker de polling automatique tourne toutes les 5 min pour chaque source.
  // On affiche un décompte « Prochaine auto dans mm:ss » pour rassurer la
  // cliente que la synchro tourne bien en fond, comme dans la vue PFS.
  const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;
  const nextSyncLabel = useCallback(
    (lastSyncedAt: string | null): string | null => {
      if (!lastSyncedAt || nowTick === 0) return null;
      const lastTs = new Date(lastSyncedAt).getTime();
      const remaining = lastTs + AUTO_SYNC_INTERVAL_MS - nowTick;
      if (remaining <= 0) return "à l'instant";
      const totalSec = Math.ceil(remaining / 1000);
      const mm = Math.floor(totalSec / 60);
      const ss = totalSec % 60;
      return `${mm}:${ss.toString().padStart(2, "0")}`;
    },
    [nowTick],
  );

  const noCredentials =
    !syncMeta.pfs.hasCredentials &&
    !syncMeta.efashion.hasCredentials &&
    !syncMeta.ankorstore.hasCredentials &&
    !syncMeta.faire.hasCredentials &&
    !syncMeta.microstore.hasCredentials;

  const closingDrawer = useMemo(
    () => () => {
      setSelectedPfs(null);
      setSelectedEfashion(null);
      setSelectedAnkorstore(null);
      setSelectedFaire(null);
      setSelectedMicrostore(null);
    },
    [],
  );

  if (noCredentials) {
    return (
      <div className="rounded-2xl bg-bg-primary border border-border p-10 text-center">
        <h2 className="font-heading text-xl font-bold">Aucune marketplace configurée</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
          Pour récupérer vos commandes marketplaces, ouvrez «&nbsp;Paramètres → Marketplaces&nbsp;» et
          renseignez les identifiants de Paris Fashion Shop, eFashion Paris, Ankorstore et/ou Faire.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barre période + synchronisations */}
      <section className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4 flex flex-wrap items-center gap-4 justify-between">
        <MarketplacePeriodBar
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

        <div className="flex items-center gap-3 flex-wrap">
          {syncMeta.pfs.hasCredentials && (
            <SyncStatusPill
              source="PFS"
              lastLabel={lastSyncLabel(syncMeta.pfs.lastSyncedAt)}
              nextLabel={nextSyncLabel(syncMeta.pfs.lastSyncedAt)}
              totalInDb={syncMeta.pfs.totalOrdersInDb}
              syncing={syncingPfs}
              onSyncNow={() => startTransition(() => void onSyncPfs())}
              onImport={() => void onStartImportPfs()}
            />
          )}
          {syncMeta.efashion.hasCredentials && (
            <SyncStatusPill
              source="EFASHION"
              lastLabel={lastSyncLabel(syncMeta.efashion.lastSyncedAt)}
              nextLabel={nextSyncLabel(syncMeta.efashion.lastSyncedAt)}
              totalInDb={syncMeta.efashion.totalOrdersInDb}
              syncing={syncingEfashion}
              onSyncNow={() => startTransition(() => void onSyncEfashion())}
              onImport={() => void onStartImportEfashion()}
            />
          )}
          {syncMeta.ankorstore.hasCredentials && (
            <SyncStatusPill
              source="ANKORSTORE"
              lastLabel={lastSyncLabel(syncMeta.ankorstore.lastSyncedAt)}
              nextLabel={nextSyncLabel(syncMeta.ankorstore.lastSyncedAt)}
              totalInDb={syncMeta.ankorstore.totalOrdersInDb}
              syncing={syncingAnkorstore}
              onSyncNow={() => startTransition(() => void onSyncAnkorstore())}
              onImport={() => void onStartImportAnkorstore()}
            />
          )}
          {syncMeta.faire.hasCredentials && (
            <SyncStatusPill
              source="FAIRE"
              lastLabel={lastSyncLabel(syncMeta.faire.lastSyncedAt)}
              nextLabel={nextSyncLabel(syncMeta.faire.lastSyncedAt)}
              totalInDb={syncMeta.faire.totalOrdersInDb}
              syncing={syncingFaire}
              onSyncNow={() => startTransition(() => void onSyncFaire())}
              onImport={() => void onStartImportFaire()}
            />
          )}
          {syncMeta.microstore.hasCredentials && (
            <SyncStatusPill
              source="MICROSTORE"
              lastLabel={lastSyncLabel(syncMeta.microstore.lastSyncedAt)}
              nextLabel={nextSyncLabel(syncMeta.microstore.lastSyncedAt)}
              totalInDb={syncMeta.microstore.totalOrdersInDb}
              syncing={syncingMicrostore}
              onSyncNow={() => startTransition(() => void onSyncMicrostore())}
              onImport={() => void onStartImportMicrostore()}
            />
          )}
        </div>
      </section>

      <MarketplaceKpiRow stats={stats} />

      <section className="grid lg:grid-cols-2 gap-4">
        <MarketplaceTopClients stats={stats} />
        <MarketplaceTopProducts stats={stats} />
      </section>

      <MarketplaceOrdersTable
        items={list}
        total={listMeta.total}
        page={listMeta.page}
        perPage={10}
        totalPages={listMeta.totalPages}
        countsBySource={listMeta.countsBySource}
        q={q}
        onQChange={setQ}
        statusFilter={statusFilter}
        onStatusChange={(s) => {
          setStatusFilter(s);
          setPage(1);
        }}
        sourceFilter={sourceFilter}
        onSourceChange={(s) => {
          setSourceFilter(s);
          setPage(1);
        }}
        stockFilter={stockFilter}
        onStockFilterChange={(v) => {
          setStockFilter(v);
          setPage(1);
        }}
        onPageChange={setPage}
        onOpen={onOpenOrder}
        onDeductClick={onDeductClick}
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

      {selectedPfs && <PfsOrderDrawer order={selectedPfs} onClose={closingDrawer} />}
      {selectedEfashion && <EfashionOrderDrawer order={selectedEfashion} onClose={closingDrawer} />}
      {selectedAnkorstore && (
        <AnkorstoreOrderDrawer order={selectedAnkorstore} onClose={closingDrawer} />
      )}
      {selectedFaire && <FaireOrderDrawer order={selectedFaire} onClose={closingDrawer} />}
      {selectedMicrostore && (
        <MicrostoreOrderDrawer order={selectedMicrostore} onClose={closingDrawer} />
      )}
      {loadingDetail && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          Chargement du détail…
        </div>
      )}

      {deductionSource?.source === "PFS" && (
        <PfsStockDeductionModal
          orderId={deductionSource.orderId}
          onClose={() => setDeductionSource(null)}
          onDeducted={() => void refresh()}
        />
      )}
      {deductionSource?.source === "EFASHION" && (
        <EfashionStockDeductionModal
          orderId={deductionSource.orderId}
          onClose={() => setDeductionSource(null)}
          onDeducted={() => void refresh()}
        />
      )}
      {deductionSource?.source === "ANKORSTORE" && (
        <AnkorstoreStockDeductionModal
          orderId={deductionSource.orderId}
          onClose={() => setDeductionSource(null)}
          onDeducted={() => void refresh()}
        />
      )}
      {deductionSource?.source === "FAIRE" && (
        <FaireStockDeductionModal
          orderId={deductionSource.orderId}
          onClose={() => setDeductionSource(null)}
          onDeducted={() => void refresh()}
        />
      )}
    </div>
  );
}

function SyncStatusPill({
  source,
  lastLabel,
  nextLabel,
  totalInDb,
  syncing,
  onSyncNow,
  onImport,
}: {
  source: MarketplaceSource;
  lastLabel: string;
  nextLabel: string | null;
  totalInDb: number;
  syncing: boolean;
  onSyncNow: () => void;
  onImport?: () => void;
}) {
  const marketplaceLabel = (() => {
    switch (source) {
      case "PFS":
        return "Paris Fashion Shop";
      case "EFASHION":
        return "eFashion Paris";
      case "ANKORSTORE":
        return "Ankorstore";
      case "FAIRE":
        return "Faire";
      case "MICROSTORE":
        return "Microstore";
    }
  })();
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-secondary/50 px-3 py-1.5">
      <MarketplaceBadge source={source} size="sm" />
      <div className="text-[11px] leading-tight">
        <div className="font-medium text-text-primary">{marketplaceLabel}</div>
        <div className="text-text-muted">
          {totalInDb.toLocaleString("fr-FR")} en base · {lastLabel}
          {nextLabel && (
            <>
              <span className="mx-1.5 opacity-40">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-text-primary tabular-nums">{nextLabel}</span>
              </span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onSyncNow}
        disabled={syncing}
        className="rounded-lg border border-border bg-white text-xs px-2 py-1 hover:bg-bg-secondary disabled:opacity-50"
      >
        {syncing ? "…" : "Synchro"}
      </button>
      {onImport && (
        <button
          type="button"
          onClick={onImport}
          className="rounded-lg bg-slate-900 text-white text-xs px-2 py-1 hover:bg-slate-800"
          title="Rattrapage complet — récupère toutes les commandes non encore importées"
        >
          Rattrapage
        </button>
      )}
    </div>
  );
}
