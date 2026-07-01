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
    expect(state).toEqual({ loading: false, online: false, syncRequired: false, justPublishedOk: false });
  });

  it("online when server id is set and no op (already published before)", () => {
    const state = computeMarketplaceBadgeState("ankors-123", undefined, "ankorstore");
    expect(state).toEqual({ loading: false, online: true, syncRequired: false, justPublishedOk: false });
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

describe("computeMarketplaceBadgeState — syncRequired", () => {
  it("syncRequired flag has no effect when product is not linked", () => {
    // Pas lié → on n'affichera jamais "Synchro nécessaire" même si le drapeau
    // est par erreur posé en BDD (faux positif neutralisé côté UI).
    const state = computeMarketplaceBadgeState(null, undefined, "ankorstore", true);
    expect(state.online).toBe(false);
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired shown when product is linked AND flag is true AND no op in flight", () => {
    const state = computeMarketplaceBadgeState("ankors-123", undefined, "ankorstore", true);
    expect(state.online).toBe(true);
    expect(state.syncRequired).toBe(true);
  });

  it("syncRequired hidden when a refresh/publish op is currently loading (loading takes precedence)", () => {
    const op = baseItem({ status: "in_progress" });
    const state = computeMarketplaceBadgeState("ankors-123", op, "ankorstore", true);
    expect(state.loading).toBe(true);
    // Pendant que le push tourne, on n'affiche PAS l'orange — soit en cours,
    // soit ça vient d'être poussé.
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired hidden right after a successful publish (justPublishedOk takes precedence)", () => {
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
    });
    const state = computeMarketplaceBadgeState("ankors-123", op, "ankorstore", true);
    expect(state.justPublishedOk).toBe(true);
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired stays visible when latest op failed and produit toujours marqué à synchroniser", () => {
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
    });
    const state = computeMarketplaceBadgeState("ankors-123", op, "ankorstore", true);
    expect(state.online).toBe(true);
    // L'op a échoué (justPublishedOk=false, loading=false) → le badge orange
    // reste visible pour inviter à re-essayer la sync.
    expect(state.syncRequired).toBe(true);
  });

  it("syncRequired is false by default (no flag passed)", () => {
    const state = computeMarketplaceBadgeState("ankors-123", undefined, "ankorstore");
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired hidden briefly after a successful resync (flash bug)", () => {
    // Reproduit le bug : op resync qui vient de finir OK côté serveur, mais
    // les props RSC n'ont pas encore été rafraîchies (syncRequired=true stale).
    // Le badge doit rester vert le temps que router.refresh rapatrie
    // syncRequired=false, pas flasher en orange 1 seconde.
    const now = 1_700_000_000_000;
    const completedAt = new Date(now - 500).toISOString();
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt,
    });
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      op,
      "ankorstore",
      true,
      now,
    );
    expect(state.online).toBe(true);
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired hidden briefly after a successful refresh too", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      mode: "refresh",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 1_000).toISOString(),
    });
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      op,
      "ankorstore",
      true,
      now,
    );
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired reappears after the grace window expires (user modified since)", () => {
    // Passée la fenêtre de grâce, on refait confiance à syncRequired : si
    // l'utilisatrice modifie le produit après une sync réussie, le badge
    // orange doit bien revenir.
    const now = 1_700_000_000_000;
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 60_000).toISOString(),
    });
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      op,
      "ankorstore",
      true,
      now,
    );
    expect(state.syncRequired).toBe(true);
  });

  it("syncRequired stays visible when the recent op failed (no false green)", () => {
    // Op récente échouée : pas de fenêtre de grâce, le badge orange doit
    // rester visible pour inviter à re-lancer la sync.
    const now = 1_700_000_000_000;
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      op,
      "ankorstore",
      true,
      now,
    );
    expect(state.syncRequired).toBe(true);
  });

  it("syncRequired shown when op has no completedAt (unexpected but robust)", () => {
    // Sécurité : sans completedAt, on ne joue pas la fenêtre de grâce et on
    // affiche l'état réel remonté par le serveur.
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
    });
    const state = computeMarketplaceBadgeState("ankors-123", op, "ankorstore", true);
    expect(state.syncRequired).toBe(true);
  });
});
