"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";

interface Props {
  clientSecret: string;
  publishableKey: string;
  amountLabel: string;
  onClose: () => void;
}

/**
 * Monte un Stripe Checkout en mode « embedded » (iframe intégrée dans la
 * page commande, pas de redirection externe). Même expérience que le
 * paiement du panier, mais pour un complément.
 */
export default function SupplementCheckoutModal({
  clientSecret,
  publishableKey,
  amountLabel,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Instance Stripe mémoïsée par clé publique (loadStripe est caché par Stripe
  // en interne, mais on évite les re-créations inutiles sur chaque render).
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              Paiement sécurisé Stripe
            </p>
            <h3 className="font-heading text-lg font-semibold text-slate-900 mt-0.5">
              Compléter le règlement — {amountLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </div>
    </div>
  );
}
