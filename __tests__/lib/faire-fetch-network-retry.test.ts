import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Le module log doit être muet pendant les tests.
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/faire-auth", () => ({
  FAIRE_BASE_URL: "https://www.faire.com/external-api/v2",
  getFaireHeaders: vi.fn(async () => ({
    "X-FAIRE-ACCESS-TOKEN": "test-key",
    "User-Agent": "BJ/test",
  })),
}));

import { faireFetch } from "@/lib/faire-api";

describe("faireFetch — retry sur erreur réseau (TypeError: fetch failed)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("réessaie 2 fois quand fetch throw TypeError puis renvoie la réponse au 3ᵉ essai", async () => {
    const netError = new TypeError("fetch failed");
    (netError as TypeError & { cause?: unknown }).cause = Object.assign(new Error("socket hang up"), { code: "UND_ERR_SOCKET" });

    const ok = new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(netError)
      .mockRejectedValueOnce(netError)
      .mockResolvedValueOnce(ok);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = faireFetch("/products/p_test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
  });

  it("re-throw avec le code de la cause bas niveau quand tous les essais échouent", async () => {
    const netError = new TypeError("fetch failed");
    (netError as TypeError & { cause?: unknown }).cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });

    const fetchMock = vi.fn().mockRejectedValue(netError);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = faireFetch("/products/p_test", { method: "PATCH", body: "{}" });
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow(/ECONNRESET/);
    // MAX_FAIRE_ATTEMPTS = 5 (relevé depuis 3 le 2026-08-15 pour absorber
    // les blocages Cloudflare 1015).
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("ne réessaie PAS sur 4xx client (non-429) — renvoie immédiatement", async () => {
    const bad = new Response("{\"message\":\"nope\"}", { status: 400 });
    const fetchMock = vi.fn().mockResolvedValueOnce(bad);
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await faireFetch("/products/p_test");
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("réessaie sur 5xx serveur puis renvoie la dernière réponse", async () => {
    const bad = new Response("bad gateway", { status: 502 });
    const fetchMock = vi.fn().mockResolvedValue(bad);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = faireFetch("/products/p_test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
