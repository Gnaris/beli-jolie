/**
 * Test: Ankorstore Catalog Integrations API - create operation + add product with variants
 * Run: npx tsx scripts/test-ankorstore-catalog.ts
 */

import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

async function getToken(): Promise<string> {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map((r) => [r.key, decryptIfSensitive(r.key, r.value)]));
  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: map.get("ankors_client_id")!,
      client_secret: map.get("ankors_client_secret")!,
      scope: "*",
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function main() {
  const token = await getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
  };

  // Step 1: Create an import operation
  console.log("=== Step 1: Create import operation ===");
  const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/vnd.api+json" },
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

  console.log("Status:", createRes.status);
  const createBody = await createRes.text();
  console.log("Response:", createBody.slice(0, 1000));

  if (!createRes.ok) {
    console.log("Failed to create operation. Exiting.");
    return;
  }

  const operation = JSON.parse(createBody);
  const opId = operation.data?.id;
  console.log("\nOperation ID:", opId);

  if (!opId) return;

  // Step 2: Try multiple body formats to add a product

  const formats = [
    {
      name: "Format A: plain JSON array (from Shopify example)",
      body: {
        products: [
          {
            type: "catalog-integration-product",
            attributes: {
              external_id: "TEST_001",
              name: "Test Product",
              variants: [{ sku: "TEST_Unit", name: "Unité" }],
            },
          },
        ],
      },
    },
    {
      name: "Format B: data array with type",
      body: {
        data: {
          type: "catalog-integration-products",
          attributes: {
            products: [
              {
                external_id: "TEST_001",
                name: "Test Product",
                variants: [{ sku: "TEST_Unit" }],
              },
            ],
          },
        },
      },
    },
    {
      name: "Format C: single product in data",
      body: {
        data: {
          type: "catalog-integration-product",
          attributes: {
            external_id: "TEST_001",
            name: "Test Product",
            variants: [{ sku: "TEST_Unit" }],
          },
        },
      },
    },
  ];

  for (const fmt of formats) {
    console.log(`\n=== ${fmt.name} ===`);
    const addRes = await fetch(
      `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify(fmt.body),
      }
    );
    console.log("Status:", addRes.status);
    const addBody = await addRes.text();
    console.log("Response:", addBody.slice(0, 500));
    if (addBody.includes("totalProductsCount\":1") || addBody.includes('"created"')) {
      console.log("\n🎉 SUCCESS!");
      break;
    }
  }

  // Don't start processing — just test the endpoints. Delete the operation if possible.
  if (opId) {
    console.log("\n=== Cleanup: Delete operation ===");
    const delRes = await fetch(
      `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`,
      { method: "DELETE", headers }
    );
    console.log("Delete status:", delRes.status);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
