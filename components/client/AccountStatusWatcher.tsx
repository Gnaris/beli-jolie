"use client";

import { useEffect, useRef } from "react";
import { signOut, useSession } from "next-auth/react";

interface AccountStatusWatcherProps {
  /** Statut courant côté serveur (au moment du rendu de la page) */
  initialStatus: "PENDING" | "APPROVED" | "REJECTED";
  /** Intervalle de polling en millisecondes (défaut 8s) */
  intervalMs?: number;
}

/**
 * Surveille le statut du compte côté client en interrogeant
 * `/api/auth/me/status` à intervalle régulier :
 *  - changement de statut (PENDING → APPROVED par l'admin) → reload pour appliquer
 *  - 404 (compte supprimé en BDD) → déconnexion forcée immédiate
 */
export default function AccountStatusWatcher({
  initialStatus,
  intervalMs = 8000,
}: AccountStatusWatcherProps) {
  const { update } = useSession();
  const triggeredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (triggeredRef.current) return;
      try {
        const res = await fetch("/api/auth/me/status", { cache: "no-store" });
        // Compte supprimé côté admin → on déconnecte immédiatement.
        if (res.status === 404) {
          triggeredRef.current = true;
          if (!cancelled) {
            await signOut({ callbackUrl: "/connexion", redirect: true });
          }
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { status?: string };
        if (cancelled || !data.status) return;
        if (data.status !== initialStatus) {
          triggeredRef.current = true;
          try {
            await update();
          } catch {
            /* ignore */
          }
          if (!cancelled) {
            window.location.reload();
          }
        }
      } catch {
        /* silent — on retentera au prochain tick */
      }
    }

    const id = setInterval(check, intervalMs);
    // Vérification immédiate aussi (utile si l'admin a agi pendant que la
    // page était en arrière-plan).
    check();

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [initialStatus, intervalMs, update]);

  return null;
}
