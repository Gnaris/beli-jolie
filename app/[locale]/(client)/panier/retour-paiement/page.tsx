import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import PaymentReturnClient from "@/components/panier/PaymentReturnClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout" });
  return {
    title: t("returnTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Page atterrissage après un paiement redirigé (PayPal aujourd'hui, Billie
 * demain). Stripe pose `?payment_intent=…&payment_intent_client_secret=…
 * &redirect_status=…` sur l'URL. `PaymentReturnClient` lit ces params et
 * appelle `finalizeOrderFromPaymentIntent` pour créer la commande.
 */
export default async function PaymentReturnPage() {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) {
    return redirect({
      href: { pathname: "/connexion", query: { callbackUrl: "/panier" } },
      locale,
    });
  }

  return <PaymentReturnClient />;
}
