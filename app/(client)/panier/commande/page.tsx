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

  const [cart, addresses, user, minConfig] = await Promise.all([
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
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
  ]);

  if (!cart || cart.items.length === 0) redirect("/panier");

  // Vérification minimum commande (couche serveur — ne peut pas être contournée)
  const minOrderHT = minConfig ? parseFloat(minConfig.value) : 0;
  if (minOrderHT > 0) {
    const subtotalHT = cart.items.reduce((sum, item) => {
      const { unitPrice } = item.saleOption.productColor;
      const base = item.saleOption.saleType === "UNIT"
        ? unitPrice
        : unitPrice * (item.saleOption.packQuantity ?? 1);
      let price = base;
      if (item.saleOption.discountType && item.saleOption.discountValue) {
        price = item.saleOption.discountType === "PERCENT"
          ? Math.max(0, base * (1 - item.saleOption.discountValue / 100))
          : Math.max(0, base - item.saleOption.discountValue);
      }
      return sum + price * item.quantity;
    }, 0);
    if (subtotalHT < minOrderHT) redirect("/panier");
  }

  return (
    <CheckoutClient
      cart={cart as Parameters<typeof CheckoutClient>[0]["cart"]}
      addresses={addresses}
      user={user!}
    />
  );
}
