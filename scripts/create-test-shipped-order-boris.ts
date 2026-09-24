/**
 * Crée une commande SHIPPED de test pour borischen91@gmail.com afin de
 * tester le wizard service client sur un compte réel.
 *
 * Usage : npx tsx scripts/create-test-shipped-order-boris.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CLIENT_EMAIL = "borischen91@gmail.com";
const ITEM_COUNT = 4;

async function main() {
  // 1. Trouver le user (peut exister dans plusieurs tenants — on prend le premier
  //    où il est APPROVED, puis on scope tout le reste à ce tenant).
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

  const user =
    users.find((u) => u.status === "APPROVED") ?? users[0];
  const tenant = user.tenant;
  if (!tenant) {
    console.error(`❌ User ${CLIENT_EMAIL} n'a pas de tenant rattaché (tenantId=null).`);
    process.exit(1);
  }

  console.log(`✔ User trouvé : ${CLIENT_EMAIL} → tenant ${tenant.name} (${tenant.slug})`);
  console.log(`  Status : ${user.status}`);

  // 2. Piocher ITEM_COUNT variantes ONLINE dans le même tenant
  const variants = await prisma.productColor.findMany({
    where: {
      product: {
        status: "ONLINE",
        tenantId: tenant.id,
      },
    },
    take: ITEM_COUNT,
    include: {
      product: { select: { name: true, reference: true } },
      images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
    },
  });

  if (variants.length < ITEM_COUNT) {
    console.error(
      `❌ Pas assez de produits ONLINE dans le tenant ${tenant.slug} (trouvés : ${variants.length}, requis : ${ITEM_COUNT}).`,
    );
    process.exit(1);
  }

  // 3. Construire les OrderItems (prix + quantités variés pour rendre le test parlant)
  const itemsSpec = [
    { qty: 3, price: 12.5 },
    { qty: 5, price: 24.0 },
    { qty: 4, price: 18.0 },
    { qty: 2, price: 22.5 },
  ];

  const itemsData = variants.map((v, i) => {
    const spec = itemsSpec[i % itemsSpec.length];
    const lineTotal = spec.qty * spec.price;
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
      tenantId: tenant.id,
    };
  });

  const subtotalHT = itemsData.reduce((s, it) => s + it.lineTotal, 0);
  const tvaRate = 0.2;
  const tvaAmount = Math.round(subtotalHT * tvaRate * 100) / 100;
  const carrierPrice = 11.7;
  const totalTTC = Math.round((subtotalHT + tvaAmount + carrierPrice) * 100) / 100;

  const orderNumber = `TESTBORIS${Date.now().toString().slice(-5)}`;

  // 4. Créer la commande SHIPPED
  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: user.id,
      status: "SHIPPED",
      tvaRate,
      subtotalHT,
      tvaAmount,
      totalTTC,
      paidSubtotalHT: subtotalHT,
      carrierId: "colissimo",
      carrierName: "Colissimo",
      carrierPrice,
      clientDiscountAmt: 0,
      clientFreeShipping: false,
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
  console.log(`✅ Commande ${order.orderNumber} créée (SHIPPED)`);
  console.log(`   Tenant     : ${tenant.name}`);
  console.log(`   Articles   : ${order.items.length}`);
  console.log(`   Sous-total : ${subtotalHT.toFixed(2)} € HT`);
  console.log(`   TVA        : ${tvaAmount.toFixed(2)} €`);
  console.log(`   Port       : ${carrierPrice.toFixed(2)} €`);
  console.log(`   Total TTC  : ${totalTTC.toFixed(2)} €`);
  console.log("──────────────────────────────────────────────────────────");
  console.log(`   Client     : /commandes/${order.id}`);
  console.log(`   Admin      : /admin/commandes/${order.id}`);
  console.log("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
