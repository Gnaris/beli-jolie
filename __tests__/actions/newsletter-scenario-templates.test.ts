import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests des actions scénario (assign / reset / seed lazy / delete refus /
 * getScenarioAssignTargets). Mock complet de `prisma.newsletterTemplate` avec
 * un store en mémoire, mock des helpers FS (copie/list/delete).
 */

const TENANT_ID = "tenant_bj";
const OTHER_TENANT_ID = "tenant_issy";

interface Row {
  id: string;
  tenantId: string;
  name: string;
  subject: string;
  format: string;
  html: string | null;
  blocks: unknown;
  scenarioKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSentAt: Date | null;
}

interface StageRow {
  id: string;
  tenantId: string;
  stageIndex: number;
  delaySeconds: number;
  templateId: string;
}

interface ImageRow {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  path: string;
  alt: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

const store: {
  rows: Row[];
  stages: StageRow[];
  inactiveStages: StageRow[];
  images: ImageRow[];
  nextId: number;
} = {
  rows: [],
  stages: [],
  inactiveStages: [],
  images: [],
  nextId: 1,
};

function makeRow(data: Partial<Row>): Row {
  const now = new Date();
  return {
    id: `row_${store.nextId++}`,
    tenantId: TENANT_ID,
    name: "Untitled",
    subject: "",
    format: "html",
    html: null,
    blocks: [],
    scenarioKey: null,
    createdAt: now,
    updatedAt: now,
    lastSentAt: null,
    ...data,
  };
}

/**
 * HTML source valide pour tous les scénarios : contient les 4 tokens marketing
 * + toutes les boucles/variables scénario (cart/favorites/days). Comme ça un
 * même string peut être copié sur n'importe quel scénario sans faux positif.
 */
const VALID_MULTI_SCENARIO_HTML = `
  <html>
    <body>
      <p>{shopName} · {shopAddress}</p>
      <p><a href="{unsubscribeLink}">Se désinscrire</a></p>
      <p><a href="{privacyLink}">Confidentialité</a></p>
      {{#each cart}}<div>{name} — {qty} × {total} — {image}</div>{{/each}}
      {{#each favorites}}<div>{name} — {price} — {image}</div>{{/each}}
      <p>Inactif depuis {days} jours.</p>
    </body>
  </html>
`;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    abandonedCartStage: {
      findMany: vi.fn(async ({ where, orderBy, select }: any) => {
        void select;
        let rows = store.stages.filter((s) => {
          if (where?.tenantId && s.tenantId !== where.tenantId) return false;
          if (where?.stageIndex?.gte !== undefined && s.stageIndex < where.stageIndex.gte) return false;
          return true;
        });
        if (orderBy?.stageIndex === "asc") {
          rows = [...rows].sort((a, b) => a.stageIndex - b.stageIndex);
        }
        return rows.map((s) => {
          const tpl = store.rows.find((r) => r.id === s.templateId);
          return {
            id: s.id,
            stageIndex: s.stageIndex,
            delaySeconds: s.delaySeconds,
            templateId: s.templateId,
            template: tpl ? { id: tpl.id, name: tpl.name } : null,
          };
        });
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const s = store.stages.find((s) => {
          if (where?.id && s.id !== where.id) return false;
          if (where?.templateId && s.templateId !== where.templateId) return false;
          if (where?.tenantId && s.tenantId !== where.tenantId) return false;
          if (where?.stageIndex !== undefined && s.stageIndex !== where.stageIndex) return false;
          return true;
        });
        return s ?? null;
      }),
    },
    inactiveClientStage: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        let rows = store.inactiveStages.filter((s) => {
          if (where?.tenantId && s.tenantId !== where.tenantId) return false;
          if (where?.stageIndex?.gte !== undefined && s.stageIndex < where.stageIndex.gte) return false;
          return true;
        });
        if (orderBy?.stageIndex === "asc") {
          rows = [...rows].sort((a, b) => a.stageIndex - b.stageIndex);
        }
        return rows.map((s) => {
          const tpl = store.rows.find((r) => r.id === s.templateId);
          return {
            id: s.id,
            stageIndex: s.stageIndex,
            delaySeconds: s.delaySeconds,
            templateId: s.templateId,
            template: tpl ? { id: tpl.id, name: tpl.name } : null,
          };
        });
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const s = store.inactiveStages.find((s) => {
          if (where?.id && s.id !== where.id) return false;
          if (where?.templateId && s.templateId !== where.templateId) return false;
          if (where?.tenantId && s.tenantId !== where.tenantId) return false;
          if (where?.stageIndex !== undefined && s.stageIndex !== where.stageIndex) return false;
          return true;
        });
        return s ?? null;
      }),
    },
    newsletterTemplate: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const row = store.rows.find((r) => {
          if (where?.id && r.id !== where.id) return false;
          if (where?.tenantId && r.tenantId !== where.tenantId) return false;
          if (where?.scenarioKey !== undefined && r.scenarioKey !== where.scenarioKey) return false;
          return true;
        });
        if (!row) return null;
        if (include?.images) {
          return {
            ...row,
            images: store.images.filter((i) => i.templateId === row.id),
          };
        }
        return row;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.rows.filter((r) => {
          if (where?.tenantId && r.tenantId !== where.tenantId) return false;
          if (where?.scenarioKey?.in && !where.scenarioKey.in.includes(r.scenarioKey)) return false;
          if (where?.id?.notIn && where.id.notIn.includes(r.id)) return false;
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
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
    newsletterTemplateImage: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = store.images.length;
        store.images = store.images.filter((i) => i.templateId !== where.templateId);
        return { count: before - store.images.length };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        for (const img of data) {
          store.images.push({ id: `img_${store.nextId++}`, ...img });
        }
        return { count: data.length };
      }),
    },
    $transaction: vi.fn(async (fn: any) => {
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
        newsletterTemplateImage: {
          deleteMany: vi.fn(async ({ where }: any) => {
            const before = store.images.length;
            store.images = store.images.filter((i) => i.templateId !== where.templateId);
            return { count: before - store.images.length };
          }),
          createMany: vi.fn(async ({ data }: any) => {
            for (const img of data) {
              store.images.push({ id: `img_${store.nextId++}`, ...img });
            }
            return { count: data.length };
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

// Mock du storage — on ne veut pas toucher au FS dans les tests.
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    copyFile: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => []),
    deleteFiles: vi.fn(async () => undefined),
    deleteFile: vi.fn(async () => undefined),
  };
});

import {
  listNewsletterTemplates,
  assignTemplateToScenario,
  getScenarioAssignTargets,
  resetScenarioTemplateToDefault,
  deleteNewsletterTemplate,
  duplicateNewsletterTemplate,
  getScenarioTemplate,
} from "@/app/actions/admin/newsletter-templates";

beforeEach(() => {
  store.rows = [];
  store.stages = [];
  store.inactiveStages = [];
  store.images = [];
  store.nextId = 1;
});

// ─── Helper : seed initial complet (3 scénarios + Stage 1 PA + Stage 1 IC) ───
async function seedScenarios() {
  await listNewsletterTemplates();
  const ac = store.rows.find((r) => r.scenarioKey === "ABANDONED_CART")!;
  const ic = store.rows.find((r) => r.scenarioKey === "INACTIVE_CLIENT")!;
  store.stages.push({
    id: "ac_s1",
    tenantId: TENANT_ID,
    stageIndex: 1,
    delaySeconds: 86400,
    templateId: ac.id,
  });
  store.inactiveStages.push({
    id: "ic_s1",
    tenantId: TENANT_ID,
    stageIndex: 1,
    delaySeconds: 30 * 86400,
    templateId: ic.id,
  });
  return { ac, ic };
}

describe("seed lazy des 3 modèles scénario", () => {
  it("listNewsletterTemplates crée les 3 modèles par défaut s'ils manquent", async () => {
    expect(store.rows.length).toBe(0);
    const list = await listNewsletterTemplates();
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
    store.rows.push(
      makeRow({
        tenantId: OTHER_TENANT_ID,
        name: "Autre tenant",
        scenarioKey: "ABANDONED_CART",
      }),
    );
    await listNewsletterTemplates();
    expect(store.rows.length).toBe(4);
    const bjScenarios = store.rows
      .filter((r) => r.tenantId === TENANT_ID)
      .map((r) => r.scenarioKey)
      .filter(Boolean)
      .sort();
    expect(bjScenarios).toEqual(["ABANDONED_CART", "INACTIVE_CLIENT", "RESTOCK"]);
  });
});

describe("assignTemplateToScenario — RESTOCK (1 seule cible)", () => {
  it("copie le HTML + sujet dans le mail auto sans changer son nom ni son scenarioKey", async () => {
    await seedScenarios();
    const restock = store.rows.find((r) => r.scenarioKey === "RESTOCK")!;
    const originalName = restock.name;

    const source = makeRow({
      name: "Ma nouvelle promo",
      subject: "Découvrez ceci",
      html: VALID_MULTI_SCENARIO_HTML,
    });
    store.rows.push(source);

    const res = await assignTemplateToScenario(source.id, { scenario: "RESTOCK" });
    expect(res.success).toBe(true);

    const after = store.rows.find((r) => r.id === restock.id)!;
    // Nom préservé — c'est LE point essentiel du fix (incident 2026-09-28).
    expect(after.name).toBe(originalName);
    // scenarioKey préservé — la tuile "RESTOCK" pointe toujours ici.
    expect(after.scenarioKey).toBe("RESTOCK");
    // Contenu copié.
    expect(after.html).toBe(VALID_MULTI_SCENARIO_HTML);
    expect(after.subject).toBe("Découvrez ceci");
    // Source intacte, toujours libre.
    const sourceAfter = store.rows.find((r) => r.id === source.id)!;
    expect(sourceAfter.name).toBe("Ma nouvelle promo");
    expect(sourceAfter.scenarioKey).toBeNull();
  });

  it("refuse la copie si le HTML source manque une variable marketing obligatoire", async () => {
    await seedScenarios();
    const source = makeRow({
      name: "Modèle incomplet",
      html: "<p>Pas de shopName ni unsubscribeLink</p>",
    });
    store.rows.push(source);

    const res = await assignTemplateToScenario(source.id, { scenario: "RESTOCK" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/variables obligatoires/i);
      expect(res.missingVariables?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("refuse un templateId source inconnu", async () => {
    await seedScenarios();
    const res = await assignTemplateToScenario("does_not_exist", { scenario: "RESTOCK" });
    expect(res.success).toBe(false);
  });
});

describe("assignTemplateToScenario — ABANDONED_CART (multi-stades)", () => {
  it("copie le contenu vers le stade choisi, préserve le nom du stade", async () => {
    const { ac } = await seedScenarios();
    const originalStageName = ac.name;

    const source = makeRow({
      name: "Panier abandonné v2",
      subject: "Nouveau sujet",
      html: VALID_MULTI_SCENARIO_HTML,
    });
    store.rows.push(source);

    const res = await assignTemplateToScenario(source.id, {
      scenario: "ABANDONED_CART",
      stageId: "ac_s1",
    });
    expect(res.success).toBe(true);

    const after = store.rows.find((r) => r.id === ac.id)!;
    expect(after.name).toBe(originalStageName); // nom stade préservé
    expect(after.scenarioKey).toBe("ABANDONED_CART"); // tag stable
    expect(after.html).toBe(VALID_MULTI_SCENARIO_HTML);
    expect(after.subject).toBe("Nouveau sujet");
  });

  it("refuse un stageId inconnu", async () => {
    await seedScenarios();
    const source = makeRow({
      name: "OK",
      html: VALID_MULTI_SCENARIO_HTML,
    });
    store.rows.push(source);
    const res = await assignTemplateToScenario(source.id, {
      scenario: "ABANDONED_CART",
      stageId: "unknown_stage",
    });
    expect(res.success).toBe(false);
  });
});

describe("auto-réparation du drift scenarioKey (incident Issyma 2026-09-28)", () => {
  it("resynchronise scenarioKey ABANDONED_CART sur le template Stage 1 réel", async () => {
    // Reproduit l'état cassé : Stage 1 pointe vers un template SANS le tag,
    // et un autre template libre porte le tag par erreur.
    const realStage1 = makeRow({ name: "Panier abandonné (vrai)", scenarioKey: null });
    const orphanWithTag = makeRow({
      name: "PANiER abandonnéeO",
      scenarioKey: "ABANDONED_CART",
    });
    store.rows.push(realStage1, orphanWithTag);
    store.stages.push({
      id: "ac_s1",
      tenantId: TENANT_ID,
      stageIndex: 1,
      delaySeconds: 86400,
      templateId: realStage1.id,
    });

    await listNewsletterTemplates();

    // Tag remis sur le VRAI Stage 1.
    expect(store.rows.find((r) => r.id === realStage1.id)!.scenarioKey).toBe("ABANDONED_CART");
    // Le template orphelin perd son tag → redevient un modèle libre.
    expect(store.rows.find((r) => r.id === orphanWithTag.id)!.scenarioKey).toBeNull();
  });

  it("ne touche à rien si le tag est déjà sur le bon template", async () => {
    const stage1 = makeRow({ name: "OK", scenarioKey: "ABANDONED_CART" });
    store.rows.push(stage1);
    store.stages.push({
      id: "ac_s1",
      tenantId: TENANT_ID,
      stageIndex: 1,
      delaySeconds: 86400,
      templateId: stage1.id,
    });

    await listNewsletterTemplates();

    expect(store.rows.find((r) => r.id === stage1.id)!.scenarioKey).toBe("ABANDONED_CART");
  });
});

describe("getScenarioAssignTargets", () => {
  it("RESTOCK → 1 cible (le mail auto)", async () => {
    await seedScenarios();
    const res = await getScenarioAssignTargets("RESTOCK");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.targets.length).toBe(1);
      expect(res.targets[0].scenario).toBe("RESTOCK");
      expect(res.targets[0].stageId).toBeNull();
    }
  });

  it("ABANDONED_CART → N cibles (une par stade)", async () => {
    await seedScenarios();
    // Ajoute un stade 2
    const stage2Tpl = makeRow({ name: "Panier abandonné — Stade 2" });
    store.rows.push(stage2Tpl);
    store.stages.push({
      id: "ac_s2",
      tenantId: TENANT_ID,
      stageIndex: 2,
      delaySeconds: 172800,
      templateId: stage2Tpl.id,
    });

    const res = await getScenarioAssignTargets("ABANDONED_CART");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.targets.length).toBe(2);
      expect(res.targets[0].stageIndex).toBe(1);
      expect(res.targets[1].stageIndex).toBe(2);
      expect(res.targets[0].label).toBe("Stade 1");
      expect(res.targets[1].label).toBe("Stade 2");
    }
  });
});

describe("deleteNewsletterTemplate", () => {
  it("refuse la suppression d'un modèle lié à un scénario", async () => {
    await listNewsletterTemplates();
    const scenario = store.rows.find((r) => r.scenarioKey === "ABANDONED_CART")!;
    const res = await deleteNewsletterTemplate(scenario.id);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/mail automatique/i);
    expect(store.rows.find((r) => r.id === scenario.id)).toBeDefined();
  });

  it("autorise la suppression d'un modèle libre", async () => {
    const free = makeRow({ name: "libre" });
    store.rows.push(free);
    const res = await deleteNewsletterTemplate(free.id);
    expect(res.success).toBe(true);
    expect(store.rows.find((r) => r.id === free.id)).toBeUndefined();
  });

  it("refuse la suppression d'un modèle lié à un stade panier abandonné", async () => {
    const stageTemplate = makeRow({ name: "Panier abandonné — Stade 2" });
    store.rows.push(stageTemplate);
    store.stages.push({
      id: "stage_2",
      tenantId: TENANT_ID,
      stageIndex: 2,
      delaySeconds: 172800,
      templateId: stageTemplate.id,
    });
    const res = await deleteNewsletterTemplate(stageTemplate.id);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/Stade 2/i);
      expect(res.error).toMatch(/panier abandonn/i);
    }
    expect(store.rows.find((r) => r.id === stageTemplate.id)).toBeDefined();
  });
});

