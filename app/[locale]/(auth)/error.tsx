"use client";

import { useEffect } from "react";

/**
 * Auth pages error boundary — catches errors in connexion/inscription routes.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch("/api/internal/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "auth-error-boundary",
        message: error.message || "Unknown auth error",
        digest: error.digest,
      }),
    }).catch(() => {});
  }, [error]);

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
          Impossible de charger la page
        </h1>

        {/* Message */}
        <p className="font-body text-white/40 text-sm leading-relaxed mb-10">
          Une erreur s&apos;est produite lors du chargement. Veuillez réessayer.
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
