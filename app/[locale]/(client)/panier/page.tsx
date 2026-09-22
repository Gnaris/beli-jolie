import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getCartWithProductVariants,
  getShippingAddresses,
} from "@/app/actions/client/cart";
import CartWizardClient from "@/components/panier/CartWizardClient";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import CartIssymaWrapper from "@/components/issyma/CartIssymaWrapper";
import { isStripeConfigured, getStripePublishableKey } from "@/lib/stripe";
import { getCachedBankTransferConfig, formatIbanForDisplay } from "@/lib/bank-transfer-config";
import { loadActivePromotions } from "@/lib/promotions";
import { buildCartPromoContexts } from "@/lib/promotion-cart-context";
import { resolveBestItemDiscount } from "@/lib/promotion-engine";
import { computeCartCascade } from "@/lib/order-pricing";
import {
  DEFAULT_BUSINESS_HOURS,
  formatScheduleForDisplay,
  type BusinessHoursSchedule,
} from "@/lib/business-hours";
import { getEffectiveMinOrderHT } from "@/lib/min-order";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const tMeta = await getTranslations({ locale, namespace: "meta" });
  return {
    title: tMeta("cartTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Page unifiée du tunnel commande : /panier héberge les 3 étapes du wizard
 * (Panier → Livraison → Paiement) via CartWizardClient (refonte visuelle).
 * L'ancien URL /panier/commande redirige vers cette page.
 */
export default async function PanierPage() {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session)
    return redirect({
      href: { pathname: "/connexion", query: { callbackUrl: "/panier" } },
      locale,
    });

  if (session.user.role === "CLIENT" && session.user.status !== "APPROVED") {
    const tCart = await getTranslations({ locale, namespace: "cart" });
    return (
      <div className="container-site py-14 text-center">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-10">
          <svg
            className="w-12 h-12 text-slate-400 mx-auto mb-4 opacity-60"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
          <h1 className="font-heading text-xl font-semibold text-slate-900 mb-2">
            {tCart("restricted")}
          </h1>
          <p className="text-sm text-slate-500">{tCart("restrictedMessage")}</p>
          <Link
            href="/espace-pro"
            className="inline-flex items-center justify-center h-11 px-6 mt-6 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            {tCart("myAccount")}
          </Link>
        </div>
      </div>
    );
  }

  // Chargements parallélisés
  const [
    { cart, productsMeta },
    addresses,
    userRow,
    minOrderHT,
    stripeReady,
    stripePublishableKey,
    bankTransferConfig,
    companyInfo,
    businessHoursRow,
    mergeCandidates,
  ] = await Promise.all([
    getCartWithProductVariants(),
    getShippingAddresses(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        firstName: true,
        lastName: true,
        company: true,
        email: true,
        phone: true,
        siret: true,
        vatNumber: true,
        vatExempt: true,
        addressStreet: true,
        addressComplement: true,
        addressZip: true,
        addressCity: true,
        addressCountry: true,
        discountType: true,
        discountValue: true,
        discountMode: true,
        discountMinAmount: true,
        discountMinQuantity: true,
        freeShipping: true,
        freeShippingMaxPrice: true,
        shippingDiscountType: true,
        shippingDiscountValue: true,
      },
    }),
    getEffectiveMinOrderHT(session.user.id),
    isStripeConfigured(),
    getStripePublishableKey(),
    getCachedBankTransferConfig(),
    prisma.companyInfo.findFirst({
      select: {
        name: true,
        shopName: true,
        address: true,
        city: true,
        postalCode: true,
        country: true,
        phone: true,
      },
    }),
    prisma.siteConfig.findFirst({ where: { key: "business_hours" } }),
    prisma.order.findMany({
      where: {
        userId: session.user.id,
        status: "PENDING",
        paymentStatus: "paid",
        mergeIntoOrderId: null,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        totalTTC: true,
        carrierName: true,
        carrierPrice: true,
        shipAddress1: true,
        shipZipCode: true,
        shipCity: true,
        items: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  // Retrait boutique
  let businessHours: BusinessHoursSchedule = DEFAULT_BUSINESS_HOURS;
  if (businessHoursRow?.value) {
    try {
      businessHours = JSON.parse(businessHoursRow.value) as BusinessHoursSchedule;
    } catch {
      /* invalid JSON → défaut */
    }
  }
  const pickupInfo = companyInfo
    ? {
        store: {
          name: companyInfo.shopName || companyInfo.name,
          address: companyInfo.address ?? "",
          city: companyInfo.city ?? "",
          postalCode: companyInfo.postalCode ?? "",
          country: companyInfo.country ?? "",
          phone: companyInfo.phone ?? "",
        },
        schedule: formatScheduleForDisplay(businessHours, locale),
      }
    : null;

  // Sérialisation panier
  const serializedCart = cart
    ? {
        id: cart.id,
        items: cart.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
          variant: {
            id: item.variant.id,
            productId: item.variant.productId,
            colorId: item.variant.colorId ?? null,
            unitPrice: Number(item.variant.unitPrice),
            weight: Number(item.variant.weight),
            stock: Number((item.variant as { stock?: number }).stock ?? 0),
            saleType: item.variant.saleType,
            packQuantity: item.variant.packQuantity ?? null,
            product: {
              id: item.variant.product.id,
              name: item.variant.product.name,
              reference: item.variant.product.reference,
              status: item.variant.product.status,
              discountPercent:
                item.variant.product.discountPercent != null
                  ? Number(item.variant.product.discountPercent)
                  : null,
              category: { name: item.variant.product.category.name },
            },
          },
        })),
      }
    : null;

  // Promotions par item (source de vérité serveur)
  const promoInfoByItemId: Record<
    string,
    {
      finalUnitPrice: number;
      savedPerUnit: number;
      displayPercent: number;
      promotionName: string | null;
      source: "none" | "product" | "promotion" | "client" | "stack";
    }
  > = {};
  let shippingPromos: {
    id: string;
    name: string;
    discountKind: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
    discountValue: number;
    stackable: boolean;
  }[] = [];
  let cartCascade: ReturnType<typeof computeCartCascade> | null = null;
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
    shippingPromos = activePromos
      .filter((p) => p.scope === "SHIPPING" && p.type === "AUTO")
      .map((p) => ({
        id: p.id,
        name: p.name,
        discountKind: p.discountKind,
        discountValue: p.discountValue,
        stackable: p.stackable,
      }));

    // Trace cascade panier (sans livraison ni TVA) pour le récap.
    const pricingItems = cart.items
      .map((item) => {
        const ctx = promoContexts.get(item.id);
        return ctx ? { id: item.id, quantity: item.quantity, promoContext: ctx.context } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    cartCascade = computeCartCascade({
      items: pricingItems,
      user: {
        discountType: userRow!.discountType ?? null,
        discountValue: userRow!.discountValue != null ? Number(userRow!.discountValue) : null,
        discountMode: userRow!.discountMode ?? "PERMANENT",
        discountMinAmount: userRow!.discountMinAmount != null ? Number(userRow!.discountMinAmount) : null,
        discountMinQuantity: userRow!.discountMinQuantity ?? null,
      },
      activePromos,
      appliedCodePromo: null,
    });
  }

  const user = {
    firstName: userRow!.firstName,
    lastName: userRow!.lastName,
    company: userRow!.company,
    email: userRow!.email,
    phone: userRow!.phone,
    siret: userRow!.siret,
    vatNumber: userRow!.vatNumber,
    vatExempt: userRow!.vatExempt,
    addressStreet: userRow!.addressStreet,
    addressComplement: userRow!.addressComplement,
    addressZip: userRow!.addressZip,
    addressCity: userRow!.addressCity,
    addressCountry: userRow!.addressCountry,
  };

  const clientDiscount = {
    discountType: userRow!.discountType ?? null,
    discountValue: userRow!.discountValue != null ? Number(userRow!.discountValue) : null,
    freeShipping: userRow!.freeShipping,
    freeShippingMaxPrice:
      userRow!.freeShippingMaxPrice != null ? Number(userRow!.freeShippingMaxPrice) : null,
    shippingDiscountType: userRow!.shippingDiscountType ?? null,
    shippingDiscountValue:
      userRow!.shippingDiscountValue != null ? Number(userRow!.shippingDiscountValue) : null,
  };

  const wizardNode = (
    <CartWizardClient
      cart={serializedCart}
      productsMeta={productsMeta}
      addresses={addresses}
      user={user}
      clientDiscount={clientDiscount}
      shippingPromos={shippingPromos}
      promoInfoByItemId={promoInfoByItemId}
      cartCascade={cartCascade}
      pickupInfo={pickupInfo}
      mergeCandidates={mergeCandidates.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAtIso: o.createdAt.toISOString(),
        totalTTC: Number(o.totalTTC),
        carrierName: o.carrierName,
        carrierPrice: Number(o.carrierPrice),
        itemsCount: o.items.length,
        shipAddressShort: `${o.shipAddress1}, ${o.shipZipCode} ${o.shipCity}`,
      }))}
      minOrderHT={minOrderHT}
      stripeReady={stripeReady}
      stripePublishableKey={stripePublishableKey}
      bankTransfer={{
        enabled: bankTransferConfig.enabled,
        holder: bankTransferConfig.holder,
        ibanDisplay: bankTransferConfig.iban ? formatIbanForDisplay(bankTransferConfig.iban) : "",
      }}
    />
  );

  // Dispatch tenant : Issyma reçoit le wizard enveloppé dans la coquille
  // bordeaux + hero rose + bandeau réassurance. BJ reste inchangé.
  const effectiveSlug = await getEffectiveTenantSlug();
  if (effectiveSlug === "issyma") {
    return <CartIssymaWrapper>{wizardNode}</CartIssymaWrapper>;
  }

  return wizardNode;
}
