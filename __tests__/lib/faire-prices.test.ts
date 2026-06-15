import { describe, it, expect } from "vitest";
import { buildPricesPayload, chunkPrices } from "@/lib/faire-prices";

describe("chunkPrices", () => {
  it("retourne un seul chunk quand l'entrée est plus petite que la taille", () => {
    const chunks = chunkPrices([1, 2, 3], 10);
    expect(chunks).toEqual([[1, 2, 3]]);
  });

  it("découpe en chunks de taille N", () => {
    const arr = Array.from({ length: 1100 }, (_, i) => i);
    const chunks = chunkPrices(arr, 500);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(500);
    expect(chunks[1]).toHaveLength(500);
    expect(chunks[2]).toHaveLength(100);
  });

  it("rejette une taille ≤ 0", () => {
    expect(() => chunkPrices([1], 0)).toThrow();
  });
});

describe("buildPricesPayload", () => {
  it("formate les SKUs avec geo_constraint EUROPEAN_UNION et currency EUR", () => {
    const out = buildPricesPayload([
      { sku: "abc", wholesaleCents: 850, retailCents: 1700 },
    ]);
    expect(out).toEqual({
      prices: [
        {
          sku: "abc",
          prices: [
            {
              geo_constraint: { country_group: "EUROPEAN_UNION" },
              wholesale_price: { amount_minor: 850, currency: "EUR" },
              retail_price: { amount_minor: 1700, currency: "EUR" },
            },
          ],
        },
      ],
    });
  });

  it("clamp les montants négatifs à 0", () => {
    const out = buildPricesPayload([
      { sku: "abc", wholesaleCents: -10, retailCents: -20 },
    ]);
    expect(out.prices[0].prices[0].wholesale_price.amount_minor).toBe(0);
    expect(out.prices[0].prices[0].retail_price.amount_minor).toBe(0);
  });

  it("plancher entier (Math.floor)", () => {
    const out = buildPricesPayload([
      { sku: "abc", wholesaleCents: 850.9, retailCents: 1700.5 },
    ]);
    expect(out.prices[0].prices[0].wholesale_price.amount_minor).toBe(850);
    expect(out.prices[0].prices[0].retail_price.amount_minor).toBe(1700);
  });
});
