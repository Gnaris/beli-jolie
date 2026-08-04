import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/faire-auth", () => ({
  FAIRE_BASE_URL: "https://www.faire.com/external-api/v2",
  getFaireHeaders: vi.fn(async () => ({
    "X-FAIRE-ACCESS-TOKEN": "test-key",
  })),
}));

import { faireUpdatePrices } from "@/lib/faire-prices";
import { faireUpdateInventory } from "@/lib/faire-inventory";

describe("faireUpdatePrices — unknownSku sur 404 batch", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("expose le SKU 404 quand Faire renvoie {message: <sku>} sur un batch", async () => {
    const notFoundBody = JSON.stringify({
      status_code: 404,
      status_type: "Not Found",
      message: "1880_noir_UNIT_0r8sjxmy",
      entity_tokens: [],
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(notFoundBody, { status: 404 }),
    ) as unknown as typeof fetch;

    const res = await faireUpdatePrices([
      { sku: "1880_noir_UNIT_0r8sjxmy", wholesaleCents: 500, retailCents: 1500 },
      { sku: "1880_kaki_UNIT_bnvejpz6", wholesaleCents: 500, retailCents: 1500 },
    ]);

    expect(res.success).toBe(false);
    expect(res.failedCount).toBe(2);
    expect(res.unknownSku).toBe("1880_noir_UNIT_0r8sjxmy");
  });

  it("ne pose PAS unknownSku sur un 500 (autre erreur serveur)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("internal", { status: 500 }),
    ) as unknown as typeof fetch;

    const res = await faireUpdatePrices([
      { sku: "abc", wholesaleCents: 100, retailCents: 200 },
    ]);
    expect(res.success).toBe(false);
    expect(res.unknownSku).toBeUndefined();
  });

  it("ne pose PAS unknownSku si le message 404 ne correspond à aucun SKU du batch", async () => {
    const notFoundBody = JSON.stringify({
      status_code: 404,
      status_type: "Not Found",
      message: "AUTRE_SKU_INCONNU",
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(notFoundBody, { status: 404 }),
    ) as unknown as typeof fetch;

    const res = await faireUpdatePrices([
      { sku: "abc", wholesaleCents: 100, retailCents: 200 },
    ]);
    expect(res.success).toBe(false);
    expect(res.unknownSku).toBeUndefined();
  });
});

describe("faireUpdateInventory — unknownSku sur 404 batch", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("expose le SKU 404 quand Faire renvoie {message: <sku>} sur un batch", async () => {
    const notFoundBody = JSON.stringify({
      status_code: 404,
      status_type: "Not Found",
      message: "1880_noir_UNIT_0r8sjxmy",
    });
    global.fetch = vi.fn().mockResolvedValue(
      new Response(notFoundBody, { status: 404 }),
    ) as unknown as typeof fetch;

    const res = await faireUpdateInventory([
      { sku: "1880_noir_UNIT_0r8sjxmy", currentQuantity: 10 },
      { sku: "1880_kaki_UNIT_bnvejpz6", currentQuantity: 5 },
    ]);

    expect(res.success).toBe(false);
    expect(res.unknownSku).toBe("1880_noir_UNIT_0r8sjxmy");
  });
});
