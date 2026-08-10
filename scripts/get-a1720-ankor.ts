import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

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
  const uuid = "1f06faba-2a4f-6c7c-ad07-024ba929e6ad";
  const r = await fetch(
    `https://www.ankorstore.com/api/v1/products/${uuid}?include=productVariants`,
    { headers: auth },
  );
  const d = (await r.json()) as any;
  console.log("=== A1720 chez Ankorstore ===");
  console.log("uuid       :", d.data?.id);
  console.log("name       :", d.data?.attributes?.name);
  console.log("external_id:", JSON.stringify(d.data?.attributes?.externalId));
  console.log("active     :", d.data?.attributes?.active);
  console.log("archived   :", d.data?.attributes?.archived);
  console.log("outOfStock :", d.data?.attributes?.outOfStock);
  const variants = (d.included ?? []).filter((x: any) => x.type === "productVariants");
  console.log(`\nVariantes (${variants.length}) :`);
  for (const v of variants) {
    console.log(
      `  - id=${v.id}  sku="${v.attributes?.sku}"  archivedAt=${v.attributes?.archivedAt}`,
    );
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
