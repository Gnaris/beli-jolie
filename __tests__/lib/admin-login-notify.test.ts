import { describe, it, expect } from "vitest";
import { parseUserAgent } from "@/lib/admin-login-notify";

describe("parseUserAgent", () => {
  it("détecte Chrome sur Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toBe("Chrome sur Windows");
  });

  it("détecte Safari sur iPhone", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toBe("Safari sur iPhone");
  });

  it("détecte Firefox sur macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toBe("Firefox sur macOS");
  });

  it("détecte Edge sur Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseUserAgent(ua)).toBe("Edge sur Windows");
  });

  it("détecte Chrome sur Android", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toBe("Chrome sur Android");
  });

  it("renvoie 'inconnu' si vide ou null", () => {
    expect(parseUserAgent("")).toBe("inconnu");
    expect(parseUserAgent("inconnu")).toBe("inconnu");
  });

  it("tronque à 100 caractères en fallback", () => {
    const bizarre = "X".repeat(200);
    const out = parseUserAgent(bizarre);
    expect(out.length).toBeLessThanOrEqual(100);
  });
});
