"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    // Report error to the health circuit breaker
    fetch("/api/internal/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "route-error-boundary",
        message: error.message || "Unknown route error",
        digest: error.digest,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        // If maintenance was triggered, redirect to maintenance page
        if (data?.maintenanceTriggered) {
          window.location.href = "/maintenance";
        }
      })
      .catch(() => {
        // If reporting fails too, redirect to maintenance
        window.location.href = "/maintenance";
      });
  }, [error]);

  return (
    <div className="min-h-screen bg-[#1A1A1A] flex flex-col items-center justify-center px-6 py-12">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 max-w-lg w-full text-center">
        {/* Logo */}
        <div className="mb-10">
          <span className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-white tracking-tight">
            Notre site
          </span>
        </div>

        {/* Icon */}
        <div className="mx-auto mb-8 w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-9 h-9 text-white/70"
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
        <h1 className="font-[family-name:var(--font-poppins)] text-3xl font-bold text-white mb-4 leading-tight">
          Une erreur est survenue
        </h1>

        {/* Divider */}
        <div className="mx-auto mb-6 w-12 h-px bg-white/20" />

        {/* Message */}
        <p className="font-[family-name:var(--font-roboto)] text-white/60 text-base leading-relaxed mb-4">
          Nous avons détecté un problème technique. Notre équipe est
          automatiquement notifiée et travaille à le résoudre.
        </p>
        <p className="font-[family-name:var(--font-roboto)] text-white/60 text-base leading-relaxed mb-10">
          Merci pour votre patience et votre confiance.
        </p>

        {/* Status badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8">
          <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
          <span className="font-[family-name:var(--font-roboto)] text-white/50 text-sm">
            Résolution en cours
          </span>
        </div>

        {/* Retry button */}
        <div>
          <button
            onClick={reset}
            className="px-6 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm font-medium hover:bg-white/15 transition-colors font-[family-name:var(--font-roboto)]"
          >
            Réessayer
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 mt-12 text-center">
        <p className="font-[family-name:var(--font-roboto)] text-white/20 text-xs">
          Plateforme réservée aux professionnels revendeurs
        </p>
      </div>
    </div>
  );
}
