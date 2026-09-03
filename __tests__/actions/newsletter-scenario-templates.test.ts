import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests des actions scénario (assign / reset / seed lazy / delete refus).
 * Mock complet de `prisma.newsletterTemplate` avec un store en mémoire.
 */

const TENANT_ID = "tenant_bj";
const OTHER_TENANT_ID = "tenant_issy";

interface Row {
  id: string;
  tenantId: string;
  name: string;
  subject: string;
  blocks: unknown;
  scenarioKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSentAt: Date | null;
}

const store: { rows: Row[]; nextId: number } = { rows: [], nextId: 1 };

function makeRow(data: Partial<Row>): Row {
  const now = new Date();
  return {
    id: `row_${store.nextId++}`,
    tenantId: TENANT_ID,
    name: "Untitled",
    subject: "",
    blocks: [],
    scenarioKey: null,
    createdAt: now,
    updatedAt: now,
    lastSentAt: null,
    ...data,
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    newsletterTemplate: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.rows.find((r) => {
            if (where?.id && r.id !== where.id) return false;
            if (where?.tenantId && r.tenantId !== where.tenantId) return false;
            if (where?.scenarioKey !== undefined && r.scenarioKey !== where.scenarioKey) return false;
            return true;
          }) ?? null
        );
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.rows.filter((r) => {
          if (where?.tenantId && r.tenantId !== where.tenantId) return false;
          if (where?.scenarioKey?.in && !where.scenarioKey.in.includes(r.scenarioKey)) return false;
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
        // Simule contrainte @@unique(tenantId, scenarioKey)
        if (data.scenarioKey) {
          const dup = store.rows.find(
            (r) => r.tenantId === data.tenantId && r.scenarioKey === data.scenarioKey,
          );
          if (dup) throw new Error("Unique constraint violated");
        }
        const row = makeRow(data);
        store.rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = store.rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        row.updatedAt = new Date();
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of store.rows) {
          if (where?.tenantId && r.tenantId !== where.tenantId) continue;
          if (where?.scenarioKey && r.scenarioKey !== where.scenarioKey) continue;
          if (where?.id?.not && r.id === where.id.not) continue;
          Object.assign(r, data);
          count++;
        }
        return { count };
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = store.rows.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error("not found");
        return store.rows.splice(idx, 1)[0];
      }),
    },
    $transaction: vi.fn(async (fn: any) => {
      // Transaction simplifiée : réutilise le même mock
      return fn({
        newsletterTemplate: {
          updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const r of store.rows) {
              if (where?.tenantId && r.tenantId !== where.tenantId) continue;
              if (where?.scenarioKey && r.scenarioKey !== where.scenarioKey) continue;
              if (where?.id?.not && r.id === where.id.not) continue;
              Object.assign(r, data);
              count++;
            }
            return { count };
          }),
          update: vi.fn(async ({ where, data }: any) => {
            const row = store.rows.find((r) => r.id === where.id);
            if (!row) throw new Error("not found");
            Object.assign(row, data);
            return row;
          }),
        },
      });
    }),
  },
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin_1", role: "ADMIN" } },
    tenant: { id: TENANT_ID, slug: "bj", name: "BJ" },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  listNewsletterTemplates,
  assignTemplateToScenario,
  resetScenarioTemplateToDefault,
  deleteNewsletterTemplate,
  duplicateNewsletterTemplate,
  getScenarioTemplate,
} from "@/app/actions/admin/newsletter-templates";
import { SCENARIO_DEFAULTS } from "@/lib/mail-scenario-defaults";

beforeEach(() => {
  store.rows = [];
  store.nextId = 1;
});

describe("seed lazy des 3 modèles scénario", () => {
  it("listNewsletterTemplates crée les 3 modèles par défaut s'ils manquent", async () => {
    expect(store.rows.length).toBe(0);
    const list = await listNewsletterTemplates();
    // Les 3 scénarios sont créés
    const scenarios = list.map((t) => t.scenarioKey).filter(Boolean).sort();
    expect(scenarios).toEqual(["ABANDONED_CART", "INACTIVE_CLIENT", "RESTOCK"]);
    expect(list.length).toBe(3);
  });

  it("seed idempotent : appeler 2× n'en crée pas 6", async () => {
    await listNewsletterTemplates();
    await listNewsletterTemplates();
    expect(store.rows.length).toBe(3);
  });

  it("seed n'affecte que le tenant courant", async () => {
    // Ajout d'un modèle scénario pour un autre tenant
    store.rows.push(
      makeRow({
        tenantId: OTHER_TENANT_ID,
        name: "Autre tenant",
        scenarioKey: "ABANDONED_CART",
      }),
    );
    await listNewsletterTemplates();
    // 3 nouveaux pour TENANT_ID + le 1 pour OTHER_TENANT_ID = 4
    expect(store.rows.length).toBe(4);
    const bjScenarios = store.rows
      .filter((r) => r.tenantId === TENANT_ID)
      .map((r) => r.scenarioKey)
      .filter(Boolean)
      .sort();
    expect(bjScenarios).toEqual(["ABANDONED_CART", "INACTIVE_CLIENT", "RESTOCK"]);
  });
});

