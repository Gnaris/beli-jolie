import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseUserAgent } from "@/lib/admin-login-notify";

vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "Beli Jolie"),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

import { sendAdminLoginNotification } from "@/lib/admin-login-notify";
import { sendMail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const sendMailMock = sendMail as unknown as ReturnType<typeof vi.fn>;
const findFirstMock = prisma.siteConfig.findFirst as unknown as ReturnType<typeof vi.fn>;

describe("sendAdminLoginNotification", () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    findFirstMock.mockReset();
    (logger.warn as ReturnType<typeof vi.fn>).mockReset();
  });

  it("skip silencieux si aucun mail perso configuré", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await sendAdminLoginNotification({
      tenantId: "t1",
      adminEmail: "admin@example.com",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("skip silencieux si valeur SiteConfig vide", async () => {
    findFirstMock.mockResolvedValueOnce({ value: "   " });
    await sendAdminLoginNotification({
      tenantId: "t1",
      adminEmail: "admin@example.com",
      ip: "1.2.3.4",
      userAgent: "Mozilla/5.0",
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("appelle sendMail avec les bons arguments", async () => {
    findFirstMock.mockResolvedValueOnce({ value: "perso@gmail.com" });
    sendMailMock.mockResolvedValueOnce({ sent: true, id: "abc" });

    await sendAdminLoginNotification({
      tenantId: "t1",
      adminEmail: "admin@example.com",
      ip: "1.2.3.4",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const args = sendMailMock.mock.calls[0][0];
    expect(args.to).toBe("perso@gmail.com");
    expect(args.subject).toContain("Nouvelle connexion admin");
    expect(args.subject).toContain("Beli Jolie");
    expect(args.html).toContain("admin@example.com");
    expect(args.html).toContain("1.2.3.4");
    expect(args.html).toContain("Chrome sur Windows");
  });

  it("ne throw pas si sendMail retourne sent:false", async () => {
    findFirstMock.mockResolvedValueOnce({ value: "perso@gmail.com" });
    sendMailMock.mockResolvedValueOnce({
      sent: false,
      reason: "smtp_error",
      error: "timeout",
    });

    await expect(
      sendAdminLoginNotification({
        tenantId: "t1",
        adminEmail: "admin@example.com",
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0",
      })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("ne throw pas si sendMail lève", async () => {
    findFirstMock.mockResolvedValueOnce({ value: "perso@gmail.com" });
    sendMailMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      sendAdminLoginNotification({
        tenantId: "t1",
        adminEmail: "admin@example.com",
        ip: "1.2.3.4",
        userAgent: "Mozilla/5.0",
      })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
