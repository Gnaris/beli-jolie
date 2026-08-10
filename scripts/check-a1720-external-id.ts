import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { primeAnkorstoreToken, primeAnkorstoreCredentials } from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!tenant) throw new Error("no tenant");
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId: tenant.id, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const clientId = map.get("ankors_client_id")!;
  const clientSecret = map.get("ankors_client_secret")!;
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "*" });
  const tokRes = await fetch("https://www.ankorstore.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() });
  const tokData = (await tokRes.json()) as { access_token: string; expires_in: number };
  primeAnkorstoreToken(tokData.access_token, tokData.expires_in);

  const authHeader = { Authorization: `Bearer ${tokData.access_token}`, Accept: "application/vnd.api+json" };

  // Test 1 : recherche par skuOrName=A1720
  console.log("--- Test 1 : filter[skuOrName]=A1720 ---");
  const searchRes = await fetch(
    `https://www.ankorstore.com/api/v1/products?filter[skuOrName]=A1720&include=productVariant&page[limit]=5`,
    { headers: authHeader },
  );
  console.log("Status:", searchRes.status);
  const searchText = await searchRes.text();
  console.log("Body preview:", searchText.substring(0, 2000));

  console.log("\n--- Test 2 : filter[externalId]=A1720 ---");
  const extRes = await fetch(
    `https://www.ankorstore.com/api/v1/products?filter[externalId]=A1720&page[limit]=5`,
    { headers: authHeader },
  );
  console.log("Status:", extRes.status);
  const extText = await extRes.text();
  console.log("Body preview:", extText.substring(0, 1500));

  console.log("\n--- Test 3 : filter[external_id]=A1720 ---");
  const ext2Res = await fetch(
    `https://www.ankorstore.com/api/v1/products?filter[external_id]=A1720&page[limit]=5`,
    { headers: authHeader },
  );
  console.log("Status:", ext2Res.status);
  const ext2Text = await ext2Res.text();
  console.log("Body preview:", ext2Text.substring(0, 1500));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
