"use client";

/**
 * Contexte du rail latéral droit de l'admin.
 *
 * Un seul tiroir ouvert à la fois. Les icônes de la barre exposent un badge
 * (nombre de tâches en cours) qui vient du widget concerné — le rail lui-même
 * ne connaît pas le domaine, il stocke juste les badges et gère l'ouverture.
 *
 * Widget IDs actuels : "translation". Les prochains (marketplaces, images,
 * shooting) s'ajouteront ici quand la Phase 2 démarrera.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type RailWidgetId =
  | "translation"
  | "marketplaces"
  | "images"
  | "shooting"
  | "chat"
  | "emails"
  | "orders-import"
  | "pfs-audit"
  | "microstore-upload"
  // Alias legacy — les 3 clés précédentes redirigent vers orders-import
  // pour ne pas casser les liens existants (widget key dans MarketplacesOrdersView).
  | "pfs-import"
  | "efashion-import"
  | "ankorstore-import";

interface RailBadge {
  /** Nombre affiché sur le badge (0 = pas de badge). */
  count: number;
  /** Fait clignoter le badge (halo pulsant) — pour attirer l'attention. */
  pulse?: boolean;
}

/**
 * Sources marketplace pour lesquelles on suit une synchro manuelle. Utilisées
 * uniquement par le widget « Import commandes / clients marketplaces » pour
 * afficher un feedback immédiat quand la cliente clique sur « Synchro » depuis
 * la page Commandes → onglet marketplace. Les synchros auto (workers, cron)
 * n'apparaissent pas ici.
 */
export type ManualSyncSource =
  | "PFS"
  | "EFASHION"
  | "ANKORSTORE"
  | "FAIRE"
  | "MICROSTORE";

export interface ManualSyncEvent {
  source: ManualSyncSource;
  /** Cible de la synchro — pour l'instant seulement « orders ». Prépare le
   * terrain pour le Bloc 3 (import clients). */
  target: "orders" | "clients";
  phase: "starting" | "success" | "error";
  startedAt: number;
  endedAt?: number;
  created?: number;
  updated?: number;
  errorMessage?: string;
  sessionExpired?: boolean;
}

interface RightRailContextValue {
  openWidget: RailWidgetId | null;
  open: (id: RailWidgetId) => void;
  close: () => void;
  toggle: (id: RailWidgetId) => void;
  setBadge: (id: RailWidgetId, badge: RailBadge) => void;
  getBadge: (id: RailWidgetId) => RailBadge;
  /**
   * Timestamp du dernier "nudge" par widget — signale au drawer concerné
   * qu'une action côté cliente vient de créer un job court (ex: sync photos
   * Microstore de 5 s) et qu'il doit refresh immédiatement + rester en poll
   * actif quelques secondes pour ne pas rater la fenêtre.
   */
  nudges: Record<string, number>;
  /** Déclenche un refresh immédiat du widget cible. */
  nudgeWidget: (id: RailWidgetId) => void;
  /** État courant des synchros manuelles par source. `null` = pas de synchro
   * récente à afficher. */
  manualSyncs: Record<ManualSyncSource, ManualSyncEvent | null>;
  /** Enregistre une synchro manuelle en cours ou terminée. */
  pushManualSync: (event: ManualSyncEvent) => void;
  /** Nettoie la carte "résultat" d'une source (fermer le récap). */
  clearManualSync: (source: ManualSyncSource, target: "orders" | "clients") => void;
}

const RightRailContext = createContext<RightRailContextValue | null>(null);

const EMPTY_MANUAL_SYNCS: Record<ManualSyncSource, ManualSyncEvent | null> = {
  PFS: null,
  EFASHION: null,
  ANKORSTORE: null,
  FAIRE: null,
  MICROSTORE: null,
};

export function RightRailProvider({ children }: { children: React.ReactNode }) {
  const [openWidget, setOpenWidget] = useState<RailWidgetId | null>(null);
  const [badges, setBadges] = useState<Record<string, RailBadge>>({});
  const [nudges, setNudges] = useState<Record<string, number>>({});
  const [manualSyncs, setManualSyncs] =
    useState<Record<ManualSyncSource, ManualSyncEvent | null>>(EMPTY_MANUAL_SYNCS);

  const open = useCallback((id: RailWidgetId) => setOpenWidget(id), []);
  const close = useCallback(() => setOpenWidget(null), []);
  const toggle = useCallback(
    (id: RailWidgetId) => setOpenWidget((cur) => (cur === id ? null : id)),
    [],
  );
  const setBadge = useCallback((id: RailWidgetId, badge: RailBadge) => {
    setBadges((prev) => {
      const cur = prev[id];
      if (cur && cur.count === badge.count && cur.pulse === badge.pulse) return prev;
      return { ...prev, [id]: badge };
    });
  }, []);
  const getBadge = useCallback(
    (id: RailWidgetId): RailBadge => badges[id] ?? { count: 0 },
    [badges],
  );
  const nudgeWidget = useCallback((id: RailWidgetId) => {
    setNudges((prev) => ({ ...prev, [id]: Date.now() }));
  }, []);
  const pushManualSync = useCallback((event: ManualSyncEvent) => {
    setManualSyncs((prev) => ({ ...prev, [event.source]: event }));
  }, []);
  const clearManualSync = useCallback(
    (source: ManualSyncSource, target: "orders" | "clients") => {
      setManualSyncs((prev) => {
        const cur = prev[source];
        if (!cur || cur.target !== target) return prev;
        return { ...prev, [source]: null };
      });
    },
    [],
  );

  const value = useMemo<RightRailContextValue>(
    () => ({
      openWidget,
      open,
      close,
      toggle,
      setBadge,
      getBadge,
      nudges,
      nudgeWidget,
      manualSyncs,
      pushManualSync,
      clearManualSync,
    }),
    [
      openWidget,
      open,
      close,
      toggle,
      setBadge,
      getBadge,
      nudges,
      nudgeWidget,
      manualSyncs,
      pushManualSync,
      clearManualSync,
    ],
  );

  return <RightRailContext.Provider value={value}>{children}</RightRailContext.Provider>;
}

export function useRightRail(): RightRailContextValue {
  const ctx = useContext(RightRailContext);
  if (!ctx) throw new Error("useRightRail must be used within <RightRailProvider>");
  return ctx;
}
