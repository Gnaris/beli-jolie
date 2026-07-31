/**
 * Test de la détection de dédup Ankorstore dans `ankorstoreCreateCatalogOperation`.
 *
 * Ankor renvoie parfois le MÊME operationId pour deux create successifs même
 * quand notre body est différent (nonce dans callbackUrl). On détecte la
 * collision (opId déjà vu récemment) et on retry avec backoff progressif.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ankorstoreCreateCatalogOperation,
  __resetAnkorstoreRecentOperationIds,
} from "@/lib/ankorstore-api-write";

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

const createResponse = (opId: string) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ data: { id: opId, attributes: {} } }),
});

beforeEach(() => {
  mockFetch.mockReset();
  __resetAnkorstoreRecentOperationIds();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ankorstoreCreateCatalogOperation — détection dédup", () => {
  it("retourne l'opId au 1er essai quand Ankor renvoie un ID neuf", async () => {
    mockFetch.mockResolvedValueOnce(createResponse("op_aaa"));

    const promise = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ operationId: "op_aaa" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("chaque appel unique renvoie un opId neuf sans retry", async () => {
    mockFetch
      .mockResolvedValueOnce(createResponse("op_111"))
      .mockResolvedValueOnce(createResponse("op_222"))
      .mockResolvedValueOnce(createResponse("op_333"));

    const p1 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await expect(p1).resolves.toEqual({ operationId: "op_111" });

    const p2 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await expect(p2).resolves.toEqual({ operationId: "op_222" });

    const p3 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await expect(p3).resolves.toEqual({ operationId: "op_333" });

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retry quand Ankor renvoie un opId déjà vu, puis accepte le nouveau", async () => {
    // 1er appel : opId neuf
    mockFetch.mockResolvedValueOnce(createResponse("op_original"));
    const p1 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await expect(p1).resolves.toEqual({ operationId: "op_original" });

    // 2ᵉ appel : Ankor dédupe (renvoie op_original), puis au retry renvoie un ID neuf
    mockFetch
      .mockResolvedValueOnce(createResponse("op_original")) // dédup !
      .mockResolvedValueOnce(createResponse("op_fresh"));   // retry OK

    const p2 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await expect(p2).resolves.toEqual({ operationId: "op_fresh" });
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 1 dédup + 1 retry OK
  });

  it("accepte l'opId dupliqué au dernier essai si Ankor reste bloqué en dédup", async () => {
    mockFetch.mockResolvedValueOnce(createResponse("op_stuck"));
    const p1 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    await p1;

    // 4 retries + 1 dernier essai → tous renvoient le même opId
    mockFetch
      .mockResolvedValueOnce(createResponse("op_stuck"))
      .mockResolvedValueOnce(createResponse("op_stuck"))
      .mockResolvedValueOnce(createResponse("op_stuck"))
      .mockResolvedValueOnce(createResponse("op_stuck"))
      .mockResolvedValueOnce(createResponse("op_stuck"));

    const p2 = ankorstoreCreateCatalogOperation("update");
    await vi.runAllTimersAsync();
    // Après épuisement des backoffs, on accepte l'ID (le [pending]→[started]
    // retry côté start rattrapera si nécessaire).
    await expect(p2).resolves.toEqual({ operationId: "op_stuck" });
    // 1 initial + 4 retries = 5 calls
    expect(mockFetch).toHaveBeenCalledTimes(6); // p1 (1) + p2 (5)
  });
});