describe("listNewsletterTemplates : cache les templates de stades panier abandonné", () => {
  it("exclut les templates liés à un AbandonedCartStage stageIndex ≥ 2", async () => {
    const stage2Template = makeRow({ name: "Panier abandonné — Stade 2" });
    const stage3Template = makeRow({ name: "Panier abandonné — Stade 3" });
    const freeTemplate = makeRow({ name: "Ma newsletter promo" });
    store.rows.push(stage2Template, stage3Template, freeTemplate);
    store.stages.push(
      { id: "s2", tenantId: TENANT_ID, stageIndex: 2, delaySeconds: 172800, templateId: stage2Template.id },
      { id: "s3", tenantId: TENANT_ID, stageIndex: 3, delaySeconds: 259200, templateId: stage3Template.id },
    );

    const list = await listNewsletterTemplates();
    const returnedIds = list.map((t) => t.id);
    expect(returnedIds).toContain(freeTemplate.id);
    expect(returnedIds).not.toContain(stage2Template.id);
    expect(returnedIds).not.toContain(stage3Template.id);
    const scenarioTemplates = list.filter((t) => t.scenarioKey === "ABANDONED_CART");
    expect(scenarioTemplates.length).toBe(1);
  });

  it("garde le template du Stade 1 (scenarioKey ABANDONED_CART) même si un stade y pointe", async () => {
    await listNewsletterTemplates();
    const stage1Template = store.rows.find((r) => r.scenarioKey === "ABANDONED_CART")!;
    store.stages.push({
      id: "s1",
      tenantId: TENANT_ID,
      stageIndex: 1,
      delaySeconds: 86400,
      templateId: stage1Template.id,
    });
    const list = await listNewsletterTemplates();
    expect(list.find((t) => t.id === stage1Template.id)).toBeDefined();
  });
});

describe("resetScenarioTemplateToDefault", () => {
  it("remplace subject + html par le design d'origine mais garde le nom", async () => {
    await listNewsletterTemplates();
    const t = store.rows.find((r) => r.scenarioKey === "RESTOCK")!;
    t.name = "Ma version perso";
    t.subject = "Sujet perso";
    t.html = "<p>version perso</p>";
    const res = await resetScenarioTemplateToDefault("RESTOCK");
    expect(res.success).toBe(true);
    const after = store.rows.find((r) => r.id === t.id)!;
    expect(after.name).toBe("Ma version perso");
    expect(after.subject).not.toBe("Sujet perso");
    expect(after.html).not.toBe("<p>version perso</p>");
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
  });

  it("crée le défaut si absent puis le retourne", async () => {
    expect(store.rows.length).toBe(0);
    const t = await getScenarioTemplate(TENANT_ID, "RESTOCK");
    expect(t.scenarioKey).toBe("RESTOCK");
    expect(store.rows.length).toBe(3);
  });
});
