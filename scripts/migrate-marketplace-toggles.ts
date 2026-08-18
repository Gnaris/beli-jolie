/**
 * Migration one-shot des anciennes clés SiteConfig « X_enabled » → nouvelles
 * clés « X_products_management_enabled ».
 *
 * Contexte : refonte 2026-08-18. Chaque marketplace (PFS, Ankorstore, eFashion,
 * Faire, Microstore) a désormais 2 toggles distincts :
 *   - {marketplace}_products_management_enabled  (nouveau, remplace X_enabled)
 *   - {marketplace}_orders_worker_enabled        (existant, inchangé)
 *
 * Ce script :
 *   1. Pour chaque tenant × marketplace, copie l'ancienne valeur `X_enabled`
 *      (ou `ankors_enabled` / `ankorstore_bo_enabled` pour Ankor) dans la
 *      nouvelle clé `X_products_management_enabled` — seulement si l'ancienne
 *      était présente ET que la nouvelle est absente (idempotent).
 *   2. Supprime ensuite les anciennes clés (elles ne sont plus lues).
 *
 * Lancement :
 *   npx tsx scripts/migrate-marketplace-toggles.ts        # dry-run par défaut
 *   npx tsx scripts/migrate-marketplace-toggles.ts --apply
 */
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

const OLD_TO_NEW: Record<string, string> = {
  pfs_enabled: "pfs_products_management_enabled",
  ankors_enabled: "ankorstore_products_management_enabled",
  ankorstore_bo_enabled: "ankorstore_products_management_enabled",
  efashion_enabled: "efashion_products_management_enabled",
  faire_enabled: "faire_products_management_enabled",
  microstore_enabled: "microstore_products_management_enabled",
};

async function main() {
  const oldKeys = Object.keys(OLD_TO_NEW);
  const newKeys = Array.from(new Set(Object.values(OLD_TO_NEW)));

  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: [...oldKeys, ...newKeys] } },
    select: { tenantId: true, key: true, value: true },
  });

  // Index par tenant → { key: value }
  const byTenant = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (!byTenant.has(r.tenantId)) byTenant.set(r.tenantId, new Map());
    byTenant.get(r.tenantId)!.set(r.key, r.value);
  }

  let copied = 0;
  let skipped = 0;
  let deleted = 0;

  for (const [tenantId, keyMap] of byTenant.entries()) {
    for (const oldKey of oldKeys) {
      if (!keyMap.has(oldKey)) continue;
      const newKey = OLD_TO_NEW[oldKey];
      if (keyMap.has(newKey)) {
        skipped++;
        console.log(`[skip] tenant=${tenantId} ${oldKey} : ${newKey} déjà présent`);
      } else {
        const value = keyMap.get(oldKey)!;
        console.log(`[copy] tenant=${tenantId} ${oldKey}=${value} → ${newKey}`);
        if (APPLY) {
          await prisma.siteConfig.upsert({
            where: { tenantId_key: { tenantId, key: newKey } },
            create: { tenantId, key: newKey, value },
            update: { value },
          });
        }
        copied++;
      }
      // Toujours supprimer l'ancienne clé (idempotent).
      console.log(`[del]  tenant=${tenantId} ${oldKey}`);
      if (APPLY) {
        await prisma.siteConfig.deleteMany({ where: { tenantId, key: oldKey } });
      }
      deleted++;
    }
  }

  console.log(`\nBilan : copied=${copied} skipped=${skipped} deleted=${deleted}`);
  console.log(APPLY ? "APPLIQUÉ." : "DRY-RUN. Ajoutez --apply pour exécuter.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
