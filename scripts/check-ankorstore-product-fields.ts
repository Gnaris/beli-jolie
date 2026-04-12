/**
 * Fetch a product from Ankorstore and show ALL its fields.
 * Run: npx tsx scripts/check-ankorstore-product-fields.ts
 */
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

async function main() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const token = (await (await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: map.get("ankors_client_id")!,
      client_secret: map.get("ankors_client_secret")!,
      scope: "*",
    }),
  })).json()).access_token;

  const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" };

  // Fetch first product with all includes
  const res = await fetch(
    "https://www.ankorstore.com/api/v1/products?page[limit]=3&include=productVariant",
    { headers: h }
  );
  const data = await res.json();

  console.log("Status:", res.status);
  if (!data.data?.length) {
    console.log("No data. Response:", JSON.stringify(data).slice(0, 500));
  }
  if (data.data?.[0]) {
    console.log("=== Product attributes (all fields) ===");
    console.log(JSON.stringify(data.data[0].attributes, null, 2));

    console.log("\n=== Product relationships ===");
    console.log(JSON.stringify(data.data[0].relationships, null, 2));

    if (data.included?.[0]) {
      console.log("\n=== First variant attributes ===");
      console.log(JSON.stringify(data.included[0].attributes, null, 2));
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
