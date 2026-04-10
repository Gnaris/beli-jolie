/**
 * E2E test: creating a product triggers Ankorstore sync.
 *
 * Strategy:
 * 1. Log in as admin
 * 2. Create a product via the e2e API helper (calls createProduct server action)
 * 3. Verify that ankorsProductId is set quickly (optimistic link)
 * 4. Cleanup
 *
 * Note: Ankorstore processing is async (10-15 min), so we only verify
 * the optimistic link is set, not the final Ankorstore result.
 * The product may later be unlinked if Ankorstore rejects it (e.g. no image).
 */
import { test, expect } from "playwright/test";

const BASE = "http://localhost:3000";
const TEST_EMAIL = "test-pw@test.com";
const TEST_PASSWORD = "Test1234!";
const TEST_REF = `E2E-ANKORS-${Date.now()}`;

test.describe("Ankorstore auto-sync on product creation", () => {
  let productId: string | null = null;

  test.afterEach(async ({ page }) => {
    // Cleanup test product
    if (productId) {
      await page.evaluate(async (pid) => {
        await fetch(`/api/e2e/cleanup?productId=${pid}`, { method: "DELETE" });
      }, productId);
    }
  });

  test("product creation triggers optimistic Ankorstore link", async ({ page }) => {
    // ── Step 1: Log in as admin ────────────────────────────────────
    await page.goto(`${BASE}/connexion`);
    await page.fill("#email", TEST_EMAIL);
    await page.fill("#password", TEST_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for redirect to admin dashboard
    await page.waitForURL("**/admin**", { timeout: 15_000 });
    expect(page.url()).toContain("/admin");

    // ── Step 2: Create a product via server action (API call) ──────
    const result = await page.evaluate(async (ref) => {
      const res = await fetch("/api/e2e/create-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: ref }),
      });
      return res.json();
    }, TEST_REF);

    expect(result.success).toBe(true);
    expect(result.productId).toBeTruthy();
    productId = result.productId;

    // ── Step 3: Wait for optimistic link (should be fast, ~30s max) ─
    // The fire-and-forget calls pushProductToAnkorstoreInternal which
    // optimistically sets ankorsProductId before the push completes.
    let ankorsLinked = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const check = await page.evaluate(async (pid) => {
        const res = await fetch(`/api/e2e/check-ankors?productId=${pid}`);
        return res.json();
      }, productId);

      if (check.ankorsProductId) {
        ankorsLinked = true;
        console.log(`Product linked to Ankorstore: ${check.ankorsProductId}`);
        break;
      }
    }

    expect(ankorsLinked).toBe(true);
  });
});
