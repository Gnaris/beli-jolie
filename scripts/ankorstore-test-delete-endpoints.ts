/**
 * Teste plusieurs endpoints AS pour identifier comment supprimer un produit
 * par son UUID Ankorstore. Aucun DELETE n'est réellement envoyé ici — on fait
 * juste des HEAD/OPTIONS pour voir ce qui répond 405/404/200.
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
  primeAnkorstoreCredentials(clientId!, clientSecret!);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId!,
    client_secret: clientSecret!,
  });
  const resp = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await resp.json()) as { access_token?: string; expires_in?: number };
  primeAnkorstoreToken(json.access_token!, Math.floor(Date.now() / 1000) + json.expires_in!);
}

async function main() {
  await bootstrap();
  const headers = await getAnkorstoreHeaders();

  // On prend un produit AS quelconque (le 1er de la liste) — uniquement pour
  // tester l'existence d'un endpoint, sans déclencher de delete. On utilise
  // OPTIONS (qui retourne les méthodes autorisées) plutôt que DELETE.
  const list = await fetch(`${ANKORSTORE_BASE_URL}/products?page[limit]=3`, { headers });
  const body = await list.json();
  const id = body.data?.[0]?.id;
  console.log("Test ID:", id);

  // Test 1 : DELETE /products/{id} avec un HEAD (juste pour voir si l'endpoint existe)
  for (const route of [
    `/products/${id}`,
    `/catalog/products/${id}`,
    `/catalog/integrations/products/${id}`,
  ]) {
    for (const method of ["OPTIONS", "HEAD"]) {
      try {
        const r = await fetch(`${ANKORSTORE_BASE_URL}${route}`, { method, headers });
        console.log(`${method.padEnd(7)} ${route} → ${r.status} ${r.headers.get("allow") ?? ""}`);
      } catch (e) {
        console.log(`${method.padEnd(7)} ${route} → erreur: ${(e as Error).message}`);
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
