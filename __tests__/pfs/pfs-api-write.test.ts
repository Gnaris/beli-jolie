/**
 * Tests for lib/pfs-api-write.ts
 * PFS write API: products, variants, images, status, attributes.
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

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("lib/pfs-api-write", () => {
  let pfsCreateProduct: typeof import("@/lib/pfs-api-write").pfsCreateProduct;
  let pfsUpdateProduct: typeof import("@/lib/pfs-api-write").pfsUpdateProduct;
  let pfsCreateVariants: typeof import("@/lib/pfs-api-write").pfsCreateVariants;
  let pfsPatchVariants: typeof import("@/lib/pfs-api-write").pfsPatchVariants;
  let pfsDeleteVariant: typeof import("@/lib/pfs-api-write").pfsDeleteVariant;
  let pfsUploadImage: typeof import("@/lib/pfs-api-write").pfsUploadImage;
  let pfsDeleteImage: typeof import("@/lib/pfs-api-write").pfsDeleteImage;
  let pfsUpdateStatus: typeof import("@/lib/pfs-api-write").pfsUpdateStatus;
  let pfsGetColors: typeof import("@/lib/pfs-api-write").pfsGetColors;
  let pfsGetCategories: typeof import("@/lib/pfs-api-write").pfsGetCategories;
  let pfsGetCompositions: typeof import("@/lib/pfs-api-write").pfsGetCompositions;
  let pfsGetCountries: typeof import("@/lib/pfs-api-write").pfsGetCountries;
  let pfsGetCollections: typeof import("@/lib/pfs-api-write").pfsGetCollections;
  let pfsGetSizes: typeof import("@/lib/pfs-api-write").pfsGetSizes;
  let pfsTranslate: typeof import("@/lib/pfs-api-write").pfsTranslate;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

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

    const mod = await import("@/lib/pfs-api-write");
    pfsCreateProduct = mod.pfsCreateProduct;
    pfsUpdateProduct = mod.pfsUpdateProduct;
    pfsCreateVariants = mod.pfsCreateVariants;
    pfsPatchVariants = mod.pfsPatchVariants;
    pfsDeleteVariant = mod.pfsDeleteVariant;
    pfsUploadImage = mod.pfsUploadImage;
    pfsDeleteImage = mod.pfsDeleteImage;
    pfsUpdateStatus = mod.pfsUpdateStatus;
    pfsGetColors = mod.pfsGetColors;
    pfsGetCategories = mod.pfsGetCategories;
    pfsGetCompositions = mod.pfsGetCompositions;
    pfsGetCountries = mod.pfsGetCountries;
    pfsGetCollections = mod.pfsGetCollections;
    pfsGetSizes = mod.pfsGetSizes;
    pfsTranslate = mod.pfsTranslate;
  });

  // ─── pfsCreateProduct ──────────────────────────────────────────

  describe("pfsCreateProduct", () => {
    it("should create product and return pfsProductId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          resume: { products: 1, errors: 0 },
          data: [{ id: "pfs-123" }],
        })),
      });

      const result = await pfsCreateProduct({
        reference: "BJ-TEST-001",
        reference_code: "BJ-TEST-001",
        gender: "WOMAN",
        gender_label: "Femme",
        brand_name: "BeliJolie",
        family: "fashionjewelry",
        category: "bagues",
        season_name: "PE2026",
        label: { fr: "Bague test" },
        description: { fr: "Description test" },
        material_composition: "ACIER",
        country_of_manufacture: "FR",
      });

      expect(result.pfsProductId).toBe("pfs-123");
    });

    it("should throw on creation error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          resume: { products: 0, errors: 1 },
          data: [{ errors: { reference: ["Reference already exists"] } }],
        })),
      });

      await expect(pfsCreateProduct({
        reference: "DUPLICATE",
        reference_code: "DUPLICATE",
        gender: "WOMAN",
        gender_label: "Femme",
        brand_name: "Test",
        family: "fashionjewelry",
        category: "bagues",
        season_name: "PE2026",
        label: { fr: "Test" },
        description: { fr: "Test" },
        material_composition: "ACIER",
        country_of_manufacture: "FR",
      })).rejects.toThrow("reference: Reference already exists");
    });

    it("should throw if no ID returned", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          resume: { products: 1, errors: 0 },
          data: [{}], // no id
        })),
      });

      await expect(pfsCreateProduct({
        reference: "NO-ID",
        reference_code: "NO-ID",
        gender: "WOMAN",
        gender_label: "Femme",
        brand_name: "Test",
        family: "fashionjewelry",
        category: "bagues",
        season_name: "PE2026",
        label: { fr: "Test" },
        description: { fr: "Test" },
        material_composition: "ACIER",
        country_of_manufacture: "FR",
      })).rejects.toThrow("no ID returned");
    });
  });

  // ─── pfsUpdateProduct ──────────────────────────────────────────

  describe("pfsUpdateProduct", () => {
    it("should update product successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await expect(pfsUpdateProduct("pfs-123", {
        label: { fr: "Nouveau nom" },
        category: "colliers",
      })).resolves.toBeUndefined();
    });

    it("should throw on 422 validation error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({
          errors: [{ message: "Invalid category", columns: ["category"] }],
        })),
      });

      await expect(pfsUpdateProduct("pfs-123", { category: "invalid" }))
        .rejects.toThrow("validation error");
    });

    it("should throw on non-200 status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ error: "Bad request" })),
      });

      // fetchWithRetry returns non-retryable errors as-is for 400
      // The pfsUpdateProduct checks status !== 200
      await expect(pfsUpdateProduct("pfs-123", {})).rejects.toThrow();
    });
  });

  // ─── pfsCreateVariants ─────────────────────────────────────────

  describe("pfsCreateVariants", () => {
    it("should create variants and return IDs", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          resume: { products: 2, errors: 0 },
          data: [{ id: "var-1" }, { id: "var-2" }],
        })),
      });

      const result = await pfsCreateVariants("pfs-123", [
        { type: "ITEM", color: "GOLDEN", size: "TU", price_eur_ex_vat: 5.99, weight: 0.15, stock_qty: 100 },
        { type: "ITEM", color: "SILVER", size: "TU", price_eur_ex_vat: 5.99, weight: 0.15, stock_qty: 50 },
      ]);

      expect(result.variantIds).toEqual(["var-1", "var-2"]);
    });

    it("should handle 200 with partial errors (log warning)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          resume: { products: 1, errors: 1 },
          data: [{ id: "var-ok" }, { errors: { color: ["Invalid color ref"] } }],
        })),
      });

      const result = await pfsCreateVariants("pfs-123", [
        { type: "ITEM", color: "VALID", size: "TU", price_eur_ex_vat: 5, weight: 0.1, stock_qty: 10 },
        { type: "ITEM", color: "INVALID", size: "TU", price_eur_ex_vat: 5, weight: 0.1, stock_qty: 10 },
      ]);

      // Should still return the successful ID
      expect(result.variantIds).toEqual(["var-ok"]);
    });

    it("should throw on non-200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad request"),
      });

      await expect(pfsCreateVariants("pfs-123", []))
        .rejects.toThrow("create variants failed");
    });
  });

  // ─── pfsPatchVariants ──────────────────────────────────────────

  describe("pfsPatchVariants", () => {
    it("should patch variants and return updated count", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          data: { resume: { product_items: { updated: 3 } } },
        })),
      });

      const result = await pfsPatchVariants([
        { variant_id: "v1", price_eur_ex_vat: 10 },
        { variant_id: "v2", stock_qty: 200 },
        { variant_id: "v3", weight: 0.5 },
      ]);

      expect(result.updated).toBe(3);
    });
  });

  // ─── pfsDeleteVariant ──────────────────────────────────────────

  describe("pfsDeleteVariant", () => {
    it("should delete variant successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await expect(pfsDeleteVariant("var-1")).resolves.toBeUndefined();
    });

    it("should throw on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      await expect(pfsDeleteVariant("nonexistent")).rejects.toThrow();
    });
  });

  // ─── pfsUploadImage ────────────────────────────────────────────

  describe("pfsUploadImage", () => {
    it("should upload image with multipart form data", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ image_path: "/images/prod/1.jpg" })),
      });

      const buffer = Buffer.from("fake-image-data");
      const result = await pfsUploadImage("pfs-123", buffer, 1, "GOLDEN", "ring.jpg");

      expect(result.imagePath).toBe("/images/prod/1.jpg");

      // Verify FormData was used
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBeInstanceOf(FormData);
    });

    it("should throw on upload failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        text: () => Promise.resolve("File too large"),
      });

      const buffer = Buffer.from("too-large");
      await expect(pfsUploadImage("pfs-123", buffer, 1, "GOLDEN"))
        .rejects.toThrow("upload image failed");
    });
  });

  // ─── pfsDeleteImage ────────────────────────────────────────────

  describe("pfsDeleteImage", () => {
    it("should delete image by slot and color", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await expect(pfsDeleteImage("pfs-123", 1, "GOLDEN")).resolves.toBeUndefined();

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].method).toBe("DELETE");
      const body = JSON.parse(callArgs[1].body);
      expect(body.color).toBe("GOLDEN");
      expect(body.slot).toBe(1);
    });

    it("should skip deletion for DEFAULT color", async () => {
      await pfsDeleteImage("pfs-123", 1, "DEFAULT");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ─── pfsUpdateStatus ──────────────────────────────────────────

  describe("pfsUpdateStatus", () => {
    it("should batch update product statuses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await expect(pfsUpdateStatus([
        { id: "pfs-1", status: "READY_FOR_SALE" },
        { id: "pfs-2", status: "DRAFT" },
        { id: "pfs-3", status: "ARCHIVED" },
      ])).resolves.toBeUndefined();
    });

    it("should throw on status update failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          errors: [{ id: "pfs-1", message: "Product has no variants" }],
        })),
      });

      await expect(pfsUpdateStatus([
        { id: "pfs-1", status: "READY_FOR_SALE" },
      ])).rejects.toThrow("update status failed");
    });
  });

  // ─── Attribute endpoints ───────────────────────────────────────

  describe("attribute endpoints", () => {
    const mockAttributeResponse = (data: unknown[]) => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data }),
    });

    it("pfsGetColors should return color list", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([
        { reference: "GOLDEN", value: "#FFD700", labels: { fr: "Doré" } },
        { reference: "SILVER", value: "#C0C0C0", labels: { fr: "Argenté" } },
      ]));

      const colors = await pfsGetColors();
      expect(colors).toHaveLength(2);
      expect(colors[0].reference).toBe("GOLDEN");
    });

    it("pfsGetCategories should return category list", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([
        { id: "cat-1", labels: { fr: "Bagues" }, gender: "WOMAN" },
      ]));

      const categories = await pfsGetCategories();
      expect(categories).toHaveLength(1);
      expect(categories[0].labels.fr).toBe("Bagues");
    });

    it("pfsGetCompositions should return composition list", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([
        { id: "comp-1", reference: "ACIER", labels: { fr: "Acier" } },
      ]));

      const compositions = await pfsGetCompositions();
      expect(compositions).toHaveLength(1);
    });

    it("pfsGetCountries should return country list", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([
        { reference: "FR", labels: { fr: "France" }, preview: null },
        { reference: "CN", labels: { fr: "Chine" }, preview: null },
      ]));

      const countries = await pfsGetCountries();
      expect(countries).toHaveLength(2);
    });

    it("pfsGetCollections should return collection list", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([
        { id: "col-1", reference: "PE2026", labels: { fr: "Printemps-Été 2026" } },
      ]));

      const collections = await pfsGetCollections();
      expect(collections).toHaveLength(1);
      expect(collections[0].reference).toBe("PE2026");
    });

    it("pfsGetSizes should return size list", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([
        { reference: "TU" },
        { reference: "S" },
        { reference: "M" },
        { reference: "L" },
      ]));

      const sizes = await pfsGetSizes();
      expect(sizes).toHaveLength(4);
    });

    it("should handle empty data array", async () => {
      mockFetch.mockResolvedValueOnce(mockAttributeResponse([]));
      const colors = await pfsGetColors();
      expect(colors).toEqual([]);
    });

    it("should handle raw array response (no data wrapper)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ reference: "TU" }]), // direct array
      });

      const sizes = await pfsGetSizes();
      expect(sizes).toEqual([{ reference: "TU" }]);
    });

    it("should throw on attribute fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      });

      // After retries, should throw
      await expect(pfsGetColors()).rejects.toThrow();
    }, 60000);
  });

  // ─── pfsTranslate ──────────────────────────────────────────────

  describe("pfsTranslate", () => {
    it("should return translations for product name and description", async () => {
      const mockTranslations = {
        productName: { fr: "Bague", en: "Ring", de: "Ring", es: "Anillo", it: "Anello" },
        productDescription: { fr: "Belle bague", en: "Beautiful ring", de: "Schöner Ring", es: "Hermoso anillo", it: "Bellissimo anello" },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockTranslations)),
      });

      const result = await pfsTranslate("Bague", "Belle bague");
      expect(result.productName.en).toBe("Ring");
      expect(result.productDescription.es).toBe("Hermoso anillo");
    });

    it("should return FR-only fallback on API error", async () => {
      // Use 422 (non-retryable) so fetchWithRetry returns immediately
      // pfsPost then returns { status: 422, data: ... } and pfsTranslate falls back
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: () => Promise.resolve(JSON.stringify({ error: "Translation failed" })),
      });

      const result = await pfsTranslate("Bague", "Description");
      expect(result.productName.fr).toBe("Bague");
      expect(result.productDescription.fr).toBe("Description");
      expect(result.productName.en).toBeUndefined();
    });
  });
});
