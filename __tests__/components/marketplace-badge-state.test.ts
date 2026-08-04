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
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore", false, now);
    expect(state.loading).toBe(false);
    expect(state.online).toBe(true);
    expect(state.justPublishedOk).toBe(true);
  });

  it("stays offline when publish fails", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore", false, now);
    expect(state.loading).toBe(false);
    expect(state.online).toBe(false);
    expect(state.justPublishedOk).toBe(false);
  });

  it("a resync-mode op does not flip the badge to online by itself", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore", false, now);
    expect(state.justPublishedOk).toBe(false);
    expect(state.online).toBe(false);
  });

  it("a refresh-mode op does not flip the badge to online by itself", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      mode: "refresh",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore", false, now);
    expect(state.justPublishedOk).toBe(false);
    expect(state.online).toBe(false);
  });

  it("stays online when server id is set even if the latest publish op failed", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState("ankors-existing", op, "ankorstore", false, now);
    expect(state.online).toBe(true);
  });

  it("reads the PFS outcome when target is pfs", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      marketplace: "pfs",
      status: "done",
      pfsOutcome: { ok: true, archived: false },
      ankorsOutcome: undefined,
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "pfs", false, now);
    expect(state.justPublishedOk).toBe(true);
    expect(state.online).toBe(true);
  });

  it("falls back to !!serverProductId once justPublishedOk grace window expires — allows unlink to reflect immediately", () => {
    // Régression : après un délier, l'ancienne op "publish done" restait dans la file
    // et forçait online=true perpétuellement, même après que serverProductId ait été
    // remis à null. Passée la fenêtre de grâce, on refait confiance au serverProductId.
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 90_000).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore", false, now);
    expect(state.justPublishedOk).toBe(false);
    expect(state.online).toBe(false);
  });

  it("stays online for at least 20 s after publish OK — évite le flash rouge quand la RSC de /admin/produits met plusieurs secondes à renvoyer le nouveau pfsProductId", () => {
    // Régression 2026-07-15 : la fenêtre était à 5 s et la RSC de /admin/produits
    // (tableau lourd) pouvait dépasser ce délai → badge repassait rouge
    // quelques secondes avant de redevenir vert. Fenêtre bumpée à 30 s.
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 20_000).toISOString(),
    });
    const state = computeMarketplaceBadgeState(null, op, "ankorstore", false, now);
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
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState("ankors-123", op, "ankorstore", true, now);
    expect(state.justPublishedOk).toBe(true);
    expect(state.syncRequired).toBe(false);
  });

  it("syncRequired stays visible when latest op failed and produit toujours marqué à synchroniser", () => {
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      ankorsOutcome: { ok: false, kind: "error", message: "boom" },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState("ankors-123", op, "ankorstore", true, now);
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
      completedAt: new Date(now - 90_000).toISOString(),
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

describe("computeMarketplaceBadgeState — sticky client-side", () => {
  // Le sticky client-side (6ᵉ arg = timestamp client de la dernière sync réussie
  // vue par MarketplaceRefreshContext) sert de filet de sécurité contre le
  // flash orange dans les cas où la logique basée sur op.completedAt échoue :
  //   - le poll perd temporairement l'item (renvoi vide, purge)
  //   - décalage d'horloge serveur/client (dérive NTP)
  //   - le RSC met plusieurs secondes à rapatrier syncRequired=false

  it("masque syncRequired quand un succès client-side récent est fourni, même sans op", () => {
    // Cas réel : le poll a temporairement perdu l'item (op undefined) mais on
    // se souvient côté client d'avoir vu la sync réussir 2 s plus tôt.
    const now = 1_700_000_000_000;
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      undefined,
      "ankorstore",
      true, // syncRequired stale côté RSC
      now,
      now - 2_000, // sticky client-side : 2 s
    );
    expect(state.online).toBe(true);
    expect(state.syncRequired).toBe(false);
  });

  it("masque syncRequired quand un succès client-side récent est fourni, avec op ancienne", () => {
    // Cas réel : op.completedAt est ancien (par ex. horloge serveur en retard
    // ou fenêtre 30 s dépassée) mais le client a vu la sync réussir récemment.
    const now = 1_700_000_000_000;
    const op = baseItem({
      mode: "resync",
      status: "done",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 90_000).toISOString(), // hors fenêtre 30 s
    });
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      op,
      "ankorstore",
      true,
      now,
      now - 3_000, // sticky client-side : 3 s
    );
    expect(state.syncRequired).toBe(false);
  });

  it("ignore le sticky client-side quand il est trop ancien (fenêtre 5 min dépassée)", () => {
    const now = 1_700_000_000_000;
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      undefined,
      "ankorstore",
      true,
      now,
      now - 6 * 60 * 1000, // sticky client-side : 6 min → hors fenêtre
    );
    expect(state.syncRequired).toBe(true);
  });

  it("sticky client-side null → comportement historique (dépend de op.completedAt uniquement)", () => {
    const now = 1_700_000_000_000;
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      undefined,
      "ankorstore",
      true,
      now,
      null,
    );
    expect(state.syncRequired).toBe(true);
  });

  it("sticky client-side ne rend PAS le produit online s'il ne l'est pas déjà (pas de faux vert)", () => {
    // Le sticky masque juste le orange, pas plus. Un produit pas encore lié
    // reste "non lié" tant que serverProductId est null et que justPublishedOk
    // ne s'active pas via op.
    const now = 1_700_000_000_000;
    const state = computeMarketplaceBadgeState(
      null,
      undefined,
      "ankorstore",
      false,
      now,
      now - 1_000,
    );
    expect(state.online).toBe(false);
  });
});

