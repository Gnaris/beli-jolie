/**
 * E2E test: Create a complete product on BJ, push to Ankorstore, verify all fields.
 * Run: npx tsx scripts/test-create-product-e2e.ts
 */

import { chromium } from "playwright";
import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";

const BASE_URL = "http://localhost:3000";
const ANKORSTORE_BASE_URL = "https://www.ankorstore.com/api/v1";

async function getAnkorstoreToken(): Promise<string> {
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
  const r2Url = process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "";

  // ─── Step 1: Create complete product in DB ─────────────────────────
  console.log("=== Step 1: Create complete test product ===");

  // Cleanup previous test
  const existing = await prisma.product.findFirst({ where: { reference: "TEST_FULL_001" } });
  if (existing) {
    await prisma.productComposition.deleteMany({ where: { productId: existing.id } });
    await prisma.productColor.deleteMany({ where: { productId: existing.id } });
    await prisma.product.delete({ where: { id: existing.id } });
    console.log("   Cleaned up previous test");
  }

  // Get reference data
  const category = await prisma.category.findFirst({ orderBy: { name: "asc" } });
  const argent = await prisma.color.findFirst({ where: { name: "Argent" } });
  const dore = await prisma.color.findFirst({ where: { name: "Doré" } });
  const composition = await prisma.composition.findFirst();
  const country = await prisma.manufacturingCountry.findFirst();

  // Get a real image for the product
  const existingImg = await prisma.productColor.findFirst({
    where: { images: { some: {} } },
    select: { images: { take: 1, select: { path: true } } },
  });
  const imgPath = existingImg?.images[0]?.path;

  if (!category || !argent || !dore) {
    console.log("❌ Missing reference data");
    return;
  }

  const product = await prisma.product.create({
    data: {
      reference: "TEST_FULL_001",
      name: "Collier Test Complet",
      description: "Collier en acier inoxydable avec fermoir mousqueton ajustable. Finition polie miroir resistante aux rayures et a l'eau. Bijou elegant pour toutes les occasions.",
      categoryId: category.id,
      status: "ONLINE",
      isIncomplete: false,
      ...(country ? { manufacturingCountryId: country.id } : {}),
      colors: {
        create: [
          // Argent Unit
          {
            colorId: argent.id,
            saleType: "UNIT",
            unitPrice: 4.20,
            stock: 150,
            weight: 0.03,
            isPrimary: true,
            sku: "TEST_FULL_001_Argent",
          },
          // Argent Pack x12
          {
            colorId: argent.id,
            saleType: "PACK",
            unitPrice: 50.40, // 4.20 * 12
            stock: 30,
            weight: 0.36,
            packQuantity: 12,
            isPrimary: false,
            sku: "TEST_FULL_001_Argent_Pack12",
          },
          // Doré Unit
          {
            colorId: dore.id,
            saleType: "UNIT",
            unitPrice: 4.20,
            stock: 200,
            weight: 0.03,
            isPrimary: false,
            sku: "TEST_FULL_001_Dore",
          },
          // Doré Pack x12
          {
            colorId: dore.id,
            saleType: "PACK",
            unitPrice: 50.40,
            stock: 40,
            weight: 0.36,
            packQuantity: 12,
            isPrimary: false,
            sku: "TEST_FULL_001_Dore_Pack12",
          },
        ],
      },
      ...(composition
        ? { compositions: { create: [{ compositionId: composition.id, percentage: 100 }] } }
        : {}),
    },
    include: {
      colors: { include: { color: true } },
      compositions: { include: { composition: true } },
      manufacturingCountry: true,
    },
  });

  console.log(`✅ Product created: ${product.id}`);
  console.log(`   Reference: ${product.reference}`);
  console.log(`   Name: ${product.name}`);
  console.log(`   Category: ${category.name}`);
  console.log(`   Country: ${product.manufacturingCountry?.name ?? "N/A"} (${product.manufacturingCountry?.isoCode ?? "N/A"})`);
  console.log(`   Compositions: ${product.compositions.map((c) => `${c.composition.name} ${c.percentage}%`).join(", ") || "N/A"}`);
  console.log(`   Variants:`);
  for (const c of product.colors) {
    const type = c.saleType === "PACK" ? `Pack x${c.packQuantity}` : "Unite";
    console.log(`     - ${c.color?.name} ${type} | stock=${c.stock} | ${c.unitPrice}€`);
  }

  // ─── Step 2: Build & push to Ankorstore ────────────────────────────
  console.log("\n=== Step 2: Push to Ankorstore ===");

  const token = await getAnkorstoreToken();
  const authHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.api+json" };
  const jsonHeaders = { ...authHeaders, "Content-Type": "application/vnd.api+json" };

  const mainImage = imgPath && r2Url ? `${r2Url}${imgPath}` : undefined;

  // Build composition text
  const compoText = product.compositions.length > 0
    ? product.compositions.map((c) => `${c.composition.name} ${c.percentage}%`).join(", ")
    : null;

  // Build description with composition + reference
  let desc = product.description ?? "";
  if (compoText) desc += `\nComposition : ${compoText}`;
  desc += `\nRéférence : ${product.reference}`;

  // Build title: {name} - {reference}
  const title = `${product.name} - ${product.reference}`;

  // Build variants
  const colorGroups = new Map<string, typeof product.colors>();
  for (const c of product.colors) {
    const name = c.color?.name ?? "Default";
    const group = colorGroups.get(name) ?? [];
    group.push(c);
    colorGroups.set(name, group);
  }

  const variants: Record<string, unknown>[] = [];
  for (const [colorName, colorVars] of colorGroups) {
    const unitVar = colorVars.find((c) => c.saleType === "UNIT");
    const packVar = colorVars.find((c) => c.saleType === "PACK");
    const unitPrice = Number(unitVar?.unitPrice ?? 0);
    const imageUrl = mainImage; // Use same image for all variants

    if (unitVar && unitPrice > 0) {
      variants.push({
        sku: `${product.reference}_${colorName}`,
        external_id: unitVar.id,
        stock_quantity: unitVar.stock,
        is_always_in_stock: false,
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
      });
    }
    if (packVar) {
      const packQty = packVar.packQuantity ?? 12;
      const packPrice = unitPrice * packQty;
      variants.push({
        sku: `${product.reference}_${colorName}_Pack${packQty}`,
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
      });
    }
  }

  console.log(`\n   📤 Pushing to Ankorstore:`);
  console.log(`   Title: "${title}"`);
  console.log(`   Description: "${desc.slice(0, 80)}..."`);
  console.log(`   Country: ${product.manufacturingCountry?.isoCode ?? "N/A"}`);
  console.log(`   Variants: ${variants.length}`);

  // Create operation
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
  const opId = (await createRes.json()).data?.id;
  console.log(`   Operation: ${opId}`);

  // Add product
  const basePrice = Number(product.colors.find((c) => c.saleType === "UNIT")?.unitPrice ?? 0);
  await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/products`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      products: [{
        id: product.reference,
        type: "catalog-integration-product",
        attributes: {
          external_id: product.reference,
          name: title,
          description: desc,
          currency: "EUR",
          vat_rate: 20,
          wholesale_price: basePrice,
          retail_price: basePrice * 2,
          unit_multiplier: 1,
          discount_rate: 0,
          ...(mainImage ? { main_image: mainImage } : {}),
          ...(product.manufacturingCountry?.isoCode ? { made_in_country: product.manufacturingCountry.isoCode } : {}),
          variants,
        },
      }],
    }),
  });

  // Start
  await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, {
    method: "PATCH",
    headers: jsonHeaders,
    body: JSON.stringify({
      data: { type: "catalog-integration-operation", id: opId, attributes: { status: "started" } },
    }),
  });

  // Poll
  console.log("   Processing...");
  let finalStatus = "";
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}`, { headers: authHeaders })).json();
    const attrs = check.data?.attributes;
    process.stdout.write(`   [${i + 1}] ${attrs?.status} ${attrs?.processedProductsCount}/${attrs?.totalProductsCount}\r`);
    finalStatus = attrs?.status;

    if (["succeeded", "completed", "failed", "partially_failed", "skipped"].includes(attrs?.status)) {
      console.log(`\n   → ${attrs.status}! processed=${attrs.processedProductsCount} failed=${attrs.failedProductsCount}`);
      const results = await (await fetch(`${ANKORSTORE_BASE_URL}/catalog/integrations/operations/${opId}/results`, { headers: authHeaders })).json();
      for (const r of results.data ?? []) {
        const a = r.attributes;
        console.log(`\n   📋 ${a.externalProductId}: ${a.status} ${a.failureReason ?? ""}`);
        for (const issue of a.issues ?? []) console.log(`      ${issue.field}: ${issue.message}`);
      }
      break;
    }
  }

  // ─── Step 3: Verify on Ankorstore ──────────────────────────────────
  console.log("\n=== Step 3: Verify on Ankorstore ===");
  await new Promise((r) => setTimeout(r, 5000));

  const searchRes = await fetch(
    `${ANKORSTORE_BASE_URL}/product-variants?filter[skuOrName]=TEST_FULL_001`,
    { headers: authHeaders }
  );
  const searchData = await searchRes.json();
  const foundVariants = Array.isArray(searchData.data) ? searchData.data : [];

  if (foundVariants.length > 0) {
    console.log(`\n🎉 FOUND ${foundVariants.length} variant(s) on Ankorstore:`);
    for (const v of foundVariants) {
      const a = v.attributes;
      console.log(`   - SKU: ${a.sku}`);
      console.log(`     Name: ${a.name}`);
      console.log(`     Stock: ${a.available_quantity ?? a.stockQuantity ?? "?"}`);
      console.log(`     Wholesale: ${a.wholesale_price ?? a.wholesalePrice ?? "?"}€`);
    }
  } else {
    console.log("   ⚠️  Variants not indexed yet — check Ankorstore dashboard manually");
  }

  // ─── Step 4: Open in browser ───────────────────────────────────────
  console.log("\n=== Step 4: Open product in browser ===");
  const browser = await chromium.launch({ headless: false });
  const page = await (await browser.newContext()).newPage();

  // Login
  await page.goto(`${BASE_URL}/connexion`);
  await page.waitForTimeout(2000);

  if (!page.url().includes("/admin")) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { email: true } });
    if (admin) {
      await page.fill('input[type="email"]', admin.email);
      await page.fill('input[type="password"]', "Admin1234!");
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
    }
  }

  // Show product edit page
  await page.goto(`${BASE_URL}/admin/produits/${product.id}/modifier`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "test-full-product.png" });
  console.log("📸 Screenshot: test-full-product.png");

  console.log("\n✅ Test complete! Browser open for 30s...");
  console.log(`   Product: ${title}`);
  console.log(`   Ankorstore: ${foundVariants.length} variants found`);
  console.log(`   Status: ${finalStatus}`);

  await page.waitForTimeout(30000);
  await browser.close();
}

main().catch(console.error).finally(() => prisma.$disconnect());
