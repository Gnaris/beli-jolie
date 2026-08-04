/**
 * Tests pour l'action `getMailForwardStatus` (app/actions/admin/mail-notify.ts).
 * Vérifie que `canForward` reflète la présence des 4 briques indispensables :
 *   - adresse perso vérifiée
 *   - smtp_host
 *   - smtp_user
 *   - smtp_password
 * Prisma et encryption sont mockés.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    findMany: vi.fn(),
  },
}));

const mockEncryption = vi.hoisted(() => ({
  decryptIfSensitive: vi.fn((_key: string, value: string) => value),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/encryption", () => mockEncryption);

// getServerSession n'est jamais appelé dans getMailForwardStatus mais le fichier
// importe next-auth via authOptions → on stub pour éviter les side-effects.
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getMailForwardStatus } from "@/app/actions/admin/mail-notify";

function siteConfigRows(pairs: Record<string, string>) {
  return Object.entries(pairs).map(([key, value]) => ({ key, value }));
}

describe("getMailForwardStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("canForward = false quand aucune adresse perso vérifiée", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        smtp_host: "mail.beliandjolie.com",
        smtp_user: "contact@beliandjolie.com",
        smtp_password: "s3cret",
        smtp_from_email: "contact@beliandjolie.com",
      })
    );
    const res = await getMailForwardStatus();
    expect(res.canForward).toBe(false);
    expect(res.personalEmail).toBe("");
    expect(res.proEmail).toBe("contact@beliandjolie.com");
  });

  it("canForward = false quand SMTP incomplet (mot de passe manquant)", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        admin_personal_email: "boss@gmail.com",
        smtp_host: "mail.beliandjolie.com",
        smtp_user: "contact@beliandjolie.com",
        smtp_from_email: "contact@beliandjolie.com",
      })
    );
    const res = await getMailForwardStatus();
    expect(res.canForward).toBe(false);
    expect(res.personalEmail).toBe("boss@gmail.com");
  });

  it("canForward = true quand perso + SMTP complet", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        admin_personal_email: "boss@gmail.com",
        smtp_host: "mail.beliandjolie.com",
        smtp_user: "contact@beliandjolie.com",
        smtp_password: "s3cret",
        smtp_from_email: "contact@beliandjolie.com",
      })
    );
    const res = await getMailForwardStatus();
    expect(res.canForward).toBe(true);
    expect(res.personalEmail).toBe("boss@gmail.com");
    expect(res.proEmail).toBe("contact@beliandjolie.com");
  });

  it("trim les espaces autour de l'adresse perso", async () => {
    mockPrisma.siteConfig.findMany.mockResolvedValue(
      siteConfigRows({
        admin_personal_email: "  boss@gmail.com  ",
        smtp_host: "mail.beliandjolie.com",
        smtp_user: "contact@beliandjolie.com",
        smtp_password: "s3cret",
        smtp_from_email: "contact@beliandjolie.com",
      })
    );
    const res = await getMailForwardStatus();
    expect(res.personalEmail).toBe("boss@gmail.com");
    expect(res.canForward).toBe(true);
  });
});
