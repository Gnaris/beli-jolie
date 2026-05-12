/**
 * Test de `ankorstoreKickoffDelete` (mode callback-only, plus de retry interne).
 *
 * Le retry "Could not archive SKUs" a disparu : c'était une boucle de polling
 * qui n'a plus de sens en mode callback. L'API renvoie l'operationId
 * immédiatement, le résultat arrive par webhook plus tard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ankorstoreKickoffDelete } from "@/lib/ankorstore-api-write";

vi.mock("@/lib/ankorstore-auth", () => ({
  getAnkorstoreHeaders: vi.fn().mockResolvedValue({
    Authorization: "Bearer x",
    Accept: "application/vnd.api+json",
  }),
  ANKORSTORE_BASE_URL: "https://www.ankorstore.com/api/v1",
  invalidateAnkorstoreToken: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as never;

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ankorstoreKickoffDelete (callback-only)", () => {
  it("rejette quand variantSkus est vide (silent no-op de l'API)", async () => {
    await expect(ankorstoreKickoffDelete("EXT-1", [])).rejects.toThrow(/empty variant list/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("envoie POST /operations/delete et retourne l'operationId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: "op-xyz", attributes: { status: "started" } } }),
    });

    const promise = ankorstoreKickoffDelete("EXT-1", ["SKU-A", "SKU-B"]);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.operationId).toBe("op-xyz");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/catalog/integrations/operations/delete");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.source).toBe("other");
    expect(body.callbackUrl).toMatch(/api\/webhooks\/ankorstore/);
    expect(body.products[0].attributes.external_id).toBe("EXT-1");
    expect(body.products[0].attributes.variants).toEqual([{ sku: "SKU-A" }, { sku: "SKU-B" }]);
  });
});
