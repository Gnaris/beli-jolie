"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  listMarketplaceOrders,
  getMarketplaceStats,
  getMarketplaceSyncMeta,
  setMarketplaceAutoSyncEnabled,
  type MarketplacePeriodKey,
  type MarketplaceOrderListItem,
  type MarketplaceStatsBundle,
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
  getMicrostoreImportStateAction,
  getMicrostoreOrderDetail,
  type MicrostoreOrderDetailFull,
} from "@/app/actions/admin/microstore-orders";
import MicrostoreOrderDrawer from "./MicrostoreOrderDrawer";
import PfsOrderDrawer from "@/components/admin/orders/pfs/PfsOrderDrawer";
import EfashionOrderDrawer from "./EfashionOrderDrawer";
import AnkorstoreOrderDrawer from "./AnkorstoreOrderDrawer";
import FaireOrderDrawer from "./FaireOrderDrawer";
import MarketplacePeriodBar from "./MarketplacePeriodBar";
import MarketplaceKpiRow from "./MarketplaceKpiRow";
import MarketplaceTopClients from "./MarketplaceTopClients";
import MarketplaceTopProducts from "./MarketplaceTopProducts";
import MarketplaceOrdersTable from "./MarketplaceOrdersTable";
import MarketplaceBadge from "./MarketplaceBadge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { useRightRail } from "@/components/admin/widgets-rail";

interface SyncMetaEntry {
  lastSyncedAt: string | null;
  totalOrdersInDb: number;
  hasCredentials: boolean;
  autoSyncEnabled: boolean;
}

interface Props {
  initialSyncMeta: {
    pfs: SyncMetaEntry;
    efashion: SyncMetaEntry;
    ankorstore: SyncMetaEntry;
    faire: SyncMetaEntry;
    microstore: SyncMetaEntry;
  };
}