describe("assignTemplateToScenario", () => {
  it("déplace le lien scénario d'un modèle à un autre", async () => {
    // Seed initial (3 scénarios) + création d'un modèle libre
    await listNewsletterTemplates();
    const initial = store.rows.find((r) => r.scenarioKey === "ABANDONED_CART")!;
    const free = makeRow({ name: "Mon modèle", scenarioKey: null });
    store.rows.push(free);

    const res = await assignTemplateToScenario(free.id, "ABANDONED_CART");
    expect(res.success).toBe(true);

    const updatedFree = store.rows.find((r) => r.id === free.id)!;
    const updatedOld = store.rows.find((r) => r.id === initial.id)!;
    expect(updatedFree.scenarioKey).toBe("ABANDONED_CART");
    expect(updatedOld.scenarioKey).toBeNull();
  });

  it("no-op si le modèle est déjà assigné à ce scénario", async () => {
    await listNewsletterTemplates();
    const t = store.rows.find((r) => r.scenarioKey === "RESTOCK")!;
    const res = await assignTemplateToScenario(t.id, "RESTOCK");
    expect(res.success).toBe(true);
    expect(store.rows.filter((r) => r.scenarioKey === "RESTOCK").length).toBe(1);
  });

  it("refuse un templateId inconnu", async () => {
    const res = await assignTemplateToScenario("does_not_exist", "RESTOCK");
    expect(res.success).toBe(false);
  });
});

describe("deleteNewsletterTemplate", () => {
  it("refuse la suppression d'un modèle lié à un scénario", async () => {
    await listNewsletterTemplates();
    const scenario = store.rows.find((r) => r.scenarioKey === "ABANDONED_CART")!;
    const res = await deleteNewsletterTemplate(scenario.id);
    expect(res.success).toBe(false);
    // Le message doit expliquer la raison
    if (!res.success) {
      expect(res.error).toMatch(/mail automatique/i);
    }
    // Rien supprimé
    expect(store.rows.find((r) => r.id === scenario.id)).toBeDefined();
  });

  it("autorise la suppression d'un modèle libre", async () => {
    const free = makeRow({ name: "libre" });
    store.rows.push(free);
    const res = await deleteNewsletterTemplate(free.id);
    expect(res.success).toBe(true);
    expect(store.rows.find((r) => r.id === free.id)).toBeUndefined();
  });
});

describe("resetScenarioTemplateToDefault", () => {
  it("remplace subject + blocks par le design d'origine mais garde le nom", async () => {
    await listNewsletterTemplates();
    const t = store.rows.find((r) => r.scenarioKey === "RESTOCK")!;
    // La cliente a customisé
    t.name = "Ma version perso";
    t.subject = "Sujet perso";
    t.blocks = [];
    const res = await resetScenarioTemplateToDefault("RESTOCK");
    expect(res.success).toBe(true);
    const after = store.rows.find((r) => r.id === t.id)!;
    expect(after.name).toBe("Ma version perso"); // nom préservé
    expect(after.subject).toBe(SCENARIO_DEFAULTS.RESTOCK.subject);
    expect(Array.isArray(after.blocks)).toBe(true);
    expect((after.blocks as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("duplicateNewsletterTemplate", () => {
  it("la copie n'hérite jamais du scenarioKey de la source", async () => {
    await listNewsletterTemplates();
    const source = store.rows.find((r) => r.scenarioKey === "INACTIVE_CLIENT")!;
    const res = await duplicateNewsletterTemplate(source.id);
    expect(res.success).toBe(true);
    if (res.success) {
      const copy = store.rows.find((r) => r.id === res.id)!;
      expect(copy.scenarioKey).toBeNull();
      expect(copy.name).toContain("(copie)");
    }
  });
});

describe("getScenarioTemplate", () => {
  it("retourne le modèle actif du scénario", async () => {
    await listNewsletterTemplates();
    const t = await getScenarioTemplate(TENANT_ID, "ABANDONED_CART");
    expect(t.scenarioKey).toBe("ABANDONED_CART");
    expect(t.blocks.length).toBeGreaterThan(0);
  });

  it("crée le défaut si absent puis le retourne", async () => {
    expect(store.rows.length).toBe(0);
    const t = await getScenarioTemplate(TENANT_ID, "RESTOCK");
    expect(t.scenarioKey).toBe("RESTOCK");
    expect(store.rows.length).toBe(3); // seed lazy crée les 3
  });
});
