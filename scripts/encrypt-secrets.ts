/**
 * Script de migration : chiffre toutes les valeurs sensibles existantes en BDD.
 *
 * Usage : npx tsx scripts/encrypt-secrets.ts
 *
 * Sûr à relancer : ignore les valeurs déjà chiffrées (préfixe "enc:v1:").
 */

import { PrismaClient } from "@prisma/client";
import { SENSITIVE_KEYS, encryptValue, isEncrypted } from "../lib/encryption";

async function main() {
  if (!process.env.ENCRYPTION_KEY) {
    console.error("❌ ENCRYPTION_KEY manquante dans .env");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const rows = await prisma.siteConfig.findMany({
      where: { key: { in: Array.from(SENSITIVE_KEYS) } },
    });

    if (rows.length === 0) {
      console.log("Aucune clé sensible trouvée en BDD. Rien à migrer.");
      return;
    }

    let encrypted = 0;
    let skipped = 0;

    for (const row of rows) {
      if (isEncrypted(row.value)) {
        console.log(`  ⏭  ${row.key} — déjà chiffrée`);
        skipped++;
        continue;
      }

      const encryptedValue = encryptValue(row.value);
      await prisma.siteConfig.update({
        where: { key: row.key },
        data: { value: encryptedValue },
      });
      console.log(`  🔒 ${row.key} — chiffrée`);
      encrypted++;
    }

    console.log(`\n✅ Migration terminée : ${encrypted} chiffrée(s), ${skipped} déjà OK.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Erreur fatale :", e);
  process.exit(1);
});
