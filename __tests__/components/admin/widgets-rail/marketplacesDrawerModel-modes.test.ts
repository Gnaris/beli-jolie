import { describe, it, expect } from "vitest";
import {
  bucketGroupsByMode,
  groupItemsByProduct,
  groupItemsByProductAndMode,
  MODE_ORDER,
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

const ok: TargetOutcome = { ok: true };
const err = (message: string): TargetOutcome => ({ ok: false, kind: "error", message });

describe("dominantMode sur ProductGroup", () => {
  it("prend le mode de l'unique item quand il n'y en a qu'un", () => {
    const [g] = groupItemsByProduct([mkItem({ productId: "p1", mode: "publish" })]);
    expect(g.dominantMode).toBe("publish");
  });

  it("privilégie l'item actif sur les items terminés du même produit", () => {
    const groups = groupItemsByProduct([
      mkItem({
        productId: "p1",
        mode: "refresh",
        status: "done",
        completedAt: "2026-07-27T10:00:00Z",
        pfsOutcome: ok,
      }),
      mkItem({
        productId: "p1",
        mode: "resync",
        status: "in_progress",
        marketplace: "ankorstore",
      }),
    ]);
    expect(groups[0].dominantMode).toBe("resync");
  });

  it("entre deux items terminés, prend le plus récent", () => {
    const [g] = groupItemsByProduct([
      mkItem({
        productId: "p1",
        mode: "publish",
        status: "done",
        completedAt: "2026-07-27T09:00:00Z",
        pfsOutcome: ok,
      }),
      mkItem({
        productId: "p1",
        mode: "refresh",
        status: "done",
        completedAt: "2026-07-27T11:00:00Z",
        marketplace: "ankorstore",
        ankorsOutcome: ok,
      }),
    ]);
    expect(g.dominantMode).toBe("refresh");
  });
});

describe("groupItemsByProductAndMode", () => {
  it("crée une carte distincte par (produit, mode) pour ne pas mélanger les erreurs", () => {
    // Même produit, un publish qui a raté PFS + un refresh qui a raté Ankor.
    // Sans split, on aurait 1 carte avec 2 badges rouges mélangés ; avec split,
    // on en veut 2 : une sous Modifications (erreur PFS), une sous Rafraîchissements
    // (erreur Ankor).
    const groups = groupItemsByProductAndMode([
      mkItem({
        productId: "p1",
        mode: "publish",
        marketplace: "pfs",
        status: "done",
        completedAt: "2026-07-27T09:00:00Z",
        pfsOutcome: err("Publish PFS a raté"),
      }),
      mkItem({
        productId: "p1",
        mode: "refresh",
        marketplace: "ankorstore",
        status: "done",
        completedAt: "2026-07-27T10:00:00Z",
        ankorsOutcome: err("Refresh Ankor a raté"),
      }),
    ]);
    expect(groups).toHaveLength(2);
    const publish = groups.find((g) => g.dominantMode === "publish")!;
    const refresh = groups.find((g) => g.dominantMode === "refresh")!;
    expect(publish.cells.pfs.kind).toBe("error");
    expect(publish.cells.ankorstore.kind).toBe("not-targeted");
    expect(refresh.cells.ankorstore.kind).toBe("error");
    expect(refresh.cells.pfs.kind).toBe("not-targeted");
  });

  it("permet à un produit d'apparaître dans plusieurs buckets de mode", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "p1", mode: "publish", pfsOutcome: ok }),
      mkItem({
        productId: "p1",
        mode: "refresh",
        marketplace: "ankorstore",
        ankorsOutcome: err("boum"),
      }),
    ]);
    const buckets = bucketGroupsByMode(groups);
    expect(buckets.map((b) => b.mode)).toEqual(["publish", "refresh"]);
    expect(buckets.find((b) => b.mode === "publish")!.errorGroupCount).toBe(0);
    expect(buckets.find((b) => b.mode === "refresh")!.errorGroupCount).toBe(1);
  });

  it("préserve l'ordre d'arrivée entre paires (produit, mode)", () => {
    const groups = groupItemsByProductAndMode([
      mkItem({ productId: "pA", mode: "publish" }),
      mkItem({ productId: "pB", mode: "refresh" }),
      mkItem({ productId: "pA", mode: "refresh" }),
    ]);
    expect(groups.map((g) => `${g.productId}:${g.dominantMode}`)).toEqual([
      "pA:publish",
      "pB:refresh",
      "pA:refresh",
    ]);
  });
});

describe("bucketGroupsByMode", () => {
  it("retourne un tableau vide quand il n'y a pas de groupes", () => {
    expect(bucketGroupsByMode([])).toEqual([]);
  });

  it("regroupe les produits par mode et respecte l'ordre Publish → Refresh → Resync", () => {
    const groups = groupItemsByProduct([
      mkItem({ productId: "pA", mode: "refresh", pfsOutcome: ok }),
      mkItem({ productId: "pB", mode: "resync", pfsOutcome: ok }),
      mkItem({ productId: "pC", mode: "publish", pfsOutcome: ok }),
      mkItem({ productId: "pD", mode: "refresh", pfsOutcome: ok }),
    ]);
    const buckets = bucketGroupsByMode(groups);
    expect(buckets.map((b) => b.mode)).toEqual(["publish", "refresh", "resync"]);
    expect(MODE_ORDER).toEqual(["publish", "refresh", "resync"]);
    const refresh = buckets.find((b) => b.mode === "refresh")!;
    expect(refresh.groups.map((g) => g.productId).sort()).toEqual(["pA", "pD"]);
  });

  it("omet les modes sans produit", () => {
    const groups = groupItemsByProduct([
      mkItem({ productId: "pA", mode: "publish", pfsOutcome: ok }),
    ]);
    const buckets = bucketGroupsByMode(groups);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].mode).toBe("publish");
  });

  it("compte les items encore queued par bucket, tous produits confondus", () => {
    const groups = groupItemsByProduct([
      mkItem({ productId: "pA", mode: "publish", status: "queued" }),
      mkItem({
        productId: "pA",
        mode: "publish",
        status: "queued",
        marketplace: "ankorstore",
      }),
      mkItem({ productId: "pB", mode: "refresh", status: "queued" }),
      mkItem({ productId: "pC", mode: "resync", status: "done", pfsOutcome: ok }),
    ]);
    const buckets = bucketGroupsByMode(groups);
    const byMode = Object.fromEntries(buckets.map((b) => [b.mode, b]));
    expect(byMode.publish.queuedItemCount).toBe(2);
    expect(byMode.refresh.queuedItemCount).toBe(1);
    expect(byMode.resync.queuedItemCount).toBe(0);
  });

  it("compte séparément les groupes en erreur et les groupes actifs", () => {
    const groups = groupItemsByProduct([
      mkItem({
        productId: "pA",
        mode: "publish",
        status: "done",
        pfsOutcome: err("boom"),
      }),
      mkItem({ productId: "pB", mode: "publish", status: "in_progress" }),
      mkItem({
        productId: "pC",
        mode: "refresh",
        status: "done",
        pfsOutcome: ok,
      }),
    ]);
    const buckets = bucketGroupsByMode(groups);
    const publish = buckets.find((b) => b.mode === "publish")!;
    expect(publish.errorGroupCount).toBe(1);
    expect(publish.activeGroupCount).toBe(1);
    const refresh = buckets.find((b) => b.mode === "refresh")!;
    expect(refresh.errorGroupCount).toBe(0);
    expect(refresh.activeGroupCount).toBe(0);
  });
});
