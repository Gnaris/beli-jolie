import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  __testing__,
  clearEfashionSession,
  efashionFetch,
  efashionGraphql,
  hasEfashionCookies,
} from "@/lib/efashion-client";

describe("efashion-client cookie parsing", () => {
  beforeEach(() => {
    clearEfashionSession();
  });

  it("parses name=value Set-Cookie header", () => {
    const parsed = __testing__.parseSetCookie("session=abc123; Path=/; HttpOnly");
    expect(parsed).toEqual({ name: "session", value: "abc123", expiresAt: undefined });
  });

  it("honors Max-Age (seconds from now)", () => {
    const before = Date.now();
    const parsed = __testing__.parseSetCookie("session=abc; Max-Age=60");
    expect(parsed?.expiresAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(parsed?.expiresAt).toBeLessThanOrEqual(before + 61_000);
  });

  it("honors Expires (absolute date)", () => {
    const future = new Date(Date.now() + 3_600_000).toUTCString();
    const parsed = __testing__.parseSetCookie(`session=abc; Expires=${future}`);
    expect(parsed?.expiresAt).toBeDefined();
    expect(parsed?.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
  });

  it("returns null on malformed header (no equals sign)", () => {
    expect(__testing__.parseSetCookie("garbage_no_equals")).toBeNull();
  });

  it("Max-Age takes precedence over Expires when both present", () => {
    const old = new Date(2000, 0, 1).toUTCString();
    const before = Date.now();
    const parsed = __testing__.parseSetCookie(`s=v; Max-Age=120; Expires=${old}`);
    expect(parsed?.expiresAt).toBeGreaterThanOrEqual(before + 119_000);
  });
});

describe("efashion-client session jar", () => {
  beforeEach(() => clearEfashionSession());
  afterEach(() => {
    vi.restoreAllMocks();
    clearEfashionSession();
  });

  function mockResponse(opts: {
    status?: number;
    body?: unknown;
    setCookies?: string[];
  }) {
    const headers = new Headers();
    for (const c of opts.setCookies ?? []) {
      headers.append("set-cookie", c);
    }
    return new Response(JSON.stringify(opts.body ?? {}), {
      status: opts.status ?? 200,
      headers,
    });
  }

  it("captures Set-Cookie from response and sends Cookie on next request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          setCookies: ["session=xyz; Max-Age=3600", "track=42; Max-Age=3600"],
        }),
      )
      .mockResolvedValueOnce(mockResponse({ body: { ok: true } }));

    await efashionFetch("/anything");
    expect(await hasEfashionCookies()).toBe(true);

    await efashionFetch("/follow-up");
    const secondCall = fetchMock.mock.calls[1];
    const headers = secondCall[1]?.headers as Headers;
    expect(headers.get("Cookie")).toContain("session=xyz");
    expect(headers.get("Cookie")).toContain("track=42");
  });

  it("posts Origin + Referer matching eFashion CORS expectations", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse({ body: {} }));

    await efashionFetch("/graphql", { method: "POST" });
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Origin")).toBe("https://wholesaler.efashion-paris.com");
    expect(headers.get("Referer")).toBe("https://wholesaler.efashion-paris.com/");
  });

  it("drops expired cookies before sending next request", async () => {
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse({ setCookies: ["s=v; Max-Age=1"] }));

    await efashionFetch("/seed");
    expect(await hasEfashionCookies()).toBe(true);

    // Force expiry
    vi.useFakeTimers();
    vi.advanceTimersByTime(2_000);
    expect(await hasEfashionCookies()).toBe(false);
    vi.useRealTimers();
  });
});

describe("efashionGraphql", () => {
  beforeEach(() => clearEfashionSession());
  afterEach(() => {
    vi.restoreAllMocks();
    clearEfashionSession();
  });

  it("returns data field on success", async () => {
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { totalProduitsVendeur: 18783 } }), {
          status: 200,
          headers: new Headers(),
        }),
      );
    const data = await efashionGraphql<{ totalProduitsVendeur: number }>("query { x }");
    expect(data.totalProduitsVendeur).toBe(18783);
  });

  it("throws when response has GraphQL errors array", async () => {
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ errors: [{ message: "Unauthorized" }] }),
          { status: 200, headers: new Headers() },
        ),
      );
    await expect(efashionGraphql("query { x }")).rejects.toThrow(/Unauthorized/);
  });

  it("throws on non-2xx HTTP", async () => {
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("Server error body", { status: 500, headers: new Headers() }),
      );
    await expect(efashionGraphql("query { x }")).rejects.toThrow(/HTTP 500/);
  });

  it("retries on ER_LOCK_DEADLOCK and succeeds when 2nd attempt is clean", async () => {
    vi.useFakeTimers();
    const deadlockBody = JSON.stringify({
      errors: [
        {
          message:
            "ER_LOCK_DEADLOCK: Deadlock found when trying to get lock; try restarting transaction 2596B",
        },
      ],
    });
    const okBody = JSON.stringify({ data: { updateProduit: { id_produit: "42" } } });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementationOnce(async () =>
      new Response(deadlockBody, { status: 200, headers: new Headers() }),
    );
    fetchMock.mockImplementationOnce(async () =>
      new Response(okBody, { status: 200, headers: new Headers() }),
    );

    const promise = efashionGraphql<{ updateProduit: { id_produit: string } }>("mutation { x }");
    await vi.advanceTimersByTimeAsync(500);
    const data = await promise;
    expect(data.updateProduit.id_produit).toBe("42");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("gives up after 3 deadlock attempts and throws the last error", async () => {
    vi.useFakeTimers();
    const deadlockBody = JSON.stringify({
      errors: [
        {
          message: "ER_LOCK_DEADLOCK: Deadlock found when trying to get lock; try restarting transaction",
        },
      ],
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(deadlockBody, { status: 200, headers: new Headers() }),
    );

    const promise = efashionGraphql("mutation { x }");
    // Attache le catch de suite pour éviter un unhandled rejection pendant qu'on avance les timers.
    const settled = promise.catch((err) => err);
    await vi.advanceTimersByTimeAsync(500 + 1000);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ER_LOCK_DEADLOCK/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does NOT retry on other GraphQL errors (e.g. Unauthorized)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ errors: [{ message: "Unauthorized" }] }), {
        status: 200,
        headers: new Headers(),
      }),
    );

    await expect(efashionGraphql("query { x }")).rejects.toThrow(/Unauthorized/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on HTTP 5xx (out of retry scope)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("boom", { status: 500, headers: new Headers() }),
    );

    await expect(efashionGraphql("query { x }")).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
