/**
 * scripts/seed-onboarding-completed.ts
 *
 * Marque l'onboarding wizard comme deja termine sur cette boutique.
 * A executer UNE FOIS sur les instances existantes (Beli & Jolie et tout
 * clone anterieur au commit qui introduit le wizard). Idempotent : si la
 * cle existe deja, ne fait rien.
 *
 * Usage :
 *   npx tsx scripts/seed-onboarding-completed.ts
 *
 * ATTENTION : ne JAMAIS lancer ce script sur une nouvelle boutique creee
 * avec new-shop.sh — elle doit passer par le wizard normalement.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.siteConfig.findUnique({
    where: { key: "onboarding_completed_at" },
  });
  if (existing) {
    console.log(`Deja pose : onboarding_completed_at = ${existing.value}`);
    return;
  }
  const value = new Date().toISOString();
  await prisma.siteConfig.upsert({
    where: { key: "onboarding_completed_at" },
    update: { value },
    create: { key: "onboarding_completed_at", value },
  });
  console.log(`Pose : onboarding_completed_at = ${value}`);
  console.log("Cette instance ne verra pas le wizard onboarding.");
}

main()
  .catch((err) => {
    console.error("Erreur :", err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
