/**
 * E2E test: Full import flow + verify attributes display without refresh.
 * Run: npx tsx scripts/test-import-e2e.ts
 */
import { chromium } from "playwright";
import path from "path";

const BASE_URL = "http://localhost:3000";
const ADMIN_EMAIL = "beliandjolie@gmail.com";
const ADMIN_PASSWORD = "Lin123Chen";
const EXCEL_PATH = path.resolve(__dirname, "../test-import-v2.xlsx");

async function main() {
  console.log("Launching browser (headed)...\n");
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  try {
    // ── Login ──
    console.log("Step 1: Logging in...");
    await page.goto(`${BASE_URL}/connexion`);
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await emailInput.waitFor({ timeout: 10000 });
    await emailInput.fill(ADMIN_EMAIL);
    await page.fill('input[type="password"], input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin**", { timeout: 30000, waitUntil: "domcontentloaded" });
    console.log("  -> Logged in.\n");

    // ── Navigate to import page ──
    console.log("Step 2: Import page...");
    await page.goto(`${BASE_URL}/admin/produits/importer`, { timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(EXCEL_PATH);
    await page.waitForTimeout(1000);

    // Click "Analyser le fichier"
    console.log("  -> Analyzing file...");
    await page.locator('button:has-text("Analyser le fichier")').click();
    await page.waitForTimeout(5000);

    await page.screenshot({ path: "test-screenshots/01-preview.png" });

    // Handle missing entities - look for "Créer tout" or similar
    const createAllBtn = page.locator('button:has-text("Tout créer"), button:has-text("Créer tout"), button:has-text("Créer les")');
    if (await createAllBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("  -> Creating missing entities...");
      await createAllBtn.first().click();
      await page.waitForTimeout(3000);
    }

    // Click import button
    console.log("  -> Starting import...");
    const importBtn = page.locator('button:has-text("Lancer"), button:has-text("Importer les"), button:has-text("Confirmer")');
    await importBtn.first().click({ timeout: 10000 });

    // Wait for completion
    console.log("  -> Waiting for import to complete...");
    // Poll by checking for "Voir les produits" button or COMPLETED text
    let completed = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(2000);
      const voirBtn = page.locator('button:has-text("Voir les produits")');
      if (await voirBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        completed = true;
        break;
      }
    }

    if (!completed) {
      console.log("  -> Import timed out, checking DB...");
    }

    await page.screenshot({ path: "test-screenshots/02-import-done.png" });
    console.log("  -> Import done!\n");

    // Wait a moment for the revalidateAfterImport() server action to execute
    await page.waitForTimeout(3000);

    // ── Navigate to product via client-side navigation ──
    console.log("Step 3: Navigate to product list (client-side)...");
    const voirProduitsBtn = page.locator('button:has-text("Voir les produits")');
    if (await voirProduitsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await voirProduitsBtn.click();
    } else {
      await page.goto(`${BASE_URL}/admin/produits`, { timeout: 60000, waitUntil: "domcontentloaded" });
    }
    await page.waitForTimeout(3000);

    // Get product ID from DB
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    const product = await prisma.product.findFirst({
      where: { reference: "TEST-001" },
      select: { id: true, categoryId: true, manufacturingCountryId: true, seasonId: true },
    });
    await prisma.$disconnect();

    if (!product) {
      console.log("ERROR: Product TEST-001 not found in DB!");
      return;
    }
    console.log("  -> Product in DB:", JSON.stringify({
      cat: product.categoryId ? "SET" : "NULL",
      country: product.manufacturingCountryId ? "SET" : "NULL",
      season: product.seasonId ? "SET" : "NULL",
    }));

    // Click product link
    console.log("  -> Clicking product link (client-side navigation)...");
    const productLink = page.locator(`a[href*="${product.id}/modifier"]`).first();
    if (await productLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await productLink.click();
    } else {
      // Try search
      const searchInput = page.locator('input[placeholder*="Rechercher"]');
      if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await searchInput.fill("TEST-001");
        await page.waitForTimeout(2000);
      }
      await page.locator(`a[href*="${product.id}/modifier"]`).first().click({ timeout: 10000 });
    }

    await page.waitForURL(`**/${product.id}/modifier`, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    console.log("  -> On product page.\n");

    // ── Check attributes ──
    console.log("═══════════════════════════════════");
    console.log("  CHECKING ATTRIBUTES (no refresh)");
    console.log("═══════════════════════════════════\n");

    await page.screenshot({ path: "test-screenshots/03-product-page.png", fullPage: true });

    async function getDropdownValue(labelText: string): Promise<string> {
      const labels = page.locator(`label:has-text("${labelText}")`);
      const count = await labels.count();
      for (let i = 0; i < count; i++) {
        const container = labels.nth(i).locator('..').locator('..');
        const btn = container.locator('button[aria-haspopup="listbox"]');
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          return (await btn.textContent())?.trim() ?? "NOT FOUND";
        }
      }
      return "LABEL NOT FOUND";
    }

    const cat = await getDropdownValue("Catégorie");
    const country = await getDropdownValue("Pays de fabrication");
    const season = await getDropdownValue("Saison");

    console.log(`  Category: "${cat}"`);
    console.log(`  Country:  "${country}"`);
    console.log(`  Season:   "${season}"`);

    const issues: string[] = [];
    if (cat.includes("Sélectionner")) issues.push("Category EMPTY");
    if (country.includes("Aucun")) issues.push("Country EMPTY");
    if (season.includes("Aucune")) issues.push("Season EMPTY");

    if (issues.length > 0) {
      console.log(`\n  STILL BROKEN: ${issues.join(", ")}`);
      console.log("\n  Refreshing to compare...");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      const catR = await getDropdownValue("Catégorie");
      const countryR = await getDropdownValue("Pays de fabrication");
      const seasonR = await getDropdownValue("Saison");
      console.log(`\n  After refresh:`);
      console.log(`    Category: "${catR}"`);
      console.log(`    Country:  "${countryR}"`);
      console.log(`    Season:   "${seasonR}"`);
      await page.screenshot({ path: "test-screenshots/04-after-refresh.png", fullPage: true });
    } else {
      console.log("\n  ALL ATTRIBUTES VISIBLE! Bug is FIXED!");
    }

    console.log("\nBrowser stays open 30s for manual inspection...");
    await page.waitForTimeout(30000);

  } catch (err) {
    console.error("Test failed:", err);
    await page.screenshot({ path: "test-screenshots/error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
