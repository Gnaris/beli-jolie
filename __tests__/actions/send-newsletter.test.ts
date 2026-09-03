/**
 * Tests pour app/actions/admin/send-newsletter.ts
 *
 * Couvre :
 *  1. sendNewsletterToUsers avec 1 seul destinataire (flow individuel)
 *  2. Filtre RGPD (client non-APPROVED ou acceptsNewsletter=false → exclu)
 *  3. getNewsletterPreviewHtml (aperçu HTML pour la modale)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// buildUnsubscribeUrl (appelée par sendNewsletterToUsers pour insérer le lien
// de désinscription) exige un NEXTAUTH_SECRET. Posé au top du fichier.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "test-secret-32bytes-min-do-not-use-in-prod";

const mockPrisma = vi.hoisted(() => ({
  newsletterTemplate: {
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  product: { findMany: vi.fn().mockResolvedValue([]) },
  user: { findMany: vi.fn() },
  emailSend: { create: vi.fn().mockResolvedValue({}) },
  companyInfo: { findFirst: vi.fn().mockResolvedValue(null) },
}));

const mockRequireAdmin = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    tenant: { id: "tenant-1", slug: "beliandjolie", name: "Beli & Jolie" },
    session: { user: { id: "admin-1", role: "ADMIN" } },
  }),
);

const mockSendMail = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ sent: true, messageId: "msg-1" }),
);

vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/email", () => ({ sendMail: mockSendMail }));
vi.mock("@/lib/tenant-url", () => ({
  getCurrentTenantBaseUrl: vi.fn().mockResolvedValue("https://beliandjolie.com"),
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn().mockResolvedValue("Beli & Jolie"),
  // tenantScopedCacheWithTid est invoqué au top-level par lib/mail-branding
  // (pour construire getCachedMailBranding). En test on renvoie une factory
  // passthrough : elle appelle simplement la fn sous-jacente avec un tid bidon.
  tenantScopedCacheWithTid: (_k: string, fn: (tid: string) => unknown) => () => fn("test-tenant"),
}));
vi.mock("@/lib/mail-branding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail-branding")>();
  return {
    ...actual,
    getCachedMailBranding: vi.fn().mockResolvedValue(actual.DEFAULT_MAIL_BRANDING),
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  sendNewsletterToUsers,
  getNewsletterPreviewHtml,
} from "@/app/actions/admin/send-newsletter";

const baseTemplate = {
  id: "tpl-1",
  tenantId: "tenant-1",
  name: "Nouveautés été",
  subject: "Notre nouvelle collection",
  blocks: [
    {
      id: "b1",
      type: "heading",
      data: { title: "Bonjour", body: "Voici les nouveautés.", align: "center" },
    },
  ],
  lastSentAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.newsletterTemplate.findFirst.mockResolvedValue(baseTemplate);
  mockSendMail.mockResolvedValue({ sent: true, messageId: "msg-1" });
});

describe("sendNewsletterToUsers", () => {
  it("envoie à 1 seul destinataire quand userIds contient un id valide (flow individuel)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u-1", email: "marie@shop.fr" },
    ]);

    const res = await sendNewsletterToUsers({
      templateId: "tpl-1",
      userIds: ["u-1"],
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.sent).toBe(1);
    expect(res.failed).toBe(0);
    expect(res.excluded).toBe(0);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    // tracking passé à sendMail → c'est sendMail qui écrit EmailSend en interne
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "marie@shop.fr",
        fromName: "Beli & Jolie",
        tracking: expect.objectContaining({
          scenarioKey: "NEWSLETTER",
          userId: "u-1",
        }),
      }),
    );
    // Update lastSentAt sur le modèle
    expect(mockPrisma.newsletterTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tpl-1" },
        data: expect.objectContaining({ lastSentAt: expect.any(Date) }),
      }),
    );
  });

  it("filtre RGPD : client désinscrit ou non-approuvé → exclu, aucun mail envoyé", async () => {
    // Prisma filtre déjà les non-APPROVED / non-optés-in via findMany where clause,
    // donc simulate: 2 userIds envoyés, 0 revient (tous exclus).
    mockPrisma.user.findMany.mockResolvedValue([]);

    const res = await sendNewsletterToUsers({
      templateId: "tpl-1",
      userIds: ["u-1", "u-2"],
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/2 clients? exclu/);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("refuse un userIds vide", async () => {
    const res = await sendNewsletterToUsers({
      templateId: "tpl-1",
      userIds: [],
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/Aucun destinataire/);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("refuse si le modèle est introuvable", async () => {
    mockPrisma.newsletterTemplate.findFirst.mockResolvedValue(null);
    const res = await sendNewsletterToUsers({
      templateId: "unknown",
      userIds: ["u-1"],
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/introuvable/);
  });

  it("arrête l'envoi en série si SMTP n'est pas configuré (no_config)", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u-1", email: "a@shop.fr" },
      { id: "u-2", email: "b@shop.fr" },
    ]);
    mockSendMail.mockResolvedValue({ sent: false, reason: "no_config" });

    const res = await sendNewsletterToUsers({
      templateId: "tpl-1",
      userIds: ["u-1", "u-2"],
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    // 1 tentative, échec, on break → pas de 2ème appel
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(res.sent).toBe(0);
    expect(res.failed).toBe(2);
  });
});

describe("getNewsletterPreviewHtml", () => {
  it("retourne le HTML rendu pour un modèle existant", async () => {
    const res = await getNewsletterPreviewHtml("tpl-1");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.subject).toBe("Notre nouvelle collection");
    expect(res.html).toContain("<!doctype html>");
    expect(res.html).toContain("Bonjour"); // le titre du bloc heading est bien rendu
  });

  it("refuse un modèle introuvable", async () => {
    mockPrisma.newsletterTemplate.findFirst.mockResolvedValue(null);
    const res = await getNewsletterPreviewHtml("unknown");
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/introuvable/);
  });
});
