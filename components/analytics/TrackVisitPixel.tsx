"use client";

import { useEffect } from "react";

const SESSION_FLAG = "bj_visit_tracked";

/**
 * Composant invisible qui ping `/api/track-visit` une fois par session
 * navigateur. La déduplication finale est faite côté serveur (clé unique
 * `visitorId + date`), donc même si le ping est rejoué, le compteur ne
 * bouge pas. Le flag sessionStorage évite simplement les requêtes inutiles.
 */
export default function TrackVisitPixel() {
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (sessionStorage.getItem(SESSION_FLAG) === "1") return;
    } catch {
      // sessionStorage indisponible (mode privé extrême) → on tente quand même.
    }

    const controller = new AbortController();
    fetch("/api/track-visit", {
      method:      "POST",
      signal:      controller.signal,
      credentials: "include",
      keepalive:   true,
    })
      .then(() => {
        try { sessionStorage.setItem(SESSION_FLAG, "1"); } catch { /* ignore */ }
      })
      .catch(() => { /* network error — silently ignore */ });

    return () => controller.abort();
  }, []);

  return null;
}
