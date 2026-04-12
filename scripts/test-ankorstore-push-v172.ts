/**
 * Test: Push V172 (real product) to Ankorstore with all 4 variants
 * (Argent Unit + Pack, Doré Unit + Pack)
 * Run: npx tsx scripts/test-ankorstore-push-v172.ts
 */

import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const R2_URL = "https://pub-81ea63cc8cf445ce86194d9ee22cf879.r2.dev";

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

  // Load V172 from DB
  const prod = await prisma.product.findFirst({
    where: { reference: "V172" },
    select: {
      id: true, name: true, reference: true, description: true,
      colors: {
        select: {
          id: true, saleType: true, stock: true, unitPrice: true,
          packQuantity: true,
          color: { select: { name: true } },
          images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
        },
      },
    },
  });

  if (!prod) { console.log("❌ V172 not found"); return; }

  // Build Ankorstore variants: for each color, create Unit + Pack
  const colorGroups = new Map<string, typeof prod.colors>();
  for (const c of prod.colors) {
    const name = c.color?.name ?? "Unknown";
    const group = colorGroups.get(name) ?? [];
    group.push(c);
    colorGroups.set(name, group);
  }

  const variants: Record<string, unknown>[] = [];
  for (const [colorName, colorVariants] of colorGroups) {
    const unitVar = colorVariants.find((c) => c.saleType === "UNIT");
    const packVar = colorVariants.find((c) => c.saleType === "PACK");
    const unitPrice = Number(unitVar?.unitPrice ?? packVar?.unitPrice ?? 0);
    const imagePath = unitVar?.images[0]?.path ?? packVar?.images[0]?.path;

    if (unitVar) {
      variants.push({
        sku: `${prod.reference}_${colorName}`,
        external_id: unitVar.id,
        stock_quantity: unitVar.stock,
        is_always_in_stock: false,
        // Both snake_case (import) and camelCase (update) for compatibility
        wholesale_price: unitPrice,
        retail_price: unitPrice * 2,
        wholesalePrice: unitPrice,
        retailPrice: unitPrice * 2,
        originalWholesalePrice: unitPrice,
        discount_rate: 0,
        options: [
          { name: "color", value: colorName },
          { name: "size", value: "Unite" },
        ],
        ...(imagePath ? { images: [{ order: 1, url: `${R2_URL}${imagePath}` }] } : {}),
      });
    }

    if (packVar) {
      const packQty = packVar.packQuantity ?? 12;
      const packPrice = unitPrice * packQty;
      variants.push({
        sku: `${prod.reference}_${colorName}_Pack${packQty}`,
        external_id: packVar.id,
        stock_quantity: packVar.stock,
        is_always_in_stock: false,
        wholesale_price: packPrice,
        retail_price: packPrice * 2,
        wholesalePrice: packPrice,
        retailPrice: packPrice * 2,
        originalWholesalePrice: packPrice,
        discount_rate: 0,
        options: [
          { name: "color", value: colorName },
          { name: "size", value: `Pack x${packQty}` },
        ],
        ...(imagePath ? { images: [{ order: 1, url: `${R2_URL}${imagePath}` }] } : {}),
      });
    }
  }

  const mainImage = prod.colors[0]?.images[0]?.path
    ? `${R2_URL}${prod.colors[0].images[0].path}`
    : undefined;

  console.log(`\n📦 ${prod.name} (${prod.reference})`);
  console.log(`   ${variants.length} variants to push:`);
  for (const v of variants) {
    console.log(`   - ${(v as any).sku} | stock=${(v as any).stock_quantity} | wholesale=${(v as any).wholesale_price}€`);
  }

  // Step 1: Create operation (update type since product already exists on Ankorstore)
  console.log("\n=== Step 1: Create operation ===");
  const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: {
          source: "other",
          operationType: "update",
          callbackUrl: "https://example.com/callback",
        },
      },
    }),
  });
  const opId = (await createRes.json()).data?.id;
  console.log(`   ${createRes.status} → ${opId}`);
  if (!opId) return;

  // Step 2: Add product
  console.log("\n=== Step 2: Add product ===");
  const addRes = await fetch(
    `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`,
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        products: [
          {
            id: prod.reference,
            type: "catalog-integration-product",
            attributes: {
              external_id: prod.reference,
              name: prod.name,
              description: prod.description && prod.description.length >= 30
                ? prod.description
                : `${prod.name}. Bijou en acier inoxydable de haute qualite.`,
              currency: "EUR",
              vat_rate: 20,
              wholesale_price: Number(prod.colors.find(c => c.saleType === "UNIT")?.unitPrice ?? 3.9),
              retail_price: Number(prod.colors.find(c => c.saleType === "UNIT")?.unitPrice ?? 3.9) * 2,
              unit_multiplier: 1,
              discount_rate: 0,
              ...(mainImage ? { main_image: mainImage } : {}),
              variants,
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
  const startRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({
      data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } },
    }),
  });
  console.log(`   ${(await startRes.json()).data?.attributes?.status}`);

  // Step 4: Poll
  console.log("\n=== Step 4: Waiting... ===");
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const attrs = (await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers })).json()).data?.attributes;
    console.log(`   [${i + 1}] ${attrs?.status} | ${attrs?.processedProductsCount}/${attrs?.totalProductsCount} | failed=${attrs?.failedProductsCount}`);

    if (["succeeded", "completed", "failed", "partially_failed"].includes(attrs?.status)) {
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
      console.log("   ⚠️  Skipped");
      break;
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
