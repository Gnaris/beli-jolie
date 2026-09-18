import "server-only";
import type Stripe from "stripe";
import { logger } from "@/lib/logger";

/**
 * Détecte, dans un message d'erreur Stripe, le nom de la payment method type
 * refusée (non activée sur le compte). Ex :
 *   "The payment method type 'paypal' is not activated for your account"
 *   "The payment method type 'billie' is not activated for your account"
 *
 * Retourne le nom si trouvé, sinon null.
 */
function extractFailedMethod(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const anyErr = err as { message?: string; raw?: { message?: string } };
  const msg = (anyErr.message ?? anyErr.raw?.message ?? "").toLowerCase();
  if (!msg.includes("not activated") && !msg.includes("not enabled")) return null;
  // Extraction du nom entre quotes : "'paypal'", "'billie'", etc.
  const match = msg.match(/['"](\w+)['"]/);
  return match ? match[1] : null;
}

/**
 * Crée un PaymentIntent en essayant la liste complète de méthodes ; si Stripe
 * refuse parce qu'une méthode n'est pas activée sur le compte, on la retire et
 * on retente. Empêche de casser le checkout quand la cliente n'a pas encore
 * activé PayPal ou Billie dans son dashboard Stripe.
 *
 * `card` est le socle : la liste finale ne descend jamais sous ["card"].
 */
export async function createPaymentIntentWithFallback(
  stripe: Stripe,
  baseInput: Omit<Stripe.PaymentIntentCreateParams, "payment_method_types">,
  preferredMethods: string[],
): Promise<Stripe.PaymentIntent> {
  const methods = [...preferredMethods];
  const maxAttempts = methods.length;
  let lastErr: unknown = null;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // Copie fraîche pour ne pas exposer aux mutations ci-dessous (tests +
      // logs conservent parfois des références au tableau).
      return await stripe.paymentIntents.create({
        ...baseInput,
        payment_method_types: [
          ...methods,
        ] as Stripe.PaymentIntentCreateParams["payment_method_types"],
      });
    } catch (err) {
      lastErr = err;
      const failed = extractFailedMethod(err);
      if (!failed || failed === "card" || !methods.includes(failed)) {
        throw err;
      }
      methods.splice(methods.indexOf(failed), 1);
      logger.warn(
        `[createPaymentIntentWithFallback] Méthode "${failed}" non activée — retry sans`,
        { remaining: methods },
      );
      if (methods.length === 0) throw err;
    }
  }

  throw lastErr ?? new Error("Aucune méthode de paiement disponible");
}
