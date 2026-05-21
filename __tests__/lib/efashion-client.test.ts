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
    expect(hasEfashionCookies()).toBe(true);

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
    expect(hasEfashionCookies()).toBe(true);

    // Force expiry
    vi.useFakeTimers();
    vi.advanceTimersByTime(2_000);
    expect(hasEfashionCookies()).toBe(false);
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
});
