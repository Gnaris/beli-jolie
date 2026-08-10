import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const UUID = "1f06faba-2a4f-6c7c-ad07-024ba929e6ad";
const OP = "1f19339f-7891-634c-b1c0-52a079c2c400";

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  if (!t) throw new Error("no tenant");
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId: t.id, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const m = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)?.trim() ?? null]));
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: m.get("ankors_client_id")!,
    client_secret: m.get("ankors_client_secret")!,
    scope: "*",
  });
  const tokR = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const tok = (await tokR.json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${tok.access_token}`, Accept: "application/vnd.api+json" };

  console.log("=== État op Ankor bloquée ===");
  const opR = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${OP}`, { headers: auth });
  console.log("HTTP:", opR.status);
  const opD = (await opR.json()) as any;
  console.log(JSON.stringify(opD.data?.attributes, null, 2));

  console.log("\n=== Résultats de l'op ===");
  const resR = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${OP}/results`, { headers: auth });
  const resD = await resR.json();
  console.log(JSON.stringify(resD, null, 2).substring(0, 2000));

  console.log("\n=== État actuel du produit A1720 chez Ankor ===");
  const pR = await fetch(`https://www.ankorstore.com/api/v1/products/${UUID}?include=productVariants`, { headers: auth });
  const pD = (await pR.json()) as any;
  const variants = (pD.included ?? []).filter((x: any) => x.type === "productVariants");
  console.log(`Variantes (${variants.length}) :`);
  for (const v of variants) {
    const a = v.attributes ?? {};
    console.log(`  - id=${v.id}  sku="${a.sku}"  stock=${a.stockQuantity}  archivedAt=${a.archivedAt}  outOfStock=${a.outOfStock}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
