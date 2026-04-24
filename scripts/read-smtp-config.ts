/**
 * Lit et affiche la configuration SMTP actuellement enregistrée en BDD.
 * Usage : npx tsx scripts/read-smtp-config.ts
 */

import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

async function main() {
  const keys = [
    "smtp_host",
    "smtp_port",
    "smtp_secure",
    "smtp_user",
    "smtp_password",
    "smtp_from_email",
    "smtp_from_name",
    "smtp_notify_email",
  ];

  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: keys } },
  });

  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)])
  );

  const mask = (v: string | undefined) =>
    !v ? "(vide)" : v.length <= 4 ? "***" : v.slice(0, 2) + "***" + v.slice(-2);

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Configuration Email (SMTP) enregistrée");
  console.log("═══════════════════════════════════════════════════\n");
  console.log(`  Serveur SMTP (hôte)    : ${map.get("smtp_host") || "(vide)"}`);
  console.log(`  Port                   : ${map.get("smtp_port") || "(vide)"}`);
  console.log(`  TLS (secure)           : ${map.get("smtp_secure") || "(vide)"}`);
  console.log(`  Identifiant            : ${map.get("smtp_user") || "(vide)"}`);
  console.log(`  Mot de passe           : ${mask(map.get("smtp_password"))}`);
  console.log(`  Email expéditeur       : ${map.get("smtp_from_email") || "(vide)"}`);
  console.log(`  Nom affiché            : ${map.get("smtp_from_name") || "(vide)"}`);
  console.log(`  Email notif admin      : ${map.get("smtp_notify_email") || "(vide)"}`);
  console.log("\n═══════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
