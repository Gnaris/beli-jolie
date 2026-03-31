/**
 * PFS Smoke Tests — READ-ONLY against the real PFS API.
 *
 * Purpose: Verify that reverse-engineered PFS endpoints are still functional.
 * These tests NEVER create, modify, or delete anything on PFS.
 *
 * Run with: npm run test:pfs-smoke
 * Requires: PFS_EMAIL and PFS_PASSWORD env vars (or .env file)
 *
 * If any test fails, PFS integration should be considered DEGRADED.
 * The application should disable PFS sync until the issue is resolved.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";

// Load .env for real credentials
config();

const HAS_PFS_CREDENTIALS = !!(process.env.PFS_EMAIL && process.env.PFS_PASSWORD);
const PFS_BASE_URL = "https://wholesaler-api.parisfashionshops.com/api/v1";

// Skip all tests if no credentials
const describeIfPfs = HAS_PFS_CREDENTIALS ? describe : describe.skip;

describeIfPfs("PFS Smoke Tests (REAL API — read-only)", () => {
  let accessToken: string;

  // ─── Authentication ────────────────────────────────────────────

  describe("1. Authentication", () => {
    it("should authenticate with PFS and receive a valid token", async () => {
      const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: process.env.PFS_EMAIL,
          password: process.env.PFS_PASSWORD,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.access_token).toBeDefined();
      expect(typeof data.access_token).toBe("string");
      expect(data.access_token.length).toBeGreaterThan(10);

      accessToken = data.access_token;
    });

    it("should reject invalid credentials with 401", async () => {
      const res = await fetch(`${PFS_BASE_URL}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: "fake@invalid.com",
          password: "wrong-password",
        }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ─── List Products ─────────────────────────────────────────────

  describe("2. List Products", () => {
    it("should list products (page 1)", async () => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      };

      const res = await fetch(
        `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=10&status=ACTIVE`,
        { method: "GET", headers },
      );

      expect(res.status).toBe(200);
      const data = await res.json();

      // Verify response structure
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);

      // Verify product structure
      const product = data.data[0];
      expect(product.id).toBeDefined();
      expect(product.reference).toBeDefined();
      expect(product.brand).toBeDefined();
      expect(product.category).toBeDefined();
      expect(product.labels).toBeDefined();
      expect(product.status).toBeDefined();
    });

    it("should return meta with pagination info", async () => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };

      const res = await fetch(
        `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=5&status=ACTIVE`,
        { method: "GET", headers },
      );

      const data = await res.json();
      expect(data.meta).toBeDefined();
      expect(data.meta.current_page).toBe(1);
      expect(data.meta.total).toBeGreaterThan(0);
      expect(data.meta.last_page).toBeGreaterThanOrEqual(1);
    });

    it("should return state with product counts", async () => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };

      const res = await fetch(
        `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=1&status=ACTIVE`,
        { method: "GET", headers },
      );

      const data = await res.json();
      expect(data.state).toBeDefined();
      expect(typeof data.state.total).toBe("number");
      expect(typeof data.state.active).toBe("number");
    });
  });

  // ─── Check Reference ───────────────────────────────────────────

  describe("3. Check Reference", () => {
    let validReference: string;

    beforeAll(async () => {
      // Get a valid reference from list
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };
      const res = await fetch(
        `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=1&status=ACTIVE`,
        { method: "GET", headers },
      );
      const data = await res.json();
      validReference = data.data[0]?.reference;
    });

    it("should return product details for existing reference", async () => {
      if (!validReference) return;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };

      const res = await fetch(
        `${PFS_BASE_URL}/catalog/products/checkReference/${encodeURIComponent(validReference)}`,
        { method: "GET", headers },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.exists).toBe(true);
      expect(data.product).toBeDefined();
      expect(data.product.reference).toBe(validReference);

      // Verify composition structure
      expect(Array.isArray(data.product.material_composition)).toBe(true);
      // Verify description is multilingual
      expect(data.product.description).toBeDefined();
    });
  });

  // ─── Get Variants ──────────────────────────────────────────────

  describe("4. Get Variants", () => {
    let validProductId: string;

    beforeAll(async () => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };
      const res = await fetch(
        `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=1&status=ACTIVE`,
        { method: "GET", headers },
      );
      const data = await res.json();
      validProductId = data.data[0]?.id;
    });

    it("should return variants for a product", async () => {
      if (!validProductId) return;

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };

      const res = await fetch(
        `${PFS_BASE_URL}/catalog/products/${validProductId}/variants`,
        { method: "GET", headers },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toBeDefined();
      expect(Array.isArray(data.data)).toBe(true);

      if (data.data.length > 0) {
        const variant = data.data[0];
        expect(variant.id).toBeDefined();
        expect(variant.type).toMatch(/^(ITEM|PACK)$/);
        expect(variant.price_sale).toBeDefined();
        expect(typeof variant.weight).toBe("number");
        expect(typeof variant.stock_qty).toBe("number");
      }
    });
  });

  // ─── Attribute Endpoints ───────────────────────────────────────

  describe("5. Attribute Endpoints", () => {
    const headers = () => ({
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    });

    it("should fetch colors", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/colors`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].reference).toBeDefined();
    });

    it("should fetch categories", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/categories`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should fetch compositions", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/compositions`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should fetch countries", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/countries`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should fetch collections", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/collections`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should fetch families", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/families`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should fetch genders", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/genders`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should fetch sizes", async () => {
      const res = await fetch(`${PFS_BASE_URL}/catalog/attributes/sizes`, {
        method: "GET",
        headers: headers(),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      const items = data.data ?? data;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });
  });

  // ─── AI Translation Endpoint ───────────────────────────────────

  describe("6. AI Translation (read-only test)", () => {
    it("should respond to translation endpoint (even if content varies)", async () => {
      const res = await fetch(`${PFS_BASE_URL}/ai/translations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          phrases: { productName: "Bague test", productDescription: "Description test" },
          productName: "Bague test",
          productDescription: "Description test",
          source_language: "fr",
        }),
      });

      // Should at least not 404 — the endpoint exists
      expect([200, 201, 422, 429]).toContain(res.status);
    });
  });

  // ─── Health Summary ────────────────────────────────────────────

  describe("7. PFS Health Summary", () => {
    it("should confirm all core endpoints are reachable", async () => {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      };

      const endpoints = [
        { name: "listProducts", url: `${PFS_BASE_URL}/catalog/listProducts?page=1&per_page=1&status=ACTIVE` },
        { name: "colors", url: `${PFS_BASE_URL}/catalog/attributes/colors` },
        { name: "categories", url: `${PFS_BASE_URL}/catalog/attributes/categories` },
        { name: "compositions", url: `${PFS_BASE_URL}/catalog/attributes/compositions` },
      ];

      const results = await Promise.allSettled(
        endpoints.map(async (ep) => {
          const res = await fetch(ep.url, { method: "GET", headers });
          return { name: ep.name, status: res.status, ok: res.ok };
        }),
      );

      const failures = results
        .map((r, i) => ({
          name: endpoints[i].name,
          status: r.status === "fulfilled" ? r.value.status : "NETWORK_ERROR",
          ok: r.status === "fulfilled" ? r.value.ok : false,
        }))
        .filter((r) => !r.ok);

      if (failures.length > 0) {
        console.error("⚠️  PFS DEGRADED — Failed endpoints:", failures);
      }

      expect(failures).toHaveLength(0);
    });
  });
});
