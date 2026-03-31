/**
 * Tests for lib/pfs-auth.ts
 * PFS token management: caching, refresh, invalidation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock cached credentials
vi.mock("@/lib/cached-data", () => ({
  getCachedPfsCredentials: vi.fn().mockResolvedValue({
    email: "test@pfs.com",
    password: "test-password",
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("lib/pfs-auth", () => {
  let getPfsToken: typeof import("@/lib/pfs-auth").getPfsToken;
  let invalidatePfsToken: typeof import("@/lib/pfs-auth").invalidatePfsToken;
  let getPfsHeaders: typeof import("@/lib/pfs-auth").getPfsHeaders;
  let PFS_BASE_URL: string;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();
    const mod = await import("@/lib/pfs-auth");
    getPfsToken = mod.getPfsToken;
    invalidatePfsToken = mod.invalidatePfsToken;
    getPfsHeaders = mod.getPfsHeaders;
    PFS_BASE_URL = mod.PFS_BASE_URL;
  });

  // ─── getPfsToken ───────────────────────────────────────────────

  describe("getPfsToken", () => {
    it("should authenticate and return access_token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "test-token-123",
          expires_at: "2027-01-01 00:00:00",
        }),
        text: () => Promise.resolve(""),
      });

      const token = await getPfsToken();
      expect(token).toBe("test-token-123");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/oauth/token"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "test@pfs.com", password: "test-password" }),
        }),
      );
    });

    it("should cache token and reuse on second call", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "cached-token",
          expires_at: "2027-01-01 00:00:00",
        }),
        text: () => Promise.resolve(""),
      });

      const token1 = await getPfsToken();
      const token2 = await getPfsToken();
      expect(token1).toBe("cached-token");
      expect(token2).toBe("cached-token");
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only one fetch
    });

    it("should refresh token when expired", async () => {
      // First call: token that "expires" immediately (past date)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "old-token",
          expires_at: "2020-01-01 00:00:00", // Already expired
        }),
        text: () => Promise.resolve(""),
      });

      await getPfsToken();

      // Second call should re-authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new-token",
          expires_at: "2027-01-01 00:00:00",
        }),
        text: () => Promise.resolve(""),
      });

      const token = await getPfsToken();
      expect(token).toBe("new-token");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw on auth failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Invalid credentials"),
      });

      await expect(getPfsToken()).rejects.toThrow("PFS auth failed");
    });

    it("should throw if access_token missing from response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token_type: "Bearer" }), // no access_token
        text: () => Promise.resolve(""),
      });

      await expect(getPfsToken()).rejects.toThrow("missing access_token");
    });

    it("should fallback to 1 year expiry if no expires_at", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "long-lived-token",
          // No expires_at field
        }),
        text: () => Promise.resolve(""),
      });

      const token = await getPfsToken();
      expect(token).toBe("long-lived-token");
      // Second call should still use cache (1 year validity)
      const token2 = await getPfsToken();
      expect(token2).toBe("long-lived-token");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ─── invalidatePfsToken ────────────────────────────────────────

  describe("invalidatePfsToken", () => {
    it("should force re-authentication after invalidation", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: "token-1", expires_at: "2027-01-01 00:00:00" }),
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: "token-2", expires_at: "2027-01-01 00:00:00" }),
          text: () => Promise.resolve(""),
        });

      const t1 = await getPfsToken();
      expect(t1).toBe("token-1");

      invalidatePfsToken();

      const t2 = await getPfsToken();
      expect(t2).toBe("token-2");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getPfsHeaders ─────────────────────────────────────────────

  describe("getPfsHeaders", () => {
    it("should return Authorization, Accept, and User-Agent headers", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: "header-token", expires_at: "2027-01-01 00:00:00" }),
        text: () => Promise.resolve(""),
      });

      const headers = await getPfsHeaders();
      expect(headers.Authorization).toBe("Bearer header-token");
      expect(headers.Accept).toBe("application/json");
      expect(headers["User-Agent"]).toContain("Mozilla");
    });
  });

  // ─── Missing credentials ───────────────────────────────────────

  describe("missing credentials", () => {
    it("should throw when no credentials available", async () => {
      vi.resetModules();

      vi.doMock("@/lib/cached-data", () => ({
        getCachedPfsCredentials: vi.fn().mockResolvedValue({ email: null, password: null }),
      }));

      // Clear env vars too
      const origEmail = process.env.PFS_EMAIL;
      const origPass = process.env.PFS_PASSWORD;
      delete process.env.PFS_EMAIL;
      delete process.env.PFS_PASSWORD;

      const mod = await import("@/lib/pfs-auth");
      await expect(mod.getPfsToken()).rejects.toThrow("Identifiants PFS manquants");

      process.env.PFS_EMAIL = origEmail;
      process.env.PFS_PASSWORD = origPass;
    });
  });

  // ─── PFS_BASE_URL ──────────────────────────────────────────────

  it("should export correct PFS_BASE_URL", () => {
    expect(PFS_BASE_URL).toBe("https://wholesaler-api.parisfashionshops.com/api/v1");
  });
});
