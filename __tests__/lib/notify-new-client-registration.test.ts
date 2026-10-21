/**
 * Tests pour `notifyNewClientRegistration` — vérifie que le mail admin
 * précise bien le statut du dossier (en attente / validé auto / refusé auto).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type SentMail = {
  to: string | string[];
  subject: string;
  html: string;
  fromName?: string;
  attachments?: Array<{ filename: string; content?: Buffer; path?: string }>;
};

const { sentMails, loggerMock, cachedMock, prismaMock, siteConfigRows } =
  vi.hoisted(() => {
    const sentMails: SentMail[] = [];
    const siteConfigRows: Array<{ key: string; value: string }> = [];
    return {
      sentMails,
      loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      cachedMock: {
        getCachedShopName: vi.fn(async () => "MaBoutique"),
        getCachedCompanyInfo: vi.fn(async () => ({ email: "hello@maboutique.com" })),
      },
      prismaMock: {
        siteConfig: {
          findMany: vi.fn(async () => siteConfigRows),
          findFirst: vi.fn(async () => null),
        },
        transactionalEmailOverride: {
          findFirst: vi.fn(async () => null),
        },
        user: { findFirst: vi.fn(async () => null) },
      },
      siteConfigRows,
    };
  });

vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async (opts: SentMail) => {
    sentMails.push(opts);
    return { sent: true, id: "msg-id" } as const;
  }),
}));
vi.mock("@/lib/cached-data", () => cachedMock);
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/tenant-url", () => ({
  getCurrentTenantBaseUrl: vi.fn(async () => "https://example.com"),
}));
vi.mock("@/lib/encryption", () => ({
  decryptIfSensitive: (_key: string, value: string) => value,
}));

import { notifyNewClientRegistration } from "@/lib/notifications";

function baseClient() {
  return {
    firstName: "Marie",
    lastName: "Dupont",
    company: "Boutique Marie",
    email: "marie@exemple.com",
    phone: "0612345678",
    siret: "12345678900012",
  };
}

describe("notifyNewClientRegistration — statut dans la notif admin", () => {
  beforeEach(() => {
    sentMails.length = 0;
    vi.clearAllMocks();
  });

  it("statut PENDING → sujet contient « en attente de validation » + bandeau ambre", async () => {
    await notifyNewClientRegistration({ ...baseClient(), status: "PENDING" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("en attente de validation");
    // Bandeau coloré visible dans le mail
    expect(sentMails[0].html).toContain("Statut du dossier");
    expect(sentMails[0].html).toContain("en attente de validation");
    // Couleur ambre (#92400E = texte ambre foncé)
    expect(sentMails[0].html).toContain("#92400E");
  });

  it("statut APPROVED → sujet « validé automatiquement » + bandeau vert", async () => {
    await notifyNewClientRegistration({ ...baseClient(), status: "APPROVED" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("validé automatiquement");
    expect(sentMails[0].html).toContain("validé automatiquement");
    // Couleur emerald (#065F46)
    expect(sentMails[0].html).toContain("#065F46");
  });

  it("statut REJECTED → sujet « refusé automatiquement » + bandeau rouge", async () => {
    await notifyNewClientRegistration({ ...baseClient(), status: "REJECTED" });

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("refusé automatiquement");
    expect(sentMails[0].html).toContain("refusé automatiquement");
    // Couleur rouge (#991B1B)
    expect(sentMails[0].html).toContain("#991B1B");
  });

  it("status absent → retombe sur PENDING (rétrocompat)", async () => {
    await notifyNewClientRegistration(baseClient());

    expect(sentMails).toHaveLength(1);
    expect(sentMails[0].subject).toContain("en attente de validation");
  });
});
