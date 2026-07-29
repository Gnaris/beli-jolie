/**
 * Jeu de faux clients + commandes pour prévisualiser en local la liste
 * admin › Clients (tri par nombre de commandes / montant dépensé /
 * dernière connexion / société).
 *
 * Usage :
 *   npx tsx scripts/seed-demo-clients.ts          → (re)crée le jeu de démo
 *   npx tsx scripts/seed-demo-clients.ts --clean  → supprime tout le jeu de démo
 *
 * Tout est marqué par le suffixe d'email @demo-local.test : le nettoyage ne
 * touche jamais un vrai compte. À n'utiliser qu'en local.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL_SUFFIX = "@demo-local.test";
const ORDER_PREFIX = "DEMO";

type DemoClient = {
  firstName: string;
  lastName: string;
  company: string;
  status: "APPROVED" | "PENDING" | "REJECTED";
  /** Nombre de commandes valides */
  orders: number;
  /** Montant TTC cumulé des commandes valides, en euros */
  spent: number;
  /** Commandes annulées en plus (ne doivent PAS compter dans la liste) */
  cancelled?: number;
  /** Dernière connexion, en heures avant maintenant. null = jamais connecté */
  lastLoginHoursAgo: number | null;
  /** true = considéré « en ligne maintenant » */
  online?: boolean;
  /** Inscription, en jours avant maintenant */
  signupDaysAgo: number;
};

