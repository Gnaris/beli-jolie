// Crée 2 fausses commandes (PENDING + SHIPPED) pour borischen91@gmail.com afin de
// tester la nouvelle fiche client (onglet Commandes).
// Usage : npx tsx scripts/dev-seed-borischen-orders.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomOrderNumber(prefix: string) {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}${rnd}`;
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "borischen91@gmail.com" },
  });
  if (!user) throw new Error("User borischen91@gmail.com introuvable");

  const tenantId = user.tenantId!;

  // Variantes ONLINE du bon tenant
  const variants = await prisma.productColor.findMany({
    where: {
      product: { status: "ONLINE", tenantId },
    },
    take: 40,
    include: {
      product: { select: { id: true, name: true, reference: true } },
      color:   { select: { name: true } },
    },
  });

  if (variants.length < 4) {
    throw new Error(`Il faut au moins 4 variantes ONLINE (trouvées : ${variants.length})`);
  }

  const shipSnapshot = {
    shipLabel:     "Adresse principale",
    shipFirstName: user.firstName,
    shipLastName:  user.lastName,
    shipCompany:   user.company,
    shipAddress1:  user.addressStreet || "43 Rue De Carency",
    shipAddress2:  user.addressComplement,
    shipZipCode:   user.addressZip   || "93000",
    shipCity:      user.addressCity  || "Bobigny",
    shipCountry:   user.addressCountry || "FR",
    clientCompany:   user.company,
    clientEmail:     user.email,
    clientPhone:     user.phone,
    clientSiret:     user.siret,
    clientVatNumber: user.vatNumber,
  };

  async function createOrder({
    status,
    itemCount,
    prefix,
    daysAgo,
  }: {
    status: "PENDING" | "SHIPPED";
    itemCount: number;
    prefix: string;
    daysAgo: number;
  }) {
    const picks = pickRandom(variants, itemCount);
    const itemsData = picks.map((v) => {
      const qty = 1 + Math.floor(Math.random() * 4);
      const unitPrice = Number(v.unitPrice);
      const lineTotal = +(unitPrice * qty).toFixed(2);
      return {
        productName: v.product.name,
        productRef:  v.product.reference,
        colorName:   v.color?.name ?? "Standard",
        saleType:    v.saleType,
        packQty:     v.packQuantity,
        size:        null as string | null,
        sizesJson:   null as string | null,
        packDetails: null as string | null,
        imagePath:   null as string | null,
        unitPrice:   unitPrice,
        quantity:    qty,
        lineTotal:   lineTotal,
        productColorId: v.id,
        tenantId,
      };
    });

    const subtotalHT   = +itemsData.reduce((s, it) => s + Number(it.lineTotal), 0).toFixed(2);
    const tvaRate      = 0.2;
    const tvaAmount    = +(subtotalHT * tvaRate).toFixed(2);
    const carrierPrice = 11.7;
    const totalTTC     = +(subtotalHT + tvaAmount + carrierPrice).toFixed(2);

    const orderNumber = randomOrderNumber(prefix);
    const createdAt   = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: user.id,
        tenantId,
        status,
        tvaRate,
        subtotalHT,
        tvaAmount,
        totalTTC,
        paidSubtotalHT: subtotalHT,
        carrierId:   "colissimo",
        carrierName: "Colissimo",
        carrierPrice,
        carrierBasePrice: carrierPrice,
        clientDiscountAmt:   0,
        clientFreeShipping:  false,
        stripePaymentIntentId: `pi_test_${orderNumber}`,
        paymentStatus: "paid",
        ...shipSnapshot,
        createdAt,
        updatedAt: createdAt,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    console.log(
      `✔ Commande ${order.orderNumber} · ${status} · ${order.items.length} article(s) · ${totalTTC.toFixed(2)} € TTC · ${createdAt.toLocaleDateString("fr-FR")}`,
    );
  }

  await createOrder({ status: "PENDING", itemCount: 3, prefix: "PEND",  daysAgo: 2  });
  await createOrder({ status: "SHIPPED", itemCount: 4, prefix: "SHIP",  daysAgo: 14 });

  console.log("");
  console.log("✅ 2 fausses commandes créées pour borischen91@gmail.com");
  console.log(`   Fiche client : http://localhost:3000/admin/utilisateurs/${user.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
