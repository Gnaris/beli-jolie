"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useToast } from "@/components/ui/Toast";
import {
  createOrderCardPaymentIntent,
  confirmOrderCardPayment,
} from "@/app/actions/client/pay-order-by-card";
import { reportPaymentError, normalizeStripeError } from "@/lib/report-payment-error";

interface Props {
  orderId: string;
  totalTTC: number;
  publishableKey: string | null;
}

/**
 * Bouton « Payer par carte maintenant » affiché sur une commande virement
 * encore en attente. Ouvre une modale Stripe, bascule la commande en
 * paymentMode=CARD après paiement réussi.
 */
export default function PayOrderByCardButton({ orderId, totalTTC, publishableKey }: Props) {
  const [open, setOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const router = useRouter();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    if (publishableKey && !stripePromise) {
      setStripePromise(loadStripe(publishableKey));
    }
  }, [publishableKey, stripePromise]);

  // Retour de redirect PayPal : Stripe pose ?payment_intent=…&redirect_status=…
  // sur l'URL. On confirme la commande côté serveur puis on nettoie l'URL.
  useEffect(() => {
    const piFromUrl = searchParams.get("payment_intent");
    const redirectStatus = searchParams.get("redirect_status");
    if (!piFromUrl || redirectStatus !== "succeeded") return;
    let cancelled = false;
    (async () => {
      const res = await confirmOrderCardPayment(orderId, piFromUrl);
      if (cancelled) return;
      if (res.success) {
        toast.success("Paiement reçu", "Votre commande passe en préparation.");
        router.replace(`/commandes/${orderId}`);
      } else {
        toast.error("Paiement", res.error ?? "Impossible de confirmer.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, orderId]);

  async function handleOpen() {
    setError("");
    if (!publishableKey) {
      toast.error("Paiement indisponible", "Contactez la boutique.");
      return;
    }
    setLoading(true);
    setOpen(true);
    const res = await createOrderCardPaymentIntent(orderId);
    setLoading(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setClientSecret(res.clientSecret);
    setPaymentIntentId(res.paymentIntentId);
  }

  function handleClose() {
    setOpen(false);
    setClientSecret(null);
    setPaymentIntentId(null);
    setError("");
  }

  async function handleSuccess() {
    if (!paymentIntentId) return;
    const res = await confirmOrderCardPayment(orderId, paymentIntentId);
    if (!res.success) {
      setError(res.error ?? "Impossible de confirmer le paiement.");
      return;
    }
    toast.success("Paiement reçu", "Votre commande passe en préparation.");
    handleClose();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
            d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
        </svg>
        Payer par carte maintenant
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                  Paiement sécurisé
                </p>
                <h2 className="font-heading text-lg font-semibold text-slate-900 mt-1">
                  Payer par carte
                </h2>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="text-slate-400 hover:text-slate-900"
                aria-label="Fermer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex items-baseline justify-between">
                <span className="text-sm text-slate-600">Montant à régler</span>
                <span className="font-heading text-xl font-bold text-slate-900">{totalTTC.toFixed(2)} €</span>
              </div>

              {loading && (
                <p className="text-sm text-slate-500 text-center py-6">Préparation du paiement…</p>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4">
                  {error}
                </div>
              )}

              {clientSecret && stripePromise && !error && (
                <Elements
                  stripe={stripePromise}
                  options={{ clientSecret, appearance: { theme: "stripe" } }}
                >
                  <CardForm
                    totalAmountCents={Math.round(totalTTC * 100)}
                    paymentIntentId={paymentIntentId ?? undefined}
                    orderId={orderId}
                    returnUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/${locale}/commandes/${orderId}`}
                    onSuccess={handleSuccess}
                    onError={setError}
                  />
                </Elements>
              )}

              <p className="text-xs text-slate-400 text-center">
                🔒 Paiement chiffré via Stripe · aucune donnée bancaire stockée
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────── Formulaire Stripe ─────────────────────── */
function CardForm({
  totalAmountCents,
  paymentIntentId,
  orderId,
  returnUrl,
  onSuccess,
  onError,
}: {
  totalAmountCents: number;
  paymentIntentId?: string;
  orderId: string;
  returnUrl: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || processing) return;
    setProcessing(true);
    onError("");
    // return_url utilisé uniquement si PayPal (redirect) ; la carte reste dans
    // l'onglet grâce à redirect:"if_required". Au retour PayPal, le useEffect
    // de PayOrderByCardButton détecte les query params et confirme.
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: returnUrl },
    });
    if (error) {
      reportPaymentError({
        stage: "confirm",
        source: "pay-order-by-card",
        paymentIntentId,
        orderId,
        amountCents: totalAmountCents,
        stripeError: normalizeStripeError(error),
      });
      onError(error.message ?? "Erreur lors du paiement.");
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      startTransition(() => onSuccess());
    } else {
      reportPaymentError({
        stage: "confirm",
        source: "pay-order-by-card",
        paymentIntentId,
        orderId,
        amountCents: totalAmountCents,
        stripeError: {
          code: "not_succeeded",
          message: `PI status ${paymentIntent?.status ?? "unknown"} après confirmPayment`,
        },
      });
      onError("Le paiement n'a pas abouti.");
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={(event) => {
          reportPaymentError({
            stage: "load",
            source: "pay-order-by-card",
            paymentIntentId,
            orderId,
            amountCents: totalAmountCents,
            stripeError: normalizeStripeError(event.error),
          });
        }}
        options={{
          layout: "tabs",
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
        }}
      />
      <button
        type="submit"
        disabled={!ready || processing || isPending}
        className="w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-3"
      >
        {processing || isPending ? "Traitement…" : `🔒 Payer ${(totalAmountCents / 100).toFixed(2)} €`}
      </button>
    </form>
  );
}
