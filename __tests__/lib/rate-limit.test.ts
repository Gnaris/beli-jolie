/**
 * Tests for lib/rate-limit.ts
 * In-memory rate limiter and IP extraction.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// We need to mock NextResponse since it's imported at module level
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

describe("lib/rate-limit", () => {
  let rateLimit: typeof import("@/lib/rate-limit").rateLimit;
  let getClientIpFromHeaders: typeof import("@/lib/rate-limit").getClientIpFromHeaders;
  let checkRateLimit: typeof import("@/lib/rate-limit").checkRateLimit;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const mod = await import("@/lib/rate-limit");
    rateLimit = mod.rateLimit;
    getClientIpFromHeaders = mod.getClientIpFromHeaders;
    checkRateLimit = mod.checkRateLimit;
  });

  // ─── rateLimit ─────────────────────────────────────────────────

  describe("rateLimit", () => {
    it("should allow first request", () => {
      const result = rateLimit("test:1", 5, 60000);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it("should decrement remaining on each call", () => {
      rateLimit("test:2", 3, 60000);
      const r2 = rateLimit("test:2", 3, 60000);
      expect(r2.success).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = rateLimit("test:2", 3, 60000);
      expect(r3.success).toBe(true);
      expect(r3.remaining).toBe(0);
    });

    it("should block after max attempts", () => {
      rateLimit("test:3", 2, 60000);
      rateLimit("test:3", 2, 60000);
      const r3 = rateLimit("test:3", 2, 60000);
      expect(r3.success).toBe(false);
      expect(r3.remaining).toBe(0);
    });

    it("should reset after window expires", () => {
      rateLimit("test:4", 1, 1000);
      const blocked = rateLimit("test:4", 1, 1000);
      expect(blocked.success).toBe(false);

      vi.advanceTimersByTime(1001);

      const allowed = rateLimit("test:4", 1, 1000);
      expect(allowed.success).toBe(true);
      expect(allowed.remaining).toBe(0);
    });

    it("should track different keys independently", () => {
      rateLimit("key:a", 1, 60000);
      const blockA = rateLimit("key:a", 1, 60000);
      expect(blockA.success).toBe(false);

      const allowB = rateLimit("key:b", 1, 60000);
      expect(allowB.success).toBe(true);
    });
  });

  // ─── getClientIpFromHeaders ────────────────────────────────────

  describe("getClientIpFromHeaders", () => {
    it("should extract IP from x-forwarded-for (first entry)", () => {
      const headers = new Headers({ "x-forwarded-for": "192.168.1.1, 10.0.0.1" });
      expect(getClientIpFromHeaders(headers)).toBe("192.168.1.1");
    });

    it("should extract IP from x-real-ip", () => {
      const headers = new Headers({ "x-real-ip": "10.0.0.5" });
      expect(getClientIpFromHeaders(headers)).toBe("10.0.0.5");
    });

    it("should prefer x-forwarded-for over x-real-ip", () => {
      const headers = new Headers({
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
      });
      expect(getClientIpFromHeaders(headers)).toBe("1.2.3.4");
    });

    it("should return 'unknown' when no IP headers", () => {
      const headers = new Headers();
      expect(getClientIpFromHeaders(headers)).toBe("unknown");
    });

    it("should trim whitespace from forwarded IP", () => {
      const headers = new Headers({ "x-forwarded-for": "  192.168.1.1  , 10.0.0.1" });
      expect(getClientIpFromHeaders(headers)).toBe("192.168.1.1");
    });
  });

  // ─── checkRateLimit ────────────────────────────────────────────

  describe("checkRateLimit", () => {
    it("should return null when under limit", () => {
      const request = { headers: new Headers({ "x-forwarded-for": "1.1.1.1" }) };
      const result = checkRateLimit(request, "test", 5, 60000);
      expect(result).toBeNull();
    });

    it("should return 429 response when limit exceeded", () => {
      const request = { headers: new Headers({ "x-forwarded-for": "2.2.2.2" }) };
      checkRateLimit(request, "block-test", 1, 60000);
      const result = checkRateLimit(request, "block-test", 1, 60000);
      expect(result).not.toBeNull();
      expect((result as any).status).toBe(429);
    });
  });
});
