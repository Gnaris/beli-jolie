/**
 * Test: Push a test product "Rouge" to Ankorstore with Unit + Pack variants
 * Based on the official OpenAPI spec from github.com/ankorstore/api-docs
 * Run: npx tsx scripts/test-ankorstore-push-variants.ts
 */

import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";

async function getToken(): Promise<string> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const res = await fetch("https://www.ankorstore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: map.get("ankors_client_id")!,
      client_secret: map.get("ankors_client_secret")!,
      scope: "*",
    }),
  });
  return (await res.json()).access_token;
}

async function main() {
  const token = await getToken();
  console.log("✅ Token acquired");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
  };
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  // Use a real image from R2
  const mainImage = "https://pub-81ea63cc8cf445ce86194d9ee22cf879.r2.dev/uploads/products/pfs_1775338931056_2oyn5n.webp";

  // Step 1: Create operation
  console.log("\n=== Step 1: Create operation ===");
  const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: {
          source: "other",
          operationType: "import",
          callbackUrl: "https://example.com/callback",
        },
      },
    }),
  });
  const createData = await createRes.json();
  const opId = createData.data?.id;
  console.log(`   ${createRes.status} → Operation: ${opId}`);
  if (!opId) { console.log("❌", JSON.stringify(createData)); return; }

  // Step 2: Add product (exact format from OpenAPI spec)
  console.log("\n=== Step 2: Add product Rouge Unit + Pack ===");
  const addRes = await fetch(
    `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        products: [
          {
            id: "TEST_ROUGE_003",
            type: "catalog-integration-product",
            attributes: {
              external_id: "TEST_ROUGE_003",
              name: "Test Bague Rouge - A SUPPRIMER",
              description: "Bague en acier inoxydable ajustable couleur rouge. Produit de test cree via API - a supprimer apres verification.",
              currency: "EUR",
              vat_rate: 20,
              wholesale_price: 3.90,
              retail_price: 7.80,
              unit_multiplier: 1,
              discount_rate: 0,
              main_image: mainImage,
              shape_properties: {
                weight: { unit_code: "g", amount: 30 },
              },
              variants: [
                {
                  sku: "TEST_Rouge_Unit",
                  external_id: "TEST_Rouge_Unit",
                  stock_quantity: 50,
                  is_always_in_stock: false,
                  wholesale_price: 3.90,
                  retail_price: 7.80,
                  discount_rate: 0,
                  options: [
                    { name: "size", value: "Unite" },
                    { name: "color", value: "Rouge" },
                  ],
                },
                {
                  sku: "TEST_Rouge_Pack12",
                  external_id: "TEST_Rouge_Pack12",
                  stock_quantity: 10,
                  is_always_in_stock: false,
                  wholesale_price: 46.80,
                  retail_price: 93.60,
                  discount_rate: 0,
                  options: [
                    { name: "size", value: "Pack x12" },
                    { name: "color", value: "Rouge" },
                  ],
                },
              ],
            },
          },
        ],
      }),
    }
  );

  const addData = await addRes.json();
  console.log(`   ${addRes.status} → Products: ${addData.meta?.totalProductsCount ?? "?"}`);
  if ((addData.meta?.totalProductsCount ?? 0) === 0) {
    console.log("❌", JSON.stringify(addData));
    return;
  }

  // Step 3: Start
  console.log("\n=== Step 3: Start ===");
  const startRes = await fetch(
    `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: {
          type: "catalog-integration-operation",
          id: opId,
          attributes: { status: "started" },
        },
      }),
    }
  );
  console.log(`   ${startRes.status} → ${(await startRes.json()).data?.attributes?.status}`);

  // Step 4: Poll
  console.log("\n=== Step 4: Waiting... ===");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers });
    const attrs = (await check.json()).data?.attributes;
    console.log(`   [${i + 1}] ${attrs?.status} | ${attrs?.processedProductsCount}/${attrs?.totalProductsCount} | failed=${attrs?.failedProductsCount}`);

    if (["completed", "failed", "partially_failed"].includes(attrs?.status)) {
      const results = await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`, { headers })).json();
      for (const r of results.data ?? []) {
        const a = r.attributes;
        console.log(`\n   📋 ${a.externalProductId}: ${a.status} ${a.failureReason ?? ""}`);
        for (const issue of a.issues ?? []) {
          console.log(`      ${issue.field || "(global)"}: ${issue.message}`);
        }
      }
      break;
    }

    if (attrs?.status === "skipped") {
      console.log("   ⚠️  Skipped - possible silent validation issue");
      // Still check results
      const results = await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`, { headers })).json();
      if (results.data?.length) {
        for (const r of results.data) {
          console.log(`   📋 ${r.attributes.externalProductId}: ${r.attributes.status} ${r.attributes.failureReason ?? ""}`);
          for (const issue of r.attributes.issues ?? []) console.log(`      ${issue.field}: ${issue.message}`);
        }
      }
      break;
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
