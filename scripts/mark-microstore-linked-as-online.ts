/**
 * Rattrapage : pour tous les produits BJ qui ont un microstoreProductId mais
 * pas encore de microstoreLastPushedAt (cas du backfill de liaison en masse),
 * on pose maintenant + syncRequired=true pour que le badge Microstore passe
 * au vert avec un rappel « Synchro nécessaire ».
 */

import { PrismaClient } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";

const prisma = new PrismaClient();
const TENANT_SLUG = process.env.TENANT_SLUG || "beliandjolie";

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  await tenantALS.run(tenant.id, async () => {
    const result = await prisma.product.updateMany({
      where: {
        microstoreProductId: { not: null },
        microstoreLastPushedAt: null,
      },
      data: {
        microstoreLastPushedAt: new Date(),
        microstoreSyncRequired: true,
      },
    });
    console.log(`${result.count} produits bumpés (badge vert + synchro nécessaire)`);
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
