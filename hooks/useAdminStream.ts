"use client";

import { useEffect, useRef } from "react";
import type { AdminEvent, AdminEventType } from "@/lib/admin-events";

/**
 * Abonne un composant admin au flux SSE /api/admin/stream.
 *
 * - Ouvre une connexion EventSource au mount.
 * - Reconnexion automatique gérée nativement par EventSource après rupture.
 * - Pause de la connexion quand l'onglet est masqué pour ne pas garder
 *   des sockets ouvertes inutilement (Nginx/Node) ; reprise à la visibilité.
 * - `types` filtre les events reçus (le serveur n'a pas de filtre fin, on
 *   fait ça côté client). Si absent → tous les events admin.
 *
 * À utiliser uniquement dans un sous-arbre monté exclusivement pour un
 * administrateur authentifié. La route SSE elle-même refuse 401 sinon.
 */
export function useAdminStream(
  onEvent: (event: AdminEvent) => void,
  types?: readonly AdminEventType[],
): void {
  // Garde l'identité du callback stable sans forcer les consommateurs
  // à useCallback leur handler.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  // Idem pour la liste de types : évite de rouvrir la connexion si le
  // tableau est passé en littéral à chaque rendu.
  const typesKey = types ? types.slice().sort().join(",") : "";

  useEffect(() => {
    if (typeof window === "undefined") return;

    let eventSource: EventSource | null = null;

    function open() {
      if (eventSource) return;
      eventSource = new EventSource("/api/admin/stream");
      eventSource.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as AdminEvent;
          if (typesKey && !typesKey.split(",").includes(data.type)) return;
          handlerRef.current(data);
        } catch {
          /* ignore malformed */
        }
      };
      // onerror : EventSource reconnecte tout seul (readyState → CONNECTING).
      // On n'a rien à faire ici, mais on garde le hook si on veut logger.
    }

    function close() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") open();
      else close();
    }

    if (document.visibilityState === "visible") open();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      close();
    };
  }, [typesKey]);
}
