"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Route-level error boundary — catches errors in page rendering.
 * Reports to the health system and redirects to /maintenance.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [autoRecovering, setAutoRecovering] = useState(false);

  useEffect(() => {
    reportClientError({ source: "route-error-boundary", error })
      .then(({ transient, maintenanceTriggered }) => {
        if (maintenanceTriggered) {
          window.location.href = "/maintenance";
          return;
        }
        if (!transient) return;

        // Casse-boucle Safari iOS : si une erreur « transient » revient à
        // chaque reload (vrai bug persistant mal classé), le `reload()` en
        // boucle fait apparaître l'écran natif « Un problème récurrent est
        // survenu » sur mobile. On autorise 2 reloads auto, puis on affiche
        // l'écran d'erreur normal avec bouton « Réessayer ».
        const ATTEMPTS_KEY = "bj-error-reload-attempts";
        const LAST_AT_KEY = "bj-error-reload-last";
        const RESET_WINDOW_MS = 30_000;
        const MAX_AUTO_RELOADS = 2;
        try {
          const now = Date.now();
          const last = Number(sessionStorage.getItem(LAST_AT_KEY) ?? "0");
          const prev = Number(sessionStorage.getItem(ATTEMPTS_KEY) ?? "0");
          const attempts = now - last > RESET_WINDOW_MS ? 1 : prev + 1;
          sessionStorage.setItem(ATTEMPTS_KEY, String(attempts));
          sessionStorage.setItem(LAST_AT_KEY, String(now));
          if (attempts > MAX_AUTO_RELOADS) return; // Montre l'écran d'erreur normal
        } catch { /* sessionStorage KO (safari privé) : on tente quand même 1 reload */ }

        setAutoRecovering(true);
        window.location.reload();
      })
      .catch(() => {});
  }, [error]);

  if (autoRecovering) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="mx-auto mb-8 w-14 h-14 rounded-full border border-white/10 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-6 h-6 text-white/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="font-heading text-2xl font-semibold text-white mb-3 tracking-tight">
          Une erreur est survenue
        </h1>

        {/* Message */}
        <p className="font-body text-white/40 text-sm leading-relaxed mb-10">
          Un problème technique a été détecté. Notre équipe en est
          automatiquement informée.
        </p>

        {/* Retry button */}
        <button
          onClick={reset}
          className="px-8 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-colors font-body"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
