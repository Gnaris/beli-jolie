"use client";

import { useState, useTransition } from "react";
import { setUserNewsletter } from "@/app/actions/admin/setUserNewsletter";

/**
 * Toggle newsletter côté admin — sur la fiche d'un client.
 * Sauvegarde immédiate. Cas d'usage : le client appelle pour se désinscrire.
 */
export default function AdminNewsletterToggle({
  userId,
  initial,
}: {
  userId: string;
  initial: boolean;
}) {
  const [accepts, setAccepts] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);

  function toggle() {
    const next = !accepts;
    setAccepts(next);
    setFeedback(null);
    startTransition(async () => {
      try {
        await setUserNewsletter(userId, next);
        setFeedback("saved");
        setTimeout(() => setFeedback(null), 3000);
      } catch {
        setAccepts(!next);
        setFeedback("error");
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        role="switch"
        aria-checked={accepts}
        aria-label="Basculer la préférence newsletter"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text-primary disabled:opacity-50 ${
          accepts ? "bg-text-primary" : "bg-bg-tertiary border border-border-strong"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-text-inverse shadow-sm transition-transform ${
            accepts ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">
          {accepts ? "Abonné(e) à la newsletter" : "Désinscrit(e) — aucun email marketing"}
        </p>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
          {accepts
            ? "Reçoit nouveautés, promotions et rappels de panier oublié."
            : "Ne reçoit que les emails liés à ses commandes."}
        </p>
      </div>
      {feedback === "saved" && (
        <span className="text-xs text-emerald-600 flex items-center gap-1 shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Enregistré
        </span>
      )}
      {feedback === "error" && (
        <span className="text-xs text-error shrink-0">Erreur — réessayez.</span>
      )}
    </div>
  );
}
