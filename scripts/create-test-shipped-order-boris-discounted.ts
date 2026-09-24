/**
 * Crée une commande SHIPPED de test pour borischen91@gmail.com AVEC :
 *   – Une remise commerciale client de 10 %
 *   – Un code promo global de 10 %
 * Pour tester l'affichage « prix départ / remise / prix payé » du wizard
 * service client sur une commande à plusieurs couches de remises.
 *
 * Usage : npx tsx scripts/create-test-shipped-order-boris-discounted.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CLIENT_EMAIL = "borischen91@gmail.com";
const ITEM_COUNT = 4;
const CLIENT_DISCOUNT_PCT = 10;
const PROMO_DISCOUNT_PCT = 10;
// Les 2 premiers articles reçoivent -5 % au niveau produit (baké dans unitPrice)
const PRODUCT_DISCOUNT_INDICES = [0, 1];
const PRODUCT_DISCOUNT_PCT = 5;

function roundCent(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { email: CLIENT_EMAIL },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      phone: true,
      siret: true,
      addressStreet: true,
      addressZip: true,
      addressCity: true,
      addressCountry: true,
      status: true,
      tenantId: true,
      tenant: { select: { id: true, slug: true, name: true } },
    },
  });

  if (users.length === 0) {
    console.error(`❌ Aucun user trouvé avec l'email ${CLIENT_EMAIL}.`);
    process.exit(1);
  }

  const user = users.find((u) => u.status === "APPROVED") ?? users[0];
  const tenant = user.tenant;
  if (!tenant) {
    console.error(`❌ User ${CLIENT_EMAIL} n'a pas de tenant rattaché.`);
    process.exit(1);
  }

  console.log(`✔ User trouvé : ${CLIENT_EMAIL} → tenant ${tenant.name} (${tenant.slug})`);

  const variants = await prisma.productColor.findMany({
    where: { product: { status: "ONLINE", tenantId: tenant.id } },
    take: ITEM_COUNT,
    include: {
      product: { select: { name: true, reference: true } },
      images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
    },
  });

  if (variants.length < ITEM_COUNT) {
    console.error(
      `❌ Pas assez de produits ONLINE dans ${tenant.slug} (trouvés : ${variants.length}, requis : ${ITEM_COUNT}).`,
    );
    process.exit(1);
  }

  // Prix bruts (sans discount produit ni promo auto) pour rendre lisible le
  // calcul « prix départ / remise / prix payé » côté wizard.
  const itemsSpec = [
    { qty: 3, price: 12.5 },
    { qty: 5, price: 24.0 },
    { qty: 4, price: 18.0 },
    { qty: 2, price: 22.5 },
  ];

  const itemsData = variants.map((v, i) => {
    const spec = itemsSpec[i % itemsSpec.length];
    const hasLineDiscount = PRODUCT_DISCOUNT_INDICES.includes(i);
    // Convention OrderContent (cf. app/actions/admin/orders.ts:842) :
    //   unitPrice = prix catalogue (plein)
    //   lineDiscountAmt = montant absolu de la remise ligne
    //   lineTotal = qty × unitPrice − lineDiscountAmt   (déjà NET)
    // On utilise les vrais champs pour que la colonne « Remise » de la page
    // commande admin affiche bien le -5 %.
    const grossLine = roundCent(spec.qty * spec.price);
    const lineDiscountAmt = hasLineDiscount
      ? roundCent(grossLine * (PRODUCT_DISCOUNT_PCT / 100))
      : 0;
    const lineTotal = roundCent(grossLine - lineDiscountAmt);
    const variantSnapshot = JSON.stringify({
      productColorId: v.id,
      productName: v.product.name,
      productRef: v.product.reference,
      colorName: v.name ?? "Standard",
      saleType: "UNIT",
      unitPriceOriginal: spec.price,
      discountPercent: null,
    });
    return {
      productName: v.product.name,
      productRef: v.product.reference,
      colorName: v.name ?? "Standard",
      saleType: "UNIT",
      packQty: null as number | null,
      size: null as string | null,
      sizesJson: null as string | null,
      packDetails: null as string | null,
      imagePath: v.images[0]?.path ?? null,
      unitPrice: spec.price,
      quantity: spec.qty,
      lineTotal,
      lineDiscountType: hasLineDiscount ? "percent" : null,
      lineDiscountValue: hasLineDiscount ? PRODUCT_DISCOUNT_PCT : null,
      lineDiscountAmt: hasLineDiscount ? lineDiscountAmt : null,
      variantSnapshot,
      tenantId: tenant.id,
    };
  });

  // Sous-total brut = somme des lineTotal
  const subtotalBrutHT = roundCent(itemsData.reduce((s, it) => s + it.lineTotal, 0));

  // Remise commerciale client (10 %) appliquée sur le sous-total brut
  const clientDiscountAmt = roundCent(subtotalBrutHT * (CLIENT_DISCOUNT_PCT / 100));
  const subtotalAfterClient = roundCent(subtotalBrutHT - clientDiscountAmt);

  // Code promo global (10 %) appliqué APRÈS la remise commerciale
  const promoDiscount = roundCent(subtotalAfterClient * (PROMO_DISCOUNT_PCT / 100));
  const subtotalHT = roundCent(subtotalAfterClient - promoDiscount);

  const tvaRate = 0.2;
  const carrierPrice = 11.7;
  const tvaAmount = roundCent((subtotalHT + carrierPrice) * tvaRate);
  const totalTTC = roundCent(subtotalHT + carrierPrice + tvaAmount);

  // Supprime toute commande TESTPROMO précédente de ce client pour repartir propre
  const previous = await prisma.order.findMany({
    where: { userId: user.id, orderNumber: { startsWith: "TESTPROMO" } },
    select: { id: true, orderNumber: true },
  });
  if (previous.length > 0) {
    for (const p of previous) {
      await prisma.claimOrderItem.deleteMany({
        where: { orderItem: { orderId: p.id } },
      });
      await prisma.orderItem.deleteMany({ where: { orderId: p.id } });
      await prisma.order.delete({ where: { id: p.id } });
      console.log(`  ↳ supprimée : ${p.orderNumber}`);
    }
  }

  const orderNumber = `TESTPROMO${Date.now().toString().slice(-5)}`;

  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: user.id,
      status: "SHIPPED",
      tvaRate,
      subtotalBrutHT,
      subtotalHT,
      tvaAmount,
      totalTTC,
      paidSubtotalHT: subtotalHT,
      carrierId: "colissimo",
      carrierName: "Colissimo",
      carrierPrice,
      // Remise commerciale client
      clientDiscountType: "PERCENT",
      clientDiscountValue: CLIENT_DISCOUNT_PCT,
      clientDiscountAmt,
      clientFreeShipping: false,
      // Code promo global
      promoCode: "TEST10",
      promoDiscount,
      stripePaymentIntentId: `pi_test_${orderNumber}`,
      paymentStatus: "paid",
      eeTrackingId: `TESTTRACK${Date.now().toString().slice(-6)}`,
      shipLabel: "Domicile principal",
      shipFirstName: user.firstName ?? "Boris",
      shipLastName: user.lastName ?? "Chen",
      shipCompany: user.company ?? null,
      shipAddress1: user.addressStreet ?? "1 rue de la Paix",
      shipZipCode: user.addressZip ?? "75001",
      shipCity: user.addressCity ?? "Paris",
      shipCountry: user.addressCountry ?? "FR",
      clientCompany: user.company ?? "",
      clientEmail: CLIENT_EMAIL,
      clientPhone: user.phone ?? "0600000000",
      clientSiret: user.siret ?? "TESTSIRET",
      tenantId: tenant.id,
      items: {
        create: itemsData,
      },
    },
    include: { items: true },
  });

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`✅ Commande ${order.orderNumber} créée (SHIPPED, avec remises)`);
  console.log(`   Tenant                : ${tenant.name}`);
  console.log(`   Articles              : ${order.items.length}`);
  console.log(`   – 2 premiers avec remise produit -${PRODUCT_DISCOUNT_PCT} % (bakée dans unitPrice)`);
  console.log(`   – 2 derniers au prix catalogue`);
  console.log(`   Sous-total brut HT    : ${subtotalBrutHT.toFixed(2)} €  (après remise produit, avant client + promo)`);
  console.log(`   Remise client ${CLIENT_DISCOUNT_PCT} %    : -${clientDiscountAmt.toFixed(2)} €`);
  console.log(`   Code TEST10 -${PROMO_DISCOUNT_PCT} %      : -${promoDiscount.toFixed(2)} €  (appliqué après client)`);
  console.log(`   Sous-total HT         : ${subtotalHT.toFixed(2)} €`);
  console.log(`   TVA (20 %)            : ${tvaAmount.toFixed(2)} €`);
  console.log(`   Port                  : ${carrierPrice.toFixed(2)} €`);
  console.log(`   Total TTC             : ${totalTTC.toFixed(2)} €`);
  console.log("──────────────────────────────────────────────────────────");
  console.log(`   Client                : /commandes/${order.id}`);
  console.log(`   Admin                 : /admin/commandes/${order.id}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log(`   Wizard service client — remise affichée par ligne :`);
  console.log(`   – Articles 1-2 (-5 % produit + -10 % client + -10 % promo) ≈ -23 %`);
  console.log(`   – Articles 3-4 (-10 % client + -10 % promo)                ≈ -19 %`);
  console.log("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
