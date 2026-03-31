/**
 * Tests for lib/easy-express.ts
 * Easy-Express shipping API: rates, checkout, label download.
 * All HTTP calls and dependencies are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock cached-data
vi.mock("@/lib/cached-data", () => ({
  getCachedEasyExpressApiKey: vi.fn().mockResolvedValue("test-api-key-123"),
  getCachedCompanyInfo: vi.fn().mockResolvedValue({
    name: "BeliJolie SARL",
    shopName: "BeliJolie",
    email: "contact@belijolie.com",
    phone: "+33612345678",
    address: "10 Rue de la Paix",
    city: "Paris",
    postalCode: "75002",
    country: "France",
    siret: "12345678901234",
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("lib/easy-express", () => {
  let fetchEasyExpressRates: typeof import("@/lib/easy-express").fetchEasyExpressRates;
  let createEasyExpressShipment: typeof import("@/lib/easy-express").createEasyExpressShipment;
  let fetchEasyExpressLabel: typeof import("@/lib/easy-express").fetchEasyExpressLabel;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    vi.doMock("@/lib/cached-data", () => ({
      getCachedEasyExpressApiKey: vi.fn().mockResolvedValue("test-api-key-123"),
      getCachedCompanyInfo: vi.fn().mockResolvedValue({
        name: "BeliJolie SARL",
        shopName: "BeliJolie",
        email: "contact@belijolie.com",
        phone: "+33612345678",
        address: "10 Rue de la Paix",
        city: "Paris",
        postalCode: "75002",
        country: "France",
        siret: "12345678901234",
      }),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));

    const mod = await import("@/lib/easy-express");
    fetchEasyExpressRates = mod.fetchEasyExpressRates;
    createEasyExpressShipment = mod.createEasyExpressShipment;
    fetchEasyExpressLabel = mod.fetchEasyExpressLabel;
  });

  // ─── fetchEasyExpressRates ─────────────────────────────────────

  describe("fetchEasyExpressRates", () => {
    it("should return carriers on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: {
            Status: "OK",
            Code: 200,
            Message: {
              transactionId: "tx-123",
              carriers: [
                {
                  id: "carrier-base64-id",
                  name: "Colissimo",
                  priceIncTax: 899, // cents
                  logo: "https://logo.com/colissimo.png",
                  infos: { estimatedArrival: "2-3 jours" },
                },
                {
                  id: "carrier-2-id",
                  name: "Chronopost",
                  priceIncTax: 1299,
                  logo: "https://logo.com/chrono.png",
                  infos: { estimatedArrival: "24h" },
                },
              ],
            },
          },
        })),
      });

      const result = await fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 2,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.transactionId).toBe("tx-123");
        expect(result.carriers).toHaveLength(2);
        expect(result.carriers[0].name).toBe("Colissimo");
        expect(result.carriers[0].price).toBe(8.99); // 899 cents → 8.99 EUR
        expect(result.carriers[1].price).toBe(12.99);
      }
    });

    it("should enforce minimum 1kg weight", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: { Code: 200, Message: { transactionId: "tx-1", carriers: [] } },
        })),
      });

      await fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 0.1, // below 1kg
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.parcels[0].weight).toBe(1); // clamped to 1
    });

    it("should return error when API key is missing", async () => {
      vi.resetModules();
      vi.doMock("@/lib/cached-data", () => ({
        getCachedEasyExpressApiKey: vi.fn().mockResolvedValue(null),
        getCachedCompanyInfo: vi.fn().mockResolvedValue({}),
      }));
      vi.doMock("@/lib/logger", () => ({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));

      const mod = await import("@/lib/easy-express");
      const result = await mod.fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Clé API");
      }
    });

    it("should handle HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });

      const result = await fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });

      expect(result.success).toBe(false);
    });

    it("should handle non-JSON response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("<html>Not JSON</html>"),
      });

      const result = await fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("non-JSON");
      }
    });

    it("should handle API error response (Code != 200)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: { Code: 400, Message: "Invalid postal code" },
        })),
      });

      const result = await fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "INVALID",
        weightKg: 1,
      });

      expect(result.success).toBe(false);
    });

    it("should handle network exception", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network unreachable"));

      const result = await fetchEasyExpressRates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Impossible de contacter");
      }
    });

    it("should convert country name to code for sender", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: { Code: 200, Message: { transactionId: "tx", carriers: [] } },
        })),
      });

      await fetchEasyExpressRates({
        receiverCountry: "BE",
        receiverZipCode: "1000",
        weightKg: 1,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.senderAddress.countryCode).toBe("FR"); // from "France" in company info
      expect(body.receiverAddress.countryCode).toBe("BE");
    });
  });

  // ─── createEasyExpressShipment ─────────────────────────────────

  describe("createEasyExpressShipment", () => {
    const shipmentInput = {
      transactionId: "tx-123",
      carrierId: "carrier-base64-id",
      orderNumber: "CMD-001",
      weightKg: 1.5,
      toFirstName: "Jean",
      toLastName: "Dupont",
      toCompany: "SARL Dupont",
      toEmail: "jean@dupont.fr",
      toAddress1: "15 Rue de la Liberté",
      toAddress2: null,
      toZipCode: "69001",
      toCity: "Lyon",
      toCountry: "FR",
      toPhone: "+33698765432",
    };

    it("should create shipment and return tracking info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: {
            Code: 200,
            Message: {
              labels: "https://easy-express.fr/labels/combined.pdf",
              parcels: [
                { tracking: "TRACK123456", ticket: "https://easy-express.fr/ticket.pdf" },
              ],
            },
          },
        })),
      });

      const result = await createEasyExpressShipment(shipmentInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.trackingId).toBe("TRACK123456");
        expect(result.labelUrl).toBe("https://easy-express.fr/labels/combined.pdf");
      }
    });

    it("should return error when API key missing", async () => {
      vi.resetModules();
      vi.doMock("@/lib/cached-data", () => ({
        getCachedEasyExpressApiKey: vi.fn().mockResolvedValue(null),
        getCachedCompanyInfo: vi.fn().mockResolvedValue({}),
      }));
      vi.doMock("@/lib/logger", () => ({
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      }));

      const mod = await import("@/lib/easy-express");
      const result = await mod.createEasyExpressShipment(shipmentInput);
      expect(result.success).toBe(false);
    });

    it("should return error when no tracking in response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: {
            Code: 200,
            Message: { parcels: [{}] }, // no tracking
          },
        })),
      });

      const result = await createEasyExpressShipment(shipmentInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("numéro de suivi");
      }
    });

    it("should handle checkout API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          Response: { Code: 400, Message: "Transaction expired" },
        })),
      });

      const result = await createEasyExpressShipment(shipmentInput);
      expect(result.success).toBe(false);
    });

    it("should handle network failure gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection reset"));

      const result = await createEasyExpressShipment(shipmentInput);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Impossible de contacter");
      }
    });
  });

  // ─── fetchEasyExpressLabel ─────────────────────────────────────

  describe("fetchEasyExpressLabel", () => {
    it("should download PDF label as Buffer", async () => {
      const pdfContent = Buffer.from("%PDF-1.4 fake content");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(pdfContent.buffer),
      });

      const result = await fetchEasyExpressLabel("https://easy-express.fr/label.pdf");
      expect(result).toBeInstanceOf(Buffer);
      expect(result?.length).toBeGreaterThan(0);
    });

    it("should return null on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchEasyExpressLabel("https://easy-express.fr/missing.pdf");
      expect(result).toBeNull();
    });

    it("should return null on network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await fetchEasyExpressLabel("https://easy-express.fr/label.pdf");
      expect(result).toBeNull();
    });
  });
});
