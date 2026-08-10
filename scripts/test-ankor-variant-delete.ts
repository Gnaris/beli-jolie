/**
 * Test : est-ce qu'on peut supprimer/archiver une variante Ankor via API ?
 * Cible : Multicolore Argent A1720 (id 1f19339c-de3d-609a-8e2f-e27e75fc91e7).
 * Ne modifie AUCUNE base BJ.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const VARIANT_ID = "1f19339c-de3d-609a-8e2f-e27e75fc91e7";
const PRODUCT_UUID = "1f06faba-2a4f-6c7c-ad07-024ba929e6ad";

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "beliandjolie" } });
  const rows = await prisma.siteConfig.findMany({
    where: { tenantId: t!.id, key: { in: ["ankors_client_id", "ankors_client_secret"] } },
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
  const authWrite = { ...auth, "Content-Type": "application/vnd.api+json" };

  const tests = [
    {
      name: "DELETE /product-variants/{id}",
      run: () => fetch(`https://www.ankorstore.com/api/v1/product-variants/${VARIANT_ID}`, { method: "DELETE", headers: auth }),
    },
    {
      name: "DELETE /products/{p}/variants/{v}",
      run: () => fetch(`https://www.ankorstore.com/api/v1/products/${PRODUCT_UUID}/variants/${VARIANT_ID}`, { method: "DELETE", headers: auth }),
    },
    {
      name: "PATCH /product-variants/{id} archived=true",
      run: () => fetch(`https://www.ankorstore.com/api/v1/product-variants/${VARIANT_ID}`, {
        method: "PATCH", headers: authWrite,
        body: JSON.stringify({ data: { type: "product-variants", id: VARIANT_ID, attributes: { archived: true } } }),
      }),
    },
    {
      name: "PATCH /product-variants/{id} archivedAt=now",
      run: () => fetch(`https://www.ankorstore.com/api/v1/product-variants/${VARIANT_ID}`, {
        method: "PATCH", headers: authWrite,
        body: JSON.stringify({ data: { type: "product-variants", id: VARIANT_ID, attributes: { archivedAt: new Date().toISOString() } } }),
      }),
    },
    {
      name: "POST /product-variants/{id}/archive",
      run: () => fetch(`https://www.ankorstore.com/api/v1/product-variants/${VARIANT_ID}/archive`, { method: "POST", headers: authWrite, body: "{}" }),
    },
    {
      name: "PATCH /product-variants/{id}/status status=archived",
      run: () => fetch(`https://www.ankorstore.com/api/v1/product-variants/${VARIANT_ID}/status`, {
        method: "PATCH", headers: authWrite,
        body: JSON.stringify({ data: { type: "product-variant-status", attributes: { status: "archived" } } }),
      }),
    },
  ];

  for (const t of tests) {
    try {
      const r = await t.run();
      const b = await r.text();
      console.log(`\n[${r.status}] ${t.name}`);
      console.log("  →", b.substring(0, 250));
    } catch (e) {
      console.log(`\n[ERR] ${t.name} :`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log("\n\n=== État final de la variante ===");
  const r = await fetch(`https://www.ankorstore.com/api/v1/product-variants/${VARIANT_ID}`, { headers: auth });
  const d = (await r.json()) as any;
  console.log("archivedAt:", d.data?.attributes?.archivedAt);
  console.log("stock:", d.data?.attributes?.stockQuantity);
  console.log("sku:", d.data?.attributes?.sku);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
