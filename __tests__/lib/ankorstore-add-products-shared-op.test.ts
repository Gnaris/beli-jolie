/**
 * Tests pour ankorstoreAddProductsToOperation — détection d'opId partagé.
 *
 * Bug 2026-08-12 : quand Ankor déduplique POST /operations et renvoie le
 * même opId qu'un kickoff précédent encore en `pending`, l'appel add renvoie
 * `meta.totalProductsCount > products.length` (l'op contient déjà les
 * produits du kickoff précédent). Avant le fix, on continuait — créant des
 * jobs orphelins. Maintenant on throw AnkorstoreSharedOperationError.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock("@/lib/ankorstore-auth", () => ({
  getAnkorstoreHeaders: async () => ({ Authorization: "Bearer TEST" }),
  invalidateAnkorstoreToken: vi.fn(),
  ANKORSTORE_BASE_URL: "https://api.ankorstore.test",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: mockLoggerError },
}));

// @ts-expect-error — override global fetch
global.fetch = mockFetch;

const dummyProduct = {
  externalId: "R1",
  name: "P1",
  description: "d",
  currency: "EUR" as const,
  vatRate: 20,
  unitMultiplier: 1,
  wholesalePrice: 10,
  retailPrice: 30,
  countryCode: "FR",
  variants: [],
};

describe("ankorstoreAddProductsToOperation", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  it("throw AnkorstoreSharedOperationError quand acknowledged > sent", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ meta: { totalProductsCount: 5 } }), {
        status: 200,
      }),
    );
    const { ankorstoreAddProductsToOperation, AnkorstoreSharedOperationError } =
      await import("@/lib/ankorstore-api-write");

    await expect(
      ankorstoreAddProductsToOperation("op-shared", [dummyProduct]),
    ).rejects.toBeInstanceOf(AnkorstoreSharedOperationError);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("shared operation"),
      expect.objectContaining({
        operationId: "op-shared",
        sent: 1,
        acknowledged: 5,
      }),
    );
  });

  it("ne throw pas quand acknowledged === sent (cas normal)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ meta: { totalProductsCount: 1 } }), {
        status: 200,
      }),
    );
    const { ankorstoreAddProductsToOperation } = await import(
      "@/lib/ankorstore-api-write"
    );

    const resp = await ankorstoreAddProductsToOperation("op-ok", [dummyProduct]);
    expect(resp.totalProductsCount).toBe(1);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it("ne throw pas quand acknowledged === 0 (payload rejeté, ancien bug — caller check)", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ meta: { totalProductsCount: 0 } }), {
        status: 200,
      }),
    );
    const { ankorstoreAddProductsToOperation } = await import(
      "@/lib/ankorstore-api-write"
    );

    const resp = await ankorstoreAddProductsToOperation("op-empty", [dummyProduct]);
    // Caller vérifie totalProductsCount === 0 séparément — on log un warn
    // partial ack au passage.
    expect(resp.totalProductsCount).toBe(0);
    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});
