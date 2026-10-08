"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export const COOKIE_CONSENT_NAME = "bj_cookie_consent";
/** 13 mois, limite CNIL. */
const COOKIE_CONSENT_MAX_AGE = 60 * 60 * 24 * 395;

type Decision = "accepted" | "refused" | "";

function writeConsentCookie(value: Exclude<Decision, "">) {
  if (typeof document === "undefined") return;
  const parts = [
    `${COOKIE_CONSENT_NAME}=${value}`,
    `path=/`,
    `max-age=${COOKIE_CONSENT_MAX_AGE}`,
    `SameSite=Lax`,
  ];
  if (window.location.protocol === "https:") parts.push("Secure");
  document.cookie = parts.join("; ");
}

function pushConsentUpdate(value: Exclude<Decision, "">) {
  if (typeof window === "undefined") return;
  const granted = value === "accepted" ? "granted" : "denied";
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  w.dataLayer = w.dataLayer || [];
  const push: (...args: unknown[]) => void =
    w.gtag ?? ((...args: unknown[]) => w.dataLayer!.push(args));
  push("consent", "update", {
    ad_storage: granted,
    ad_user_data: granted,
    ad_personalization: granted,
    analytics_storage: granted,
    functionality_storage: granted,
    personalization_storage: granted,
  });
}

interface Props {
  /** Décision lue côté serveur depuis le cookie. */
  initialDecision: string;
}

export default function CookieConsentBanner({ initialDecision }: Props) {
  const t = useTranslations("cookieBanner");
  const [decision, setDecision] = useState<Decision>(
    initialDecision === "accepted" || initialDecision === "refused"
      ? initialDecision
      : "",
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || decision !== "") return null;

  function choose(value: Exclude<Decision, "">) {
    writeConsentCookie(value);
    pushConsentUpdate(value);
    setDecision(value);
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("ariaLabel")}
      className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-3xl rounded-2xl border border-border bg-bg-primary/95 backdrop-blur shadow-xl p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-body text-text-primary leading-relaxed">
            <span className="font-semibold">{t("title")}</span>{" "}
            <span className="text-text-secondary">{t("message")}</span>{" "}
            <Link
              href="/cookies"
              className="underline underline-offset-2 text-text-primary hover:text-text-muted"
            >
              {t("learnMore")}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => choose("refused")}
            className="h-9 px-4 rounded-lg border border-border text-sm font-body font-medium text-text-primary hover:bg-bg-secondary transition-colors"
          >
            {t("refuse")}
          </button>
          <button
            type="button"
            onClick={() => choose("accepted")}
            className="h-9 px-4 rounded-lg bg-bg-dark text-text-inverse text-sm font-body font-semibold hover:bg-primary-hover transition-colors"
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
