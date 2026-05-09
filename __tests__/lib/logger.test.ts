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

    it("error sort un bloc encadré multi-ligne", () => {
      logger.error("[Storage] cannot write");
      const output = consoleSpy.error.mock.calls[0][0] as string;
      expect(output).toContain("❌ ERREUR");
      expect(output).toContain("Stockage de fichier");
      expect(output).toContain("cannot write");
      expect(output.startsWith("─")).toBe(true);
    });

    it("warn sort un bloc encadré ⚠️", () => {
      logger.warn("low disk");
      const output = consoleSpy.warn.mock.calls[0][0] as string;
      expect(output).toContain("AVERTISSEMENT");
    });

    it("error inclut type/message brut/stack quand error est un Error", () => {
      const err = new Error("boom");
      err.name = "BoomError";
      logger.error("[PFS] failed", { error: err });
      const output = consoleSpy.error.mock.calls[0][0] as string;
      expect(output).toContain("Type erreur");
      expect(output).toContain("BoomError");
      expect(output).toContain("Message brut");
      expect(output).toContain("boom");
    });

    it("info sort une ligne compacte avec ℹ️", () => {
      logger.info("hello", { x: 1 });
      const output = consoleSpy.log.mock.calls[0][0] as string;
      expect(output).toContain("ℹ️");
      expect(output).toContain("hello");
      expect(output).toContain('{"x":1}');
      expect(output).not.toContain("─");
    });

    it("debug est filtré en production", () => {
      logger.debug("debug me");
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });
  });
});
