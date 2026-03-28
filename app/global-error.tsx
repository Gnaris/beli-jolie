"use client";

import { useEffect } from "react";

/**
 * Global error boundary — catches errors that escape route-level error.tsx.
 * Reports to the health system and shows the maintenance page inline.
 */
export default function GlobalError({
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
        source: "global-error-boundary",
        message: error.message || "Unknown global error",
        digest: error.digest,
      }),
    }).catch(() => {
      // If even this fails, we're in deep trouble — nothing more we can do
    });
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, padding: 0, backgroundColor: "#1A1A1A" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          {/* Logo */}
          <div style={{ marginBottom: "40px" }}>
            <span
              style={{
                fontSize: "24px",
                fontWeight: 700,
                color: "#ffffff",
                letterSpacing: "-0.025em",
              }}
            >
              Notre site
            </span>
          </div>

          {/* Icon */}
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "32px",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>

          {/* Title */}
          <h1
            style={{
              fontSize: "30px",
              fontWeight: 700,
              color: "#ffffff",
              marginBottom: "16px",
              textAlign: "center",
            }}
          >
            Site en maintenance
          </h1>

          {/* Divider */}
          <div
            style={{
              width: "48px",
              height: "1px",
              backgroundColor: "rgba(255,255,255,0.2)",
              marginBottom: "24px",
            }}
          />

          {/* Message */}
          <p
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "16px",
              lineHeight: 1.6,
              textAlign: "center",
              maxWidth: "480px",
              marginBottom: "16px",
            }}
          >
            Une erreur inattendue est survenue. Le site est temporairement en
            maintenance afin de résoudre le problème.
          </p>
          <p
            style={{
              color: "rgba(255,255,255,0.6)",
              fontSize: "16px",
              lineHeight: 1.6,
              textAlign: "center",
              maxWidth: "480px",
              marginBottom: "40px",
            }}
          >
            Merci pour votre patience et votre confiance.
          </p>

          {/* Status badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 16px",
              borderRadius: "9999px",
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              marginBottom: "24px",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#F59E0B",
              }}
            />
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px" }}>
              Maintenance en cours
            </span>
          </div>

          {/* Retry button */}
          <button
            onClick={reset}
            style={{
              padding: "10px 24px",
              borderRadius: "8px",
              backgroundColor: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#ffffff",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Réessayer
          </button>

          {/* Footer */}
          <p
            style={{
              marginTop: "48px",
              color: "rgba(255,255,255,0.2)",
              fontSize: "12px",
            }}
          >
            Plateforme réservée aux professionnels revendeurs
          </p>
        </div>
      </body>
    </html>
  );
}
