"use client";

import { useEffect, useState } from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Client area error boundary — catches errors in espace-pro, panier, commandes, favoris.
 */
export default function ClientError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Si l'erreur est identifiée transient (hoquet navigateur type Safari
  // Translate qui mute le DOM sous React), on recharge la page sans montrer
  // le fallback anxiogène qui faisait abandonner le checkout.
  const [autoRecovering, setAutoRecovering] = useState(false);

  useEffect(() => {
    console.error("[Client Error Boundary]", error);
    reportClientError({ source: "client-error-boundary", error })
      .then(({ transient }) => {
        if (transient) {
          setAutoRecovering(true);
          window.location.reload();
        }
      })
      .catch(() => {});
  }, [error]);

  if (autoRecovering) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-[#F5F5F5] flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-8 h-8 text-[#999]"
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
        <h1 className="font-heading text-2xl font-bold text-[#1A1A1A] mb-3">
          Une erreur est survenue
        </h1>

        {/* Message */}
        <p className="font-body text-[#666] text-sm leading-relaxed mb-8">
          Nous n&apos;avons pas pu charger cette page. Veuillez réessayer dans
          quelques instants. Si le problème persiste, n&apos;hésitez pas à nous
          contacter.
        </p>

        {/* Retry button */}
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-lg bg-[#1A1A1A] text-white text-sm font-medium hover:bg-[#333] transition-colors font-body"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