const CLIENTS: DemoClient[] = [
  { firstName: "Marie",   lastName: "Lambert",  company: "Bijoux & Co",         status: "APPROVED", orders: 24, spent: 18430, lastLoginHoursAgo: 0.03, online: true,  signupDaysAgo: 560 },
  { firstName: "Paul",    lastName: "Durand",   company: "Atelier du Nord",     status: "APPROVED", orders: 17, spent: 21050, lastLoginHoursAgo: 3,                   signupDaysAgo: 610 },
  { firstName: "Sofia",   lastName: "Benali",   company: "Concept Store Lyon",  status: "APPROVED", orders: 12, spent: 7890,  lastLoginHoursAgo: 0.2,  online: true,  signupDaysAgo: 245 },
  { firstName: "Chloé",   lastName: "Petit",    company: "Écrin Doré",          status: "APPROVED", orders: 9,  spent: 5120,  lastLoginHoursAgo: 48,                  signupDaysAgo: 400 },
  { firstName: "Julie",   lastName: "Roche",    company: "Maison Roche",        status: "APPROVED", orders: 5,  spent: 2140,  lastLoginHoursAgo: 144,                 signupDaysAgo: 300 },
  { firstName: "Amine",   lastName: "Haddad",   company: "Perle Rare",          status: "APPROVED", orders: 4,  spent: 3980,  lastLoginHoursAgo: 720,                 signupDaysAgo: 180 },
  { firstName: "Léa",     lastName: "Fontaine", company: "Studio Ambre",        status: "APPROVED", orders: 3,  spent: 1250,  lastLoginHoursAgo: 360,                 signupDaysAgo: 120 },
  { firstName: "Marc",    lastName: "Olivier",  company: "Trésors d'Ici",       status: "APPROVED", orders: 2,  spent: 890,   lastLoginHoursAgo: 2900,                signupDaysAgo: 500 },
  { firstName: "Inès",    lastName: "Cardoso",  company: "Nova Boutique",       status: "APPROVED", orders: 1,  spent: 420,   lastLoginHoursAgo: 8,                   signupDaysAgo: 60  },
  { firstName: "Hugo",    lastName: "Mercier",  company: "Galerie Zénith",      status: "APPROVED", orders: 1,  spent: 610,   cancelled: 2, lastLoginHoursAgo: 480,   signupDaysAgo: 95  },
  { firstName: "Camille", lastName: "Noel",     company: "Fleur de Sel",        status: "APPROVED", orders: 0,  spent: 0,     lastLoginHoursAgo: 1080,                signupDaysAgo: 210 },
  { firstName: "Théo",    lastName: "Nguyen",   company: "Univers Mode",        status: "PENDING",  orders: 0,  spent: 0,     lastLoginHoursAgo: null,                signupDaysAgo: 2   },
  { firstName: "Sarah",   lastName: "Meyer",    company: "Optique Vision",      status: "PENDING",  orders: 0,  spent: 0,     lastLoginHoursAgo: null,                signupDaysAgo: 0   },
  { firstName: "Karim",   lastName: "Belaid",   company: "Zen Boutique",        status: "REJECTED", orders: 0,  spent: 0,     lastLoginHoursAgo: null,                signupDaysAgo: 30  },
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function emailOf(c: DemoClient): string {
  const slug = `${c.firstName}.${c.lastName}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z.]/g, "");
  return `${slug}${EMAIL_SUFFIX}`;
}

/** Répartit `total` en `n` montants réalistes dont la somme fait exactement `total`. */
function splitAmount(total: number, n: number): number[] {
  if (n <= 0) return [];
  const weights = Array.from({ length: n }, (_, i) => 0.6 + ((i * 37) % 100) / 100);
  const sumW = weights.reduce((s, w) => s + w, 0);
  const parts = weights.map((w) => Math.round((total * w) / sumW));
  const drift = total - parts.reduce((s, p) => s + p, 0);
  parts[parts.length - 1] += drift;
  return parts;
}

async function resolveTenantId(): Promise<string> {
  const local = await prisma.tenantDomain.findFirst({
    where: { host: { in: ["localhost:3000", "localhost"] } },
    select: { tenantId: true },
  });
  if (local) return local.tenantId;

  const first = await prisma.tenant.findFirst({ select: { id: true } });
  if (!first) throw new Error("Aucun tenant en base — lancer d'abord scripts/seed-default-tenant.ts");
  return first.id;
}

async function clean(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return 0;

  // Order n'a pas onDelete: Cascade → on supprime items puis commandes d'abord.
  const orders = await prisma.order.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  await prisma.cart.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function main() {
  const cleanOnly = process.argv.includes("--clean");

  const removed = await clean();
  if (removed > 0) console.log(`🧹 ${removed} client(s) de démo supprimé(s).`);

  if (cleanOnly) {
    console.log("✅ Nettoyage terminé, aucun faux client ne reste.");
    return;
  }

  const tenantId = await resolveTenantId();
  const passwordHash = await bcrypt.hash("Demo1234!", 10);
  const now = Date.now();

  let orderSeq = 0;
  let totalOrders = 0;

  for (const [idx, c] of CLIENTS.entries()) {
    const email = emailOf(c);
    const user = await prisma.user.create({
      data: {
        tenantId,
        email,
        password: passwordHash,
        firstName: c.firstName,
        lastName: c.lastName,
        company: c.company,
        phone: `06 ${String(10 + idx).padStart(2, "0")} 45 78 ${String(10 + idx * 3).padStart(2, "0")}`,
        siret: `DEMO${String(100000000 + idx * 7919).slice(0, 9)}`,
        addressStreet: "12 rue de la Démo",
        addressZip: "75011",
        addressCity: "Paris",
        addressCountry: "FR",
        role: "CLIENT",
        status: c.status,
        createdAt: new Date(now - c.signupDaysAgo * DAY),
        lastLoginAt: c.lastLoginHoursAgo === null ? null : new Date(now - c.lastLoginHoursAgo * HOUR),
        lastSeenAt: c.online ? new Date(now - 10_000) : null,
      },
    });

    const amounts = splitAmount(c.spent, c.orders);
    const cancelledCount = c.cancelled ?? 0;

    for (let i = 0; i < c.orders + cancelledCount; i++) {
      const isCancelled = i >= c.orders;
      const totalTTC = isCancelled ? 350 : amounts[i];
      const carrierPrice = 11.7;
      const subtotalHT = Math.max(0, (totalTTC - carrierPrice) / 1.2);
      const tvaAmount = subtotalHT * 0.2;
      orderSeq += 1;
      const orderNumber = `${ORDER_PREFIX}${String(orderSeq).padStart(5, "0")}`;
      // Commandes étalées sur les 14 derniers mois
      const placedAt = new Date(now - ((i * 37) % 420) * DAY - 2 * HOUR);

      await prisma.order.create({
        data: {
          tenantId,
          orderNumber,
          userId: user.id,
          status: isCancelled ? "CANCELLED" : i % 3 === 0 ? "PENDING" : "SHIPPED",
          createdAt: placedAt,
          tvaRate: 0.2,
          subtotalHT,
          tvaAmount,
          totalTTC,
          paidSubtotalHT: subtotalHT,
          carrierId: "colissimo",
          carrierName: "Colissimo",
          carrierPrice,
          clientDiscountAmt: 0,
          clientFreeShipping: false,
          stripePaymentIntentId: `pi_demo_${orderNumber}`,
          paymentStatus: isCancelled ? "failed" : "paid",
          shipLabel: "Boutique",
          shipFirstName: c.firstName,
          shipLastName: c.lastName,
          shipCompany: c.company,
          shipAddress1: "12 rue de la Démo",
          shipZipCode: "75011",
          shipCity: "Paris",
          shipCountry: "FR",
          clientCompany: c.company,
          clientEmail: email,
          clientPhone: user.phone,
          clientSiret: user.siret,
          items: {
            create: [
              {
                productName: "Article de démonstration",
                productRef: `DEMO-${orderNumber}`,
                colorName: "Doré",
                saleType: "UNIT",
                unitPrice: Math.round(subtotalHT * 100) / 100,
                quantity: 1,
                lineTotal: Math.round(subtotalHT * 100) / 100,
              },
            ],
          },
        },
      });
      if (!isCancelled) totalOrders += 1;
    }

    const label = c.orders > 0 ? `${c.orders} cmd · ${c.spent} €` : "aucune commande";
    console.log(`✔ ${c.company.padEnd(22)} ${c.firstName} ${c.lastName} — ${label}`);
  }

  console.log("");
  console.log("──────────────────────────────────────────────────────────");
  console.log(`✅ ${CLIENTS.length} clients de démo + ${totalOrders} commandes valides créés.`);
  console.log("   Aperçu : http://localhost:3000/admin/utilisateurs");
  console.log("   Nettoyage : npx tsx scripts/seed-demo-clients.ts --clean");
  console.log("──────────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
