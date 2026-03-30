"use client";

import { useEffect } from "react";

/**
 * Admin panel error boundary — catches errors in admin routes.
 * Shows error details in development mode.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Admin Error Boundary]", error);

    fetch("/api/internal/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "admin-error-boundary",
        message: error.message || "Unknown admin error",
        digest: error.digest,
      }),
    }).catch(() => {
      // Silently fail — error already logged to console
    });
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12 bg-bg-primary">
      <div className="max-w-lg w-full text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-red-500"
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
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-3">
          Erreur dans le panneau d&apos;administration
        </h1>

        {/* Message */}
        <p className="font-body text-text-secondary text-sm leading-relaxed mb-6">
          Une erreur inattendue s&apos;est produite. Veuillez réessayer ou
          contacter le support technique si le problème persiste.
        </p>

        {/* Dev-mode error details */}
        {isDev && (
          <div className="mb-6 text-left bg-red-500/5 border border-red-500/20 rounded-xl p-4 overflow-auto max-h-48">
            <p className="font-mono text-xs text-red-400 font-semibold mb-1">
              {error.name}: {error.message}
            </p>
            {error.digest && (
              <p className="font-mono text-xs text-text-tertiary">
                Digest: {error.digest}
              </p>
            )}
            {error.stack && (
              <pre className="font-mono text-xs text-text-tertiary mt-2 whitespace-pre-wrap break-words">
                {error.stack}
              </pre>
            )}
          </div>
        )}

        {/* Retry button */}
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 transition-colors font-body"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
