/**
 * Tests pour app/actions/admin/send-newsletter-fiches.ts
 *
 * L'action ne fait plus que **enqueuer** un `BulkMailJob`. La logique d'envoi
 * vit dans le worker `lib/bulk-mail-worker.ts`. Les tests ici couvrent :
 *  1. Enqueue correct des fiches avec email (mock enqueueBulkMailJob)
 *  2. Skip des fiches sans email (email null / vide / whitespace)
 *  3. Refus si aucun destinataire valide / modèle inconnu / modèle vide
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || "test-secret-32bytes-min-do-not-use-in-prod";

const mockPrisma = vi.hoisted(() => ({
  newsletterTemplate: {
    findFirst: vi.fn(),
  },
  adminClientCard: {
    findMany: vi.fn(),
  },
}));

const mockRequireAdmin = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    tenant: { id: "tenant-1", slug: "beliandjolie", name: "Beli & Jolie" },
    session: { user: { id: "admin-1", role: "ADMIN" } },
  }),
);

const mockEnqueue = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ jobId: "job-xyz" }),
);

vi.mock("@/lib/auth-helpers", () => ({ requireAdmin: mockRequireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/bulk-mail-worker", () => ({ enqueueBulkMailJob: mockEnqueue }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { sendNewsletterToFiches } from "@/app/actions/admin/send-newsletter-fiches";

const baseTemplate = {
  id: "tpl-1",
  name: "Nouveautés été",
  subject: "Notre nouvelle collection",
  blocks: [
    {
      id: "b1",
      type: "heading",
      data: { title: "Bonjour {firstName}", body: "Nouveautés en boutique.", align: "center" },
    },
  ],
};

function makeFiche(overrides: Partial<{
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  company: string | null;
}>) {
  const email = "email" in overrides ? overrides.email ?? null : "marie@shop.fr";
  return {
    id: overrides.id ?? "f-1",
    firstName: overrides.firstName ?? "Marie",
    lastName: overrides.lastName ?? "Dupont",
    company: overrides.company ?? "Bijoux Marie",
    email,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.newsletterTemplate.findFirst.mockResolvedValue(baseTemplate);
  mockEnqueue.mockResolvedValue({ jobId: "job-xyz" });
});

describe("sendNewsletterToFiches", () => {
  it("enqueue un BulkMailJob avec les fiches ayant un email", async () => {
    mockPrisma.adminClientCard.findMany.mockResolvedValue([
      makeFiche({ id: "f-1", firstName: "Marie", lastName: "Dupont", email: "marie@shop.fr" }),
    ]);

    const res = await sendNewsletterToFiches({
      templateId: "tpl-1",
      ficheIds: ["f-1"],
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.jobId).toBe("job-xyz");
    expect(res.queued).toBe(1);
    expect(res.excluded).toBe(0);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        templateId: "tpl-1",
        templateName: "Nouveautés été",
        templateSubject: "Notre nouvelle collection",
        recipients: [
          expect.objectContaining({
            ficheId: "f-1",
            email: "marie@shop.fr",
            name: "Marie Dupont",
          }),
        ],
      }),
    );
  });

  it("skippe les fiches sans email (null / vide / whitespace) et compte excluded", async () => {
    mockPrisma.adminClientCard.findMany.mockResolvedValue([
      makeFiche({ id: "f-1", email: "marie@shop.fr" }),
      makeFiche({ id: "f-2", email: null }),
      makeFiche({ id: "f-3", email: "" }),
      makeFiche({ id: "f-4", email: "   " }),
    ]);

    const res = await sendNewsletterToFiches({
      templateId: "tpl-1",
      ficheIds: ["f-1", "f-2", "f-3", "f-4"],
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.queued).toBe(1);
    expect(res.excluded).toBe(3);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const arg = mockEnqueue.mock.calls[0][0] as { recipients: Array<{ ficheId: string }> };
    expect(arg.recipients).toHaveLength(1);
    expect(arg.recipients[0].ficheId).toBe("f-1");
  });

  it("refuse quand aucune fiche n'a d'email", async () => {
    mockPrisma.adminClientCard.findMany.mockResolvedValue([
      makeFiche({ id: "f-2", email: null }),
      makeFiche({ id: "f-3", email: "" }),
    ]);

    const res = await sendNewsletterToFiches({
      templateId: "tpl-1",
      ficheIds: ["f-2", "f-3"],
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/2 fiches sans email/);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("refuse ficheIds vide", async () => {
    const res = await sendNewsletterToFiches({
      templateId: "tpl-1",
      ficheIds: [],
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/Aucune fiche/);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("refuse quand le modèle est introuvable", async () => {
    mockPrisma.newsletterTemplate.findFirst.mockResolvedValue(null);
    const res = await sendNewsletterToFiches({
      templateId: "unknown",
      ficheIds: ["f-1"],
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/introuvable/);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("refuse quand le modèle est vide (aucun bloc)", async () => {
    mockPrisma.newsletterTemplate.findFirst.mockResolvedValue({
      ...baseTemplate,
      blocks: [],
    });
    const res = await sendNewsletterToFiches({
      templateId: "tpl-1",
      ficheIds: ["f-1"],
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/vide/i);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
