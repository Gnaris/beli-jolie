/**
 * scripts/seed-onboarding-completed.ts
 *
 * Marque l'onboarding wizard comme deja termine sur les boutiques existantes.
 * A executer UNE FOIS sur les instances existantes (Beli & Jolie et tout
 * clone anterieur au commit qui introduit le wizard). Idempotent : si la
 * cle existe deja pour un tenant, ne fait rien pour lui.
 *
 * Multi-tenant : SiteConfig a une PK composite (tenantId, key). On pose la
 * cle pour CHAQUE tenant existant qui ne l'a pas encore, sinon un nouveau
 * tenant seede tomberait dans le wizard alors qu'on veut le sauter.
 *
 * Usage :
 *   npx tsx scripts/seed-onboarding-completed.ts
 *
 * ATTENTION : ne JAMAIS lancer ce script sur une nouvelle boutique creee
 * juste apres — elle doit passer par le wizard normalement.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  if (tenants.length === 0) {
    console.error("Aucun tenant. Lance d'abord scripts/seed-default-tenant.ts");
    process.exit(1);
  }
  const value = new Date().toISOString();
  for (const t of tenants) {
    const existing = await prisma.siteConfig.findUnique({
      where: { tenantId_key: { tenantId: t.id, key: "onboarding_completed_at" } },
    });
    if (existing) {
      console.log(`[${t.slug}] Deja pose : ${existing.value}`);
      continue;
    }
    await prisma.siteConfig.upsert({
      where: { tenantId_key: { tenantId: t.id, key: "onboarding_completed_at" } },
      update: { value },
      create: { tenantId: t.id, key: "onboarding_completed_at", value },
    });
    console.log(`[${t.slug}] Pose : ${value}`);
  }
  console.log("Fait.");
}

main()
  .catch((err) => {
    console.error("Erreur :", err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
