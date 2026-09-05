/**
 * Orderchamp GraphQL client — politique de retry.
 *
 * Bug 2026-09-05 : `productCreate` est appelé avec `disableRetry: true` pour
 * éviter les doublons en cas de 5xx retryé (incident 2026-08-20). Mais ce
 * drapeau désactivait AUSSI le retry sur 429, alors qu'un 429 est un rejet
 * explicite avant traitement — parfaitement idempotent, donc safe à retenter.
 *
 * Règle figée : `disableRetry` désactive uniquement les retries dangereux
 * (5xx et erreur réseau). Les 429 restent toujours retryés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/orderchamp-auth", () => ({
  ORDERCHAMP_BASE_URL: "https://api.orderchamp.test/v1/graphql",
  getOrderchampHeaders: async () => ({ "Content-Type": "application/json", Authorization: "Bearer test" }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { orderchampGraphQL, OrderchampGraphQLError } from "@/lib/orderchamp-client";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rateLimitResponse(retryAfterSeconds?: number): Response {
  const headers = new Headers();
  if (retryAfterSeconds !== undefined) headers.set("Retry-After", String(retryAfterSeconds));
  // Volontairement pas de body JSON — reproduit le comportement OC en throttle
  // (corps HTML/vide → parseGraphQLResponse throw "sans JSON").
  return new Response("Too Many Requests", { status: 429, headers });
}

function serverErrorResponse(): Response {
  return new Response("Internal Server Error", { status: 500 });
}

describe("orderchampGraphQL — retry policy", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    // Accélère les délais de retry pour les tests (sans ça, 30s+ par tentative)
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 5 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("disableRetry=true : un 429 est retryé (safe car pas de traitement côté OC)", async () => {
    fetchSpy
      .mockResolvedValueOnce(rateLimitResponse(0)) // Retry-After 0s → wait ~0ms
      .mockResolvedValueOnce(rateLimitResponse(0))
      .mockResolvedValueOnce(jsonResponse({ data: { productCreate: { ok: true } } }));

    const res = await orderchampGraphQL("mutation Q", {}, "productCreate", { disableRetry: true });
    expect(res).toEqual({ productCreate: { ok: true } });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("disableRetry=true : un 5xx N'EST PAS retryé (risque de doublon)", async () => {
    fetchSpy.mockResolvedValueOnce(serverErrorResponse());

    await expect(
      orderchampGraphQL("mutation Q", {}, "productCreate", { disableRetry: true }),
    ).rejects.toBeInstanceOf(OrderchampGraphQLError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("message d'erreur 429 : libellé humain pour la cliente (pas de 'sans JSON')", async () => {
    // 5 tentatives toutes en 429 → épuise le retry et remonte le message final.
    fetchSpy.mockResolvedValue(rateLimitResponse(0));

    try {
      await orderchampGraphQL("query Q", {}, "query");
      throw new Error("attendait un throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OrderchampGraphQLError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/saturé/i);
      expect(msg).not.toMatch(/sans JSON/i);
      expect((err as OrderchampGraphQLError).status).toBe(429);
    }
  });

  it("message d'erreur 5xx : libellé humain, mentionne 'indisponible'", async () => {
    fetchSpy.mockResolvedValueOnce(serverErrorResponse());

    try {
      await orderchampGraphQL("mutation Q", {}, "productCreate", { disableRetry: true });
      throw new Error("attendait un throw");
    } catch (err) {
      expect(err).toBeInstanceOf(OrderchampGraphQLError);
      expect((err as Error).message).toMatch(/indisponible/i);
    }
  });

  it("disableRetry=true : une erreur réseau N'EST PAS retryée (risque de doublon)", async () => {
    const netErr = Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error("boom"), { code: "ECONNRESET" }) });
    fetchSpy.mockRejectedValueOnce(netErr);

    await expect(
      orderchampGraphQL("mutation Q", {}, "productCreate", { disableRetry: true }),
    ).rejects.toThrow(/fetch failed/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("disableRetry non fourni : 429 puis 5xx puis succès sont bien retryés", async () => {
    fetchSpy
      .mockResolvedValueOnce(rateLimitResponse(0))
      .mockResolvedValueOnce(serverErrorResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    const res = await orderchampGraphQL<{ ok: boolean }>("query Q", {}, "query");
    expect(res).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
