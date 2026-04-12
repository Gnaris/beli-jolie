/**
 * Debug script: shows what credentials are stored in DB
 * and tests authentication with them.
 *
 * Usage: npx tsx scripts/debug-ankorstore-auth.ts
 */
import { PrismaClient } from "@prisma/client";
import { decryptIfSensitive } from "@/lib/encryption";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });

  console.log("=== Raw DB values ===");
  for (const row of rows) {
    console.log(`${row.key}: "${row.value}" (length: ${row.value.length})`);
  }

  console.log("\n=== After decryption ===");
  const map = new Map(rows.map(r => [r.key, decryptIfSensitive(r.key, r.value)]));
  const clientId = map.get("ankors_client_id") ?? "(missing)";
  const clientSecret = map.get("ankors_client_secret") ?? "(missing)";

  console.log(`client_id: "${clientId}" (length: ${clientId.length})`);
  console.log(`client_secret: "${clientSecret}" (length: ${clientSecret.length})`);

  // Check for whitespace issues
  if (clientId !== clientId.trim()) {
    console.log("⚠️  client_id has leading/trailing whitespace!");
  }
  if (clientSecret !== clientSecret.trim()) {
    console.log("⚠️  client_secret has leading/trailing whitespace!");
  }

  // Test auth
  console.log("\n=== Testing auth ===");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    scope: "*",
  });

  console.log("POST https://www.ankorstore.com/oauth/token");
  console.log("Body:", body.toString());

  const res = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  console.log(`Status: ${res.status}`);
  const text = await res.text();
  console.log("Response:", text);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
