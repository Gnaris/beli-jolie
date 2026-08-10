/**
 * Test A1720 : envoyer une opération "update" à Ankor avec les 2 variantes
 * existantes + 1 nouvelle "Beige". Vérifier si Ankor crée bien la nouvelle
 * variante malgré external_id non retourné par le GET.
 *
 * Ne modifie AUCUN état local. Communique uniquement avec Ankor.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
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
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "*" });
  const tokRes = await fetch("https://www.ankorstore.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() });
  const tokData = (await tokRes.json()) as { access_token: string; expires_in: number };
  const AUTH = { Authorization: `Bearer ${tokData.access_token}`, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" };
  console.log("✓ Auth OK\n");

  // Step 1 : Create update operation
  console.log("--- Step 1: Create operation type=update ---");
  const opRes = await fetch("https://www.ankorstore.com/api/v1/catalog/integrations/operations", {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: {
          operationType: "update",
          source: "other",
          callbackUrl: "https://example.com/no-callback-for-test",
        },
      },
    }),
  });
  console.log("Status:", opRes.status);
  const opData = (await opRes.json()) as { data: { id: string } };
  const operationId = opData.data.id;
  console.log("operationId:", operationId);

  // Step 2 : Add products (A1720 avec 3 variantes : Doré + Argent + Beige NEW)
  console.log("\n--- Step 2: Add A1720 with existing + new Beige variant ---");
  const productPayload = {
    id: "A1720",
    type: "catalog-integration-product",
    attributes: {
      external_id: "A1720",
      name: "Bague en acier inoxydable ajustable",
      description: "Advantages of stainless steel:\n\n- Durable\n- Corrosion resistant\n- Hypoallergenic\n- Easy to maintain\n- Does not tarnish\n\nComposition: 100% Stainless steel\n\nReference: A1720",
      main_image: "https://img.ankorstore.com/products/images/6256751-47fad4c169d342.jpg",
      images: [
        { order: 2, url: "https://img.ankorstore.com/products/images/6256751-47fad4c169d3ee.jpg" },
      ],
      currency: "EUR",
      vat_rate: 20,
      unit_multiplier: 1,
      wholesale_price: 340,
      retail_price: 1020,
      made_in_country: "CN",
      variants: [
        {
          sku: "A1720_Doré",
          ian: null,
          stock_quantity: 997,
          is_always_in_stock: false,
          wholesale_price: 340,
          retail_price: 1020,
          original_wholesale_price: 340,
          options: [
            { name: "color", value: "Doré" },
            { name: "size", value: "TU" },
          ],
          images: [
            { order: 1, url: "https://img.ankorstore.com/products/images/6256751-9774751-47fad4c169d786.jpg" },
          ],
        },
        {
          sku: "A1720_ Argent",
          ian: null,
          stock_quantity: 1000,
          is_always_in_stock: false,
          wholesale_price: 340,
          retail_price: 1020,
          original_wholesale_price: 340,
          options: [
            { name: "color", value: "Argent" },
            { name: "size", value: "TU" },
          ],
          images: [
            { order: 1, url: "https://img.ankorstore.com/products/images/6256751-9774752-47fad4c169d557.jpg" },
          ],
        },
        {
          sku: "A1720_BEIGE_UNIT_TEST",
          ian: null,
          stock_quantity: 1000,
          is_always_in_stock: false,
          wholesale_price: 340,
          retail_price: 1020,
          original_wholesale_price: 340,
          options: [
            { name: "color", value: "Beige" },
            { name: "size", value: "TU" },
          ],
          images: [
            { order: 1, url: "https://www.beliandjolie.com/api/marketplace-image?path=%2Fuploads%2Fbeliandjolie%2Fproduits%2Fa1720%2Fa1720-beige-1-msj74rh4ofj1.webp" },
          ],
        },
      ],
    },
  };
  const addRes = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${operationId}/products`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ products: [productPayload] }),
  });
  console.log("Status:", addRes.status);
  const addData = await addRes.json();
  console.log("Response:", JSON.stringify(addData, null, 2).substring(0, 1500));

  // Step 3 : Start operation
  console.log("\n--- Step 3: Start operation ---");
  const startRes = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${operationId}`, {
    method: "PATCH",
    headers: AUTH,
    body: JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        id: operationId,
        attributes: { status: "started" },
      },
    }),
  });
  console.log("Status:", startRes.status);
  if (startRes.status >= 400) {
    console.log("Body:", await startRes.text());
  } else {
    console.log("Started OK");
  }

  // Step 4 : Poll for result (up to 60s)
  console.log("\n--- Step 4: Poll operation status ---");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const stRes = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${operationId}`, { headers: AUTH });
    const stData = (await stRes.json()) as { data: { attributes: { status: string; totalProductsCount?: number; processedProductsCount?: number } } };
    const status = stData.data.attributes.status;
    console.log(`  [${i * 3 + 3}s] status=${status} total=${stData.data.attributes.totalProductsCount} processed=${stData.data.attributes.processedProductsCount}`);
    if (["succeeded", "failed", "partially_failed", "skipped"].includes(status)) {
      // Fetch results
      const resRes = await fetch(`https://www.ankorstore.com/api/v1/catalog/integrations/operations/${operationId}/results`, { headers: AUTH });
      const resData = await resRes.json();
      console.log("\nResults:", JSON.stringify(resData, null, 2).substring(0, 2000));
      break;
    }
  }

  // Step 5 : Re-fetch A1720 chez Ankor pour voir les variantes
  console.log("\n--- Step 5: Re-fetch A1720 to see variants after update ---");
  await new Promise((r) => setTimeout(r, 5000));
  const finalRes = await fetch("https://www.ankorstore.com/api/v1/products/1f06faba-2a4f-6c7c-ad07-024ba929e6ad?include=productVariants", { headers: AUTH });
  const finalData = (await finalRes.json()) as { data: any; included: any[] };
  const variants = (finalData.included ?? []).filter((x) => x.type === "productVariants");
  console.log(`A1720 a maintenant ${variants.length} variantes chez Ankor :`);
  for (const v of variants) {
    console.log(`  - id=${v.id}  sku="${v.attributes?.sku}"  archived=${v.attributes?.archivedAt}`);
  }

  // Vérifie si BEIGE_UNIT_TEST a été créée
  const beigeFound = variants.find((v) => v.attributes?.sku?.includes("BEIGE"));
  console.log(`\n${beigeFound ? "✅ BEIGE créée !" : "❌ BEIGE PAS créée"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
