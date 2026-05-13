/**
 * Vérifie la sérialisation du bloc `shape_properties` envoyé à Ankorstore :
 * - le poids passe en `{ amount }` SANS `unit_code`
 * - les dimensions passent en `{ unit_code: "cm", width, height, length }`
 * - seuls les axes renseignés apparaissent dans le payload final snake_case
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// On stubble fetch et l'auth pour pouvoir capturer le payload envoyé.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/ankorstore-auth", () => ({
  ANKORSTORE_BASE_URL: "https://test.ankorstore.invalid/api/v1",
  getAnkorstoreHeaders: vi.fn().mockResolvedValue({ Authorization: "Bearer test" }),
  invalidateAnkorstoreToken: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastJsonBody(): Record<string, unknown> {
  const lastCall = mockFetch.mock.calls.at(-1);
  if (!lastCall) throw new Error("fetch n'a pas été appelé");
  const init = lastCall[1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("ankorstoreAddProductsToOperation — payload shape_properties", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(jsonResponse({ meta: { totalProductsCount: 1 } }));
  });

  it("poids → 'weight: { amount }' SANS unit_code", async () => {
    const { ankorstoreAddProductsToOperation } = await import("@/lib/ankorstore-api-write");
    await ankorstoreAddProductsToOperation("op1", [
      {
        externalId: "REF1",
        name: "P",
        description: "D",
        currency: "EUR",
        vatRate: 20,
        unitMultiplier: 1,
        wholesalePrice: 10,
        retailPrice: 15,
        countryCode: "FR",
        variants: [],
        shapeProperties: { weight: { amount: 0.05 } },
      },
    ]);

    const body = lastJsonBody();
    const product = (body.products as Array<Record<string, unknown>>)[0];
    const attrs = product.attributes as Record<string, unknown>;
    const shape = attrs.shape_properties as Record<string, unknown>;
    expect(shape).toBeDefined();
    expect(shape.weight).toEqual({ amount: 0.05 });
    // unit_code ne doit pas figurer dans le payload sérialisé
    expect((shape.weight as Record<string, unknown>).unit_code).toBeUndefined();
  });

  it("dimensions → 'dimensions: { unit_code: cm, length, width, height }'", async () => {
    const { ankorstoreAddProductsToOperation } = await import("@/lib/ankorstore-api-write");
    await ankorstoreAddProductsToOperation("op1", [
      {
        externalId: "REF1",
        name: "P",
        description: "D",
        currency: "EUR",
        vatRate: 20,
        unitMultiplier: 1,
        wholesalePrice: 10,
        retailPrice: 15,
        countryCode: "FR",
        variants: [],
        shapeProperties: {
          dimensions: { unitCode: "cm", width: 8, height: 3, length: 15 },
        },
      },
    ]);

    const body = lastJsonBody();
    const product = (body.products as Array<Record<string, unknown>>)[0];
    const attrs = product.attributes as Record<string, unknown>;
    const shape = attrs.shape_properties as Record<string, unknown>;
    expect(shape.dimensions).toEqual({
      unit_code: "cm",
      width: 8,
      height: 3,
      length: 15,
    });
  });

  it("dimensions partielles → seuls les axes renseignés apparaissent (en plus de unit_code)", async () => {
    const { ankorstoreAddProductsToOperation } = await import("@/lib/ankorstore-api-write");
    await ankorstoreAddProductsToOperation("op1", [
      {
        externalId: "REF1",
        name: "P",
        description: "D",
        currency: "EUR",
        vatRate: 20,
        unitMultiplier: 1,
        wholesalePrice: 10,
        retailPrice: 15,
        countryCode: "FR",
        variants: [],
        shapeProperties: {
          dimensions: { unitCode: "cm", length: 12 },
        },
      },
    ]);

    const body = lastJsonBody();
    const product = (body.products as Array<Record<string, unknown>>)[0];
    const attrs = product.attributes as Record<string, unknown>;
    const shape = attrs.shape_properties as Record<string, unknown>;
    expect(shape.dimensions).toEqual({ unit_code: "cm", length: 12 });
  });

  it("poids + dimensions combinés", async () => {
    const { ankorstoreAddProductsToOperation } = await import("@/lib/ankorstore-api-write");
    await ankorstoreAddProductsToOperation("op1", [
      {
        externalId: "REF1",
        name: "P",
        description: "D",
        currency: "EUR",
        vatRate: 20,
        unitMultiplier: 1,
        wholesalePrice: 10,
        retailPrice: 15,
        countryCode: "FR",
        variants: [],
        shapeProperties: {
          weight: { amount: 0.12 },
          dimensions: { unitCode: "cm", width: 10, height: 5, length: 20 },
        },
      },
    ]);

    const body = lastJsonBody();
    const product = (body.products as Array<Record<string, unknown>>)[0];
    const attrs = product.attributes as Record<string, unknown>;
    const shape = attrs.shape_properties as Record<string, unknown>;
    expect(shape).toEqual({
      weight: { amount: 0.12 },
      dimensions: { unit_code: "cm", width: 10, height: 5, length: 20 },
    });
  });

  it("sans shapeProperties → pas de bloc shape_properties dans le payload", async () => {
    const { ankorstoreAddProductsToOperation } = await import("@/lib/ankorstore-api-write");
    await ankorstoreAddProductsToOperation("op1", [
      {
        externalId: "REF1",
        name: "P",
        description: "D",
        currency: "EUR",
        vatRate: 20,
        unitMultiplier: 1,
        wholesalePrice: 10,
        retailPrice: 15,
        countryCode: "FR",
        variants: [],
      },
    ]);

    const body = lastJsonBody();
    const product = (body.products as Array<Record<string, unknown>>)[0];
    const attrs = product.attributes as Record<string, unknown>;
    expect(attrs.shape_properties).toBeUndefined();
  });
});
