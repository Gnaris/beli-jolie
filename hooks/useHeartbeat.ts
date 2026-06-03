"use client";

import { useEffect } from "react";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/online-status";

/**
 * Envoie un ping POST /api/heartbeat toutes les HEARTBEAT_INTERVAL_MS
 * tant que le composant est monté ET que l'onglet est visible.
 *
 * À monter uniquement quand un client est connecté (cf. HeartbeatLoader).
 */
export function useHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const ping = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.hidden) return;
      fetch("/api/heartbeat", { method: "POST", keepalive: true }).catch(() => {
        /* ignore — un raté = on attend le prochain tick */
      });
    };

    ping(); // ping immédiat à la connexion / au remount
    const intervalId = window.setInterval(ping, HEARTBEAT_INTERVAL_MS);

    // Ping à chaque retour de visibilité (onglet ré-actif après pause)
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) ping();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
