"use client";

/**
 * Toggle « Ne plus recevoir de relances panier » pour l'espace pro.
 * Séparé du toggle newsletter global : la cliente peut vouloir couper les
 * relances panier tout en gardant les newsletters commerciales, et
 * réciproquement.
 *
 * L'état est stocké sur `User.abandonedCartOptOut`. Un `true` :
 *   - empêche la création de nouveaux jobs de relance
 *   - annule les jobs pending existants
 */

import { useState, useTransition } from "react";
import { setAbandonedCartOptOut } from "@/app/actions/client/abandoned-cart-optout";

export default function AbandonedCartOptOutToggle({
  optOut: initial,
}: {
  optOut: boolean;
}) {
  const [optOut, setOptOut] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);

  function toggle() {
    const next = !optOut;
    setOptOut(next); // optimistic
    setFeedback(null);
    startTransition(async () => {
      try {
        await setAbandonedCartOptOut(next);
        setFeedback("saved");
        setTimeout(() => setFeedback(null), 3000);
      } catch {
        setOptOut(!next);
        setFeedback("error");
      }
    });
  }

  return (
    <div className="bg-bg-primary rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          Relances panier abandonné
        </h2>
        {feedback === "saved" && (
          <span className="text-xs text-emerald-600 font-body flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Enregistré
          </span>
        )}
        {feedback === "error" && (
          <span className="text-xs text-error font-body">Erreur — réessayez.</span>
        )}
      </div>

      <div className="p-5 flex items-start gap-4">
        <button
          type="button"
          onClick={toggle}
          disabled={isPending}
          role="switch"
          aria-checked={!optOut}
          aria-label="Recevoir les relances panier"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text-primary disabled:opacity-50 ${
            !optOut ? "bg-text-primary" : "bg-bg-tertiary border border-border-strong"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-text-inverse shadow-sm transition-transform ${
              !optOut ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-body font-medium text-text-primary">
            {!optOut
              ? "Recevoir des rappels quand j'oublie un panier"
              : "Ne plus recevoir de rappels panier"}
          </p>
          <p className="text-xs font-body text-text-muted mt-1 leading-relaxed">
            {!optOut
              ? "Si vous laissez des articles dans votre panier sans commander, nous vous envoyons un ou plusieurs rappels par mail avec le contenu du panier. Aucun rappel ne part si vous passez commande."
              : "Vous ne recevrez plus aucun mail de rappel panier. Vous continuerez à recevoir vos e-mails de compte et de commande."}
          </p>
        </div>
      </div>
    </div>
  );
}
