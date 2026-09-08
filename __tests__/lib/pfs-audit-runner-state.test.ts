/**
 * Tests unitaires : combinaison state SiteConfig + résultats PfsAuditResult.
 *
 * Depuis 2026-07-28, l'audit ne stocke plus les écarts dans SiteConfig (qui
 * plafonne à 64 Ko de TEXT — planté sur Issyma à 125/645 produits). Les
 * compteurs restent en SiteConfig ; les écarts vivent dans PfsAuditResult
 * (une ligne par écart). On vérifie que `getPfsAuditState` recompose bien
 * la forme historique `PfsAuditState` attendue par le drawer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstSiteConfig = vi.fn();
const upsertSiteConfig = vi.fn();
const deleteSiteConfig = vi.fn();
const findManyResults = vi.fn();
const updateManyResults = vi.fn();
const countResults = vi.fn();
const deleteManyResults = vi.fn();
const updateManyRuns = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findFirst: (...args: unknown[]) => findFirstSiteConfig(...args),
      upsert: (...args: unknown[]) => upsertSiteConfig(...args),
      delete: (...args: unknown[]) => deleteSiteConfig(...args),
    },
    pfsAuditResult: {
      findMany: (...args: unknown[]) => findManyResults(...args),
      updateMany: (...args: unknown[]) => updateManyResults(...args),
      count: (...args: unknown[]) => countResults(...args),
      deleteMany: (...args: unknown[]) => deleteManyResults(...args),
    },
    pfsAuditRun: {
      updateMany: (...args: unknown[]) => updateManyRuns(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/tenant-als", () => ({
  tenantALS: { run: (_tid: string, fn: () => unknown) => fn() },
}));

vi.mock("@/lib/pfs-verify", () => ({
  verifyPfsProduct: vi.fn(),
  loadPfsVerifyContext: vi.fn(),
}));

import {
  getPfsAuditState,
  dismissAuditResults,
  hardStopPfsAudit,
} from "@/lib/pfs-audit-runner";

beforeEach(() => {
  findFirstSiteConfig.mockReset();
  upsertSiteConfig.mockReset();
  deleteSiteConfig.mockReset();
  findManyResults.mockReset();
  updateManyResults.mockReset();
  countResults.mockReset();
  deleteManyResults.mockReset();
  updateManyRuns.mockReset();
});

describe("getPfsAuditState", () => {
  it("retourne EMPTY quand SiteConfig est vide", async () => {
    findFirstSiteConfig.mockResolvedValue(null);
    findManyResults.mockResolvedValue([]);

    const state = await getPfsAuditState("t1");

    expect(state.status).toBe("IDLE");
    expect(state.total).toBe(0);
    expect(state.results).toEqual([]);
    // On ne query PAS PfsAuditResult si auditRunId est null (économie BDD).
    expect(findManyResults).not.toHaveBeenCalled();
  });

  it("combine compteurs SiteConfig + rangs PfsAuditResult pour un audit en cours", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "RUNNING",
        auditRunId: "run-abc",
        startedAt: 1000,
        finishedAt: null,
        total: 645,
        processed: 125,
        okCount: 46,
        diffCount: 2,
        errorCount: 0,
      }),
    });
    findManyResults.mockResolvedValue([
      {
        ok: true,
        productId: "p1",
        reference: "REF-1",
        name: "Bague dorée",
        firstImage: "/uploads/x.webp",
        issues: [{ scope: "product", field: "name", fieldLabel: "Nom" }],
        errorMessage: null,
        errorKind: null,
      },
      {
        ok: false,
        productId: "p2",
        reference: "REF-2",
        name: "Collier",
        firstImage: null,
        issues: null,
        errorMessage: "PFS 404",
        errorKind: "pfs_unreachable",
      },
    ]);

    const state = await getPfsAuditState("t1");

    expect(state.status).toBe("RUNNING");
    expect(state.total).toBe(645);
    expect(state.processed).toBe(125);
    expect(state.okCount).toBe(46);
    expect(state.results).toHaveLength(2);

    const diff = state.results[0];
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.reference).toBe("REF-1");
      expect(diff.issues).toEqual([{ scope: "product", field: "name", fieldLabel: "Nom" }]);
    }

    const err = state.results[1];
    expect(err.ok).toBe(false);
    if (!err.ok) {
      expect(err.error).toBe("PFS 404");
      expect(err.errorKind).toBe("pfs_unreachable");
    }

    // Scope multi-tenant + par run + exclusion des cartes dismissed.
    expect(findManyResults).toHaveBeenCalledWith({
      where: { tenantId: "t1", auditRunId: "run-abc", dismissedAt: null },
      orderBy: { createdAt: "asc" },
    });
  });

  it("ignore un ancien payload contenant results[] inline (compat)", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "ERROR",
        auditRunId: null,
        startedAt: 1000,
        finishedAt: 2000,
        total: 645,
        processed: 125,
        okCount: 46,
        diffCount: 79,
        errorCount: 0,
        errorMessage: "value too long",
        // Ancien format : ne doit pas casser le parse ni polluer results.
        results: [{ ok: true, productId: "old", reference: "OLD", name: "x", firstImage: null, issues: [] }],
      }),
    });

    const state = await getPfsAuditState("t1");

    expect(state.status).toBe("ERROR");
    expect(state.errorMessage).toBe("value too long");
    expect(state.results).toEqual([]);
    expect(findManyResults).not.toHaveBeenCalled();
  });

  it("retourne un errorKind par défaut si null en BDD", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "DONE",
        auditRunId: "run-x",
        startedAt: 1,
        finishedAt: 2,
        total: 1,
        processed: 1,
        okCount: 0,
        diffCount: 0,
        errorCount: 1,
      }),
    });
    findManyResults.mockResolvedValue([
      {
        ok: false,
        productId: "p1",
        reference: "R",
        name: "N",
        firstImage: null,
        issues: null,
        errorMessage: null,
        errorKind: null,
      },
    ]);

    const state = await getPfsAuditState("t1");
    const err = state.results[0];
    expect(err.ok).toBe(false);
    if (!err.ok) {
      expect(err.error).toBe("");
      expect(err.errorKind).toBe("unknown");
    }
  });

  it("filtre les résultats dismissedAt lors du fetch (ne ressuscite pas les cartes ignorées au refresh)", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "DONE",
        auditRunId: "run-y",
        startedAt: 1,
        finishedAt: 2,
        total: 3,
        processed: 3,
        okCount: 0,
        diffCount: 3,
        errorCount: 0,
      }),
    });
    findManyResults.mockResolvedValue([]);

    await getPfsAuditState("t1");

    expect(findManyResults).toHaveBeenCalledWith({
      where: { tenantId: "t1", auditRunId: "run-y", dismissedAt: null },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("dismissAuditResults", () => {
  it("marque dismissedAt sur les productIds passés et renvoie le reste", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "DONE",
        auditRunId: "run-z",
        startedAt: 1,
        finishedAt: 2,
        total: 5,
        processed: 5,
        okCount: 0,
        diffCount: 5,
        errorCount: 0,
      }),
    });
    updateManyResults.mockResolvedValue({ count: 2 });
    // 3 cartes encore visibles après le dismiss.
    countResults.mockResolvedValue(3);

    const result = await dismissAuditResults("t1", ["p1", "p2"]);

    expect(result).toEqual({ remaining: 3, autoReset: false });
    expect(updateManyResults).toHaveBeenCalledWith({
      where: {
        tenantId: "t1",
        auditRunId: "run-z",
        productId: { in: ["p1", "p2"] },
        dismissedAt: null,
      },
      data: { dismissedAt: expect.any(Date) },
    });
    // Pas de reset : il reste des cartes.
    expect(deleteManyResults).not.toHaveBeenCalled();
    expect(upsertSiteConfig).not.toHaveBeenCalled();
  });

  it("auto-reset l'audit quand toutes les cartes sont dismissed et l'audit est terminé", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "DONE",
        auditRunId: "run-w",
        startedAt: 1,
        finishedAt: 2,
        total: 2,
        processed: 2,
        okCount: 0,
        diffCount: 2,
        errorCount: 0,
      }),
    });
    updateManyResults.mockResolvedValue({ count: 2 });
    countResults.mockResolvedValue(0);
    upsertSiteConfig.mockResolvedValue({});
    deleteSiteConfig.mockResolvedValue({});
    deleteManyResults.mockResolvedValue({ count: 0 });

    const result = await dismissAuditResults("t1", ["p1", "p2"]);

    expect(result).toEqual({ remaining: 0, autoReset: true });
    // resetPfsAuditState → writePersistedState (EMPTY) + deleteMany résultats.
    expect(upsertSiteConfig).toHaveBeenCalled();
    expect(deleteManyResults).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
  });

  it("ne reset PAS l'audit si le statut est RUNNING même à 0 restant (l'audit va en repousser)", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "RUNNING",
        auditRunId: "run-r",
        startedAt: 1,
        finishedAt: null,
        total: 100,
        processed: 3,
        okCount: 1,
        diffCount: 2,
        errorCount: 0,
      }),
    });
    updateManyResults.mockResolvedValue({ count: 2 });
    countResults.mockResolvedValue(0);

    const result = await dismissAuditResults("t1", ["p1", "p2"]);

    expect(result).toEqual({ remaining: 0, autoReset: false });
    expect(deleteManyResults).not.toHaveBeenCalled();
  });

  it("no-op si productIds est vide", async () => {
    const result = await dismissAuditResults("t1", []);
    expect(result).toEqual({ remaining: 0, autoReset: false });
    expect(updateManyResults).not.toHaveBeenCalled();
    expect(findFirstSiteConfig).not.toHaveBeenCalled();
  });

  it("no-op si l'audit n'a pas d'auditRunId (rien à dismisser)", async () => {
    findFirstSiteConfig.mockResolvedValue({
      value: JSON.stringify({
        status: "IDLE",
        auditRunId: null,
        startedAt: null,
        finishedAt: null,
        total: 0,
        processed: 0,
        okCount: 0,
        diffCount: 0,
        errorCount: 0,
      }),
    });

    const result = await dismissAuditResults("t1", ["p1"]);
    expect(result).toEqual({ remaining: 0, autoReset: false });
    expect(updateManyResults).not.toHaveBeenCalled();
  });
});

describe("hardStopPfsAudit", () => {
  it("pose le stop signal, purge les résultats, finalise les runs auto en cours, reset le state et désactive l'audit auto", async () => {
    upsertSiteConfig.mockResolvedValue({});
    deleteManyResults.mockResolvedValue({ count: 42 });
    updateManyRuns.mockResolvedValue({ count: 1 });

    await hardStopPfsAudit("t1");

    // Historique : les runs RUNNING sont finalisés en ERROR avec message.
    expect(updateManyRuns).toHaveBeenCalledWith({
      where: { tenantId: "t1", status: "RUNNING" },
      data: {
        status: "ERROR",
        finishedAt: expect.any(Date),
        errorMessage: "Audit interrompu manuellement",
      },
    });

    // Stop signal posé.
    expect(upsertSiteConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_key: { tenantId: "t1", key: "pfs_audit_stop" } },
        update: { value: "1" },
      }),
    );
    // Résultats purgés.
    expect(deleteManyResults).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
    // State reset en IDLE.
    const stateUpsertCall = upsertSiteConfig.mock.calls.find(
      (c) =>
        (c[0] as { where: { tenantId_key: { key: string } } }).where.tenantId_key.key ===
        "pfs_audit_state",
    );
    expect(stateUpsertCall).toBeDefined();
    const stateWritten = JSON.parse(
      (stateUpsertCall![0] as { update: { value: string } }).update.value,
    );
    expect(stateWritten.status).toBe("IDLE");
    expect(stateWritten.total).toBe(0);
    expect(stateWritten.processed).toBe(0);
    // Audit auto désactivé (KEY_AUTO_ENABLED = "0").
    const autoDisableCall = upsertSiteConfig.mock.calls.find(
      (c) =>
        (c[0] as { where: { tenantId_key: { key: string } } }).where.tenantId_key.key ===
        "pfs_audit_auto_enabled",
    );
    expect(autoDisableCall).toBeDefined();
    expect(
      (autoDisableCall![0] as { update: { value: string } }).update.value,
    ).toBe("0");
    // On ne touche plus au chrono (KEY_AUTO_LAST_RUN_AT) — la réactivation
    // manuelle depuis le bandeau se chargera de le reset.
    const lastRunCall = upsertSiteConfig.mock.calls.find(
      (c) =>
        (c[0] as { where: { tenantId_key: { key: string } } }).where.tenantId_key.key ===
        "pfs_audit_auto_last_run_at",
    );
    expect(lastRunCall).toBeUndefined();
  });
});
