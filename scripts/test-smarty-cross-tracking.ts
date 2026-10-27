/**
 * scripts/test-smarty-cross-tracking.ts
 *
 * Test ponctuel : est-ce que l'endpoint `batchGetTraces` de Smarty365
 * sait tracer des numéros de suivi émis par Easy-Express (c'est-à-dire
 * des colis que Smarty n'a PAS créés) ?
 *
 * Usage sur VPS :
 *   cd /var/www/beliandjolie && npx tsx scripts/test-smarty-cross-tracking.ts
 */

import { PrismaClient } from "@prisma/client";
import { decryptIfSensitive } from "@/lib/encryption";

const prisma = new PrismaClient();

const EE_TRACKING_NUMBERS = [
  { tn: "74807042",      note: "UPS/GLS court" },
  { tn: "6C21281063539", note: "DPD-like" },
  { tn: "XX118917113JB", note: "Chronopost" },
  { tn: "879159017679",  note: "Colissimo" },
  { tn: "XX118712698JB", note: "Chronopost" },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("Tenant beliandjolie introuvable");

  const row = await prisma.siteConfig.findFirst({
    where: { tenantId: tenant.id, key: "smarty365_api_key" },
  });
  if (!row?.value) throw new Error("smarty365_api_key manquant pour beliandjolie");

  const apiKey = decryptIfSensitive("smarty365_api_key", row.value);
  console.log(`[OK] Clé Smarty récupérée (${apiKey.length} chars)`);

  // 1) Test batchGetTraces avec les tracking numbers EE
  console.log("\n── TEST 1 : batchGetTraces avec tracking numbers Easy-Express ──");
  const res1 = await fetch("https://www.smarty365.com/api/parcel/batchGetTraces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      trackingNumbers: EE_TRACKING_NUMBERS.map((x) => x.tn),
    }),
  });
  const text1 = await res1.text();
  console.log(`HTTP ${res1.status}`);
  console.log(text1.slice(0, 4000));

  // 2) Variante : certaines APIs attendent "ids" ou "trackings" ou autre
  console.log("\n── TEST 2 : variante payload { trackings: [...] } ──");
  const res2 = await fetch("https://www.smarty365.com/api/parcel/batchGetTraces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      trackings: EE_TRACKING_NUMBERS.map((x) => x.tn),
    }),
  });
  const text2 = await res2.text();
  console.log(`HTTP ${res2.status}`);
  console.log(text2.slice(0, 2000));

  // 3) GET single par tracking number (déjà documenté)
  console.log("\n── TEST 3 : GET /api/parcel/trackingNumber/XX118917113JB ──");
  const res3 = await fetch(
    "https://www.smarty365.com/api/parcel/trackingNumber/XX118917113JB",
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  const text3 = await res3.text();
  console.log(`HTTP ${res3.status}`);
  console.log(text3.slice(0, 1500));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
