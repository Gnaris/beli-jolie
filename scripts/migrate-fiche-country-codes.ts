/**
 * Migration one-shot : convertit les valeurs stockées dans
 * AdminClientCard.countryCode depuis le nom complet remonté par PFS
 * ("PORTUGAL", "SUISSE", "RÉUNION"…) vers le code ISO 3166-1 alpha-2
 * ("PT", "CH", "RE"…).
 *
 * Cause : `lib/pfs-orders-sync.ts` stockait auparavant `addr.country.toUpperCase()`
 * brut. Résultat : le CDN de drapeaux (flagcdn.com) recevait un slug invalide
 * et renvoyait 404. Le nom du pays affiché à côté de la ville était vide.
 *
 * Après ce script : les fiches existantes remontent proprement leur drapeau +
 * nom canonique, et l'import PFS corrigé produit directement du code ISO.
 *
 * Idempotent : les fiches déjà en ISO ne sont pas retouchées.
 *
 * Usage : MULTI_TENANT_SCOPE=off npx tsx scripts/migrate-fiche-country-codes.ts
 */

import { PrismaClient } from "@prisma/client";
import { resolveCountryCode } from "../lib/countries";

const prisma = new PrismaClient();

interface Summary {
  scanned: number;
  alreadyIso: number;
  converted: number;
  unresolved: Array<{ id: string; value: string }>;
}

async function main() {
  const cards = await prisma.adminClientCard.findMany({
    where: { countryCode: { not: null } },
    select: { id: true, countryCode: true },
  });

  const summary: Summary = {
    scanned: cards.length,
    alreadyIso: 0,
    converted: 0,
    unresolved: [],
  };

  for (const card of cards) {
    const raw = card.countryCode!;
    const iso = resolveCountryCode(raw);
    if (!iso) {
      summary.unresolved.push({ id: card.id, value: raw });
      continue;
    }
    if (iso === raw) {
      summary.alreadyIso++;
      continue;
    }
    await prisma.adminClientCard.update({
      where: { id: card.id },
      data: { countryCode: iso },
    });
    summary.converted++;
  }

  console.log("─── Migration countryCode fiches ──────────────────────");
  console.log(`Fiches scannées : ${summary.scanned}`);
  console.log(`Déjà en ISO     : ${summary.alreadyIso}`);
  console.log(`Converties      : ${summary.converted}`);
  console.log(`Non résolues    : ${summary.unresolved.length}`);
  if (summary.unresolved.length > 0) {
    console.log("\nValeurs à vérifier manuellement :");
    for (const u of summary.unresolved) {
      console.log(`  - ${u.id} : "${u.value}"`);
    }
  }
}

main()
  .catch((err) => {
    console.error("[migrate-fiche-country-codes] Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
