import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCart, getShippingAddresses } from "@/app/actions/client/cart";
import CheckoutClient from "@/components/panier/CheckoutClient";

export const metadata: Metadata = {
  title: "Passer la commande",
  robots: { index: false, follow: false },
};

export default async function CommandePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/connexion?callbackUrl=/panier/commande");
  if (session.user.status !== "APPROVED") redirect("/panier");

  const [cart, addresses, user] = await Promise.all([
    getCart(),
    getShippingAddresses(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        firstName: true,
        lastName:  true,
        company:   true,
        email:     true,
        phone:     true,
        siret:     true,
        vatNumber: true,
      },
    }),
  ]);

  if (!cart || cart.items.length === 0) redirect("/panier");

  return (
    <CheckoutClient
      cart={cart as Parameters<typeof CheckoutClient>[0]["cart"]}
      addresses={addresses}
      user={user!}
    />
  );
}
