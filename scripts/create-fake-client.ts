// Crée un faux client complet pour tester la nouvelle fiche /admin/utilisateurs/[id].
// Usage : npx tsx scripts/create-fake-client.ts

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "marie.bertrand+test@moretti.fr";

  // Supprime si déjà existant (cascade → cart, orders…)
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    console.log("Client de test déjà présent, suppression pour repartir propre…");
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const passwordHash = await bcrypt.hash("Test1234!", 10);

  // ─── 1. Le client ────────────────────────────────────────────────────
  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      firstName: "Marie",
      lastName: "Bertrand",
      company: "Bijouterie Moretti",
      phone: "06 12 34 56 78",
      siret: `TEST${Date.now().toString().slice(-11)}`,
      addressStreet: "14 rue Sainte-Catherine",
      addressComplement: null,
      addressZip: "33000",
      addressCity: "Bordeaux",
      addressCountry: "FR",
      vatNumber: "FR32843920176",
      // VIES pré-rempli comme si vérifié à l'inscription
      viesValid: true,
      viesName: "BIJOUTERIE MORETTI SARL",
      viesAddress: "14 RUE SAINTE-CATHERINE\n33000 BORDEAUX\nFRANCE",
      viesRequestDate: new Date().toISOString(),
      viesError: null,
      status: "PENDING",
      role: "CLIENT",
      registrationMessage:
        "Bonjour, je souhaite vendre vos bijoux en acier inoxydable dans ma boutique du centre historique de Bordeaux. J'ouvre à la rentrée, pouvez-vous me confirmer vos délais de livraison pour un premier stock ? Merci !",
      // Remise produits déjà configurée
      discountType: "PERCENT",
      discountValue: 10,
      discountMode: "PERMANENT",
      // Remise livraison mode « sous conditions » à partir de 150 € HT
      shippingDiscountType: "PERCENT",
      shippingDiscountValue: 50,
      shippingDiscountMode: "THRESHOLD",
      shippingDiscountMinAmount: 150,
      shippingDiscountMinQuantity: null,
      freeShipping: false,
      lastSeenAt: new Date(), // pour voir le badge « En ligne » qui pulse
    },
  });
  console.log(`✔ Utilisatrice créée : ${user.id}`);

  // ─── 2. Panier avec des vraies variantes ─────────────────────────────
  // On prend jusqu'à 4 variantes en ligne existantes
  const variants = await prisma.productColor.findMany({
    where: {
      product: { status: "ONLINE" },
    },
    take: 4,
    include: { product: { select: { name: true, reference: true } } },
  });

  if (variants.length === 0) {
    console.log("⚠ Aucune variante produit en ligne trouvée — pas de panier créé.");
  } else {
    const cart = await prisma.cart.create({
      data: { userId: user.id },
    });
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId: v.id,
          quantity: [12, 3, 8, 4][i] ?? 2,
        },
      });
      console.log(`  + panier : ${v.product.name} (${v.product.reference})`);
    }
  }

  // ─── 3. Quelques commandes historiques ───────────────────────────────
  const now = Date.now();
  const orderPresets = [
    { daysAgo: 9,   status: "SHIPPED"   as const, totalTTC: 742.0,  subtotalHT: 618.33, tvaAmount: 123.67, itemCount: 6 },
    { daysAgo: 19,  status: "SHIPPED"   as const, totalTTC: 368.5,  subtotalHT: 307.08, tvaAmount: 61.42,  itemCount: 4 },
    { daysAgo: 26,  status: "PENDING"   as const, totalTTC: 198.0,  subtotalHT: 165.0,  tvaAmount: 33.0,   itemCount: 3 },
    { daysAgo: 35,  status: "SHIPPED"   as const, totalTTC: 564.0,  subtotalHT: 470.0,  tvaAmount: 94.0,   itemCount: 8 },
    { daysAgo: 47,  status: "CANCELLED" as const, totalTTC: 142.0,  subtotalHT: 118.33, tvaAmount: 23.67,  itemCount: 2 },
    { daysAgo: 61,  status: "SHIPPED"   as const, totalTTC: 412.0,  subtotalHT: 343.33, tvaAmount: 68.67,  itemCount: 5 },
    { daysAgo: 76,  status: "SHIPPED"   as const, totalTTC: 614.0,  subtotalHT: 511.67, tvaAmount: 102.33, itemCount: 7 },
  ];

  for (const p of orderPresets) {
    const createdAt = new Date(now - p.daysAgo * 24 * 3600 * 1000);
    const orderNumber = `TEST-${String(p.daysAgo).padStart(4, "0")}`;
    await prisma.order.create({
      data: {
        orderNumber,
        userId: user.id,
        status: p.status,
        tvaRate: 0.20,
        subtotalHT: p.subtotalHT,
        tvaAmount: p.tvaAmount,
        totalTTC: p.totalTTC,
        carrierId: "chronopost",
        carrierName: "Chronopost",
        carrierPrice: 12.5,
        clientDiscountAmt: 0,
        clientDiscountType: null,
        clientDiscountValue: null,
        clientFreeShipping: false,
        stripePaymentIntentId: `pi_test_${orderNumber}`,
        paymentStatus: p.status === "CANCELLED" ? "failed" : "paid",
        shipLabel: "Boutique",
        shipFirstName: "Marie",
        shipLastName: "Bertrand",
        shipCompany: "Bijouterie Moretti",
        shipAddress1: "14 rue Sainte-Catherine",
        shipAddress2: null,
        shipZipCode: "33000",
        shipCity: "Bordeaux",
        shipCountry: "FR",
        clientCompany: "Bijouterie Moretti",
        clientEmail: user.email,
        clientPhone: "06 12 34 56 78",
        clientSiret: user.siret,
        clientVatNumber: "FR32843920176",
        createdAt,
      },
    });
    console.log(`  + commande ${orderNumber} (${p.status})`);
  }

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`✅ Faux client prêt.`);
  console.log(`   URL : http://localhost:3000/admin/utilisateurs/${user.id}`);
  console.log("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
