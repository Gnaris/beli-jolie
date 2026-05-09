import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCart, getShippingAddresses } from "@/app/actions/client/cart";
import CheckoutClient from "@/components/panier/CheckoutClient";
import { isStripeConfigured } from "@/lib/stripe";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const tCheckout = await getTranslations({ locale, namespace: "checkout" });
  return {
    title: tCheckout("title"),
    robots: { index: false, follow: false },
  };
}

export default async function CommandePage() {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) return redirect({href: {pathname: "/connexion", query: { callbackUrl: "/panier/commande" }}, locale});
  if (session.user.status !== "APPROVED") return redirect({href: "/panier", locale});

  const [cart, addresses, user, minConfig] = await Promise.all([
    getCart(),
    getShippingAddresses(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        firstName:         true,
        lastName:          true,
        company:           true,
        email:             true,
        phone:             true,
        siret:             true,
        vatNumber:         true,
        vatExempt:         true,
        addressStreet:     true,
        addressComplement: true,
        addressZip:        true,
        addressCity:       true,
        addressCountry:    true,
        discountType:      true,
        discountValue:     true,
        freeShipping:      true,
      },
    }),
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
  ]);

  if (!cart || cart.items.length === 0) return redirect({href: "/panier", locale});

  if (!isStripeConfigured()) return redirect({href: "/panier", locale});

  // Vérification minimum commande (couche serveur — ne peut pas être contournée)
  const minOrderHT = minConfig ? parseFloat(minConfig.value) : 0;
  if (minOrderHT > 0) {
    let subtotalHT = 0;
    for (const item of cart.items) {
      const v = item.variant;
      const up = Number(v.unitPrice);
      const base = v.saleType === "UNIT" ? up : up * (v.packQuantity ?? 1);
      let price = base;
      const dp = v.product?.discountPercent != null ? Number(v.product.discountPercent) : null;
      if (dp && dp > 0) {
        price = Math.max(0, base * (1 - dp / 100));
      }
      subtotalHT += price * item.quantity;
    }
    if (subtotalHT < minOrderHT) redirect({href: "/panier", locale});
  }

  // Sérialiser les Decimal Prisma en number pour le client component
  const serializedCart = {
    id: cart.id,
    items: cart.items.map((item) => ({
      ...item,
      variant: {
        ...item.variant,
        unitPrice: Number(item.variant.unitPrice),
        weight: Number(item.variant.weight),
        product: {
          ...item.variant.product,
          discountPercent: item.variant.product?.discountPercent != null ? Number(item.variant.product.discountPercent) : null,
        },
      },
    })),
  };

  return (
    <CheckoutClient
      cart={serializedCart as Parameters<typeof CheckoutClient>[0]["cart"]}
      addresses={addresses}
      user={user!}
      clientDiscount={{
        discountType:  user!.discountType ?? null,
        discountValue: user!.discountValue != null ? Number(user!.discountValue) : null,
        freeShipping:  user!.freeShipping,
      }}
    />
  );
}
