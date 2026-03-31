/**
 * Tests for lib/logger.ts
 * Structured logging: JSON in production, colored in dev.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

describe("lib/logger", () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("development mode", () => {
    let logger: typeof import("@/lib/logger").logger;

    beforeEach(async () => {
      vi.resetModules();
      process.env.NODE_ENV = "development";
      const mod = await import("@/lib/logger");
      logger = mod.logger;
    });

    it("should log debug messages to console.debug", () => {
      logger.debug("test debug");
      expect(consoleSpy.debug).toHaveBeenCalledOnce();
      const output = consoleSpy.debug.mock.calls[0][0] as string;
      expect(output).toContain("[DEBUG]");
      expect(output).toContain("test debug");
    });

    it("should log info messages to console.log", () => {
      logger.info("test info");
      expect(consoleSpy.log).toHaveBeenCalledOnce();
      const output = consoleSpy.log.mock.calls[0][0] as string;
      expect(output).toContain("[INFO]");
      expect(output).toContain("test info");
    });

    it("should log warn messages to console.warn", () => {
      logger.warn("test warn");
      expect(consoleSpy.warn).toHaveBeenCalledOnce();
      const output = consoleSpy.warn.mock.calls[0][0] as string;
      expect(output).toContain("[WARN]");
    });

    it("should log error messages to console.error", () => {
      logger.error("test error");
      expect(consoleSpy.error).toHaveBeenCalledOnce();
      const output = consoleSpy.error.mock.calls[0][0] as string;
      expect(output).toContain("[ERROR]");
    });

    it("should include metadata in dev output", () => {
      logger.info("request", { method: "GET", path: "/api/test" });
      const output = consoleSpy.log.mock.calls[0][0] as string;
      expect(output).toContain("method");
      expect(output).toContain("GET");
    });

    it("should handle no metadata", () => {
      logger.info("simple message");
      const output = consoleSpy.log.mock.calls[0][0] as string;
      expect(output).toContain("simple message");
    });
  });

  describe("production mode", () => {
    let logger: typeof import("@/lib/logger").logger;

    beforeEach(async () => {
      vi.resetModules();
      process.env.NODE_ENV = "production";
      const mod = await import("@/lib/logger");
      logger = mod.logger;
    });

    afterEach(() => {
      process.env.NODE_ENV = "test";
    });

    it("should output valid JSON in production", () => {
      logger.info("prod message", { key: "value" });
      const output = consoleSpy.log.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe("info");
      expect(parsed.message).toBe("prod message");
      expect(parsed.key).toBe("value");
      expect(parsed.timestamp).toBeDefined();
    });

    it("should include ISO timestamp in production JSON", () => {
      logger.error("error msg");
      const output = consoleSpy.error.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should spread metadata into JSON object", () => {
      logger.warn("warning", { userId: "123", action: "login" });
      const output = consoleSpy.warn.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.userId).toBe("123");
      expect(parsed.action).toBe("login");
    });
  });
});
