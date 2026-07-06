// Crée une fausse commande PENDING complète pour tester la nouvelle fiche
// /admin/commandes/[id] (rupture / ajustement / ajout d'articles).
// Usage : npx tsx scripts/create-fake-order.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "sophie.martin+test-order@bijoux-elegance.fr";

  // ─── 1. Client de test (recrée à chaque lancement) ───────────────────
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    console.log("Client de test déjà présent, suppression pour repartir propre…");
    // Supprimer d'abord les commandes (Order n'a pas onDelete: Cascade)
    await prisma.order.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const passwordHash = await bcrypt.hash("Test1234!", 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      firstName: "Sophie",
      lastName: "Martin",
      company: "Bijoux Élégance",
      phone: "06 45 78 92 13",
      siret: `TESTORD${Date.now().toString().slice(-8)}`,
      addressStreet: "27 avenue de la République",
      addressZip: "75011",
      addressCity: "Paris",
      addressCountry: "FR",
      status: "APPROVED",
      role: "CLIENT",
      lastSeenAt: new Date(),
    },
  });
  console.log(`✔ Client créée : ${user.email}`);

  // ─── 2. On récupère 4 vraies variantes ONLINE pour peupler la commande ──
  const variants = await prisma.productColor.findMany({
    where: { product: { status: "ONLINE" } },
    take: 4,
    include: {
      product: {
        select: {
          name: true,
          reference: true,
          categoryId: true,
        },
      },
    },
  });

  if (variants.length < 4) {
    console.error(
      `⚠ Il faut au moins 4 produits en ligne pour créer une commande de test. Trouvés : ${variants.length}`,
    );
    process.exit(1);
  }

  // ─── 3. Construction des articles de commande ────────────────────────
  // Prix arbitraires réalistes + quantités variées pour illustrer les modifs
  const itemsSpec = [
    { qty: 3, price: 12.5,  label: "Paquet ×3" },
    { qty: 5, price: 24.0,  label: "Unité" },
    { qty: 4, price: 18.0,  label: "Unité" },
    { qty: 2, price: 22.5,  label: "Unité" },
  ];

  const itemsData = variants.map((v, i) => {
    const spec = itemsSpec[i];
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
      imagePath: null as string | null,
      unitPrice: spec.price,
      quantity: spec.qty,
      lineTotal,
    };
  });

  const subtotalHT = itemsData.reduce((s, it) => s + it.lineTotal, 0);
  const tvaRate = 0.2;
  const tvaAmount = subtotalHT * tvaRate;
  const carrierPrice = 11.7;
  const totalTTC = subtotalHT + tvaAmount + carrierPrice;

  const orderNumber = `TESTORD${Date.now().toString().slice(-5)}`;

  // ─── 4. Supprimer une éventuelle commande TESTORD précédente ──────────
  await prisma.order.deleteMany({ where: { orderNumber: { startsWith: "TESTORD" } } });

  // ─── 5. Créer la commande + items ────────────────────────────────────
  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: user.id,
      status: "PENDING",
      tvaRate,
      subtotalHT,
      tvaAmount,
      totalTTC,
      paidSubtotalHT: subtotalHT, // Snapshot immuable du HT payé
      carrierId: "colissimo",
      carrierName: "Colissimo",
      carrierPrice,
      clientDiscountAmt: 0,
      clientFreeShipping: false,
      stripePaymentIntentId: `pi_test_${orderNumber}`,
      paymentStatus: "paid",
      shipLabel: "Boutique principale",
      shipFirstName: "Sophie",
      shipLastName: "Martin",
      shipCompany: "Bijoux Élégance",
      shipAddress1: "27 avenue de la République",
      shipZipCode: "75011",
      shipCity: "Paris",
      shipCountry: "FR",
      clientCompany: "Bijoux Élégance",
      clientEmail: user.email,
      clientPhone: "06 45 78 92 13",
      clientSiret: user.siret!,
      items: {
        create: itemsData,
      },
    },
    include: { items: true },
  });

  console.log(`✔ Commande ${order.orderNumber} créée avec ${order.items.length} articles`);
  console.log(`  Sous-total HT : ${subtotalHT.toFixed(2)} €`);
  console.log(`  TVA (20 %)    : ${tvaAmount.toFixed(2)} €`);
  console.log(`  Livraison     : ${carrierPrice.toFixed(2)} €`);
  console.log(`  Total TTC     : ${totalTTC.toFixed(2)} €  (= montant payé Stripe)`);

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`✅ Commande de test prête.`);
  console.log(`   URL : http://localhost:3000/admin/commandes/${order.id}`);
  console.log("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
