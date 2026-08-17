import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCartWithProductVariants } from "@/app/actions/client/cart";
import CartPageClient from "@/components/panier/CartPageClient";
import { isStripeConfigured } from "@/lib/stripe";
import { loadActivePromotions } from "@/lib/promotions";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { resolveBestItemDiscount } from "@/lib/promotion-engine";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const tMeta = await getTranslations({ locale, namespace: "meta" });
  return {
    title: tMeta("cartTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function PanierPage() {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) return redirect({href: {pathname: "/connexion", query: { callbackUrl: "/panier" }}, locale});

  if (session.user.status !== "APPROVED") {
    const tCart = await getTranslations({ locale, namespace: "cart" });
    return (
      <div className="container-site py-14 text-center">
        <div className="max-w-md mx-auto card p-10">
          <svg className="w-12 h-12 text-text-muted mx-auto mb-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h1 className="font-heading text-xl font-semibold text-text-primary mb-2">
            {tCart("restricted")}
          </h1>
          <p className="text-sm font-body text-text-secondary">
            {tCart("restrictedMessage")}
          </p>
          <Link href="/espace-pro" className="btn-primary mt-6 justify-center">
            {tCart("myAccount")}
          </Link>
        </div>
      </div>
    );
  }

  const [{ cart, productsMeta }, minConfig, userDiscount] = await Promise.all([
    getCartWithProductVariants(),
    prisma.siteConfig.findFirst({ where: { key: "min_order_ht" } }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { discountType: true, discountValue: true },
    }),
  ]);
  const minOrderHT = minConfig ? parseFloat(minConfig.value) : 0;

  const clientDiscount = userDiscount?.discountType && userDiscount.discountValue != null
    ? { type: userDiscount.discountType, value: Number(userDiscount.discountValue) }
    : null;

  const stripeReady = await isStripeConfigured();

  // Sérialiser les Decimal Prisma en number pour le client component
  const serializedCart = cart ? {
    id: cart.id,
    items: cart.items.map((item) => ({
      ...item,
      variant: {
        ...item.variant,
        unitPrice: Number(item.variant.unitPrice),
        weight: Number(item.variant.weight),
        stock: Number(item.variant.stock ?? 0),
        product: {
          ...item.variant.product,
          discountPercent: item.variant.product?.discountPercent != null ? Number(item.variant.product.discountPercent) : null,
        },
      },
    })),
  } : null;

  // Calculer les promotions applicables par item (source de vérité serveur)
  const promoInfoByItemId: Record<string, {
    finalUnitPrice: number;
    savedPerUnit: number;
    displayPercent: number;
    promotionName: string | null;
    source: "none" | "product" | "promotion";
  }> = {};

  if (cart && cart.items.length > 0) {
    const [activePromos, promoContexts] = await Promise.all([
      loadActivePromotions(),
      buildCartPromoContexts(cart.items),
    ]);
    for (const item of cart.items) {
      const ctx = promoContexts.get(item.id);
      if (!ctx) continue;
      const resolved = resolveBestItemDiscount(ctx.context, activePromos, null);
      promoInfoByItemId[item.id] = {
        finalUnitPrice: resolved.finalUnitPrice,
        savedPerUnit: resolved.savedPerUnit,
        displayPercent: resolved.displayPercent,
        promotionName: resolved.promotion?.name ?? null,
        source: resolved.source,
      };
    }
  }

  return (
    <CartPageClient
      cart={serializedCart as Parameters<typeof CartPageClient>[0]["cart"]}
      productsMeta={productsMeta}
      minOrderHT={minOrderHT}
      stripeReady={stripeReady}
      promoInfoByItemId={promoInfoByItemId}
      clientDiscount={clientDiscount}
    />
  );
}
