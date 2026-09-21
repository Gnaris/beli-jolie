/**
 * Envoie une erreur du tunnel de paiement Stripe au serveur (fire-and-forget).
 *
 * À appeler dans les composants React qui embarquent Stripe.js :
 *   - `onLoadError` du PaymentElement (le formulaire n'a pas pu s'ouvrir)
 *   - `catch` de `stripe.confirmPayment()` (le clic Payer a échoué)
 *
 * Sans ce mouchard, les erreurs Stripe.js restent piégées dans l'iframe et
 * on ne peut pas enquêter quand un client rapporte « Veuillez réessayer plus
 * tard ». Les erreurs remontent dans les logs prod, tag `[payment-telemetry]`.
 *
 * `keepalive: true` garantit l'envoi même si l'utilisateur ferme l'onglet
 * juste après l'erreur.
 */

import type { StripeError } from "@stripe/stripe-js";

type Payload = {
  stage: "load" | "confirm";
  source: "checkout" | "pay-order-by-card";
  paymentIntentId?: string;
  offeredMethods?: string[];
  attemptedMethod?: string;
  stripeError?: {
    type?: string;
    code?: string;
    declineCode?: string;
    message?: string;
    paymentMethodType?: string;
  };
  orderId?: string;
  amountCents?: number;
};

export function reportPaymentError(input: Payload): void {
  const payload: Payload & { page?: string } = {
    ...input,
    page: typeof window !== "undefined" ? window.location.pathname : undefined,
  };

  try {
    // fetch keepalive : survit à un unmount / navigation immédiate. On ignore
    // volontairement la promesse retournée (fire-and-forget).
    void fetch("/api/telemetry/payment-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* Aucun feedback à donner à l'utilisateur : la télémétrie est
         accessoire, elle ne doit jamais interrompre le tunnel. */
    });
  } catch {
    /* idem */
  }
}

/**
 * Normalise un objet StripeError (SDK client) vers le format attendu par la
 * route telemetry — évite d'exposer des champs internes SDK au serveur.
 */
export function normalizeStripeError(err: StripeError | unknown): Payload["stripeError"] {
  if (!err || typeof err !== "object") return undefined;
  const e = err as Partial<StripeError> & { decline_code?: string; payment_method?: { type?: string } };
  return {
    type: e.type,
    code: e.code,
    declineCode: e.decline_code,
    message: e.message,
    paymentMethodType: e.payment_method?.type,
  };
}
