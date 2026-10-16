/**
 * Crée UNE réclamation Service Client (type ORDER_RELATED) random pour
 * borischen91@gmail.com sur la BDD locale. But : avoir un ticket pour tester
 * le tiroir « Commande concernée » dans /admin/service-client/[id].
 *
 * Usage : npx tsx scripts/_seed-random-claim-boris.ts
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const SUBJECTS = [
  "Article cassé à la réception",
  "Mauvaise taille livrée",
  "Produit manquant dans le colis",
  "Couleur différente de la photo",
  "Problème de qualité sur un article",
];

const BODIES = [
  "Bonjour,\n\nJ'ai reçu ma commande ce matin et l'un des articles est arrivé abîmé. Pouvez-vous m'indiquer la marche à suivre ? Merci d'avance.",
  "Bonjour,\n\nIl me manque un article dans mon colis par rapport au bon de livraison. Pouvez-vous vérifier ?",
  "Bonjour,\n\nLa couleur reçue ne correspond pas vraiment à celle affichée sur le site. Je souhaiterais un geste commercial ou un retour.",
  "Bonjour,\n\nUn des bijoux présente un défaut (fermoir cassé). Je peux vous envoyer une photo si besoin.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function generateReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SAV-${year}-`;
  const last = await p.claim.findFirst({
    where: { reference: { startsWith: prefix } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  let n = 1;
  if (last) {
    const parsed = parseInt(last.reference.replace(prefix, ""), 10);
    if (!isNaN(parsed)) n = parsed + 1;
  }
  return `${prefix}${String(n).padStart(6, "0")}`;
}

(async () => {
  const tenant = await p.tenant.findFirst({
    where: { slug: "beliandjolie" },
    select: { id: true, slug: true },
  });
  if (!tenant) throw new Error("Tenant beliandjolie introuvable");

  const user = await p.user.findFirst({
    where: { tenantId: tenant.id, email: "borischen91@gmail.com" },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!user) throw new Error("User borischen91@gmail.com introuvable sur beliandjolie");

  // Commande éligible : PENDING ou SHIPPED, avec au moins 1 article.
  const orders = await p.order.findMany({
    where: {
      tenantId: tenant.id,
      userId: user.id,
      status: { in: ["PENDING", "SHIPPED"] },
    },
    select: {
      id: true,
      orderNumber: true,
      items: { select: { id: true, productName: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const eligible = orders.filter((o) => o.items.length > 0);
  if (eligible.length === 0) {
    throw new Error("Aucune commande PENDING/SHIPPED avec articles pour cet utilisateur");
  }

  const order = pick(eligible);
  const itemCount = Math.min(order.items.length, Math.random() < 0.5 ? 1 : 2);
  const shuffled = [...order.items].sort(() => Math.random() - 0.5).slice(0, itemCount);
  const reported = shuffled.map((it) => ({
    orderItemId: it.id,
    quantity: Math.max(1, Math.min(it.quantity, Math.ceil(Math.random() * it.quantity))),
  }));

  const subject = pick(SUBJECTS);
  const body = pick(BODIES);
  const reference = await generateReference();

  const claim = await p.claim.create({
    data: {
      reference,
      subject,
      status: "OPEN",
      type: "ORDER_RELATED",
      userId: user.id,
      orderId: order.id,
      tenantId: tenant.id,
      body,
      orderItems: {
        create: reported.map((r) => ({ orderItemId: r.orderItemId, quantity: r.quantity })),
      },
    },
    select: { id: true, reference: true },
  });

  const conversation = await p.conversation.create({
    data: {
      type: "CLAIM",
      subject,
      userId: user.id,
      claimId: claim.id,
      tenantId: tenant.id,
      messages: {
        create: {
          senderId: user.id,
          senderRole: "CLIENT",
          content: body,
          source: "APP",
        },
      },
    },
    select: { id: true },
  });

  console.log("✅ Réclamation créée");
  console.log("   référence :", claim.reference);
  console.log("   claim id  :", claim.id);
  console.log("   commande  :", order.orderNumber, `(${itemCount} article(s) signalé(s))`);
  console.log("   conv id   :", conversation.id);
  console.log("   URL admin : /admin/service-client/" + claim.id);
})()
  .catch((err) => {
    console.error("❌ Échec :", err);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