export default function MarketplacesOrdersView({ initialSyncMeta }: Props) {
  // Défaut "all" (au lieu de "month") pour que le tableau de bord montre
  // vraiment ce qui est en base — sinon la cliente importe 5 ans d'historique
  // et se retrouve avec un dashboard vide car "ce mois-ci" ne matche que
  // les commandes récentes (bug UX corrigé 2026-08-01).
  const [period, setPeriod] = useState<MarketplacePeriodKey>("all");
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
  const [page, setPage] = useState(1);
  const [selectedPfs, setSelectedPfs] = useState<PfsOrderDetailFull | null>(null);
  const [selectedEfashion, setSelectedEfashion] = useState<EfashionOrderDetailFull | null>(null);
  const [selectedAnkorstore, setSelectedAnkorstore] = useState<AnkorstoreOrderDetailFull | null>(
    null,
  );
  const [selectedFaire, setSelectedFaire] = useState<FaireOrderDetailFull | null>(null);
  const [selectedMicrostore, setSelectedMicrostore] =
    useState<MicrostoreOrderDetailFull | null>(null);
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
  const { open: openWidget, pushManualSync } = useRightRail();
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
  }, [page, q, statusFilter, sourceFilter, period, customFrom, customTo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling léger de l'état d'import (PFS + eFashion + Ankorstore + Faire +
  // Microstore) pour rafraîchir la vue à la fin de chaque import historique.
  useEffect(() => {
    let cancelled = false;
    let pfsWasRunning = false;
    let efashionWasRunning = false;
    let ankorWasRunning = false;
    let faireWasRunning = false;
    let microstoreWasRunning = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const [pfsState, efState, ankorState, faireState, microstoreState] = await Promise.all([
          getPfsImportStateAction().catch(() => null),
          getEfashionImportStateAction().catch(() => null),
          getAnkorstoreImportStateAction().catch(() => null),
          getFaireImportStateAction().catch(() => null),
          getMicrostoreImportStateAction().catch(() => null),
        ]);
        if (cancelled) return;
        const pfsRun = pfsState?.status === "RUNNING";
        const efRun = efState?.status === "RUNNING";
        const ankorRun = ankorState?.status === "RUNNING";
        const faireRun = faireState?.status === "RUNNING";
        const microstoreRun = microstoreState?.status === "RUNNING";
        if (
          (!pfsRun && pfsWasRunning) ||
          (!efRun && efashionWasRunning) ||
          (!ankorRun && ankorWasRunning) ||
          (!faireRun && faireWasRunning) ||
          (!microstoreRun && microstoreWasRunning)
        ) {
          void refresh();
          void getMarketplaceSyncMeta().then(setSyncMeta);
        }
        pfsWasRunning = pfsRun;
        efashionWasRunning = efRun;
        ankorWasRunning = ankorRun;
        faireWasRunning = faireRun;
        microstoreWasRunning = microstoreRun;
        timer = setTimeout(
          tick,
          pfsRun || efRun || ankorRun || faireRun || microstoreRun ? 3000 : 8000,
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
    openWidget("orders-import");
    const startedAt = Date.now();
    pushManualSync({ source: "PFS", target: "orders", phase: "starting", startedAt });
    try {
      const res = await syncPfsOrdersNow();
      if (!res.success) {
        pushManualSync({
          source: "PFS",
          target: "orders",
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          errorMessage: res.error,
        });
        toast.error("Synchro PFS échouée", res.error);
      } else {
        pushManualSync({
          source: "PFS",
          target: "orders",
          phase: "success",
          startedAt,
          endedAt: Date.now(),
          created: res.created,
          updated: res.updated,
        });
        if (res.created + res.updated === 0) {
          toast.success("Synchro PFS OK", "Aucune nouvelle commande.");
        } else {
          toast.success(
            "Synchro PFS OK",
            `${res.created} nouvelles, ${res.updated} mises à jour.`,
          );
        }
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingPfs(false);
    }
  }, [refresh, confirm, toast, openWidget, pushManualSync]);

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
    openWidget("orders-import");
    const startedAt = Date.now();
    pushManualSync({ source: "EFASHION", target: "orders", phase: "starting", startedAt });
    try {
      const res = await syncEfashionOrdersNow();
      if (!res.success) {
        pushManualSync({
          source: "EFASHION",
          target: "orders",
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          errorMessage: res.error,
        });
        toast.error("Synchro eFashion échouée", res.error);
      } else {
        pushManualSync({
          source: "EFASHION",
          target: "orders",
          phase: "success",
          startedAt,
          endedAt: Date.now(),
          created: res.created,
          updated: res.updated,
        });
        if (res.created + res.updated === 0) {
          toast.success("Synchro eFashion OK", "Aucune nouvelle commande.");
        } else {
          toast.success(
            "Synchro eFashion OK",
            `${res.created} nouvelles, ${res.updated} mises à jour.`,
          );
        }
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingEfashion(false);
    }
  }, [refresh, confirm, toast, openWidget, pushManualSync]);

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
    openWidget("orders-import");
    const startedAt = Date.now();
    pushManualSync({ source: "ANKORSTORE", target: "orders", phase: "starting", startedAt });
    try {
      const res = await syncAnkorstoreOrdersNow();
      if (!res.success) {
        pushManualSync({
          source: "ANKORSTORE",
          target: "orders",
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          errorMessage: res.error,
        });
        toast.error("Synchro Ankorstore échouée", res.error);
      } else {
        pushManualSync({
          source: "ANKORSTORE",
          target: "orders",
          phase: "success",
          startedAt,
          endedAt: Date.now(),
          created: res.created,
          updated: res.updated,
        });
        if (res.created + res.updated === 0) {
          toast.success("Synchro Ankorstore OK", "Aucune nouvelle commande.");
        } else {
          toast.success(
            "Synchro Ankorstore OK",
            `${res.created} nouvelles, ${res.updated} mises à jour.`,
          );
        }
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingAnkorstore(false);
    }
  }, [refresh, confirm, toast, openWidget, pushManualSync]);

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
    openWidget("orders-import");
    const startedAt = Date.now();
    pushManualSync({ source: "FAIRE", target: "orders", phase: "starting", startedAt });
    try {
      const res = await syncFaireOrdersNow();
      if (!res.success) {
        pushManualSync({
          source: "FAIRE",
          target: "orders",
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          errorMessage: res.error,
        });
        toast.error("Synchro Faire échouée", res.error);
      } else {
        pushManualSync({
          source: "FAIRE",
          target: "orders",
          phase: "success",
          startedAt,
          endedAt: Date.now(),
          created: res.created,
          updated: res.updated,
        });
        if (res.created + res.updated === 0) {
          toast.success("Synchro Faire OK", "Aucune nouvelle commande.");
        } else {
          toast.success(
            "Synchro Faire OK",
            `${res.created} nouvelles, ${res.updated} mises à jour.`,
          );
        }
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingFaire(false);
    }
  }, [refresh, confirm, toast, openWidget, pushManualSync]);

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
    openWidget("orders-import");
    const startedAt = Date.now();
    pushManualSync({ source: "MICROSTORE", target: "orders", phase: "starting", startedAt });
    try {
      const res = await syncMicrostoreOrdersNow();
      if (res.sessionExpired) {
        pushManualSync({
          source: "MICROSTORE",
          target: "orders",
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          sessionExpired: true,
          errorMessage: "Reconnectez-vous depuis Paramètres → Microstore.",
        });
        toast.error(
          "Session Microstore expirée",
          "Reconnectez-vous depuis Paramètres → Microstore.",
        );
      } else if (!res.success) {
        pushManualSync({
          source: "MICROSTORE",
          target: "orders",
          phase: "error",
          startedAt,
          endedAt: Date.now(),
          errorMessage: res.error,
        });
        toast.error("Synchro Microstore échouée", res.error);
      } else {
        pushManualSync({
          source: "MICROSTORE",
          target: "orders",
          phase: "success",
          startedAt,
          endedAt: Date.now(),
          created: res.created ?? 0,
          updated: res.updated ?? 0,
        });
        if ((res.created ?? 0) + (res.updated ?? 0) === 0) {
          toast.success("Synchro Microstore OK", "Aucune nouvelle commande.");
        } else {
          toast.success(
            "Synchro Microstore OK",
            `${res.created ?? 0} nouvelles, ${res.updated ?? 0} mises à jour.`,
          );
        }
      }
      const meta = await getMarketplaceSyncMeta();
      setSyncMeta(meta);
      await refresh();
    } finally {
      setSyncingMicrostore(false);
    }
  }, [refresh, confirm, toast, openWidget, pushManualSync]);

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

  /**
   * Toggle ON/OFF de la synchro auto d'une marketplace.
   * Optimistic update local + call serveur en fond.
   * Quand on remet ON, le serveur pose `lastSyncedAt = now` → le compteur
   * `nextSyncLabel` repart automatiquement à 5:00 au prochain render.
   */
  const onToggleAutoSync = useCallback(
    async (source: MarketplaceSource, enabled: boolean) => {
      // Optimistic UI
      setSyncMeta((prev) => {
        const key =
          source === "PFS"
            ? "pfs"
            : source === "EFASHION"
            ? "efashion"
            : source === "ANKORSTORE"
            ? "ankorstore"
            : source === "FAIRE"
            ? "faire"
            : "microstore";
        return {
          ...prev,
          [key]: {
            ...prev[key],
            autoSyncEnabled: enabled,
            // Si on rallume : reset côté client aussi pour que le compteur
            // affiche 5:00 immédiatement sans attendre le retour serveur.
            lastSyncedAt: enabled ? new Date().toISOString() : prev[key].lastSyncedAt,
          },
        };
      });
      try {
        await setMarketplaceAutoSyncEnabled({ source, enabled });
        // Ré-aligne avec la vérité serveur (timestamp exact)
        const meta = await getMarketplaceSyncMeta();
        setSyncMeta(meta);
      } catch (err) {
        toast.error(
          "Impossible de modifier la synchro auto",
          err instanceof Error ? err.message : "Erreur inconnue.",
        );
        // Rollback
        const meta = await getMarketplaceSyncMeta();
        setSyncMeta(meta);
      }
    },
    [toast],
  );

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

  return (
    <div className="space-y-4">
      {/* Barre période */}
      <section className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4">
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
      </section>

      {/* Rangée marketplaces — une seule ligne sur md+, wrap possible sous md */}
      <section className="rounded-2xl bg-bg-primary border border-border shadow-sm p-3 md:p-4">
        <div className="flex flex-wrap md:flex-nowrap items-stretch gap-2 md:gap-3 md:overflow-x-auto">
          <SyncStatusPill
            source="PFS"
            connected={syncMeta.pfs.hasCredentials}
            lastLabel={lastSyncLabel(syncMeta.pfs.lastSyncedAt)}
            nextLabel={nextSyncLabel(syncMeta.pfs.lastSyncedAt)}
            totalInDb={syncMeta.pfs.totalOrdersInDb}
            syncing={syncingPfs}
            autoSyncEnabled={syncMeta.pfs.autoSyncEnabled}
            onToggleAutoSync={(v) => void onToggleAutoSync("PFS", v)}
            onSyncNow={() => startTransition(() => void onSyncPfs())}
            onImport={() => void onStartImportPfs()}
          />
          <SyncStatusPill
            source="EFASHION"
            connected={syncMeta.efashion.hasCredentials}
            lastLabel={lastSyncLabel(syncMeta.efashion.lastSyncedAt)}
            nextLabel={nextSyncLabel(syncMeta.efashion.lastSyncedAt)}
            totalInDb={syncMeta.efashion.totalOrdersInDb}
            syncing={syncingEfashion}
            autoSyncEnabled={syncMeta.efashion.autoSyncEnabled}
            onToggleAutoSync={(v) => void onToggleAutoSync("EFASHION", v)}
            onSyncNow={() => startTransition(() => void onSyncEfashion())}
            onImport={() => void onStartImportEfashion()}
          />
          <SyncStatusPill
            source="ANKORSTORE"
            connected={syncMeta.ankorstore.hasCredentials}
            lastLabel={lastSyncLabel(syncMeta.ankorstore.lastSyncedAt)}
            nextLabel={nextSyncLabel(syncMeta.ankorstore.lastSyncedAt)}
            totalInDb={syncMeta.ankorstore.totalOrdersInDb}
            syncing={syncingAnkorstore}
            autoSyncEnabled={syncMeta.ankorstore.autoSyncEnabled}
            onToggleAutoSync={(v) => void onToggleAutoSync("ANKORSTORE", v)}
            onSyncNow={() => startTransition(() => void onSyncAnkorstore())}
            onImport={() => void onStartImportAnkorstore()}
          />
          <SyncStatusPill
            source="FAIRE"
            connected={syncMeta.faire.hasCredentials}
            lastLabel={lastSyncLabel(syncMeta.faire.lastSyncedAt)}
            nextLabel={nextSyncLabel(syncMeta.faire.lastSyncedAt)}
            totalInDb={syncMeta.faire.totalOrdersInDb}
            syncing={syncingFaire}
            autoSyncEnabled={syncMeta.faire.autoSyncEnabled}
            onToggleAutoSync={(v) => void onToggleAutoSync("FAIRE", v)}
            onSyncNow={() => startTransition(() => void onSyncFaire())}
            onImport={() => void onStartImportFaire()}
          />
          <SyncStatusPill
            source="MICROSTORE"
            connected={syncMeta.microstore.hasCredentials}
            lastLabel={lastSyncLabel(syncMeta.microstore.lastSyncedAt)}
            nextLabel={nextSyncLabel(syncMeta.microstore.lastSyncedAt)}
            totalInDb={syncMeta.microstore.totalOrdersInDb}
            syncing={syncingMicrostore}
            autoSyncEnabled={syncMeta.microstore.autoSyncEnabled}
            onToggleAutoSync={(v) => void onToggleAutoSync("MICROSTORE", v)}
            onSyncNow={() => startTransition(() => void onSyncMicrostore())}
            onImport={() => void onStartImportMicrostore()}
          />
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
        onPageChange={setPage}
        onOpen={onOpenOrder}
        statusCounts={stats?.statusCounts ?? null}
      />

      {isRefreshing && (
        <div
          className="loading-overlay-backdrop fixed inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-[100]"
          aria-live="polite"
        >
          <div className="loading-overlay-pill flex items-center gap-3 bg-bg-primary border border-border rounded-2xl px-6 py-4 shadow-lg">
            <svg className="loading-overlay-spinner w-5 h-5 animate-spin text-bg-dark" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium font-body text-text-primary">Chargement…</span>
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
    </div>
  );
}

function SyncStatusPill({
  source,
  connected,
  lastLabel,
  nextLabel,
  totalInDb,
  syncing,
  autoSyncEnabled,
  onToggleAutoSync,
  onSyncNow,
  onImport,
}: {
  source: MarketplaceSource;
  connected: boolean;
  lastLabel: string;
  nextLabel: string | null;
  totalInDb: number;
  syncing: boolean;
  autoSyncEnabled: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
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
  const wrapperCls = connected
    ? "flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary/50 p-3 min-w-0 flex-1 md:min-w-[220px]"
    : "flex flex-col gap-2 rounded-xl border border-dashed border-border bg-bg-secondary/30 p-3 min-w-0 flex-1 md:min-w-[220px] opacity-60";
  return (
    <div className={wrapperCls} title={connected ? undefined : `${marketplaceLabel} — non configurée`}>
      {/* Header : badge + nom + toggle Auto */}
      <div className="flex items-center gap-2 min-w-0">
        <MarketplaceBadge source={source} size="sm" />
        <div className="font-medium text-[12.5px] text-text-primary truncate flex-1">
          {marketplaceLabel}
        </div>
        <AutoSyncToggle
          enabled={autoSyncEnabled}
          disabled={!connected}
          onChange={onToggleAutoSync}
          marketplaceLabel={marketplaceLabel}
        />
      </div>

      {/* Infos synchro : stats + dernière + prochaine auto (ou "Auto désactivée") */}
      <div className="text-[11px] leading-tight text-text-muted min-h-[28px]">
        {connected ? (
          <>
            <div className="truncate">
              {totalInDb.toLocaleString("fr-FR")} en base · {lastLabel}
            </div>
            {autoSyncEnabled ? (
              nextLabel && (
                <div className="inline-flex items-center gap-1 mt-0.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-text-secondary">Prochaine&nbsp;</span>
                  <span className="text-text-primary tabular-nums font-medium">{nextLabel}</span>
                </div>
              )
            ) : (
              <div className="inline-flex items-center gap-1 mt-0.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span className="text-text-secondary italic">Auto désactivée</span>
              </div>
            )}
          </>
        ) : (
          <span className="italic">Non configurée</span>
        )}
      </div>

      {/* Boutons — la synchro manuelle et le rattrapage restent utilisables
          même quand l'auto est OFF (c'est le worker qu'on coupe, pas les
          actions manuelles). */}
      <div className="flex items-center gap-1.5 mt-auto">
        <button
          type="button"
          onClick={onSyncNow}
          disabled={!connected || syncing}
          className="flex-1 rounded-lg border border-border bg-white text-xs px-2 py-1.5 hover:bg-bg-secondary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {syncing ? "…" : "Synchro"}
        </button>
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            disabled={!connected}
            className="flex-1 rounded-lg bg-slate-900 text-white text-xs px-2 py-1.5 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              connected
                ? "Rattrapage complet — récupère toutes les commandes non encore importées"
                : `${marketplaceLabel} — non configurée`
            }
          >
            Rattrapage
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Petit toggle ON/OFF (switch iOS style) placé dans le header de chaque
 * SyncStatusPill. Coupe uniquement le worker automatique — les boutons
 * « Synchro » et « Rattrapage » restent utilisables.
 */
function AutoSyncToggle({
  enabled,
  disabled,
  onChange,
  marketplaceLabel,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
  marketplaceLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`Auto-synchro ${marketplaceLabel} ${enabled ? "activée" : "désactivée"}`}
      title={
        disabled
          ? `${marketplaceLabel} — non configurée`
          : enabled
          ? "Auto-synchro activée (5 min). Clique pour couper."
          : "Auto-synchro désactivée. Clique pour rallumer (compteur repart à 5:00)."
      }
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
        disabled
          ? "bg-slate-200 cursor-not-allowed opacity-50"
          : enabled
          ? "bg-emerald-500"
          : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-4" : "translate-x-0.5"
        }`}
        aria-hidden
      />
    </button>
  );
}
