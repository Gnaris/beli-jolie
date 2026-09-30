import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests unitaires de `listStagesForScenario` + `sendManualMail` (envoi manuel
 * depuis /admin/clients). Vérifie les filets serveur :
 *   - RESTOCK explicitement refusé (scénario temporairement désactivé).
 *   - stageIndex requis pour panier abandonné / inactivité.
 *   - stade inexistant → message clair.
 *   - modèle sans {unsubscribeLink} → refus RGPD.
 *   - liste des stades triée + flags hasContent / hasUnsubscribeToken.
 */

const TENANT_ID = "tenant_bj";

interface StageRow {
  id: string;
  tenantId: string;
  stageIndex: number;
  delaySeconds: number;
  templateId: string;
}

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  html: string | null;
  images: { name: string; path: string }[];
}

const store: {
  abandonedStages: StageRow[];
  inactiveStages: StageRow[];
  templates: TemplateRow[];
} = {
  abandonedStages: [],
  inactiveStages: [],
  templates: [],
};

function findStageJoinTemplate(
  arr: StageRow[],
  where: { tenantId?: string; stageIndex?: number },
): unknown {
  const s = arr.find((row) => {
    if (where.tenantId && row.tenantId !== where.tenantId) return false;
    if (where.stageIndex !== undefined && row.stageIndex !== where.stageIndex) return false;
    return true;
  });
  if (!s) return null;
  const tpl = store.templates.find((t) => t.id === s.templateId);
  if (!tpl) return null;
  return {
    stageIndex: s.stageIndex,
    delaySeconds: s.delaySeconds,
    template: {
      id: tpl.id,
      name: tpl.name,
      subject: tpl.subject,
      html: tpl.html,
      images: tpl.images,
    },
  };
}

function listStagesJoinTemplate(arr: StageRow[], where: { tenantId?: string }): unknown[] {
  const rows = arr
    .filter((row) => (where.tenantId ? row.tenantId === where.tenantId : true))
    .sort((a, b) => a.stageIndex - b.stageIndex);
  return rows.map((s) => {
    const tpl = store.templates.find((t) => t.id === s.templateId);
    return {
      stageIndex: s.stageIndex,
      delaySeconds: s.delaySeconds,
      template: tpl
        ? { id: tpl.id, name: tpl.name, subject: tpl.subject, html: tpl.html }
        : null,
    };
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    abandonedCartStage: {
      findMany: vi.fn(async ({ where }: { where: { tenantId?: string } }) =>
        listStagesJoinTemplate(store.abandonedStages, where),
      ),
      findFirst: vi.fn(async ({ where }: { where: { tenantId?: string; stageIndex?: number } }) =>
        findStageJoinTemplate(store.abandonedStages, where),
      ),
    },
    inactiveClientStage: {
      findMany: vi.fn(async ({ where }: { where: { tenantId?: string } }) =>
        listStagesJoinTemplate(store.inactiveStages, where),
      ),
      findFirst: vi.fn(async ({ where }: { where: { tenantId?: string; stageIndex?: number } }) =>
        findStageJoinTemplate(store.inactiveStages, where),
      ),
    },
    // Les autres modèles Prisma ne sont utilisés que dans les chemins
    // qu'on ne teste pas ici (getClientMailContext, renderStageForUser).
    // On mock au minimum pour éviter les crashs quand la garde stageIndex
    // renvoie tôt.
    user: { findFirst: vi.fn(async () => null) },
    cart: { findFirst: vi.fn(async () => null) },
    favorite: { findMany: vi.fn(async () => []) },
    stockMovement: { findMany: vi.fn(async () => []) },
    order: { count: vi.fn(async () => 0) },
    emailSend: { groupBy: vi.fn(async () => []) },
    companyInfo: { findFirst: vi.fn(async () => null) },
  },
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin_1", role: "ADMIN", email: "admin@example.com" } },
    tenant: { id: TENANT_ID, slug: "bj", name: "BJ" },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendMail: vi.fn(async () => ({ sent: true })),
}));

vi.mock("@/lib/tenant-url", () => ({
  getCurrentTenantBaseUrl: vi.fn(async () => "https://example.test"),
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "Boutique Test"),
}));

vi.mock("@/lib/newsletter-unsubscribe-token", () => ({
  buildUnsubscribeUrl: vi.fn(() => "https://example.test/unsubscribe?t=X"),
}));

import {
  listStagesForScenario,
  sendManualMail,
} from "@/app/actions/admin/user-mails";

beforeEach(() => {
  store.abandonedStages = [];
  store.inactiveStages = [];
  store.templates = [];
  vi.clearAllMocks();
});