describe("computeMarketplaceBadgeState — liaison en cours (linkInProgress)", () => {
  // La liaison manuelle marketplace (LinkMarketplaceModal → linkPfsProductManually…)
  // ne passe PAS par MarketplaceRefreshJob : sans ce signal côté badge, le rendu
  // resterait "hors ligne" (rouge) pendant toute la durée de la server action
  // (10-30 s), puis basculerait vert d'un coup — flash inconfortable pour la
  // cliente. Le 7ᵉ param force un état "loading" propre pendant toute la liaison
  // (dont la fenêtre de grâce post-succès côté MarketplaceLinkContext).

  it("force loading quand une liaison est en cours, même sans op", () => {
    const state = computeMarketplaceBadgeState(
      null,
      undefined,
      "pfs",
      false,
      undefined,
      null,
      true, // linkInProgress
    );
    expect(state.loading).toBe(true);
    expect(state.online).toBe(false);
    expect(state.syncRequired).toBe(false);
    expect(state.justPublishedOk).toBe(false);
  });

  it("force loading même si le produit est déjà lié (relink)", () => {
    // Cas : la cliente clique sur « Lier » alors qu'un pfsProductId existe déjà
    // (elle veut ré-associer). Le badge ne doit pas rester vert → loading.
    const state = computeMarketplaceBadgeState(
      "pfs-existing",
      undefined,
      "pfs",
      false,
      undefined,
      null,
      true,
    );
    expect(state.loading).toBe(true);
    expect(state.online).toBe(false);
  });

  it("force loading même si syncRequired est vrai (pas de flash orange)", () => {
    const state = computeMarketplaceBadgeState(
      "pfs-existing",
      undefined,
      "pfs",
      true, // syncRequired stale
      undefined,
      null,
      true,
    );
    expect(state.loading).toBe(true);
    expect(state.syncRequired).toBe(false);
  });

  it("force loading même s'il y a une op refresh récemment terminée (pas de flash vert prématuré)", () => {
    // Cas : une op refresh a fini quelques secondes avant la liaison. Sans le
    // linkInProgress, `justPublishedOk` ou `online` prendrait le dessus.
    const now = 1_700_000_000_000;
    const op = baseItem({
      status: "done",
      mode: "publish",
      ankorsOutcome: { ok: true, archived: false },
      completedAt: new Date(now - 500).toISOString(),
    });
    const state = computeMarketplaceBadgeState(
      "ankors-123",
      op,
      "ankorstore",
      false,
      now,
      now - 500,
      true,
    );
    expect(state.loading).toBe(true);
    expect(state.online).toBe(false);
    expect(state.justPublishedOk).toBe(false);
  });

  it("linkInProgress false → comportement historique inchangé", () => {
    // Régression : le 7ᵉ param doit être optionnel et neutre par défaut.
    const state = computeMarketplaceBadgeState("pfs-123", undefined, "pfs", false);
    expect(state.online).toBe(true);
    expect(state.loading).toBe(false);
  });
});
