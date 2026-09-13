/**
 * Seed 10 faux avis clients APPROVED pour visualiser le rendu de la section
 * Avis sur la homepage.
 *
 * Crée 10 users « fake-review-N@demo-reviews.test » (dedup si déjà présents)
 * + 10 CustomerReview APPROVED rattachées.
 *
 * Cleanup :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/seed-fake-reviews.ts --clean
 */
import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";

const TENANT_ID = "cmrhsmaim0000vld1q6b030mh";
const FAKE_EMAIL_DOMAIN = "@demo-reviews.test";
const FAKE_PASSWORD_HASH =
  // bcrypt hash pour "not-a-real-password" — non utilisable pour se connecter
  "$2b$12$0000000000000000000000000000000000000000000000000000";

const FAKE_REVIEWS: Array<{
  firstName: string;
  lastName: string;
  company: string;
  rating: number;
  text: string;
}> = [
  {
    firstName: "Sophie",
    lastName: "Legrand",
    company: "Boutique Éclat",
    rating: 5,
    text:
      "Livraison rapide, qualité au rendez-vous, prix vraiment corrects. J'ai testé 3 grossistes avant, ISSYMA est mon choix définitif pour le renouvellement de ma vitrine.",
  },
  {
    firstName: "Nadia",
    lastName: "Boukhari",
    company: "Le Petit Bijou",
    rating: 5,
    text:
      "Le catalogue en ligne est super clair et les nouveautés arrivent vraiment chaque semaine. Mes clientes adorent le style et je réassortis tous les mois sans souci.",
  },
  {
    firstName: "Claire",
    lastName: "Morel",
    company: "Concept Store Lila",
    rating: 5,
    text:
      "Service client au top, réactif et de bon conseil. Les prix pros sont très compétitifs, les remises dégressives sont automatiques et bien pensées.",
  },
  {
    firstName: "Elodie",
    lastName: "Rousseau",
    company: "Atelier Perles & Co",
    rating: 4,
    text:
      "Très bonne qualité générale, quelques références en rupture parfois mais l'équipe reprend contact rapidement pour proposer une alternative. Recommandé.",
  },
  {
    firstName: "Aurélie",
    lastName: "Chevalier",
    company: "Boutique Zeste",
    rating: 5,
    text:
      "Cela fait deux ans que je commande chez eux. La livraison en 48h est fiable, l'emballage soigné, aucun souci de SAV en dizaines de commandes.",
  },
  {
    firstName: "Mélissa",
    lastName: "Fontaine",
    company: "Douceur & Style",
    rating: 5,
    text:
      "J'apprécie particulièrement le renouvellement des collections. Les pièces sont dans l'air du temps et se vendent bien en boutique physique comme en ligne.",
  },
  {
    firstName: "Céline",
    lastName: "Berger",
    company: "Manège des Trésors",
    rating: 4,
    text:
      "Rapport qualité-prix imbattable sur les colliers et bracelets. Les fiches produits sont bien faites, on sait ce qu'on commande. Un vrai gain de temps.",
  },
  {
    firstName: "Justine",
    lastName: "Petit",
    company: "L'Écrin de Jade",
    rating: 5,
    text:
      "Une équipe à l'écoute et de véritables professionnels. Je recommande à toutes les boutiques indépendantes qui cherchent un fournisseur fiable et sérieux.",
  },
  {
    firstName: "Manon",
    lastName: "Lefevre",
    company: "Studio Ma Perle",
    rating: 5,
    text:
      "J'ai découvert ISSYMA par bouche-à-oreille, aucune déception depuis. Les nouveautés arrivent régulièrement et la qualité tient dans la durée, mes clientes reviennent.",
  },
  {
    firstName: "Amélie",
    lastName: "Marchand",
    company: "Boutique Maëva",
    rating: 4,
    text:
      "Bonne expérience globale. Le seul point d'amélioration serait plus de photos par produit mais rien de bloquant. Je recommande sans hésiter.",
  },
];

async function clean() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: FAKE_EMAIL_DOMAIN } },
    select: { id: true, email: true },
  });
  if (users.length === 0) {
    console.log("Rien à nettoyer.");
    return;
  }
  // onDelete: Cascade sur CustomerReview.user → suppression automatique des avis.
  const ids = users.map((u) => u.id);
  const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Nettoyé : ${del.count} users démo (+ avis en cascade).`);
}

async function seed() {
  console.log(`Seed ${FAKE_REVIEWS.length} faux avis dans le tenant ${TENANT_ID}…`);
  let created = 0;
  for (const [i, r] of FAKE_REVIEWS.entries()) {
    const email = `fake-review-${i + 1}${FAKE_EMAIL_DOMAIN}`;
    // upsert user par email (dedup si déjà créé lors d'un run précédent)
    const user = await prisma.user.upsert({
      where: { id: `noop-${i}` }, // where inutilisable ici, on force via findFirst puis create/update
      update: {},
      create: {
        email,
        password: FAKE_PASSWORD_HASH,
        firstName: r.firstName,
        lastName: r.lastName,
        company: r.company,
        phone: "+33600000000",
        role: "CLIENT",
        status: "APPROVED",
        tenantId: TENANT_ID,
      },
    }).catch(async () => {
      // fallback : cherche par (tenantId, email) puis crée si absent
      const existing = await prisma.user.findFirst({ where: { email, tenantId: TENANT_ID } });
      if (existing) return existing;
      return prisma.user.create({
        data: {
          email,
          password: FAKE_PASSWORD_HASH,
          firstName: r.firstName,
          lastName: r.lastName,
          company: r.company,
          phone: "+33600000000",
          role: "CLIENT",
          status: "APPROVED",
          tenantId: TENANT_ID,
        },
      });
    });

    // Un avis par user (contrainte @unique userId sur CustomerReview)
    const existingReview = await prisma.customerReview.findUnique({ where: { userId: user.id } });
    if (existingReview) {
      console.log(`  ${i + 1}. Avis déjà présent pour ${r.firstName} — skip`);
      continue;
    }

    // Étaler les dates sur les 30 derniers jours pour un rendu réaliste
    const daysAgo = crypto.randomInt(1, 30);
    const createdAt = new Date(Date.now() - daysAgo * 86400_000);

    await prisma.customerReview.create({
      data: {
        userId: user.id,
        rating: r.rating,
        text: r.text,
        status: "APPROVED",
        moderatedAt: createdAt,
        createdAt,
        tenantId: TENANT_ID,
      },
    });
    created++;
    console.log(`  ${i + 1}. ${r.firstName} ${r.lastName.charAt(0)}. — ★${r.rating}`);
  }
  console.log(`\n✓ ${created} avis créés + ${FAKE_REVIEWS.length - created} déjà présents.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--clean")) await clean();
  else await seed();
}

main()
  .catch((e) => {
    console.error("ERREUR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
