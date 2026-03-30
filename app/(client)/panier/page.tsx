import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCart } from "@/app/actions/client/cart";
import CartPageClient from "@/components/panier/CartPageClient";
import { isConnectEnabled, getConnectedAccountId } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Mon panier",
  robots: { index: false, follow: false },
};

export default async function PanierPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/panier");

  if (session.user.status !== "APPROVED") {
    return (
      <div className="container-site py-14 text-center">
        <div className="max-w-md mx-auto card p-10">
          <svg className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h1 className="font-heading text-xl font-semibold text-text-primary mb-2">
            Accès restreint
          </h1>
          <p className="text-sm font-body text-text-secondary">
            Votre compte doit être validé pour accéder au panier.
          </p>
          <Link href="/espace-pro" className="btn-primary mt-6 justify-center">
            Mon espace pro
          </Link>
        </div>
      </div>
    );
  }

  const [cart, minConfig] = await Promise.all([
    getCart(),
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
  ]);
  const minOrderHT = minConfig ? parseFloat(minConfig.value) : 0;

  // Vérifier si Stripe est prêt (compte connecté relié)
  let stripeReady = true;
  if (isConnectEnabled()) {
    const connectedId = await getConnectedAccountId();
    stripeReady = !!connectedId;
  }

  // Sérialiser les Decimal Prisma en number pour le client component
  const serializedCart = cart ? {
    id: cart.id,
    items: cart.items.map((item) => ({
      ...item,
      variant: {
        ...item.variant,
        unitPrice: Number(item.variant.unitPrice),
        weight: Number(item.variant.weight),
        discountValue: item.variant.discountValue != null ? Number(item.variant.discountValue) : null,
        stock: Number(item.variant.stock ?? 0),
      },
    })),
  } : null;

  return <CartPageClient cart={serializedCart as Parameters<typeof CartPageClient>[0]["cart"]} minOrderHT={minOrderHT} stripeReady={stripeReady} />;
}
