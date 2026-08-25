/**
 * Test end-to-end de l'envoi photos vers Microstore, hors HTTP.
 *
 * Usage :
 *   npx tsx scripts/dev/test-microstore-photos-push.ts [REFERENCE]
 *
 * Si REFERENCE est omis, choisit automatiquement le 1er produit BJ ayant
 * `microstoreProductId` non-null (donc déjà publié sur Microstore).
 *
 * Se place dans le tenant "beliandjolie" via `tenantALS.run` — l'extension
 * Prisma tenant-scope voit donc les bonnes lignes. Affiche le résultat
 * détaillé (succès + résumé par couleur, ou erreur).
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import { sendProductPhotosToMicrostoreCore } from "@/lib/microstore-photos-sync";

async function main() {
  const raw = new PrismaClient();
  // Slug local peut être "beli-jolie" (dev) ou "beliandjolie" (prod). On tente
  // les deux dans l'ordre — le premier qui matche gagne.
  const tenant =
    (await raw.tenant.findFirst({ where: { slug: "beli-jolie" } })) ||
    (await raw.tenant.findFirst({ where: { slug: "beliandjolie" } }));
  if (!tenant) {
    console.error("Tenant beliandjolie introuvable en BDD.");
    process.exit(2);
  }
  console.log(`[test] tenant = ${tenant.slug} (${tenant.id})`);

  await tenantALS.run(tenant.id, async () => {
    const { prisma } = await import("@/lib/prisma");

    let reference = process.argv[2];
    if (!reference) {
      const p = await prisma.product.findFirst({
        where: { microstoreProductId: { not: null } } as never,
        orderBy: { microstoreLastPushedAt: "desc" },
        select: { reference: true, microstoreProductId: true } as never,
      });
      if (!p) {
        console.error("Aucun produit avec microstoreProductId non-null.");
        process.exit(3);
      }
      reference = (p as { reference: string }).reference;
      console.log(
        `[test] auto-pick reference=${reference} microstoreProductId=${(p as { microstoreProductId: number }).microstoreProductId}`,
      );
    } else {
      console.log(`[test] using reference=${reference}`);
    }

    console.log("[test] calling sendProductPhotosToMicrostoreCore …");
    const t0 = Date.now();
    const res = await sendProductPhotosToMicrostoreCore(reference);
    const dt = Date.now() - t0;
    console.log(`[test] finished in ${dt}ms`);
    console.log(JSON.stringify(res, null, 2));
    if (!res.success) {
      console.error("[test] FAILED:", res.error);
      process.exit(1);
    }
    console.log("[test] SUCCESS");
  });

  await raw.$disconnect();
}

main().catch((err) => {
  console.error("[test] threw:", err);
  process.exit(99);
});
