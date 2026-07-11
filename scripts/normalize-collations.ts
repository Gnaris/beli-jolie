/**
 * Convertit toutes les tables de la BDD en utf8mb4_unicode_ci pour permettre
 * les FK vers la table Tenant (créée en utf8mb4_unicode_ci par défaut).
 * Aucune donnée n'est perdue — c'est un ALTER TABLE ... CONVERT TO CHARACTER SET.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; TABLE_COLLATION: string }>>(
    `SELECT TABLE_NAME, TABLE_COLLATION
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'beli_jolie'
     AND TABLE_COLLATION != 'utf8mb4_unicode_ci'`
  );

  console.log(`[normalize] ${rows.length} table(s) a convertir :`);
  for (const r of rows) {
    console.log(`  - ${r.TABLE_NAME} (${r.TABLE_COLLATION})`);
  }

  for (const r of rows) {
    const sql = `ALTER TABLE \`${r.TABLE_NAME}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`;
    process.stdout.write(`  -> ${r.TABLE_NAME} ... `);
    await prisma.$executeRawUnsafe(sql);
    console.log("OK");
  }

  const check = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; TABLE_COLLATION: string }>>(
    `SELECT TABLE_NAME, TABLE_COLLATION
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = 'beli_jolie'
     AND TABLE_COLLATION != 'utf8mb4_unicode_ci'`
  );

  if (check.length > 0) {
    console.error(`[normalize] Restant en mauvais collation : ${check.map((r) => r.TABLE_NAME).join(", ")}`);
    process.exit(1);
  }

  console.log("[normalize] Toutes les tables sont en utf8mb4_unicode_ci.");
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
