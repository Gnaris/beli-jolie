/**
 * Test: Delete test products from Ankorstore (3-step approach)
 * Run: npx tsx scripts/test-ankorstore-delete.ts
 */
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";

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
  const jh = { ...h, "Content-Type": "application/vnd.api+json" };

  const toDelete = [
    { external_id: "TEST_E2E_001", variants: [{ sku: "TEST_E2E_001_Argent" }, { sku: "TEST_E2E_001_Argent_Pack12" }] },
    { external_id: "TEST_FULL_001", variants: [{ sku: "TEST_FULL_001_Argent" }, { sku: "TEST_FULL_001_Argent_Pack12" }, { sku: "TEST_FULL_001_Doré" }, { sku: "TEST_FULL_001_Doré_Pack12" }] },
    { external_id: "TEST_ROUGE_003", variants: [{ sku: "TEST_Rouge_Unit" }, { sku: "TEST_Rouge_Pack12" }] },
  ];

  // Step 1: Create delete operation
  console.log("=== Step 1: Create delete operation ===");
  const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
    method: "POST",
    headers: jh,
    body: JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: {
          source: "other",
          operationType: "delete",
          callbackUrl: "https://example.com/cb",
        },
      },
    }),
  });
  const createData = await createRes.json();
  const opId = createData.data?.id;
  console.log(`   ${createRes.status} → ${opId}`);
  if (!opId) { console.log("❌", JSON.stringify(createData)); return; }

  // Step 2: Add products to delete
  console.log("\n=== Step 2: Add products ===");
  const addRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`, {
    method: "POST",
    headers: jh,
    body: JSON.stringify({
      products: toDelete.map((p) => ({
        id: p.external_id,
        type: "catalog-integration-product",
        attributes: {
          external_id: p.external_id,
          variants: p.variants,
        },
      })),
    }),
  });
  const addData = await addRes.json();
  console.log(`   ${addRes.status} → Products: ${addData.meta?.totalProductsCount ?? "?"}`);

  // Step 3: Start
  console.log("\n=== Step 3: Start ===");
  const startRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, {
    method: "PATCH",
    headers: jh,
    body: JSON.stringify({
      data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } },
    }),
  });
  console.log(`   ${(await startRes.json()).data?.attributes?.status}`);

  // Step 4: Poll
  console.log("\n=== Step 4: Waiting... ===");
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers: h })).json();
    const attrs = check.data?.attributes;
    console.log(`   [${i + 1}] ${attrs?.status} | ${attrs?.processedProductsCount}/${attrs?.totalProductsCount} | failed=${attrs?.failedProductsCount}`);

    if (["succeeded", "completed", "failed", "partially_failed", "skipped"].includes(attrs?.status)) {
      const results = await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`, { headers: h })).json();
      for (const r of results.data ?? []) {
        console.log(`   📋 ${r.attributes.externalProductId}: ${r.attributes.status} ${r.attributes.failureReason ?? ""}`);
      }
      break;
    }
  }

  // Verify
  console.log("\n=== Verify ===");
  await new Promise((r) => setTimeout(r, 5000));
  const search = await fetch(`${ANKORSTORE_BASE_URL}/product-variants?filter[skuOrName]=TEST`, { headers: h });
  const found = await search.json();
  const variants = Array.isArray(found.data) ? found.data : [];
  if (variants.length > 0) {
    console.log(`Still ${variants.length} TEST variant(s):`);
    for (const v of variants) console.log(`   - ${v.attributes.sku}`);
  } else {
    console.log("✅ All TEST variants deleted from Ankorstore");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
