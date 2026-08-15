/**
 * __tests__/lib/faire-fetch-rate-limit.test.ts
 *
 * Vérifie le comportement de `faireFetch` face au rate-limit Cloudflare 1015
 * (HTTP 429) qui protège l'API Faire. Incident 2026-08-15 : refresh en masse
 * de 20 produits → 14 échecs FAIRE, l'ancien backoff (500ms → 2s) ne laissait
 * pas Cloudflare se relâcher.
 *
 * Nouveau comportement :
 *  - 5 tentatives max (au lieu de 3)
 *  - Sur 429 : backoff long (30s / 60s / 90s / 120s) ou respect `Retry-After`
 *  - Sur 5xx / réseau : backoff court inchangé
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/faire-auth", () => ({
  FAIRE_BASE_URL: "https://www.faire.com/external-api/v2",
  getFaireHeaders: vi.fn(async () => ({
    "X-FAIRE-ACCESS-TOKEN": "test-key",
    "User-Agent": "BJ/test",
  })),
}));

import { faireFetch, computeFaireRetryDelayMs } from "@/lib/faire-api";

describe("computeFaireRetryDelayMs", () => {
  it("respecte Retry-After en secondes sur un 429", () => {
    const res = new Response("", {
      status: 429,
      headers: { "retry-after": "45" },
    });
    expect(computeFaireRetryDelayMs(res, 0)).toBe(45_000);
  });

  it("respecte Retry-After en date HTTP sur un 429", () => {
    const targetMs = Date.now() + 20_000;
    const res = new Response("", {
      status: 429,
      headers: { "retry-after": new Date(targetMs).toUTCString() },
    });
    const delay = computeFaireRetryDelayMs(res, 0);
    // Tolérance ±2s pour l'écart entre Date.now() dans le test et dans la fn.
    expect(delay).toBeGreaterThanOrEqual(18_000);
    expect(delay).toBeLessThanOrEqual(22_000);
  });

  it("cap Retry-After à 5 minutes même si Faire renvoie une valeur folle", () => {
    const res = new Response("", {
      status: 429,
      headers: { "retry-after": "9999" },
    });
    expect(computeFaireRetryDelayMs(res, 0)).toBe(300_000);
  });

  it("backoff progressif 30/60/90/120s sans Retry-After sur 429", () => {
    const res = new Response("", { status: 429 });
    expect(computeFaireRetryDelayMs(res, 0)).toBe(30_000);
    expect(computeFaireRetryDelayMs(res, 1)).toBe(60_000);
    expect(computeFaireRetryDelayMs(res, 2)).toBe(90_000);
    expect(computeFaireRetryDelayMs(res, 3)).toBe(120_000);
    // Cap à 120s à partir du 4ᵉ retry.
    expect(computeFaireRetryDelayMs(res, 5)).toBe(120_000);
  });

  it("backoff court exponentiel sur 5xx (500ms → 8s)", () => {
    const res = new Response("", { status: 502 });
    expect(computeFaireRetryDelayMs(res, 0)).toBe(500);
    expect(computeFaireRetryDelayMs(res, 1)).toBe(1_000);
    expect(computeFaireRetryDelayMs(res, 2)).toBe(2_000);
    expect(computeFaireRetryDelayMs(res, 3)).toBe(4_000);
  });
});

describe("faireFetch — retry sur HTTP 429 (Cloudflare rate-limit)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("réessaie sur 429 puis renvoie la réponse OK quand Cloudflare se relâche", async () => {
    const rateLimited = new Response(
      JSON.stringify({ error_code: 1015, error_name: "rate_limited" }),
      { status: 429 },
    );
    const ok = new Response("{}", { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(ok);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = faireFetch("/products/p_test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
  });

  it("renvoie le 429 après 5 tentatives quand Cloudflare reste bloqué", async () => {
    const rateLimited = new Response("rate limited", { status: 429 });
    const fetchMock = vi.fn().mockResolvedValue(rateLimited);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = faireFetch("/products/p_test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("respecte le header Retry-After pour temporiser (fake timers)", async () => {
    const rateLimited = new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "60" },
    });
    const ok = new Response("{}", { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(ok);
    global.fetch = fetchMock as unknown as typeof fetch;

    const promise = faireFetch("/products/p_test");

    // Avance de 30s : pas encore assez, la 2ᵉ requête ne doit pas être partie.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Avance de +35s (total 65s > 60s Retry-After) : la 2ᵉ requête part.
    await vi.advanceTimersByTimeAsync(35_000);
    const res = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });
});
