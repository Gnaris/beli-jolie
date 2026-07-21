import { describe, it, expect } from "vitest";
import {
  cellCopyable,
  cellTooltipBody,
  cellTooltipTitle,
  groupItemsByProduct,
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

describe("groupItemsByProduct", () => {
  it("retourne un tableau vide quand la file est vide", () => {
    expect(groupItemsByProduct([])).toEqual([]);
  });

  it("regroupe tous les items d'un même produit sur une seule carte", () => {
    const groups = groupItemsByProduct([
      mkItem({ productId: "p1", marketplace: "pfs", pfsOutcome: ok }),
      mkItem({ productId: "p1", marketplace: "ankorstore", ankorsOutcome: ok }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].productId).toBe("p1");
    expect(groups[0].cells.pfs.kind).toBe("done");
    expect(groups[0].cells.ankorstore.kind).toBe("done");
    expect(groups[0].cells.efashion.kind).toBe("not-targeted");
    expect(groups[0].cells.faire.kind).toBe("not-targeted");
    expect(groups[0].section).toBe("done");
  });

  it("crée une carte distincte par produit, dans l'ordre d'arrivée", () => {
    const groups = groupItemsByProduct([
      mkItem({ productId: "p1" }),
      mkItem({ productId: "p2" }),
      mkItem({ productId: "p1" }),
    ]);
    expect(groups.map((g) => g.productId)).toEqual(["p1", "p2"]);
  });

  it("classe le produit en 'errors' dès qu'une marketplace est en erreur", () => {
    const [group] = groupItemsByProduct([
      mkItem({ productId: "p1", marketplace: "pfs", pfsOutcome: ok }),
      mkItem({
        productId: "p1",
        marketplace: "ankorstore",
        ankorsOutcome: err("Prix manquant"),
      }),
    ]);
    expect(group.section).toBe("errors");
    expect(group.cells.pfs.kind).toBe("done");
    expect(group.cells.ankorstore.kind).toBe("error");
  });

  it("priorité : 'errors' > 'active' > 'queued' > 'done'", () => {
    const [group] = groupItemsByProduct([
      mkItem({
        productId: "p1",
        marketplace: "pfs",
        status: "in_progress",
      }),
      mkItem({
        productId: "p1",
        marketplace: "ankorstore",
        ankorsOutcome: err("SH code"),
      }),
      mkItem({ productId: "p1", marketplace: "efashion", status: "queued" }),
      mkItem({ productId: "p1", marketplace: "faire", faireOutcome: ok }),
    ]);
    // Une erreur présente → section = errors
    expect(group.section).toBe("errors");
    expect(group.cells.pfs.kind).toBe("active");
    expect(group.cells.ankorstore.kind).toBe("error");
    expect(group.cells.efashion.kind).toBe("queued");
    expect(group.cells.faire.kind).toBe("done");
  });

  it("un retry actif (in_progress) l'emporte sur l'ancien item terminé de la même marketplace", () => {
    // Scénario : Ankor a échoué (item old), on relance (item new, in_progress).
    // Le badge doit afficher "En cours", pas "Erreur".
    const [group] = groupItemsByProduct([
      mkItem({
        id: "old",
        productId: "p1",
        marketplace: "ankorstore",
        status: "done",
        completedAt: "2026-07-15T10:00:00.000Z",
        ankorsOutcome: err("Prix manquant"),
      }),
      mkItem({
        id: "new",
        productId: "p1",
        marketplace: "ankorstore",
        status: "in_progress",
      }),
    ]);
    expect(group.cells.ankorstore.kind).toBe("active");
    expect(group.section).toBe("active");
  });

  it("récupère la photo la plus récente pour la carte du produit", () => {
    const [group] = groupItemsByProduct([
      mkItem({ productId: "p1", firstImage: null }),
      mkItem({
        productId: "p1",
        firstImage: "/uploads/beliandjolie/produits/p1/main.webp",
      }),
    ]);
    expect(group.firstImage).toBe(
      "/uploads/beliandjolie/produits/p1/main.webp",
    );
  });

  it("garde le completedAt le plus récent pour l'horodatage de la carte", () => {
    const [group] = groupItemsByProduct([
      mkItem({
        productId: "p1",
        completedAt: "2026-07-15T09:00:00.000Z",
      }),
      mkItem({
        productId: "p1",
        completedAt: "2026-07-15T10:15:00.000Z",
      }),
    ]);
    expect(group.latestActivityAt).toBe("2026-07-15T10:15:00.000Z");
  });

  it("produit avec scheduledFor futur (lot étalé) → section 'scheduled' + earliestScheduledFor", () => {
    const now = Date.parse("2026-07-21T10:00:00.000Z");
    const in10min = "2026-07-21T10:10:00.000Z";
    const [group] = groupItemsByProduct(
      [
        mkItem({
          productId: "p1",
          marketplace: "pfs",
          status: "queued",
          scheduledFor: in10min,
        }),
      ],
      now,
    );
    expect(group.section).toBe("scheduled");
    expect(group.earliestScheduledFor).toBe(in10min);
  });

  it("scheduledFor passé → traité comme queued classique (le worker va le prendre)", () => {
    const now = Date.parse("2026-07-21T10:00:00.000Z");
    const past = "2026-07-21T09:00:00.000Z";
    const [group] = groupItemsByProduct(
      [
        mkItem({
          productId: "p1",
          marketplace: "pfs",
          status: "queued",
          scheduledFor: past,
        }),
      ],
      now,
    );
    expect(group.section).toBe("queued");
    expect(group.earliestScheduledFor).toBeNull();
  });

  it("earliestScheduledFor = le plus proche parmi plusieurs items queued", () => {
    const now = Date.parse("2026-07-21T10:00:00.000Z");
    const [group] = groupItemsByProduct(
      [
        mkItem({
          productId: "p1",
          marketplace: "pfs",
          status: "queued",
          scheduledFor: "2026-07-21T10:20:00.000Z",
        }),
        mkItem({
          productId: "p1",
          marketplace: "ankorstore",
          status: "queued",
          scheduledFor: "2026-07-21T10:05:00.000Z",
        }),
      ],
      now,
    );
    expect(group.section).toBe("scheduled");
    expect(group.earliestScheduledFor).toBe("2026-07-21T10:05:00.000Z");
  });

  it("un item in_progress l'emporte sur les items scheduled du même produit → 'active'", () => {
    const now = Date.parse("2026-07-21T10:00:00.000Z");
    const [group] = groupItemsByProduct(
      [
        mkItem({
          productId: "p1",
          marketplace: "pfs",
          status: "in_progress",
        }),
        mkItem({
          productId: "p1",
          marketplace: "ankorstore",
          status: "queued",
          scheduledFor: "2026-07-21T10:10:00.000Z",
        }),
      ],
      now,
    );
    expect(group.section).toBe("active");
  });

  it("marketplace non ciblée → cellule 'not-targeted' (badge gris)", () => {
    const [group] = groupItemsByProduct([
      mkItem({ productId: "p1", marketplace: "pfs", pfsOutcome: ok }),
    ]);
    expect(group.cells.faire.kind).toBe("not-targeted");
    expect(group.cells.efashion.kind).toBe("not-targeted");
  });
});

describe("cellTooltipBody + cellTooltipTitle + cellCopyable", () => {
  it("cell 'not-targeted' → message neutre, pas de titre, pas de copie", () => {
    const body = cellTooltipBody({ kind: "not-targeted" });
    expect(body).toBe("Non ciblé pour ce produit");
    expect(cellTooltipTitle("pfs", { kind: "not-targeted" })).toBeUndefined();
    expect(cellCopyable({ kind: "not-targeted" })).toBeUndefined();
  });

  it("cell 'queued' → 'En attente de traitement', pas de copie", () => {
    expect(cellTooltipBody({ kind: "queued" })).toBe("En attente de traitement");
    expect(cellCopyable({ kind: "queued" })).toBeUndefined();
  });

  it("cell 'active' in_progress → 'Envoi en cours…'", () => {
    const driver = mkItem({ status: "in_progress" });
    expect(cellTooltipBody({ kind: "active", driver })).toBe("Envoi en cours…");
  });

  it("cell 'active' awaiting_callback → 'En attente de la réponse marketplace…'", () => {
    const driver = mkItem({ status: "awaiting_callback" });
    expect(cellTooltipBody({ kind: "active", driver })).toBe(
      "En attente de la réponse marketplace…",
    );
  });

  it("cell 'done' → 'Terminé avec succès', pas de copie", () => {
    expect(cellTooltipBody({ kind: "done" })).toBe("Terminé avec succès");
    expect(cellCopyable({ kind: "done" })).toBeUndefined();
  });

  it("cell 'error' publish → titre 'Publication échouée', body = message, copie = message", () => {
    const driver = mkItem({ mode: "publish" });
    const cell = { kind: "error" as const, outcome: err("Prix manquant"), driver };
    expect(cellTooltipTitle("ankorstore", cell)).toBe(
      "Ankorstore — Publication échouée",
    );
    expect(cellTooltipBody(cell)).toBe("Prix manquant");
    expect(cellCopyable(cell)).toBe("Prix manquant");
  });

  it("cell 'error' resync → titre 'Resynchronisation échouée'", () => {
    const driver = mkItem({ mode: "resync" });
    const cell = {
      kind: "error" as const,
      outcome: err("Timeout"),
      driver,
    };
    expect(cellTooltipTitle("pfs", cell)).toBe("PFS — Resynchronisation échouée");
  });

  it("cell 'error' refresh → titre 'Refresh échoué'", () => {
    const driver = mkItem({ mode: "refresh" });
    const cell = { kind: "error" as const, outcome: err("500"), driver };
    expect(cellTooltipTitle("efashion", cell)).toBe("eFashion — Refresh échoué");
  });

  it("cell 'error' kind='not_found' → titre 'Produit introuvable'", () => {
    const driver = mkItem({ mode: "publish" });
    const outcome: TargetOutcome = { ok: false, kind: "not_found", message: "" };
    const cell = { kind: "error" as const, outcome, driver };
    expect(cellTooltipTitle("faire", cell)).toBe("Faire — Produit introuvable");
  });
});
