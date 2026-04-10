/**
 * Debug script: test Ankorstore push directly (bypasses unstable_cache).
 * Run: npx tsx scripts/test-ankors-push.ts [productId]
 */
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";
const ANKORSTORE_TOKEN_URL = "https://www.ankorstore.com/oauth/token";

async function getCredentials() {
  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["ankors_client_id", "ankors_client_secret"] } },
  });
  const map = new Map(rows.map(r => [r.key, decryptIfSensitive(r.key, r.value)]));
  return { clientId: map.get("ankors_client_id")!, clientSecret: map.get("ankors_client_secret")! };
}

async function getToken(clientId: string, clientSecret: string) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "*",
  });

  const res = await fetch(ANKORSTORE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.access_token as string;
}

async function main() {
  const productId = process.argv[2];

  // 1. Auth
  console.log("\n=== Step 1: Auth ===");
  const creds = await getCredentials();
  console.log("Client ID:", creds.clientId.substring(0, 20) + "...");
  const token = await getToken(creds.clientId, creds.clientSecret);
  console.log("✅ Got token:", token.substring(0, 20) + "...");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.api+json",
  };
  const jsonHeaders = { ...headers, "Content-Type": "application/vnd.api+json" };

  // 2. Create operation
  console.log("\n=== Step 2: Create Operation ===");
  const createRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      data: {
        type: "catalog-integration-operation",
        attributes: { source: "other", operationType: "import", callbackUrl: "https://example.com/cb" },
      },
    }),
  });

  console.log("Status:", createRes.status);
  const createBody = await createRes.json();
  console.log("Response:", JSON.stringify(createBody, null, 2));

  if (!createRes.ok) { console.error("❌ Failed"); process.exit(1); }

  const opId = createBody.data?.id;
  console.log("✅ Operation ID:", opId);

  if (!productId) {
    console.log("\nNo product ID provided, stopping after operation creation test.");
    process.exit(0);
  }

  // 3. Load product
  console.log("\n=== Step 3: Load Product ===");
  const prod = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true, name: true, reference: true, description: true,
      manufacturingCountry: { select: { isoCode: true } },
      compositions: { include: { composition: { select: { name: true } } }, orderBy: { percentage: "desc" } },
      colors: {
        select: {
          id: true, saleType: true, stock: true, unitPrice: true, packQuantity: true,
          color: { select: { name: true } },
          images: { take: 1, orderBy: { order: "asc" }, select: { path: true } },
        },
      },
    },
  });

  if (!prod) { console.error("❌ Product not found"); process.exit(1); }
  console.log("Product:", prod.name, `(${prod.reference})`);
  console.log("Colors:", prod.colors.length, "variants");

  const r2Url = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";
  const variants: any[] = [];
  let mainImage: string | undefined;

  const colorGroups = new Map<string, typeof prod.colors>();
  for (const c of prod.colors) {
    const name = c.color?.name ?? "Default";
    const group = colorGroups.get(name) ?? [];
    group.push(c);
    colorGroups.set(name, group);
  }

  for (const [colorName, colorVariants] of colorGroups) {
    const unitVar = colorVariants.find(c => c.saleType === "UNIT");
    const packVar = colorVariants.find(c => c.saleType === "PACK");
    const unitPrice = Number(unitVar?.unitPrice ?? 0);
    const imagePath = unitVar?.images[0]?.path ?? packVar?.images[0]?.path;
    const imageUrl = imagePath && r2Url ? `${r2Url}${imagePath}` : undefined;
    if (!mainImage && imageUrl) mainImage = imageUrl;

    if (unitVar && unitPrice > 0) {
      variants.push({
        sku: `${prod.reference}_${colorName}`,
        external_id: unitVar.id,
        stock_quantity: unitVar.stock,
        wholesale_price: unitPrice,
        retail_price: unitPrice * 2.5,
        wholesalePrice: unitPrice,
        retailPrice: unitPrice * 2.5,
        originalWholesalePrice: unitPrice,
        is_always_in_stock: false,
        discount_rate: 0,
        options: [{ name: "color", value: colorName }, { name: "size", value: "Unite" }],
        ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
      });
    }

    if (packVar) {
      const packQty = packVar.packQuantity ?? 12;
      const packPrice = unitPrice * packQty;
      if (packPrice > 0) {
        variants.push({
          sku: `${prod.reference}_${colorName}_Pack${packQty}`,
          external_id: packVar.id,
          stock_quantity: packVar.stock,
          wholesale_price: packPrice,
          retail_price: packPrice * 2.5,
          wholesalePrice: packPrice,
          retailPrice: packPrice * 2.5,
          originalWholesalePrice: packPrice,
          is_always_in_stock: false,
          discount_rate: 0,
          options: [{ name: "color", value: colorName }, { name: "size", value: `Pack x${packQty}` }],
          ...(imageUrl ? { images: [{ order: 1, url: imageUrl }] } : {}),
        });
      }
    }
  }

  console.log("Variants to push:", variants.length);

  if (variants.length === 0) {
    console.error("❌ No variants to push");
    process.exit(1);
  }

  // 4. Add product
  console.log("\n=== Step 4: Add Product to Operation ===");
  const basePrice = Number(prod.colors.find(c => c.saleType === "UNIT")?.unitPrice ?? 0);
  const compText = prod.compositions.map(c => `${c.composition.name} ${c.percentage}%`).join(", ");
  let desc = prod.description ?? "";
  if (compText) desc += `\nComposition : ${compText}`;
  desc += `\nRéférence : ${prod.reference}`;
  if (desc.length < 30) desc = `${prod.name}. ${desc}`;

  const payload = {
    products: [{
      id: prod.reference,
      type: "catalog-integration-product",
      attributes: {
        external_id: prod.reference,
        name: `${prod.name} - ${prod.reference}`,
        description: desc,
        currency: "EUR",
        vat_rate: 20,
        wholesale_price: basePrice,
        retail_price: basePrice * 2.5,
        unit_multiplier: 1,
        discount_rate: 0,
        ...(mainImage ? { main_image: mainImage } : {}),
        ...(prod.manufacturingCountry?.isoCode ? { made_in_country: prod.manufacturingCountry.isoCode } : {}),
        variants,
      },
    }],
  };

  console.log("Payload:", JSON.stringify(payload, null, 2));

  const addRes = await fetch(
    `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`,
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(payload) }
  );
  console.log("Add status:", addRes.status);
  const addBody = await addRes.json();
  console.log("Add response:", JSON.stringify(addBody, null, 2));

  if (!addRes.ok) { console.error("❌ Add products failed"); process.exit(1); }

  // 5. Start
  console.log("\n=== Step 5: Start Operation ===");
  const startRes = await fetch(
    `${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`,
    {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({
        data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } },
      }),
    }
  );
  console.log("Start status:", startRes.status);
  const startBody = await startRes.json();
  console.log("Start response:", JSON.stringify(startBody, null, 2));

  // 6. Poll
  console.log("\n=== Step 6: Poll Results ===");
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const checkRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers });
    const attrs = (await checkRes.json()).data?.attributes;
    console.log(`Poll ${i + 1}: status=${attrs?.status}, processed=${attrs?.processedProductsCount}/${attrs?.totalProductsCount}`);

    if (["succeeded", "completed", "failed", "partially_failed", "skipped"].includes(attrs?.status)) {
      const resultsRes = await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`, { headers });
      const resultsBody = await resultsRes.json();
      console.log("\n=== RESULTS ===");
      console.log(JSON.stringify(resultsBody, null, 2));
      break;
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
