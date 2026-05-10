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

// Helper: one complete delete attempt = 4 fetch calls
// 1. POST /catalog/integrations/operations        → { data: { id: "opN" } }
// 2. POST .../products                            → {}
// 3. PATCH .../operations/{id}                   → {}
// 4. GET  .../operations/{id}/results            → { data: [...] }
function mockAttempt(
  opId: string,
  resultStatus: "succeeded" | "partially_failed",
  failureReason?: string
) {
  const resultAttributes =
    resultStatus === "succeeded"
      ? { status: "succeeded" }
      : {
          status: "partially_failed",
          externalProductId: "EXT-1",
          failureReason: failureReason ?? null,
          issues: failureReason ? ["sku-detail"] : [],
        };

  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: opId } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ data: [{ attributes: resultAttributes }] }),
    });
}

describe("ankorstoreDeleteProduct retry", () => {
  it("succès au 1er essai → 1 séquence (4 appels fetch)", async () => {
    mockAttempt("op1", "succeeded");

    const promise = ankorstoreDeleteProduct("EXT-1");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("échec 'Could not archive SKUs' au 1er, succès au 2e → retry après 1s (8 appels)", async () => {
    mockAttempt("op1", "partially_failed", "Could not archive SKUs");
    mockAttempt("op2", "succeeded");

    const promise = ankorstoreDeleteProduct("EXT-1");
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(8);
  });

  it("échec 4 fois → throw après 3 retries (16 appels fetch)", async () => {
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

    expect(mockFetch).toHaveBeenCalledTimes(16);
  });
});
