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
const findManyResults = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findFirst: (...args: unknown[]) => findFirstSiteConfig(...args),
    },
    pfsAuditResult: {
      findMany: (...args: unknown[]) => findManyResults(...args),
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

import { getPfsAuditState } from "@/lib/pfs-audit-runner";

beforeEach(() => {
  findFirstSiteConfig.mockReset();
  findManyResults.mockReset();
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

    // Scope multi-tenant + par run.
    expect(findManyResults).toHaveBeenCalledWith({
      where: { tenantId: "t1", auditRunId: "run-abc" },
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
});
