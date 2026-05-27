/**
 * Inspecte le JSON brut renvoyé par Ankorstore pour 1 produit (liste + single)
 * afin de comprendre où se trouve `external_id`.
 *
 * Usage : npx tsx scripts/ankorstore-inspect-one.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  primeAnkorstoreToken,
  primeAnkorstoreCredentials,
  getAnkorstoreHeaders,
  ANKORSTORE_BASE_URL,
} from "@/lib/ankorstore-auth";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

async function bootstrap() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const clientId = map.get("ankors_client_id");
  const clientSecret = map.get("ankors_client_secret");
  if (!clientId || !clientSecret) throw new Error("Identifiants manquants");
  primeAnkorstoreCredentials(clientId, clientSecret);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const resp = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) throw new Error("OAuth invalide");
  primeAnkorstoreToken(json.access_token, Math.floor(Date.now() / 1000) + json.expires_in);
}

async function main() {
  await bootstrap();
  const headers = await getAnkorstoreHeaders();

  console.log("=== Test 1: /products?page[limit]=1 ===");
  let r = await fetch(`${ANKORSTORE_BASE_URL}/products?filter[archived]=false&page[limit]=1`, { headers });
  let body = await r.json();
  console.log("FULL RESPONSE (top keys):", Object.keys(body));
  console.log("DATA[0] FULL:", JSON.stringify(body.data?.[0], null, 2).slice(0, 2000));

  const firstId = body.data?.[0]?.id;

  console.log("\n=== Test 2: /products/{id} ===");
  r = await fetch(`${ANKORSTORE_BASE_URL}/products/${firstId}`, { headers });
  body = await r.json();
  console.log("Attributes keys:", Object.keys(body.data?.attributes ?? {}).join(", "));
  console.log("external_id?:", body.data?.attributes?.external_id);
  console.log("externalId?:", body.data?.attributes?.externalId);

  console.log("\n=== Test 3: /products avec fields[product]=external_id ===");
  r = await fetch(
    `${ANKORSTORE_BASE_URL}/products?filter[archived]=false&fields[product]=external_id,name&page[limit]=1`,
    { headers },
  );
  body = await r.json();
  console.log("Attributes keys:", Object.keys(body.data?.[0]?.attributes ?? {}).join(", "));
  console.log("external_id?:", body.data?.[0]?.attributes?.external_id);
}

main().finally(() => prisma.$disconnect());
