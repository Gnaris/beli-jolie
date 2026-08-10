/**
 * Correctif ciblé : le PATCH stock de repair-e292a.ts utilisait le mauvais
 * champ (`id` au lieu de `variant_id`) → les 3 variantes PFS recyclées
 * (Noir-Doré, Blanc-Doré, Rose-Doré) sont restées à stock 0. On repasse un
 * PATCH propre + setAvailability(true).
 */

import "dotenv/config";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { pfsPatchVariants, pfsSetVariantsAvailability } from "@/lib/pfs-api-write";

const TARGETS = [
  "pro_a2a65b5df1f1d9dbf2823a359a8d", // Noir - Doré
  "pro_3fde68629fdb199d0871909c08d2", // Blanc - Doré
  "pro_cc927b7bf16630f7e50231453b7c", // Rose - Doré
];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  await tenantALS.run(tenant!.id, async () => {
    for (const pfsVariantId of TARGETS) {
      const pc = await prisma.productColor.findFirst({
        where: { pfsVariantId },
        include: { color: true },
      });
      if (!pc) {
        console.log(`✗ ${pfsVariantId} : introuvable en BDD BJ`);
        continue;
      }
      console.log(`▶ ${pc.color?.name} → ${pfsVariantId}  stock BJ=${pc.stock}`);
      await pfsPatchVariants([
        {
          variant_id: pfsVariantId,
          price_eur_ex_vat: Number(pc.unitPrice),
          weight: pc.weight,
          stock_qty: pc.stock,
        },
      ]);
      console.log(`  ✓ PATCH stock=${pc.stock}`);
      await pfsSetVariantsAvailability([
        { pfsVariantId, enable: pc.stock > 0 && !pc.disabled },
      ]);
      console.log(`  ✓ setAvailability(${pc.stock > 0 && !pc.disabled})`);
    }
  });
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
