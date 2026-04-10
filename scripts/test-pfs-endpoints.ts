/**
 * PFS Endpoint Health Check Script
 *
 * Tests ALL PFS API endpoints (read-only) to verify they still work.
 * Reads credentials from the database (SiteConfig) with decryption.
 *
 * Usage: npx tsx scripts/test-pfs-endpoints.ts
 */

import { config } from "dotenv";
config();

import * as crypto from "crypto";

// ─── Decryption (inline to avoid Next.js imports) ────────────────────────
const PREFIX = "enc:v1:";

function decryptValue(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY missing");
  const key = Buffer.from(raw, "base64");
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ─── DB connection via Prisma ──────────────────────────────────────────
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: number | string;
  ok: boolean;
  details: string;
  responseTime: number;
}

const results: TestResult[] = [];

function log(icon: string, msg: string) {
  console.log(`${icon}  ${msg}`);
}

async function testEndpoint(
  name: string,
  endpoint: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<TestResult> {
  const url = `${PFS_BASE_URL}${endpoint}`;
  const start = Date.now();
  try {
    const options: RequestInit = {
      method,
      headers: { ...headers },
      signal: AbortSignal.timeout(30000),
    };
    if (body) {
      (options.headers as Record<string, string>)["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    const elapsed = Date.now() - start;
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    const result: TestResult = {
      name,
      endpoint,
      method,
      status: res.status,
      ok: res.ok,
      details: "",
      responseTime: elapsed,
    };

    if (res.ok) {
      // Extract useful info
      if (Array.isArray(parsed)) {
        result.details = `${parsed.length} items`;
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.data)) {
          result.details = `${obj.data.length} items`;
          if (obj.meta && typeof obj.meta === "object") {
            const meta = obj.meta as Record<string, unknown>;
            result.details += ` (page ${meta.current_page}/${meta.last_page}, total: ${meta.total})`;
          }
          if (obj.state && typeof obj.state === "object") {
            const state = obj.state as Record<string, unknown>;
            result.details += ` | state: active=${state.active}, total=${state.total}`;
          }
        } else {
          const keys = Object.keys(obj);
          result.details = `keys: [${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "..." : ""}]`;
        }
      }
    } else {
      result.details = typeof parsed === "string" ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200);
    }

    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      name,
      endpoint,
      method,
      status: err instanceof Error ? err.message.slice(0, 50) : "ERROR",
      ok: false,
      details: err instanceof Error ? err.message : String(err),
      responseTime: elapsed,
    };
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║            PFS API Endpoint Health Check                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ─── Step 1: Get credentials from DB ─────────────────────────
  log("🔑", "Fetching PFS credentials from database...");

  const rows = await prisma.siteConfig.findMany({
    where: { key: { in: ["pfs_email", "pfs_password"] } },
  });
  await prisma.$disconnect();

  const configMap = new Map<string, string>();
  for (const row of rows) {
    configMap.set(row.key, decryptValue(row.value));
  }

  const email = configMap.get("pfs_email") || process.env.PFS_EMAIL;
  const password = configMap.get("pfs_password") || process.env.PFS_PASSWORD;

  if (!email || !password) {
    console.error("❌ PFS credentials not found in DB or env vars");
    process.exit(1);
  }

  log("✅", `Credentials found for: ${email}`);
  console.log("");

  // ─── Step 2: Test Authentication ─────────────────────────────
  log("🔐", "Testing authentication...");

  const authResult = await testEndpoint(
    "Auth - Valid credentials",
    "/oauth/token",
    "POST",
    { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    { email, password },
  );
  results.push(authResult);

  if (!authResult.ok) {
    console.error(`❌ Authentication FAILED (${authResult.status}): ${authResult.details}`);
    printSummary();
    process.exit(1);
  }

  const authData = await fetch(`${PFS_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ email, password }),
  }).then(r => r.json());

  const token = authData.access_token;
  log("✅", `Token obtained (expires: ${authData.expires_at || "unknown"})`);

  // Test invalid auth
  const badAuthResult = await testEndpoint(
    "Auth - Invalid credentials (expect 401)",
    "/oauth/token",
    "POST",
    { Accept: "application/json" },
    { email: "fake@invalid.com", password: "wrong" },
  );
  badAuthResult.ok = badAuthResult.status === 401; // 401 is expected
  badAuthResult.details = badAuthResult.status === 401 ? "Correctly rejected" : `Unexpected: ${badAuthResult.status}`;
  results.push(badAuthResult);
  console.log("");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  // ─── Step 3: Test Product List ───────────────────────────────
  log("📦", "Testing product listing...");

  const listResult = await testEndpoint(
    "List Products (page 1, 10 items)",
    "/catalog/listProducts?page=1&per_page=10&status=ACTIVE",
    "GET",
    headers,
  );
  results.push(listResult);

  // Also test pagination
  const paginationResult = await testEndpoint(
    "List Products - pagination (page 2)",
    "/catalog/listProducts?page=2&per_page=5&status=ACTIVE",
    "GET",
    headers,
  );
  results.push(paginationResult);
  console.log("");

  // ─── Step 4: Get a real product for further tests ────────────
  let testProductId: string | null = null;
  let testReference: string | null = null;

  if (listResult.ok) {
    const listData = await fetch(
      `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=1&status=ACTIVE`,
      { headers },
    ).then(r => r.json());
    testProductId = listData.data?.[0]?.id ?? null;
    testReference = listData.data?.[0]?.reference ?? null;
    if (testProductId) {
      log("📌", `Using test product: ${testReference} (${testProductId})`);
    }
  }
  console.log("");

  // ─── Step 5: Test Check Reference ────────────────────────────
  log("🔍", "Testing check reference...");

  if (testReference) {
    const checkResult = await testEndpoint(
      `Check Reference (${testReference})`,
      `/catalog/products/checkReference/${encodeURIComponent(testReference)}`,
      "GET",
      headers,
    );
    results.push(checkResult);

    // Test with non-existent reference
    const checkBadResult = await testEndpoint(
      "Check Reference (non-existent)",
      "/catalog/products/checkReference/ZZZZZ-NONEXISTENT-99999",
      "GET",
      headers,
    );
    results.push(checkBadResult);
  } else {
    log("⚠️", "Skipped — no product available");
  }
  console.log("");

  // ─── Step 6: Test Get Variants ───────────────────────────────
  log("🎨", "Testing get variants...");

  if (testProductId) {
    const variantsResult = await testEndpoint(
      `Get Variants (${testProductId})`,
      `/catalog/products/${testProductId}/variants`,
      "GET",
      headers,
    );
    results.push(variantsResult);
  } else {
    log("⚠️", "Skipped — no product available");
  }
  console.log("");

  // ─── Step 7: Test ALL Attribute Endpoints ────────────────────
  log("📋", "Testing attribute endpoints...");

  const attributeEndpoints = [
    { name: "Colors", path: "/catalog/attributes/colors" },
    { name: "Categories", path: "/catalog/attributes/categories" },
    { name: "Compositions", path: "/catalog/attributes/compositions" },
    { name: "Countries", path: "/catalog/attributes/countries" },
    { name: "Collections", path: "/catalog/attributes/collections" },
    { name: "Families", path: "/catalog/attributes/families" },
    { name: "Genders", path: "/catalog/attributes/genders" },
    { name: "Sizes", path: "/catalog/attributes/sizes" },
  ];

  for (const attr of attributeEndpoints) {
    const result = await testEndpoint(
      `Attributes - ${attr.name}`,
      attr.path,
      "GET",
      headers,
    );
    results.push(result);
  }
  console.log("");

  // ─── Step 8: Test AI Translation ─────────────────────────────
  log("🌐", "Testing AI translation...");

  const translationResult = await testEndpoint(
    "AI Translation",
    "/ai/translations",
    "POST",
    headers,
    {
      phrases: { productName: "Bague en or", productDescription: "Belle bague en or 18 carats" },
      productName: "Bague en or",
      productDescription: "Belle bague en or 18 carats",
      source_language: "fr",
    },
  );
  // Accept 200, 201, 422, 429 as "endpoint exists"
  if ([200, 201, 422, 429].includes(translationResult.status as number)) {
    translationResult.ok = true;
    if (translationResult.status !== 200) {
      translationResult.details = `Endpoint reachable (status ${translationResult.status})`;
    }
  }
  results.push(translationResult);
  console.log("");

  // ─── Step 9: Test Write endpoints (dry — structure check only) ─
  log("✏️", "Testing write endpoint accessibility (read response structure)...");

  // Test PATCH variants with empty data to see if endpoint responds
  const patchVariantsResult = await testEndpoint(
    "Patch Variants (empty — structure check)",
    "/catalog/products/variants",
    "PATCH",
    headers,
    { data: [] },
  );
  // 200 or 422 means endpoint exists
  if ([200, 422, 400].includes(patchVariantsResult.status as number)) {
    patchVariantsResult.ok = true;
    patchVariantsResult.details = `Endpoint reachable (status ${patchVariantsResult.status})`;
  }
  results.push(patchVariantsResult);

  // Test batch status update with empty data
  const statusResult = await testEndpoint(
    "Batch Update Status (empty — structure check)",
    "/catalog/products/batch/updateStatus",
    "PATCH",
    headers,
    { data: [] },
  );
  if ([200, 422, 400].includes(statusResult.status as number)) {
    statusResult.ok = true;
    statusResult.details = `Endpoint reachable (status ${statusResult.status})`;
  }
  results.push(statusResult);

  // Test product create endpoint with minimal invalid data to check it responds
  const createResult = await testEndpoint(
    "Create Product (invalid — structure check)",
    "/catalog/products/create",
    "POST",
    headers,
    { data: { reference_code: "" } },
  );
  if ([200, 201, 422, 400].includes(createResult.status as number)) {
    createResult.ok = true;
    createResult.details = `Endpoint reachable (status ${createResult.status}): ${createResult.details.slice(0, 100)}`;
  }
  results.push(createResult);

  console.log("");

  // ─── Print Summary ───────────────────────────────────────────
  printSummary();
}

function printSummary() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                     RESULTS SUMMARY                        ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");

  const maxNameLen = Math.max(...results.map(r => r.name.length), 10);

  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    const name = r.name.padEnd(maxNameLen);
    const status = String(r.status).padStart(4);
    const time = `${r.responseTime}ms`.padStart(7);
    console.log(`║ ${icon} ${name} | ${status} | ${time} | ${r.details.slice(0, 40)}`);
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const total = results.length;

  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ Total: ${total}  |  Passed: ${passed}  |  Failed: ${failed}${" ".repeat(27)}║`);

  if (failed > 0) {
    console.log("║                                                              ║");
    console.log("║  ⚠️  PFS INTEGRATION DEGRADED — Some endpoints failed       ║");
    console.log("║                                                              ║");
    console.log("║  Failed endpoints:                                           ║");
    for (const r of results.filter(r => !r.ok)) {
      console.log(`║    - ${r.method} ${r.endpoint.slice(0, 50).padEnd(50)} ║`);
    }
  } else {
    console.log("║                                                              ║");
    console.log("║  ✅  ALL PFS ENDPOINTS OPERATIONAL                           ║");
  }

  console.log("╚══════════════════════════════════════════════════════════════╝");

  // Detailed failures
  if (results.some(r => !r.ok)) {
    console.log("\n─── DETAILED FAILURES ───────────────────────────────────────\n");
    for (const r of results.filter(r => !r.ok)) {
      console.log(`❌ ${r.name}`);
      console.log(`   Endpoint: ${r.method} ${r.endpoint}`);
      console.log(`   Status:   ${r.status}`);
      console.log(`   Time:     ${r.responseTime}ms`);
      console.log(`   Details:  ${r.details}`);
      console.log("");
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
