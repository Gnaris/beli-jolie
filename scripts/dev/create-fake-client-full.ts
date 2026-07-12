/**
 * Client de test « complet » pour parcourir le site côté client :
 *  - compte APPROVED
 *  - 2 adresses de livraison
 *  - panier peuplé (5 items)
 *  - 15 favoris
 *  - 8 commandes réparties (PENDING/SHIPPED/CANCELLED)
 *  - 3 réclamations (RESOLVED / IN_REVIEW / RETURN_PENDING) + conversations
 *  - 2 conversations support (1 ouverte, 1 fermée)
 *  - 1 avoir (Credit) disponible
 *
 * Usage : npx tsx scripts/dev/create-fake-client-full.ts
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL = "sophie.dupont@test.local";
const PASSWORD = "Test1234!";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 3600 * 1000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600 * 1000);
}

function pick<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

async function main() {
  console.log("=== Création du client de test complet ===\n");

  // ─── 1. Nettoyer si déjà présent ──────────────────────────────
  const existing = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  if (existing) {
    console.log("Ancien compte trouvé, nettoyage…");
    await prisma.orderItemModification.deleteMany({ where: { order: { userId: existing.id } } });
    await prisma.orderItem.deleteMany({ where: { order: { userId: existing.id } } });
    await prisma.creditUsage.deleteMany({ where: { order: { userId: existing.id } } });
    await prisma.claimItem.deleteMany({ where: { claim: { userId: existing.id } } });
    await prisma.claimImage.deleteMany({ where: { claim: { userId: existing.id } } });
    await prisma.claimReturn.deleteMany({ where: { claim: { userId: existing.id } } });
    await prisma.claimReship.deleteMany({ where: { claim: { userId: existing.id } } });
    await prisma.messageAttachment.deleteMany({ where: { message: { conversation: { userId: existing.id } } } });
    await prisma.message.deleteMany({ where: { conversation: { userId: existing.id } } });
    await prisma.conversation.deleteMany({ where: { userId: existing.id } });
    await prisma.credit.deleteMany({ where: { userId: existing.id } });
    await prisma.claim.deleteMany({ where: { userId: existing.id } });
    await prisma.order.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  // ─── 2. Créer le client ────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      email: EMAIL,
      password: passwordHash,
      firstName: "Sophie",
      lastName: "Dupont",
      company: "Sophie Bijoux Lyon",
      phone: "06 34 12 78 90",
      siret: `TESTCLI${Date.now().toString().slice(-11)}`,
      addressStreet: "42 rue de la République",
      addressComplement: "Rez-de-chaussée",
      addressZip: "69002",
      addressCity: "Lyon",
      addressCountry: "FR",
      vatNumber: "FR76853721098",
      viesValid: true,
      viesName: "SOPHIE BIJOUX LYON SARL",
      viesAddress: "42 RUE DE LA REPUBLIQUE\n69002 LYON\nFRANCE",
      viesRequestDate: new Date().toISOString(),
      status: "APPROVED",
      role: "CLIENT",
      registrationMessage:
        "Bonjour, je gère une boutique de bijoux fantaisie à Lyon depuis 3 ans. Je serais ravie de compléter mon offre avec vos créations en acier inoxydable.",
      discountType: "PERCENT",
      discountValue: 10,
      discountMode: "PERMANENT",
      shippingDiscountType: "PERCENT",
      shippingDiscountValue: 100,
      shippingDiscountMode: "THRESHOLD",
      shippingDiscountMinAmount: 200,
      lastLoginAt: hoursAgo(2),
      lastSeenAt: hoursAgo(1),
    },
  });
  console.log(`✔ Client créé : ${user.email} (${user.id})`);

  // ─── 3. Adresses de livraison ─────────────────────────────────
  await prisma.shippingAddress.createMany({
    data: [
      {
        userId: user.id,
        label: "Boutique principale",
        firstName: "Sophie",
        lastName: "Dupont",
        company: "Sophie Bijoux Lyon",
        address1: "42 rue de la République",
        address2: "Rez-de-chaussée",
        zipCode: "69002",
        city: "Lyon",
        country: "FR",
        phone: "04 78 12 34 56",
        isDefault: true,
      },
      {
        userId: user.id,
        label: "Entrepôt Villeurbanne",
        firstName: "Sophie",
        lastName: "Dupont",
        company: "Sophie Bijoux Lyon",
        address1: "18 avenue Roger Salengro",
        zipCode: "69100",
        city: "Villeurbanne",
        country: "FR",
        phone: "04 78 45 67 89",
        isDefault: false,
      },
    ],
  });
  console.log("✔ 2 adresses de livraison");

  // ─── 4. Récupérer un pool de variantes ONLINE ─────────────────
  const variants = await prisma.productColor.findMany({
    where: {
      product: { status: "ONLINE" },
      unitPrice: { gt: 0 },
    },
    take: 60,
    include: {
      product: { select: { id: true, name: true, reference: true } },
      images: { orderBy: { order: "asc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  if (variants.length < 20) {
    console.error(`⚠ Pas assez de variantes ONLINE (${variants.length}) — annulation.`);
    process.exit(1);
  }
  console.log(`✔ Pool de ${variants.length} variantes disponibles`);

  // ─── 5. Panier ─────────────────────────────────────────────────
  const cart = await prisma.cart.create({ data: { userId: user.id } });
  const cartPicks = pick(variants, 5);
  for (let i = 0; i < cartPicks.length; i++) {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        variantId: cartPicks[i].id,
        quantity: [12, 6, 3, 24, 4][i] ?? 2,
      },
    });
  }
  console.log(`✔ Panier avec ${cartPicks.length} articles`);

  // ─── 6. Favoris ────────────────────────────────────────────────
  const favProducts = Array.from(
    new Map(pick(variants, 40).map((v) => [v.product.id, v.product])).values(),
  ).slice(0, 15);
  for (const p of favProducts) {
    await prisma.favorite.create({
      data: { userId: user.id, productId: p.id, createdAt: daysAgo(Math.floor(Math.random() * 60)) },
    });
  }
  console.log(`✔ ${favProducts.length} favoris`);

  // ─── 7. Commandes ──────────────────────────────────────────────
  const orderConfigs: Array<{
    daysAgo: number;
    status: "PENDING" | "SHIPPED" | "CANCELLED";
    itemCount: number;
    paymentStatus: string;
    note?: string;
  }> = [
    { daysAgo: 2, status: "PENDING", itemCount: 4, paymentStatus: "paid", note: "Nouvelle" },
    { daysAgo: 6, status: "PENDING", itemCount: 3, paymentStatus: "paid", note: "En préparation" },
    { daysAgo: 14, status: "SHIPPED", itemCount: 5, paymentStatus: "paid" },
    { daysAgo: 28, status: "SHIPPED", itemCount: 6, paymentStatus: "paid" },
    { daysAgo: 45, status: "SHIPPED", itemCount: 4, paymentStatus: "paid" },
    { daysAgo: 72, status: "CANCELLED", itemCount: 2, paymentStatus: "failed" },
    { daysAgo: 95, status: "SHIPPED", itemCount: 7, paymentStatus: "paid" },
    { daysAgo: 130, status: "SHIPPED", itemCount: 3, paymentStatus: "paid" },
  ];

  const createdOrders: { id: string; number: string; items: { id: string; ref: string; name: string }[] }[] = [];

  for (const cfg of orderConfigs) {
    const picks = pick(variants, cfg.itemCount);
    const orderCreatedAt = daysAgo(cfg.daysAgo);
    const shortNum = Math.random().toString(36).slice(2, 10).toUpperCase();

    const itemsData: Prisma.OrderItemCreateManyOrderInput[] = picks.map((v, i) => {
      const qty = [2, 4, 6, 8, 12, 3][i % 6];
      const unitPrice = Number(v.unitPrice);
      const lineTotal = qty * unitPrice;
      const imgPath = v.images[0]?.path ?? null;
      return {
        productName: v.product.name,
        productRef: v.product.reference,
        colorName: "Doré",
        saleType: v.saleType,
        packQty: v.packQuantity,
        imagePath: imgPath,
        unitPrice,
        quantity: qty,
        lineTotal,
      };
    });

    const subtotalHT = itemsData.reduce((s, it) => s + Number(it.lineTotal), 0);
    const tvaRate = 0.2;
    const tvaAmount = Math.round(subtotalHT * tvaRate * 100) / 100;
    const carrierPrice = subtotalHT >= 200 ? 0 : 12.5;
    const totalTTC = Math.round((subtotalHT + tvaAmount + carrierPrice) * 100) / 100;

    const order = await prisma.order.create({
      data: {
        orderNumber: shortNum,
        userId: user.id,
        status: cfg.status,
        tvaRate,
        subtotalHT,
        tvaAmount,
        totalTTC,
        paidSubtotalHT: subtotalHT,
        carrierId: "colissimo",
        carrierName: "Colissimo",
        carrierPrice,
        clientDiscountAmt: 0,
        clientFreeShipping: subtotalHT >= 200,
        stripePaymentIntentId: `pi_test_${shortNum}`,
        paymentStatus: cfg.paymentStatus,
        shipLabel: "Boutique principale",
        shipFirstName: "Sophie",
        shipLastName: "Dupont",
        shipCompany: "Sophie Bijoux Lyon",
        shipAddress1: "42 rue de la République",
        shipAddress2: "Rez-de-chaussée",
        shipZipCode: "69002",
        shipCity: "Lyon",
        shipCountry: "FR",
        clientCompany: "Sophie Bijoux Lyon",
        clientEmail: user.email,
        clientPhone: "06 34 12 78 90",
        clientSiret: user.siret,
        clientVatNumber: "FR76853721098",
        eeTrackingId: cfg.status === "SHIPPED" ? `EE${shortNum}FR` : null,
        cgvAcceptedAt: orderCreatedAt,
        createdAt: orderCreatedAt,
        items: { createMany: { data: itemsData } },
      },
      include: { items: true },
    });
    createdOrders.push({
      id: order.id,
      number: order.orderNumber,
      items: order.items.map((it) => ({ id: it.id, ref: it.productRef, name: it.productName })),
    });
    console.log(`  + Commande ${order.orderNumber} (${cfg.status}, ${itemsData.length} art., ${totalTTC}€ TTC)`);
  }

  // ─── 8. Réclamations ───────────────────────────────────────────
  // 8.a Réclamation RESOLVED (crédit accordé)
  const orderForResolved = createdOrders[3]; // il y a 28 jours
  const claim1 = await prisma.claim.create({
    data: {
      reference: `SAV${Date.now().toString().slice(-6)}A`,
      type: "ORDER_CLAIM",
      status: "RESOLVED",
      userId: user.id,
      orderId: orderForResolved.id,
      description: "Deux bracelets sont arrivés cassés dans le lot. Les fermoirs ne tiennent pas.",
      resolution: "CREDIT",
      creditAmount: 45.0,
      adminNote: "Confirmé après photos. Avoir de 45€ crédité sur le compte.",
      createdAt: daysAgo(20),
      updatedAt: daysAgo(15),
      items: {
        create: [
          { orderItemId: orderForResolved.items[0].id, quantity: 2, reason: "DEFECTIVE", reasonDetail: "Fermoir cassé" },
        ],
      },
    },
  });
  const conv1 = await prisma.conversation.create({
    data: {
      type: "CLAIM",
      subject: `Réclamation ${claim1.reference}`,
      status: "CLOSED",
      userId: user.id,
      claimId: claim1.id,
      createdAt: daysAgo(20),
      updatedAt: daysAgo(15),
      messages: {
        create: [
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Bonjour, j'ai reçu la commande mais 2 bracelets ont le fermoir cassé. Voici les photos.",
            createdAt: daysAgo(20),
            readAt: daysAgo(19),
          },
          {
            senderId: user.id, // simulé côté admin — sender = admin
            senderRole: "ADMIN",
            content: "Bonjour Sophie, désolée pour ce désagrément. Après vérification, nous vous accordons un avoir de 45€. Il apparaîtra dans votre espace pro.",
            createdAt: daysAgo(19),
            readAt: daysAgo(19),
          },
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Merci beaucoup pour votre réactivité !",
            createdAt: daysAgo(18),
            readAt: daysAgo(18),
          },
        ],
      },
    },
  });
  const credit1 = await prisma.credit.create({
    data: {
      userId: user.id,
      amount: 45.0,
      remainingAmount: 45.0,
      claimId: claim1.id,
      expiresAt: daysAgo(-365),
      createdAt: daysAgo(15),
    },
  });
  console.log(`✔ Réclamation ${claim1.reference} RESOLVED + avoir 45€`);

  // 8.b Réclamation IN_REVIEW (en cours de traitement)
  const orderForReview = createdOrders[2];
  const claim2 = await prisma.claim.create({
    data: {
      reference: `SAV${Date.now().toString().slice(-6)}B`,
      type: "ORDER_CLAIM",
      status: "IN_REVIEW",
      userId: user.id,
      orderId: orderForReview.id,
      description: "Erreur dans le colis : j'ai reçu 3 colliers argentés au lieu de dorés.",
      createdAt: daysAgo(5),
      updatedAt: daysAgo(2),
      items: {
        create: [
          { orderItemId: orderForReview.items[0].id, quantity: 3, reason: "WRONG_ITEM", reasonDetail: "Couleur erronée" },
        ],
      },
    },
  });
  await prisma.conversation.create({
    data: {
      type: "CLAIM",
      subject: `Réclamation ${claim2.reference}`,
      status: "OPEN",
      userId: user.id,
      claimId: claim2.id,
      createdAt: daysAgo(5),
      updatedAt: daysAgo(2),
      messages: {
        create: [
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Bonjour, j'ai reçu 3 colliers argentés à la place des dorés commandés. Comment procède-t-on ?",
            createdAt: daysAgo(5),
            readAt: daysAgo(4),
          },
          {
            senderId: user.id,
            senderRole: "ADMIN",
            content: "Bonjour Sophie, désolée pour cette erreur. On regarde ce qu'on peut faire — pouvez-vous nous envoyer une photo des colliers reçus ?",
            createdAt: daysAgo(4),
            readAt: daysAgo(4),
          },
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Voici la photo en pièce jointe. Merci d'avance.",
            createdAt: daysAgo(2),
            readAt: null, // non lu par l'admin
          },
        ],
      },
    },
  });
  console.log(`✔ Réclamation ${claim2.reference} IN_REVIEW (message client non lu)`);

  // 8.c Réclamation RETURN_PENDING (retour à envoyer)
  const orderForReturn = createdOrders[4];
  const claim3 = await prisma.claim.create({
    data: {
      reference: `SAV${Date.now().toString().slice(-6)}C`,
      type: "ORDER_CLAIM",
      status: "RETURN_PENDING",
      userId: user.id,
      orderId: orderForReturn.id,
      description: "1 lot défectueux — je préfère le retourner et être remboursée.",
      resolution: "REFUND",
      refundAmount: 32.0,
      adminNote: "Accord retour. Bordereau à générer.",
      createdAt: daysAgo(10),
      updatedAt: daysAgo(3),
      items: {
        create: [
          { orderItemId: orderForReturn.items[1].id, quantity: 1, reason: "DEFECTIVE" },
        ],
      },
      returnInfo: {
        create: {
          method: "EASY_EXPRESS",
          status: "LABEL_GENERATED",
          trackingNumber: "EE123RETOUR",
        },
      },
    },
  });
  await prisma.conversation.create({
    data: {
      type: "CLAIM",
      subject: `Réclamation ${claim3.reference}`,
      status: "OPEN",
      userId: user.id,
      claimId: claim3.id,
      createdAt: daysAgo(10),
      updatedAt: daysAgo(3),
      messages: {
        create: [
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Le lot de bracelets à charms est défectueux, les breloques tombent. Je préfère retourner.",
            createdAt: daysAgo(10),
            readAt: daysAgo(9),
          },
          {
            senderId: user.id,
            senderRole: "ADMIN",
            content: "Compris. Nous vous envoyons un bordereau prépayé Colissimo. Remboursement dès réception.",
            createdAt: daysAgo(3),
            readAt: daysAgo(3),
          },
        ],
      },
    },
  });
  console.log(`✔ Réclamation ${claim3.reference} RETURN_PENDING (bordereau généré)`);

  // ─── 9. Conversations support (hors réclamation) ──────────────
  await prisma.conversation.create({
    data: {
      type: "SUPPORT",
      subject: "Délais de livraison pour l'international",
      status: "CLOSED",
      userId: user.id,
      createdAt: daysAgo(40),
      updatedAt: daysAgo(38),
      messages: {
        create: [
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Bonjour, quels sont vos délais pour une livraison en Belgique ?",
            createdAt: daysAgo(40),
            readAt: daysAgo(39),
          },
          {
            senderId: user.id,
            senderRole: "ADMIN",
            content: "Bonjour Sophie, comptez 4 jours ouvrés en moyenne via Chronopost.",
            createdAt: daysAgo(39),
            readAt: daysAgo(39),
          },
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Parfait, merci pour l'info.",
            createdAt: daysAgo(38),
            readAt: daysAgo(38),
          },
        ],
      },
    },
  });

  await prisma.conversation.create({
    data: {
      type: "SUPPORT",
      subject: "Question sur les couleurs disponibles",
      status: "OPEN",
      userId: user.id,
      createdAt: daysAgo(3),
      updatedAt: daysAgo(1),
      messages: {
        create: [
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Est-ce que la référence PT91 existe aussi en argenté ?",
            createdAt: daysAgo(3),
            readAt: daysAgo(2),
          },
          {
            senderId: user.id,
            senderRole: "ADMIN",
            content: "Oui, la couleur argenté est en réassort. On vous prévient dès qu'elle est en ligne.",
            createdAt: daysAgo(2),
            readAt: daysAgo(2),
          },
          {
            senderId: user.id,
            senderRole: "CLIENT",
            content: "Super, j'attends votre retour. Une idée du délai ?",
            createdAt: daysAgo(1),
            readAt: null, // en attente d'admin
          },
        ],
      },
    },
  });
  console.log("✔ 2 conversations support (1 fermée, 1 ouverte)");

  console.log("\n──────────────────────────────────────────────────────────");
  console.log("✅ Client de test complet prêt.");
  console.log(`   Email     : ${EMAIL}`);
  console.log(`   Mot de passe : ${PASSWORD}`);
  console.log(`   Espace pro  : http://localhost:3000/espace-pro`);
  console.log(`   Fiche admin : http://localhost:3000/admin/utilisateurs/${user.id}`);
  console.log("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
