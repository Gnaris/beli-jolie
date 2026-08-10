/**
 * Scan rapide : 20 produits BJ (tenant beliandjolie) au hasard, pour voir si
 * le problème d'external_id vide est spécifique à Issyma ou touche aussi BJ.
 */

import "dotenv/config";
import { tenantALS } from "@/lib/tenant-als";
import { prisma } from "@/lib/prisma";
import { ankorstoreGetProduct } from "@/lib/ankorstore-api";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

async function bootstrapAnkorstoreAuth(tenantId: string): Promise<void> {
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(
    rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]),
  );
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) throw new Error("Identifiants Ankor absents");
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });
  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Ankor auth failed ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("No access_token");
  primeAnkorstoreToken(data.access_token, data.expires_in ?? 3600);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("tenant beliandjolie introuvable");
  console.log(`Tenant BJ : ${tenant.id}`);

  await bootstrapAnkorstoreAuth(tenant.id);
  console.log("✓ Token Ankor amorcé\n");

  await tenantALS.run(tenant.id, async () => {
    const products = await prisma.$queryRaw<{ reference: string; ankorsProductId: string }[]>`
      SELECT reference, ankorsProductId FROM Product
      WHERE tenantId = ${tenant.id}
        AND ankorsProductId IS NOT NULL
        AND status = 'ONLINE'
      ORDER BY RAND()
      LIMIT 20
    `;

    console.log(`Sample : ${products.length} produits BJ\n`);

    let ok = 0;
    let empty = 0;
    let mismatch = 0;
    for (const p of products) {
      try {
        const asProduct = await ankorstoreGetProduct(p.ankorsProductId);
        const ext = (asProduct?.externalId ?? "").trim();
        if (!ext) {
          console.log(`  ${p.reference}  → external_id VIDE`);
          empty++;
        } else if (ext.toUpperCase() !== p.reference.toUpperCase()) {
          console.log(`  ${p.reference}  → external_id "${ext}" (différent)`);
          mismatch++;
        } else {
          console.log(`  ${p.reference}  → ✓ ok ("${ext}")`);
          ok++;
        }
      } catch (err) {
        console.log(`  ${p.reference}  → ERREUR : ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`\n=== ${ok} OK / ${empty} vide / ${mismatch} différent ===`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
