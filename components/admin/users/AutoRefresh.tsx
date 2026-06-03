"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rafraîchit le Server Component parent toutes les `intervalMs` via
 * `router.refresh()`. Met en pause quand l'onglet est masqué pour ne
 * pas tourner inutilement.
 */
export default function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    };

    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
