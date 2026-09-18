"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { finalizeOrderFromPaymentIntent } from "@/app/actions/client/order";

type State =
  | { kind: "loading" }
  | { kind: "success"; orderId: string }
  | { kind: "canceled" }
  | { kind: "failed"; message: string };

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Client-side handler pour /panier/retour-paiement. Lit les query params posés
 * par Stripe après un redirect (PayPal, Billie...), appelle
 * `finalizeOrderFromPaymentIntent` et redirige vers la commande.
 *
 * Cas gérés :
 * - `redirect_status=succeeded` → finalize (avec retry court si `processing`)
 * - `redirect_status=failed` → écran erreur + bouton retour panier
 * - Pas de `payment_intent` → écran erreur inconnu
 */
export default function PaymentReturnClient() {
  const t = useTranslations("checkout");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>({ kind: "loading" });
  const attemptRef = useRef(0);

  useEffect(() => {
    const paymentIntentId = searchParams.get("payment_intent");
    const redirectStatus = searchParams.get("redirect_status");

    if (!paymentIntentId) {
      setState({ kind: "failed", message: t("returnUnknown") });
      return;
    }

    // PayPal peut renvoyer `failed` si le client a annulé côté paypal.com.
    if (redirectStatus === "failed") {
      setState({ kind: "failed", message: t("returnFailed") });
      return;
    }

    let cancelled = false;

    async function attempt() {
      attemptRef.current += 1;
      const res = await finalizeOrderFromPaymentIntent(paymentIntentId!);
      if (cancelled) return;

      if (res.success) {
        setState({ kind: "success", orderId: res.orderId });
        router.replace(`/commandes/${res.orderId}`);
        return;
      }

      // PayPal reste ~30s en "processing" avant `succeeded` — on retente.
      if (res.retryable && attemptRef.current < MAX_RETRIES) {
        setTimeout(() => {
          if (!cancelled) attempt();
        }, RETRY_DELAY_MS);
        return;
      }

      // Après MAX_RETRIES ou erreur définitive.
      setState({ kind: "failed", message: res.error });
    }

    attempt();

    return () => {
      cancelled = true;
    };
  }, [searchParams, router, t]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center px-6 py-12">
      <div className="max-w-md w-full bg-bg-primary border border-border rounded-2xl shadow-sm p-8 text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted font-semibold">
          {t("returnTitle")}
        </p>

        {state.kind === "loading" && (
          <div className="mt-6 space-y-4">
            <div className="mx-auto h-10 w-10 rounded-full border-2 border-slate-300 border-t-slate-900 animate-spin" />
            <p className="text-sm text-text-secondary">{t("returnProcessing")}</p>
          </div>
        )}

        {state.kind === "success" && (
          <p className="mt-6 text-sm text-text-secondary">{t("returnSuccessRedirect")}</p>
        )}

        {state.kind === "canceled" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-text-secondary">{t("returnCanceled")}</p>
            <button
              type="button"
              onClick={() => router.replace("/panier")}
              className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              {t("returnRetry")}
            </button>
          </div>
        )}

        {state.kind === "failed" && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4 text-left">
              {state.message}
            </div>
            <button
              type="button"
              onClick={() => router.replace("/panier")}
              className="inline-flex items-center justify-center px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
            >
              {t("returnBackToCart")}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
