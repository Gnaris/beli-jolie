import { describe, it, expect } from "vitest";
import {
  computeMarketplaceBadgeState,
  findLatestOpForProduct,
} from "@/components/admin/products/marketplaceBadgeState";
import type { MarketplaceRefreshItem } from "@/components/admin/products/MarketplaceRefreshContext";

function baseItem(overrides: Partial<MarketplaceRefreshItem>): MarketplaceRefreshItem {
  return {
    id: "id-1",
    productId: "p1",
    reference: "REF",
    productName: "Test product",
    firstImage: null,
    options: { local: false, pfs: false, ankorstore: true },
    mode: "publish",
    marketplace: "ankorstore",
    status: "queued",
    ...overrides,
  };
}

describe("findLatestOpForProduct", () => {
  it("returns undefined when the queue is empty", () => {
    expect(findLatestOpForProduct([], "p1", "ankorstore")).toBeUndefined();
  });

  it("returns undefined when no op matches the product+marketplace", () => {
    const items = [baseItem({ id: "a", productId: "p2" })];
    expect(findLatestOpForProduct(items, "p1", "ankorstore")).toBeUndefined();
  });

  it("returns the latest matching op (queue order = oldest first)", () => {
    const items = [
      baseItem({ id: "old", status: "done" }),
      baseItem({ id: "new", status: "in_progress" }),
    ];
    const latest = findLatestOpForProduct(items, "p1", "ankorstore");
    expect(latest?.id).toBe("new");
  });

  it("filters by marketplace", () => {
    const items = [
      baseItem({ id: "pfs-op", marketplace: "pfs" }),
      baseItem({ id: "ak-op", marketplace: "ankorstore" }),
    ];
    expect(findLatestOpForProduct(items, "p1", "pfs")?.id).toBe("pfs-op");
    expect(findLatestOpForProduct(items, "p1", "ankorstore")?.id).toBe("ak-op");
  });
});

describe("computeMarketplaceBadgeState", () => {
  it("offline when no server id and no op", () => {
    const state = computeMarketplaceBadgeState(null, undefined, "ankorstore");
    expect(state).toEqual({ loading: false, online: false, justPublishedOk: false });
  });

  it("online when server id is set and no op (already published before)", () => {
    const state = computeMarketplaceBadgeState("ankors-123", undefined, "ankorstore");
    expect(state).toEqual({ loading: false, online: true, justPublishedOk: false });
  });

  it("loading when op is queued", () => {
    const op = baseItem({ status: "queued" });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore");
    expect(state.loading).toBe(true);
    expect(state.online).toBe(false);
  });

  it("loading when op is in_progress", () => {
    const op = baseItem({ status: "in_progress" });
    expect(computeMarketplaceBadgeState(null, op, "ankorstore").loading).toBe(true);
  });

  it("loading when op is awaiting_callback (Ankorstore async kickoff)", () => {
    const op = baseItem({ status: "awaiting_callback" });
    expect(computeMarketplaceBadgeState(null, op, "ankorstore").loading).toBe(true);
  });

  it("turns online when publish succeeds — even before server id is updated", () => {
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore");
    expect(state.loading).toBe(false);
    expect(state.online).toBe(true);
    expect(state.justPublishedOk).toBe(true);
  });

  it("stays offline when publish fails", () => {
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore");
    expect(state.loading).toBe(false);
    expect(state.online).toBe(false);
    expect(state.justPublishedOk).toBe(false);
  });

  it("a resync-mode op does not flip the badge to online by itself", () => {
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore");
    expect(state.justPublishedOk).toBe(false);
    expect(state.online).toBe(false);
  });

  it("a refresh-mode op does not flip the badge to online by itself", () => {
    const op = baseItem({
      mode: "refresh",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore");
    expect(state.justPublishedOk).toBe(false);
    expect(state.online).toBe(false);
  });

  it("stays online when server id is set even if the latest publish op failed", () => {
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
    });
    const state = computeMarketplaceBadgeState("ankors-existing", op, "ankorstore");
    expect(state.online).toBe(true);
  });

  it("reads the PFS outcome when target is pfs", () => {
    const op = baseItem({
      marketplace: "pfs",
      status: "done",
      pfsOutcome: { ok: true, archived: false },
      ankorsOutcome: undefined,
    });
    const state = computeMarketplaceBadgeState(null, op, "pfs");
    expect(state.justPublishedOk).toBe(true);
    expect(state.online).toBe(true);
  });
});
