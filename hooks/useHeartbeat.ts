"use client";

import { useEffect } from "react";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/online-status";
import {
  getActiveConversationId,
  subscribeActiveConversation,
} from "@/lib/conversation-presence";

/**
 * Envoie un ping POST /api/heartbeat toutes les HEARTBEAT_INTERVAL_MS
 * tant que le composant est monté ET que l'onglet est visible.
 *
 * Le body inclut `activeConversationId` : si le client est en train de
 * lire une conversation Service Client, le serveur le sait et n'enverra
 * pas d'email « nouvelle réponse » pour cette conv.
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
      const activeConversationId = getActiveConversationId();
      fetch("/api/heartbeat", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeConversationId }),
      }).catch(() => {
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

    // Ping immédiat à chaque changement de conversation active (ouverture /
    // fermeture du chat, navigation vers/hors la page réclamation) — pour
    // ne pas attendre 30 s avant que le serveur voie le nouveau contexte.
    const unsub = subscribeActiveConversation(() => ping());

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      unsub();
    };
  }, [enabled]);
}
