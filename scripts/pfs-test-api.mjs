/**
 * PFS API Test Script — READ + WRITE operations on TESTAPI01
 *
 * Tests:
 * 1. Auth
 * 2. Search for TESTAPI01 via listProducts + checkReference
 * 3. Get variants
 * 4. Fetch /catalog/attributes/sizes
 * 5. Fetch /catalog/attributes/categories
 * 6. Try /catalog/attributes/sizes?category=...
 * 7. Create test ITEM variant with size
 * 8. Create test PACK variant with multi-size multi-color
 * 9. Delete test variants
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env manually
const envPath = resolve(process.cwd(), ".env");
const envContent = readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    const val = match[2].trim().replace(/^"|"$/g, "");
    env[match[1].trim()] = val;
  }
}

const BASE = "https://wholesaler-api.parisfashionshops.com/api/v1";
const BRAND_ID = "a01AZ00000314QgYAI";
const PFS_EMAIL = env.PFS_EMAIL;
const PFS_PASSWORD = env.PFS_PASSWORD;

if (!PFS_EMAIL || !PFS_PASSWORD) {
  console.error("Missing PFS_EMAIL or PFS_PASSWORD in .env");
  process.exit(1);
}

let TOKEN = null;

async function authenticate() {
  console.log("\n=== 1. AUTHENTICATE ===");
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ email: PFS_EMAIL, password: PFS_PASSWORD }),
  });
  const data = await res.json();
  console.log("Auth status:", res.status);
  console.log("Token expires_at:", data.expires_at);
  TOKEN = data.access_token;
  return TOKEN;
}

function headers(json = false) {
  const h = {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function apiGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

async function apiPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

async function apiDelete(path) {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE", headers: headers() });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
}

function logJson(label, obj) {
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(obj, null, 2));
}

async function main() {
  await authenticate();

  // 2. Search for TESTAPI01
  console.log("\n=== 2. SEARCH FOR TESTAPI01 ===");

  // 2a. Via listProducts with reference filter
  console.log("\n--- 2a. listProducts?reference=TESTAPI01 ---");
  const listRes = await apiGet(`/catalog/listProducts?page=1&per_page=10&brand=${BRAND_ID}&reference=TESTAPI01`);
  logJson("listProducts response", listRes);

  // 2b. Via checkReference
  console.log("\n--- 2b. checkReference/TESTAPI01 ---");
  const checkRes = await apiGet(`/catalog/products/checkReference/TESTAPI01`);
  logJson("checkReference response", checkRes);

  // Get product ID from one of the responses
  let productId = null;
  if (listRes.data?.data?.length > 0) {
    productId = listRes.data.data[0].id;
  } else if (checkRes.data?.product?.id) {
    productId = checkRes.data.product.id;
  }

  if (!productId) {
    console.error("\nTESTAPI01 not found! Trying without status filter...");
    const listRes2 = await apiGet(`/catalog/listProducts?page=1&per_page=10&brand=${BRAND_ID}&reference=TESTAPI01&status=NEW`);
    logJson("listProducts (status=NEW)", listRes2);
    if (listRes2.data?.data?.length > 0) productId = listRes2.data.data[0].id;

    const listRes3 = await apiGet(`/catalog/listProducts?page=1&per_page=10&brand=${BRAND_ID}&reference=TESTAPI01&status=DRAFT`);
    logJson("listProducts (status=DRAFT)", listRes3);
    if (listRes3.data?.data?.length > 0) productId = listRes3.data.data[0].id;

    const listRes4 = await apiGet(`/catalog/listProducts?page=1&per_page=10&brand=${BRAND_ID}&reference=TESTAPI01&status=READY_FOR_SALE`);
    logJson("listProducts (status=READY_FOR_SALE)", listRes4);
    if (listRes4.data?.data?.length > 0) productId = listRes4.data.data[0].id;

    if (!productId) {
      console.error("\nTESTAPI01 truly not found in any status. Cannot continue.");
      process.exit(1);
    }
  }

  console.log("\nProduct ID:", productId);

  // 3. Get variants
  console.log("\n=== 3. GET VARIANTS ===");
  const variantsRes = await apiGet(`/catalog/products/${productId}/variants`);
  logJson("variants response", variantsRes);

  // 4. Fetch sizes
  console.log("\n=== 4. FETCH SIZES ===");
  const sizesRes = await apiGet(`/catalog/attributes/sizes`);
  logJson("sizes response", sizesRes);

  // 5. Fetch categories
  console.log("\n=== 5. FETCH CATEGORIES ===");
  const categoriesRes = await apiGet(`/catalog/attributes/categories`);
  logJson("categories response (first 5)", {
    status: categoriesRes.status,
    total: categoriesRes.data?.data?.length,
    first5: categoriesRes.data?.data?.slice(0, 5),
    // Check if any category has size info
    sampleWithAllKeys: categoriesRes.data?.data?.[0] ? Object.keys(categoriesRes.data.data[0]) : null
  });

  // Get category ID from the product
  let categoryId = null;
  if (checkRes.data?.product?.category?.id) {
    categoryId = checkRes.data.product.category.id;
  } else if (listRes.data?.data?.[0]?.category?.id) {
    categoryId = listRes.data.data[0].category.id;
  }

  // 6. Try sizes filtered by category
  if (categoryId) {
    console.log("\n=== 6. SIZES BY CATEGORY ===");
    console.log("Category ID:", categoryId);

    const sizesCatRes = await apiGet(`/catalog/attributes/sizes?category=${categoryId}`);
    logJson("sizes?category=... response", sizesCatRes);

    const sizesCatRes2 = await apiGet(`/catalog/attributes/sizes?category_id=${categoryId}`);
    logJson("sizes?category_id=... response", sizesCatRes2);
  }

  // Also try to fetch product full detail via a direct get
  console.log("\n=== 7. FULL PRODUCT DETAIL ===");
  const productDetailRes = await apiGet(`/catalog/products/${productId}`);
  logJson("product detail response", productDetailRes);

  // Also try listProducts with all statuses to see full TESTAPI01 structure
  console.log("\n=== 8. LISTPRODUCTS FULL FOR TESTAPI01 ===");
  // Already done above, but show the full variants inline
  if (listRes.data?.data?.length > 0) {
    const product = listRes.data.data[0];
    logJson("Full product from listProducts", product);
  }

  // ============================================================
  // WRITE TESTS
  // ============================================================

  console.log("\n\n========================================");
  console.log("=== WRITE TESTS ON TESTAPI01 ===");
  console.log("========================================");

  // Record existing variant IDs so we don't accidentally delete them
  const existingVariantIds = new Set(
    (variantsRes.data?.data || []).map(v => v.id)
  );
  console.log("\nExisting variant IDs (will NOT delete):", [...existingVariantIds]);

  const createdVariantIds = [];

  // 8a. Create ITEM variant with size "M"
  console.log("\n=== 9a. CREATE ITEM VARIANT (size M, color GOLDEN) ===");
  const itemVariant = {
    type: "ITEM",
    color: "GOLDEN",
    size: "M",
    price_eur_ex_vat: 5.00,
    weight: 0.1,
    stock_qty: 10,
    is_active: true,
    custom_suffix: "TEST_ITEM_M",
  };
  console.log("Request body:", JSON.stringify({ data: [itemVariant] }, null, 2));
  const createItemRes = await apiPost(`/catalog/products/${productId}/variants`, { data: [itemVariant] });
  logJson("Create ITEM variant response", createItemRes);

  if (createItemRes.data?.data) {
    for (const v of createItemRes.data.data) {
      if (v.id && !existingVariantIds.has(v.id)) {
        createdVariantIds.push(v.id);
      }
    }
  }

  // Re-fetch variants to see the new one
  console.log("\n--- Variants after ITEM creation ---");
  const afterItemRes = await apiGet(`/catalog/products/${productId}/variants`);
  logJson("Variants after ITEM", afterItemRes);

  // 8b. Create PACK variant with MULTIPLE sizes and MULTIPLE colors
  console.log("\n=== 9b. CREATE PACK VARIANT (multi-color multi-size) ===");

  // Try format 1: packs array with multiple colors, each with multiple sizes
  const packVariant1 = {
    type: "PACK",
    color: "GOLDEN",  // primary color
    size: "M",        // primary size (may be ignored for packs)
    price_eur_ex_vat: 3.00,
    weight: 0.5,
    stock_qty: 50,
    is_active: true,
    custom_suffix: "TEST_PACK_MULTI",
    packs: [
      { color: "GOLDEN", size: "17", qty: 2 },
      { color: "GOLDEN", size: "18", qty: 2 },
      { color: "GOLDEN", size: "19", qty: 2 },
      { color: "SILVER", size: "17", qty: 2 },
      { color: "SILVER", size: "18", qty: 2 },
      { color: "SILVER", size: "19", qty: 2 },
    ],
  };
  console.log("Request body (format 1 - flat packs):", JSON.stringify({ data: [packVariant1] }, null, 2));
  const createPack1Res = await apiPost(`/catalog/products/${productId}/variants`, { data: [packVariant1] });
  logJson("Create PACK variant (format 1) response", createPack1Res);

  if (createPack1Res.data?.data) {
    for (const v of createPack1Res.data.data) {
      if (v.id && !existingVariantIds.has(v.id)) {
        createdVariantIds.push(v.id);
      }
    }
  }

  // If format 1 didn't work well, try format 2: grouped by color
  console.log("\n=== 9c. CREATE PACK VARIANT (grouped packs format) ===");
  const packVariant2 = {
    type: "PACK",
    color: "SILVER",
    size: "TU",
    price_eur_ex_vat: 2.50,
    weight: 0.3,
    stock_qty: 30,
    is_active: true,
    custom_suffix: "TEST_PACK_GROUPED",
    packs: [
      { color: "SILVER", size: "TU", qty: 6 },
      { color: "GOLDEN", size: "TU", qty: 6 },
    ],
  };
  console.log("Request body (format 2 - two colors same size):", JSON.stringify({ data: [packVariant2] }, null, 2));
  const createPack2Res = await apiPost(`/catalog/products/${productId}/variants`, { data: [packVariant2] });
  logJson("Create PACK variant (format 2) response", createPack2Res);

  if (createPack2Res.data?.data) {
    for (const v of createPack2Res.data.data) {
      if (v.id && !existingVariantIds.has(v.id)) {
        createdVariantIds.push(v.id);
      }
    }
  }

  // Re-fetch all variants to see the full picture
  console.log("\n=== 10. ALL VARIANTS AFTER WRITES ===");
  const finalVariantsRes = await apiGet(`/catalog/products/${productId}/variants`);
  logJson("All variants final", finalVariantsRes);

  // CLEANUP: Delete test variants
  console.log("\n=== 11. CLEANUP — DELETE TEST VARIANTS ===");
  console.log("Variant IDs to delete:", createdVariantIds);

  for (const vid of createdVariantIds) {
    console.log(`\nDeleting variant ${vid}...`);
    const delRes = await apiDelete(`/catalog/products/variants/${vid}`);
    logJson(`Delete ${vid}`, delRes);
  }

  // Verify cleanup
  console.log("\n=== 12. VERIFY CLEANUP ===");
  const cleanupVerify = await apiGet(`/catalog/products/${productId}/variants`);
  logJson("Variants after cleanup", cleanupVerify);

  console.log("\n\n=== DONE ===");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
