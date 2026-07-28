import { describe, it, expect } from "vitest";
import {
  bucketColumns,
  COLUMN_ORDER,
  groupItemsByProductAndMode,
  type LinkJobLike,
} from "@/components/admin/widgets-rail/marketplacesDrawerModel";
import type {
  MarketplaceRefreshItem,
  MarketplaceTarget,
  QueueItemMode,
  QueueItemStatus,
  TargetOutcome,
} from "@/components/admin/products/MarketplaceRefreshContext";

function mkItem(overrides: Partial<MarketplaceRefreshItem>): MarketplaceRefreshItem {
  const marketplace: MarketplaceTarget = overrides.marketplace ?? "pfs";
  const mode: QueueItemMode = overrides.mode ?? "refresh";
  const status: QueueItemStatus = overrides.status ?? "done";
  return {
    id: overrides.id ?? "job-" + Math.random().toString(36).slice(2, 8),
    productId: overrides.productId ?? "p1",
    reference: overrides.reference ?? "REF-1",
    productName: overrides.productName ?? "Produit test",
    firstImage: overrides.firstImage ?? null,
    options: overrides.options ?? { local: false, pfs: true },
    mode,
    marketplace,
    status,
    pfsOutcome: overrides.pfsOutcome,
    ankorsOutcome: overrides.ankorsOutcome,
    efashionOutcome: overrides.efashionOutcome,
    faireOutcome: overrides.faireOutcome,
    completedAt: overrides.completedAt,
    scheduledFor: overrides.scheduledFor,
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

describe("bucketColumns — refonte 4 colonnes 2026-07-28", () => {
  it("retourne toujours 4 buckets dans l'ordre publish/refresh/resync/link", () => {
    const buckets = bucketColumns([], []);
    expect(buckets).toHaveLength(4);
    expect(buckets.map((b) => b.key)).toEqual(COLUMN_ORDER);
    for (const b of buckets) {
      expect(b.kpi).toEqual({ errors: 0, active: 0, queued: 0, done: 0 });
      expect(b.groups).toEqual([]);
      expect(b.linkJobs).toEqual([]);
    }
  });

  it("range chaque produit dans la colonne de son mode dominant", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", mode: "publish", status: "done", pfsOutcome: ok }),
      mkItem({ productId: "p2", mode: "refresh", status: "done", pfsOutcome: ok }),
      mkItem({ productId: "p3", mode: "resync", status: "done", pfsOutcome: ok }),
    ]);
    const buckets = bucketColumns(groups, []);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    expect(byKey.publish.groups).toHaveLength(1);
    expect(byKey.refresh.groups).toHaveLength(1);
    expect(byKey.resync.groups).toHaveLength(1);
    expect(byKey.link.groups).toHaveLength(0);
  });

  it("range les LinkJob dans la colonne « link » et calcule ses KPI", () => {
    const buckets = bucketColumns(
      [],
      [
        mkLink({ status: "in_progress" }),
        mkLink({ status: "in_progress" }),
        mkLink({ status: "done" }),
        mkLink({ status: "error", error: "Boom" }),
      ],
    );
    const link = buckets.find((b) => b.key === "link")!;
    expect(link.linkJobs).toHaveLength(4);
    expect(link.kpi).toEqual({ errors: 1, active: 2, queued: 0, done: 1 });
    // Les autres buckets doivent rester vides
    for (const b of buckets) {
      if (b.key !== "link") expect(b.groups).toHaveLength(0);
    }
  });

  it("calcule les KPI par section (errors/active/queued/done) pour chaque colonne", () => {
    const groups = groupItemsByProductAndMode([
      // publish : 1 erreur + 1 done
      mkItem({
        productId: "p1",
        mode: "publish",
        status: "done",
        pfsOutcome: err("nope"),
      }),
      mkItem({
        productId: "p2",
        mode: "publish",
        status: "done",
        pfsOutcome: ok,
      }),
      // refresh : 1 active
      mkItem({
        productId: "p3",
        mode: "refresh",
        status: "in_progress",
      }),
    ]);
    const buckets = bucketColumns(groups, []);
    const publish = buckets.find((b) => b.key === "publish")!;
    const refresh = buckets.find((b) => b.key === "refresh")!;
    expect(publish.kpi.errors).toBe(1);
    expect(publish.kpi.done).toBe(1);
    expect(refresh.kpi.active).toBe(1);
  });

  it("compte les items queued arrêtables par colonne (queuedItemCount)", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", mode: "refresh", status: "queued" }),
      mkItem({ productId: "p2", mode: "refresh", status: "queued" }),
      mkItem({ productId: "p3", mode: "publish", status: "queued" }),
    ]);
    const buckets = bucketColumns(groups, []);
    const refresh = buckets.find((b) => b.key === "refresh")!;
    const publish = buckets.find((b) => b.key === "publish")!;
    expect(refresh.queuedItemCount).toBe(2);
    expect(publish.queuedItemCount).toBe(1);
  });

  it("marque hasScheduled=true pour la colonne refresh si un item est planifié", () => {
    const future = new Date(Date.now() + 5 * 60_000).toISOString();
    const groups = groupItemsByProductAndMode(
      [
        mkItem({
          productId: "p1",
          mode: "refresh",
          status: "queued",
          scheduledFor: future,
        }),
      ],
      Date.now(),
    );
    const buckets = bucketColumns(groups, []);
    const refresh = buckets.find((b) => b.key === "refresh")!;
    expect(refresh.hasScheduled).toBe(true);
    // Les autres colonnes n'ont rien à planifier
    for (const b of buckets) {
      if (b.key !== "refresh") expect(b.hasScheduled).toBe(false);
    }
  });

  it("colonne link : queuedItemCount toujours 0 et hasScheduled toujours false", () => {
    const buckets = bucketColumns(
      [],
      [mkLink({ status: "in_progress" }), mkLink({ status: "done" })],
    );
    const link = buckets.find((b) => b.key === "link")!;
    expect(link.queuedItemCount).toBe(0);
    expect(link.hasScheduled).toBe(false);
  });
});
