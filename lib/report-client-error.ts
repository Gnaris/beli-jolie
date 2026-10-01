"use client";

import { isTransientBrowserError } from "@/lib/transient-browser-errors";

interface ReportArgs {
  source: string;
  error: Error & { digest?: string };
}

interface ReportResult {
  transient: boolean;
  maintenanceTriggered: boolean;
}

/**
 * Envoie l'erreur à /api/internal/report-error avec un payload enrichi
 * (URL, user-agent, visibilité onglet) pour que le log serveur ait de
 * quoi diagnostiquer sans relancer le client. Retourne un verdict :
 * `transient:true` → la cliente appelante doit déclencher un reload
 * silencieux au lieu d'afficher le fallback d'erreur.
 */
export async function reportClientError({ source, error }: ReportArgs): Promise<ReportResult> {
  const payload = {
    source,
    message: error.message || `Unknown ${source}`,
    digest: error.digest,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    visibilityState: typeof document !== "undefined" ? document.visibilityState : undefined,
    wasHidden: typeof document !== "undefined" ? document.hidden : undefined,
  };

  try {
    const res = await fetch("/api/internal/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (!res.ok) {
      return { transient: isTransientBrowserError(error.message), maintenanceTriggered: false };
    }
    const data = await res.json().catch(() => ({}));
    return {
      transient: Boolean(data?.transient) || isTransientBrowserError(error.message),
      maintenanceTriggered: Boolean(data?.maintenanceTriggered),
    };
  } catch {
    return { transient: isTransientBrowserError(error.message), maintenanceTriggered: false };
  }
}
