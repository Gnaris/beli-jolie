/**
 * Tests unitaires du regroupement en 5 vues (Création / Modification /
 * Liaison / Rafraîchissement / Étalement) dans marketplacesDrawerModel.
 *
 * Couvre la résolution d'intent → vue :
 *  - Priorité au champ `intent` (posé serveur-side depuis 2026-08-14)
 *  - Fallback sur mode + scheduledFor pour les anciens jobs sans intent
 *  - Fusion des LinkJob client + jobs BDD intent=link dans la vue Liaison
 *  - KPI par vue (errors / active / queued / done)
 */
import { describe, it, expect } from "vitest";
import {
  bucketViews,
  groupItemsByProductAndMode,
  viewKeyFromItem,
  VIEW_ORDER,
  type LinkJobLike,
} from "@/components/admin/widgets-rail/marketplacesDrawerModel";
import type {
  MarketplaceRefreshItem,
  MarketplaceTarget,
  QueueItemMode,
  QueueItemStatus,
  TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";

const NOW = Date.parse("2026-08-14T14:00:00.000Z");

function mkItem(overrides: Partial<MarketplaceRefreshItem>): MarketplaceRefreshItem {
  const marketplace: MarketplaceTarget = overrides.marketplace ?? "pfs";
  const mode: QueueItemMode = overrides.mode ?? "refresh";
  const status: QueueItemStatus = overrides.status ?? "done";
  return {
    id: overrides.id ?? "job-" + Math.random().toString(36).slice(2, 8),
    productId: overrides.productId ?? "p1",
    reference: overrides.reference ?? "REF-1",
    productName: overrides.productName ?? "Produit",
    firstImage: overrides.firstImage ?? null,
    options: overrides.options ?? { local: false, pfs: true },
    mode,
    marketplace,
    status,
    intent: overrides.intent,
    steps: overrides.steps,
    pfsOutcome: overrides.pfsOutcome,
    ankorsOutcome: overrides.ankorsOutcome,
    efashionOutcome: overrides.efashionOutcome,
    faireOutcome: overrides.faireOutcome,
    completedAt: overrides.completedAt,
    scheduledFor: overrides.scheduledFor,
    startedAt: overrides.startedAt,
  };
}

function mkLink(overrides: Partial<LinkJobLike>): LinkJobLike {
  return {
    id: overrides.id ?? "link-" + Math.random().toString(36).slice(2, 8),
    marketplace: overrides.marketplace ?? "pfs",
    productId: overrides.productId ?? "p1",
    productName: overrides.productName ?? "Produit",
    reference: overrides.reference ?? "REF-L",
    productImage: overrides.productImage ?? null,
    status: overrides.status ?? "in_progress",
    error: overrides.error,
    linkedCount: overrides.linkedCount,
    createdCount: overrides.createdCount,
    deletedCount: overrides.deletedCount,
    importedCount: overrides.importedCount,
    startedAt: overrides.startedAt ?? 0,
    doneAt: overrides.doneAt,
  };
}

const ok: TargetOutcome = { ok: true };
const err = (message: string): TargetOutcome => ({ ok: false, kind: "error", message });

// ────────────────────────────────────────────────────────────────
describe("viewKeyFromItem — routage par intent (priorité BDD)", () => {
  it('intent="create" → vue "creation"', () => {
    expect(viewKeyFromItem(mkItem({ intent: "create", mode: "publish" }), NOW)).toBe("creation");
  });

  it('intent="update" → vue "update"', () => {
    expect(viewKeyFromItem(mkItem({ intent: "update", mode: "publish" }), NOW)).toBe("update");
  });

  it('intent="link" → vue "link"', () => {
    expect(viewKeyFromItem(mkItem({ intent: "link", mode: "publish" }), NOW)).toBe("link");
  });

  it('intent="scheduled" → vue "scheduled" même sans scheduledFor', () => {
    expect(viewKeyFromItem(mkItem({ intent: "scheduled", mode: "refresh" }), NOW)).toBe("scheduled");
  });

  it('intent="refresh" avec scheduledFor futur → vue "scheduled"', () => {
    expect(
      viewKeyFromItem(
        mkItem({
          intent: "refresh",
          mode: "refresh",
          scheduledFor: new Date(NOW + 60_000).toISOString(),
        }),
        NOW,
      ),
    ).toBe("scheduled");
  });

  it('intent="refresh" sans scheduledFor → vue "refresh"', () => {
    expect(viewKeyFromItem(mkItem({ intent: "refresh", mode: "refresh" }), NOW)).toBe("refresh");
  });
});

// ────────────────────────────────────────────────────────────────
describe("viewKeyFromItem — fallback pour anciens jobs sans intent", () => {
  it('mode="refresh" sans intent + scheduledFor futur → "scheduled"', () => {
    expect(
      viewKeyFromItem(
        mkItem({ mode: "refresh", scheduledFor: new Date(NOW + 60_000).toISOString() }),
        NOW,
      ),
    ).toBe("scheduled");
  });

  it('mode="refresh" sans intent + scheduledFor passé → "refresh"', () => {
    expect(
      viewKeyFromItem(
        mkItem({ mode: "refresh", scheduledFor: new Date(NOW - 60_000).toISOString() }),
        NOW,
      ),
    ).toBe("refresh");
  });

  it('mode="refresh" sans intent ni scheduledFor → "refresh"', () => {
    expect(viewKeyFromItem(mkItem({ mode: "refresh" }), NOW)).toBe("refresh");
  });

  it('mode="resync" sans intent → "update"', () => {
    expect(viewKeyFromItem(mkItem({ mode: "resync" }), NOW)).toBe("update");
  });

  it('mode="publish" sans intent → "update" par défaut (heuristique conservatrice)', () => {
    expect(viewKeyFromItem(mkItem({ mode: "publish" }), NOW)).toBe("update");
  });
});

// ────────────────────────────────────────────────────────────────
describe("bucketViews — retourne exactement 5 vues dans l'ordre", () => {
  it("retourne les 5 clés dans VIEW_ORDER, même si toutes vides", () => {
    const views = bucketViews([], [], NOW);
    expect(views).toHaveLength(5);
    expect(views.map((v) => v.key)).toEqual(VIEW_ORDER);
    for (const v of views) {
      expect(v.kpi).toEqual({ errors: 0, active: 0, queued: 0, done: 0 });
      expect(v.groups).toEqual([]);
      expect(v.linkJobs).toEqual([]);
    }
  });
});

// ────────────────────────────────────────────────────────────────
describe("bucketViews — routage par intent en présence de plusieurs jobs", () => {
  it("range chaque produit dans la vue de son intent", () => {
    const items: MarketplaceRefreshItem[] = [
      mkItem({ productId: "pA", intent: "create", mode: "publish", pfsOutcome: ok }),
      mkItem({ productId: "pB", intent: "update", mode: "publish", pfsOutcome: ok }),
      mkItem({ productId: "pC", intent: "refresh", mode: "refresh", pfsOutcome: ok }),
      mkItem({
        productId: "pD",
        intent: "refresh",
        mode: "refresh",
        status: "queued",
        scheduledFor: new Date(NOW + 5 * 60_000).toISOString(),
      }),
    ];
    const groups = groupItemsByProductAndMode(items, NOW);
    const views = bucketViews(groups, [], NOW);

    const creation = views.find((v) => v.key === "creation")!;
    const update = views.find((v) => v.key === "update")!;
    const refresh = views.find((v) => v.key === "refresh")!;
    const scheduled = views.find((v) => v.key === "scheduled")!;

    expect(creation.groups.map((g) => g.productId)).toEqual(["pA"]);
    expect(update.groups.map((g) => g.productId)).toEqual(["pB"]);
    expect(refresh.groups.map((g) => g.productId)).toEqual(["pC"]);
    expect(scheduled.groups.map((g) => g.productId)).toEqual(["pD"]);
  });

  it("compte les KPI par vue en tenant compte du section (done/errors/active/queued)", () => {
    const items: MarketplaceRefreshItem[] = [
      mkItem({ productId: "p1", intent: "create", mode: "publish", pfsOutcome: ok }),
      mkItem({
        productId: "p2",
        intent: "create",
        mode: "publish",
        pfsOutcome: err("422"),
      }),
      mkItem({ productId: "p3", intent: "create", mode: "publish", status: "in_progress" }),
    ];
    const groups = groupItemsByProductAndMode(items, NOW);
    const views = bucketViews(groups, [], NOW);
    const creation = views.find((v) => v.key === "creation")!;
    expect(creation.kpi.done).toBe(1);
    expect(creation.kpi.errors).toBe(1);
    expect(creation.kpi.active).toBe(1);
    expect(creation.kpi.queued).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
describe("bucketViews — vue Liaison agrège LinkJob client + jobs BDD intent=link", () => {
  it("fusionne les 2 sources dans la même vue avec KPI additionnés", () => {
    const items: MarketplaceRefreshItem[] = [
      mkItem({ productId: "pLINK", intent: "link", mode: "publish", pfsOutcome: ok }),
    ];
    const linkJobs: LinkJobLike[] = [
      mkLink({ status: "in_progress" }),
      mkLink({ status: "error", error: "422" }),
      mkLink({ status: "done", linkedCount: 3 }),
    ];
    const groups = groupItemsByProductAndMode(items, NOW);
    const views = bucketViews(groups, linkJobs, NOW);
    const link = views.find((v) => v.key === "link")!;

    expect(link.groups.map((g) => g.productId)).toEqual(["pLINK"]);
    expect(link.linkJobs).toHaveLength(3);
    // KPI : 1 done depuis pLINK (BDD) + 1 done depuis linkJobs client = 2
    expect(link.kpi.done).toBe(2);
    expect(link.kpi.errors).toBe(1);
    expect(link.kpi.active).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
describe("bucketViews — hasScheduled activé quand un job planifié futur existe", () => {
  it("hasScheduled=true dans la vue scheduled quand un item a scheduledFor futur", () => {
    const items: MarketplaceRefreshItem[] = [
      mkItem({
        productId: "p1",
        intent: "refresh",
        mode: "refresh",
        status: "queued",
        scheduledFor: new Date(NOW + 5 * 60_000).toISOString(),
      }),
    ];
    const groups = groupItemsByProductAndMode(items, NOW);
    const views = bucketViews(groups, [], NOW);
    const scheduled = views.find((v) => v.key === "scheduled")!;
    expect(scheduled.hasScheduled).toBe(true);
    expect(scheduled.groups[0].earliestScheduledFor).toBeTruthy();
  });
});
