import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ankorstoreDeleteProduct } from "@/lib/ankorstore-api-write";

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

// Helper: one complete delete attempt = 5 fetch calls
// 1. POST /catalog/integrations/operations          → { data: { id: "opN" } }
// 2. POST .../operations/{id}/products              → {}
// 3. PATCH .../operations/{id}                     → {}
// 4. GET  .../operations/{id}                      → { data: { attributes: { status: "succeeded"|"partially_failed"|"failed" } } }
// 5. GET  .../operations/{id}/results              → { data: [{ attributes: { externalProductId, status, failureReason, issues } }] }
function mockAttempt(
  opId: string,
  opStatus: "succeeded" | "partially_failed" | "failed",
  failureReason?: string
) {
  const resultAttributes =
    opStatus === "succeeded"
      ? { externalProductId: "EXT-1", status: "success", failureReason: null, issues: [] }
      : {
          externalProductId: "EXT-1",
          status: "failure",
          failureReason: failureReason ?? null,
          issues: failureReason ? ["sku-detail"] : [],
        };

  mockFetch
    // 1. Create operation
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: opId } }),
    })
    // 2. Add products
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    })
    // 3. Start (PATCH)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    })
    // 4. Poll operation status (GET /operations/{id})
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ data: { attributes: { status: opStatus } } }),
    })
    // 5. Fetch per-product results (GET /operations/{id}/results)
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ data: [{ attributes: resultAttributes }] }),
    });
}

describe("ankorstoreDeleteProduct retry", () => {
  it("succès au 1er essai → 1 séquence (5 appels fetch)", async () => {
    mockAttempt("op1", "succeeded");

    const promise = ankorstoreDeleteProduct("EXT-1");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("échec 'Could not archive SKUs' au 1er, succès au 2e → retry après 1s (10 appels)", async () => {
    mockAttempt("op1", "partially_failed", "Could not archive SKUs");
    mockAttempt("op2", "succeeded");

    const promise = ankorstoreDeleteProduct("EXT-1");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(10);
  });

  it("échec 4 fois → throw après 3 retries", async () => {
    for (let i = 0; i < 4; i++) {
      mockAttempt(`op${i}`, "partially_failed", "Could not archive SKUs");
    }

    // Attach .catch() before timers run to avoid unhandled-rejection warnings
    const promise = ankorstoreDeleteProduct("EXT-1");
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Could not archive SKUs/);
  });
});
