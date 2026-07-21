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
  | "pfs-import";

interface RailBadge {
  /** Nombre affiché sur le badge (0 = pas de badge). */
  count: number;
  /** Fait clignoter le badge (halo pulsant) — pour attirer l'attention. */
  pulse?: boolean;
}

interface RightRailContextValue {
  openWidget: RailWidgetId | null;
  open: (id: RailWidgetId) => void;
  close: () => void;
  toggle: (id: RailWidgetId) => void;
  setBadge: (id: RailWidgetId, badge: RailBadge) => void;
  getBadge: (id: RailWidgetId) => RailBadge;
}

const RightRailContext = createContext<RightRailContextValue | null>(null);

export function RightRailProvider({ children }: { children: React.ReactNode }) {
  const [openWidget, setOpenWidget] = useState<RailWidgetId | null>(null);
  const [badges, setBadges] = useState<Record<string, RailBadge>>({});

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

  const value = useMemo<RightRailContextValue>(
    () => ({ openWidget, open, close, toggle, setBadge, getBadge }),
    [openWidget, open, close, toggle, setBadge, getBadge],
  );

  return <RightRailContext.Provider value={value}>{children}</RightRailContext.Provider>;
}

export function useRightRail(): RightRailContextValue {
  const ctx = useContext(RightRailContext);
  if (!ctx) throw new Error("useRightRail must be used within <RightRailProvider>");
  return ctx;
}
