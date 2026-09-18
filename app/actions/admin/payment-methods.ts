"use server";

import { getServerSession } from "next-auth";
import { revalidateTag } from "next/cache";
import { authOptions } from "@/lib/auth";
import { setSiteConfig } from "@/lib/site-config-write";
import {
  OPTIONAL_STRIPE_METHODS,
  stripeMethodConfigKey,
  type OptionalStripeMethod,
} from "@/lib/stripe-payment-methods-enabled";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") throw new Error("Non autorisé");
}

function isOptionalMethod(m: string): m is OptionalStripeMethod {
  return (OPTIONAL_STRIPE_METHODS as readonly string[]).includes(m);
}

/**
 * Active ou désactive une méthode Stripe optionnelle (PayPal, Billie,
 * Bancontact, iDEAL) pour le tenant courant. La méthode doit avoir été
 * activée côté dashboard Stripe au préalable — la case ici ne fait que
 * l'exposer dans le tunnel de paiement.
 */
export async function setStripePaymentMethodEnabled(
  method: string,
  enabled: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    if (!isOptionalMethod(method)) {
      return { success: false, error: "Méthode inconnue." };
    }
    await setSiteConfig(stripeMethodConfigKey(method), enabled ? "1" : "0");
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Erreur" };
  }
}
