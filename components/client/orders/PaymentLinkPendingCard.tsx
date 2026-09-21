"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { regeneratePaymentLink } from "@/app/actions/client/payment-link-order";

/**
 * Encart affiché sur la fiche commande client quand la commande a été créée
 * via le fallback "lien de paiement" (paymentMode=STRIPE_LINK) et n'a pas
 * encore été réglée. Comportement équivalent à l'encart IBAN du virement.
 *
 * - Si le lien est valide → gros bouton "Payer maintenant" vers checkout.stripe.com
 * - Si le lien est expiré (24h) → bouton "Régénérer le lien"
 */
export default function PaymentLinkPendingCard({
  orderId,
  orderNumber,
  totalTTC,
  initialUrl,
  initialExpiresAt,
}: {
  orderId: string;
  orderNumber: string;
  totalTTC: number;
  initialUrl: string | null;
  initialExpiresAt: string | null;
}) {
  const t = useTranslations("orders");
  const locale = useLocale();
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);
  const [error, setError] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const now = Date.now();
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= now : true;

  const expiresStr = expiresAt
    ? new Date(expiresAt).toLocaleString(locale === "en" ? "en-GB" : "fr-FR", {
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  function handleRegenerate() {
    setError("");
    startTransition(async () => {
      const res = await regeneratePaymentLink(orderId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setUrl(res.url);
      setExpiresAt(res.expiresAt);
    });
  }

  return (
    <section className="bg-white border border-emerald-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-7 sm:px-8 py-5 border-b border-emerald-100 bg-emerald-50 flex items-center gap-4">
        <div className="w-1.5 h-10 bg-emerald-500 rounded-full" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
            {t("paymentLinkPending")}
          </p>
          <h2 className="font-heading text-xl sm:text-2xl font-semibold text-slate-900 mt-1">
            {t("paymentLinkPendingDesc")}
          </h2>
        </div>
      </div>
      <div className="p-7 sm:p-8 space-y-5">
        <div className="rounded-2xl bg-slate-900 text-white p-6">
          <p className="text-[10px] uppercase tracking-widest opacity-60 font-semibold mb-4">
            {t("paymentLinkAmountLabel")}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 items-end">
            <div>
              <p className="opacity-60 text-xs mb-1">{t("paymentLinkOrderLabel")}</p>
              <p className="font-mono font-semibold">{orderNumber}</p>
            </div>
            <div>
              <p className="opacity-60 text-xs mb-1">{t("paymentLinkAmount")}</p>
              <p className="font-heading text-3xl font-bold">{totalTTC.toFixed(2)} €</p>
            </div>
          </div>
        </div>

        {url && !isExpired && (
          <div className="space-y-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-14 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold flex items-center justify-center gap-2"
            >
              🔒 {t("paymentLinkPayNow")}
            </a>
            {expiresAt && (
              <p className="text-[11px] text-slate-500 text-center">
                {t("paymentLinkValidUntil", { date: expiresStr })}
              </p>
            )}
          </div>
        )}

        {(!url || isExpired) && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 space-y-3">
            <p className="text-sm text-amber-900">
              {isExpired ? t("paymentLinkExpired") : t("paymentLinkMissing")}
            </p>
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={pending}
              className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-2"
            >
              {pending ? (
                <>
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  {t("paymentLinkRegenerating")}
                </>
              ) : (
                t("paymentLinkRegenerate")
              )}
            </button>
            {error && (
              <p className="text-xs text-red-700 text-center">{error}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
