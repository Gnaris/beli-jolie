"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setNewsletterPreference } from "@/app/actions/client/profile";

/**
 * Toggle newsletter pour l'espace pro.
 * Sauvegarde immédiate (pas de mode « édition ») : le client peut se
 * désinscrire en 1 clic, comme exigé par la CNIL.
 */
export default function NewsletterToggle({
  acceptsNewsletter: initial,
}: {
  acceptsNewsletter: boolean;
}) {
  const t = useTranslations("account");
  const [accepts, setAccepts] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);

  function toggle() {
    const next = !accepts;
    setAccepts(next); // optimistic
    setFeedback(null);
    startTransition(async () => {
      try {
        await setNewsletterPreference(next);
        setFeedback("saved");
        setTimeout(() => setFeedback(null), 3000);
      } catch {
        setAccepts(!next); // rollback
        setFeedback("error");
      }
    });
  }

  return (
    <div className="bg-bg-primary rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-text-primary">
          {t("newsletterSection")}
        </h2>
        {feedback === "saved" && (
          <span className="text-xs text-emerald-600 font-body flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            {t("saved")}
          </span>
        )}
        {feedback === "error" && (
          <span className="text-xs text-error font-body">{t("updateError")}</span>
        )}
      </div>

      <div className="p-5 flex items-start gap-4">
        <button
          type="button"
          onClick={toggle}
          disabled={isPending}
          role="switch"
          aria-checked={accepts}
          aria-label={t("newsletterToggleAria")}
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
          <p className="text-sm font-body font-medium text-text-primary">
            {accepts ? t("newsletterOnLabel") : t("newsletterOffLabel")}
          </p>
          <p className="text-xs font-body text-text-muted mt-1 leading-relaxed">
            {accepts ? t("newsletterOnDesc") : t("newsletterOffDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}
