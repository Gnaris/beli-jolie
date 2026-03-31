/**
 * Tests for lib/pfs-api.ts
 * PFS read API: listProducts, checkReference, getVariants, pfsTotalProducts.
 * All HTTP calls are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock pfs-auth
vi.mock("@/lib/pfs-auth", () => ({
  getPfsHeaders: vi.fn().mockResolvedValue({
    Authorization: "Bearer test-token",
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  }),
  invalidatePfsToken: vi.fn(),
  PFS_BASE_URL: "https://wholesaler-api.parisfashionshops.com/api/v1",
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("lib/pfs-api", () => {
  let pfsListProducts: typeof import("@/lib/pfs-api").pfsListProducts;
  let pfsCheckReference: typeof import("@/lib/pfs-api").pfsCheckReference;
  let pfsGetVariants: typeof import("@/lib/pfs-api").pfsGetVariants;
  let pfsTotalProducts: typeof import("@/lib/pfs-api").pfsTotalProducts;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    // Re-mock after resetModules
    vi.doMock("@/lib/pfs-auth", () => ({
      getPfsHeaders: vi.fn().mockResolvedValue({
        Authorization: "Bearer test-token",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      }),
      invalidatePfsToken: vi.fn(),
      PFS_BASE_URL: "https://wholesaler-api.parisfashionshops.com/api/v1",
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const mod = await import("@/lib/pfs-api");
    pfsListProducts = mod.pfsListProducts;
    pfsCheckReference = mod.pfsCheckReference;
    pfsGetVariants = mod.pfsGetVariants;
    pfsTotalProducts = mod.pfsTotalProducts;
  });

  // ─── pfsListProducts ──────────────────────────────────────────

  describe("pfsListProducts", () => {
    it("should fetch page 1 with default perPage=100", async () => {
      const mockResponse = {
        data: [{ id: "1", reference: "REF001" }],
        meta: { current_page: 1, last_page: 5, total: 450 },
        state: { total: 450, active: 400 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pfsListProducts(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].reference).toBe("REF001");
      expect(result.meta?.total).toBe(450);

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("page=1");
      expect(calledUrl).toContain("per_page=100");
      expect(calledUrl).toContain("status=ACTIVE");
    });

    it("should support custom perPage", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], meta: { total: 0 } }),
      });

      await pfsListProducts(2, 50);
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("page=2");
      expect(calledUrl).toContain("per_page=50");
    });

    it("should throw on 404 (after retries)", async () => {
      // 404 is thrown inside try, caught by catch, retried with backoff.
      // Provide enough mock responses for all retry attempts (maxRetries=5, so 6 total).
      for (let i = 0; i < 7; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not found"),
        });
      }

      await expect(pfsListProducts(1)).rejects.toThrow("404");
    }, 120000);
  });

  // ─── pfsCheckReference ─────────────────────────────────────────

  describe("pfsCheckReference", () => {
    it("should return product details when reference exists", async () => {
      const mockResponse = {
        exists: true,
        product: {
          id: "prod-1",
          reference: "BJ-001",
          category: { id: "cat-1", reference: "bijoux" },
          material_composition: [{ id: "comp-1", reference: "ACIER", percentage: 100 }],
          country_of_manufacture: "FR",
          description: { fr: "Bague en acier" },
          status: "READY_FOR_SALE",
          images: {},
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pfsCheckReference("BJ-001");
      expect(result.exists).toBe(true);
      expect(result.product?.reference).toBe("BJ-001");
      expect(result.product?.material_composition).toHaveLength(1);
    });

    it("should return exists:false for unknown reference", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ exists: false }),
      });

      const result = await pfsCheckReference("UNKNOWN-REF");
      expect(result.exists).toBe(false);
    });

    it("should URL-encode the reference", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ exists: false }),
      });

      await pfsCheckReference("REF/WITH SPACES");
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("REF%2FWITH%20SPACES");
    });
  });

  // ─── pfsGetVariants ────────────────────────────────────────────

  describe("pfsGetVariants", () => {
    it("should return variants for a product", async () => {
      const mockResponse = {
        data: [
          {
            id: "var-1",
            type: "ITEM",
            price_sale: { unit: { value: 5.99, currency: "EUR" } },
            weight: 0.15,
            stock_qty: 100,
            is_active: true,
            item: { color: { reference: "GOLDEN", value: "#FFD700" }, size: "TU" },
          },
          {
            id: "var-2",
            type: "PACK",
            price_sale: { unit: { value: 3.99, currency: "EUR" }, total: { value: 23.94, currency: "EUR" } },
            weight: 0.9,
            stock_qty: 50,
            is_active: true,
            packs: [{ color: { reference: "SILVER" }, sizes: [{ size: "S", qty: 3 }, { size: "M", qty: 3 }] }],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pfsGetVariants("prod-1");
      expect(result.data).toHaveLength(2);
      expect(result.data[0].type).toBe("ITEM");
      expect(result.data[1].type).toBe("PACK");
    });
  });

  // ─── pfsTotalProducts ──────────────────────────────────────────

  describe("pfsTotalProducts", () => {
    it("should return total from meta", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [],
          meta: { total: 1234 },
          state: { active: 1200 },
        }),
      });

      const total = await pfsTotalProducts();
      expect(total).toBe(1234);
    });

    it("should fallback to state.active if meta.total missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: [],
          state: { active: 800 },
        }),
      });

      const total = await pfsTotalProducts();
      expect(total).toBe(800);
    });

    it("should return 0 if neither meta nor state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const total = await pfsTotalProducts();
      expect(total).toBe(0);
    });
  });

  // ─── Retry logic ───────────────────────────────────────────────

  describe("retry logic", () => {
    it("should retry on 500 errors", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("Internal Error") })
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("Internal Error") })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [], meta: { total: 0 } }),
        });

      const result = await pfsListProducts(1);
      expect(result.data).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 60000);

    it("should retry on 429 rate limit", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve("Rate limited") })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });

      await pfsListProducts(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 60000);

    it("should eventually throw on 404 after exhausting retries", async () => {
      // 404 errors are thrown inside try block, caught by catch, and retried.
      // Provide enough responses for all attempts.
      for (let i = 0; i < 7; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not found"),
        });
      }

      await expect(pfsListProducts(1)).rejects.toThrow("404");
    }, 120000);

    it("should invalidate token on 401 and retry once", async () => {
      const { invalidatePfsToken } = await import("@/lib/pfs-auth");

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("Unauthorized") })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });

      await pfsListProducts(1);
      expect(invalidatePfsToken).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retries exceeded", async () => {
      // Return 500 for all attempts (0..5 = 6 calls)
      // Total backoff: 2+4+8+16+32+60 = ~122s, so we need a generous timeout
      for (let i = 0; i < 7; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Server Error"),
        });
      }

      await expect(pfsListProducts(1)).rejects.toThrow();
    }, 180000);
  });
});
