import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "@/i18n/navigation";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCachedBankTransferConfig } from "@/lib/bank-transfer-config";
import { isStripeConfigured } from "@/lib/stripe";
import FinalizeAdminOrderClient from "@/components/client/orders/FinalizeAdminOrderClient";

export const metadata: Metadata = {
  title: "Finaliser votre commande",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FinaliserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) {
    return redirect({ href: { pathname: "/connexion" }, locale });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        select: {
          id: true,
          productName: true,
          productRef: true,
          colorName: true,
          imagePath: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          sizesJson: true,
          saleType: true,
          packQty: true,
        },
      },
    },
  });
  if (!order) notFound();
  if (order.userId !== session.user.id) notFound();

  // Déjà finalisée → on redirige vers la fiche standard.
  if (!order.isAdminDraft) {
    return redirect({ href: { pathname: `/commandes/${order.id}` }, locale });
  }

  // Poids total — pour que la page client puisse quoter les transporteurs.
  const variantIds = Array.from(new Set(order.items.map((i) => {
    // On ne stocke pas le productColorId sur OrderItem — on va passer poids = 0.5 kg/item par défaut.
    void i;
    return "";
  })));
  void variantIds;
  // Approximation : 0.3 kg par article (sera recalculé serveur-side au besoin).
  // Dans un futur refactor on pourra snapshoter le poids dans OrderItem.
  const totalWeightKg = order.items.reduce((s, i) => s + 0.3 * i.quantity, 0);

  // Config paiement
  const [bankCfg, stripeOk] = await Promise.all([
    getCachedBankTransferConfig(),
    isStripeConfigured(),
  ]);

  const serializedOrder = {
    id: order.id,
    orderNumber: order.orderNumber,
    tvaRate: Number(order.tvaRate),
    subtotalHT: Number(order.subtotalHT),
    totalWeightKg,
    items: order.items.map((i) => ({
      productName: i.productName,
      productRef: i.productRef,
      colorName: i.colorName,
      imagePath: i.imagePath,
      quantity: i.quantity,
      unitPrice: Number(i.unitPrice),
      lineTotal: Number(i.lineTotal),
      sizesJson: i.sizesJson,
      saleType: i.saleType,
      packQty: i.packQty,
    })),
    initialShip: {
      firstName: order.shipFirstName,
      lastName: order.shipLastName,
      company: order.shipCompany,
      address1: order.shipAddress1,
      address2: order.shipAddress2,
      zipCode: order.shipZipCode,
      city: order.shipCity,
      country: order.shipCountry,
    },
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 lg:p-8 w-full space-y-6">
      <Link
        href={{ pathname: "/commandes" }}
        className="text-xs text-text-muted hover:text-text-primary inline-flex items-center gap-1 transition-colors w-fit"
      >
        ← Retour à mes commandes
      </Link>

      <section className="bg-bg-primary border border-amber-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-7 sm:px-8 py-5 border-b border-amber-100 bg-amber-50 flex items-center gap-4">
          <div className="w-1.5 h-10 bg-amber-500 rounded-full" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
              À finaliser et payer
            </p>
            <h1 className="font-heading text-xl sm:text-2xl font-semibold text-text-primary mt-1">
              Commande {order.orderNumber}
            </h1>
          </div>
        </div>
        <div className="p-7 sm:p-8 text-sm font-body text-text-secondary">
          Nous avons préparé cette commande pour vous. Choisissez votre adresse de livraison,
          votre transporteur et votre mode de paiement — vos articles sont déjà réservés.
        </div>
      </section>

      <FinalizeAdminOrderClient
        order={serializedOrder}
        bankTransferEnabled={bankCfg.enabled}
        stripeConfigured={stripeOk}
      />
    </div>
  );
}