function seedStagesFor(scenario: "ABANDONED_CART" | "INACTIVE_CLIENT") {
  const stages = scenario === "ABANDONED_CART" ? store.abandonedStages : store.inactiveStages;
  // Stade 1 — HTML complet avec unsubscribe.
  store.templates.push({
    id: "tpl_1",
    name: "Stade 1",
    subject: "Sujet stade 1",
    html:
      "<html><body>{firstName} · {shopName} · {shopAddress} · " +
      '<a href="{unsubscribeLink}">désinsc</a> · {privacyLink}</body></html>',
    images: [],
  });
  stages.push({
    id: "s1",
    tenantId: TENANT_ID,
    stageIndex: 1,
    delaySeconds: 3600,
    templateId: "tpl_1",
  });
  // Stade 2 — HTML sans unsubscribe (doit être signalé).
  store.templates.push({
    id: "tpl_2",
    name: "Stade 2",
    subject: "Sujet stade 2",
    html: "<html><body>Contenu du stade 2 sans lien de désinscription</body></html>",
    images: [],
  });
  stages.push({
    id: "s2",
    tenantId: TENANT_ID,
    stageIndex: 2,
    delaySeconds: 7200,
    templateId: "tpl_2",
  });
  // Stade 3 — HTML vide (hasContent=false).
  store.templates.push({
    id: "tpl_3",
    name: "Stade 3",
    subject: "Sujet stade 3",
    html: "",
    images: [],
  });
  stages.push({
    id: "s3",
    tenantId: TENANT_ID,
    stageIndex: 3,
    delaySeconds: 86400,
    templateId: "tpl_3",
  });
}

describe("listStagesForScenario", () => {
  it("retourne les stades ABANDONED_CART triés par stageIndex croissant", async () => {
    seedStagesFor("ABANDONED_CART");
    const res = await listStagesForScenario("ABANDONED_CART");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.stages).toHaveLength(3);
    expect(res.stages.map((s) => s.stageIndex)).toEqual([1, 2, 3]);
  });

  it("détecte hasContent=false quand le HTML source est vide", async () => {
    seedStagesFor("ABANDONED_CART");
    const res = await listStagesForScenario("ABANDONED_CART");
    if (!res.success) throw new Error("expected success");
    const s3 = res.stages.find((s) => s.stageIndex === 3)!;
    expect(s3.hasContent).toBe(false);
  });

  it("détecte hasUnsubscribeToken=false quand {unsubscribeLink} manque du HTML", async () => {
    seedStagesFor("ABANDONED_CART");
    const res = await listStagesForScenario("ABANDONED_CART");
    if (!res.success) throw new Error("expected success");
    const s1 = res.stages.find((s) => s.stageIndex === 1)!;
    const s2 = res.stages.find((s) => s.stageIndex === 2)!;
    expect(s1.hasUnsubscribeToken).toBe(true);
    expect(s2.hasUnsubscribeToken).toBe(false);
  });

  it("retourne aussi la liste pour INACTIVE_CLIENT", async () => {
    seedStagesFor("INACTIVE_CLIENT");
    const res = await listStagesForScenario("INACTIVE_CLIENT");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.stages).toHaveLength(3);
  });
});

describe("sendManualMail — filets serveur", () => {
  it("refuse RESTOCK avec un message « en construction »", async () => {
    const res = await sendManualMail("user_1", "RESTOCK", { stageIndex: 1 });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/en cours de finalisation/i);
  });

  it("refuse NEWSLETTER (passe par une autre modale)", async () => {
    const res = await sendManualMail("user_1", "NEWSLETTER");
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/modale/i);
  });

  it("refuse ABANDONED_CART sans stageIndex", async () => {
    const res = await sendManualMail("user_1", "ABANDONED_CART");
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/stade/i);
  });

  it("refuse INACTIVE_CLIENT avec stageIndex hors config", async () => {
    seedStagesFor("INACTIVE_CLIENT");
    // Client actif il y a 40 jours → passe le gate INACTIVE_CLIENT (≥ 15 j),
    // pour qu'on atteigne bien la vérif « stade 99 inexistant » plus loin.
    const inactiveSince = new Date(Date.now() - 40 * 86400_000);
    const prisma = (await import("@/lib/prisma")).prisma as unknown as {
      user: { findFirst: ReturnType<typeof vi.fn> };
      order: { count: ReturnType<typeof vi.fn> };
    };
    prisma.user.findFirst.mockImplementation(async () => ({
      id: "user_1",
      email: "u@test.com",
      firstName: "Marie",
      lastName: "Test",
      company: "",
      lastLoginAt: inactiveSince,
      lastSeenAt: inactiveSince,
      acceptsNewsletter: true,
      status: "APPROVED",
    }));
    // Le gate INACTIVE_CLIENT exige ≥ 1 commande passée (pas un prospect).
    prisma.order.count.mockImplementation(async () => 1);
    const res = await sendManualMail("user_1", "INACTIVE_CLIENT", { stageIndex: 99 });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/Stade 99|configuré/i);
  });
});
