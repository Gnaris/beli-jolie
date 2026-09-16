"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useToast } from "@/components/ui/Toast";
import {
  createOrderCardPaymentIntent,
  confirmOrderCardPayment,
} from "@/app/actions/client/pay-order-by-card";

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
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);

  useEffect(() => {
    if (publishableKey && !stripePromise) {
      setStripePromise(loadStripe(publishableKey));
    }
  }, [publishableKey, stripePromise]);

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
                    clientSecret={clientSecret}
                    totalAmountCents={Math.round(totalTTC * 100)}
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
  clientSecret,
  totalAmountCents,
  onSuccess,
  onError,
}: {
  clientSecret: string;
  totalAmountCents: number;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [ready, setReady] = useState({ n: false, e: false, c: false });
  const allReady = ready.n && ready.e && ready.c;
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || processing) return;
    setProcessing(true);
    onError("");
    const cardEl = elements.getElement(CardNumberElement);
    if (!cardEl) {
      onError("Erreur lors de la préparation du paiement.");
      setProcessing(false);
      return;
    }
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardEl },
    });
    if (error) {
      onError(error.message ?? "Erreur lors du paiement.");
      setProcessing(false);
    } else if (paymentIntent && paymentIntent.status === "succeeded") {
      startTransition(() => onSuccess());
    } else {
      onError("Le paiement n'a pas abouti.");
      setProcessing(false);
    }
  }

  const fieldClass =
    "px-3 py-3 border border-slate-200 rounded-xl bg-white focus-within:border-slate-900 focus-within:ring-2 focus-within:ring-slate-900/10 transition-all";
  const elementOpts = {
    style: {
      base: {
        fontSize: "15px",
        color: "#0f172a",
        fontFamily: "Inter, system-ui, sans-serif",
        "::placeholder": { color: "#94a3b8" },
      },
      invalid: { color: "#dc2626" },
    },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Numéro de carte</label>
        <div className={fieldClass}>
          <CardNumberElement options={elementOpts} onReady={() => setReady((r) => ({ ...r, n: true }))} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Expiration</label>
          <div className={fieldClass}>
            <CardExpiryElement options={elementOpts} onReady={() => setReady((r) => ({ ...r, e: true }))} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">CVC</label>
          <div className={fieldClass}>
            <CardCvcElement options={elementOpts} onReady={() => setReady((r) => ({ ...r, c: true }))} />
          </div>
        </div>
      </div>
      <button
        type="submit"
        disabled={!allReady || processing || isPending}
        className="w-full h-12 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-3"
      >
        {processing || isPending ? "Traitement…" : `🔒 Payer ${(totalAmountCents / 100).toFixed(2)} €`}
      </button>
    </form>
  );
}
