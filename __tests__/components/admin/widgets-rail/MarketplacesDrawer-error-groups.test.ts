import { describe, it, expect } from "vitest";
import { groupErrorsByProduct } from "@/components/admin/widgets-rail/MarketplacesDrawer";
import type { MarketplaceRefreshItem } from "@/components/admin/products/MarketplaceRefreshContext";

function mkItem(overrides: Partial<MarketplaceRefreshItem>): MarketplaceRefreshItem {
  return {
    id: overrides.id ?? "job-" + Math.random().toString(36).slice(2, 8),
    productId: overrides.productId ?? "p1",
    reference: overrides.reference ?? "REF-1",
    productName: overrides.productName ?? "Produit test",
    firstImage: overrides.firstImage ?? null,
    options: overrides.options ?? { local: false, pfs: true },
    mode: overrides.mode ?? "refresh",
    marketplace: overrides.marketplace ?? "pfs",
    status: overrides.status ?? "done",
    pfsOutcome: overrides.pfsOutcome,
    ankorsOutcome: overrides.ankorsOutcome,
    efashionOutcome: overrides.efashionOutcome,
    faireOutcome: overrides.faireOutcome,
    completedAt: overrides.completedAt,
  };
}

describe("groupErrorsByProduct", () => {
  it("regroupe plusieurs erreurs marketplace d'un même produit en une seule carte", () => {
    const items = [
      mkItem({
        id: "a",
        productId: "p1",
        marketplace: "ankorstore",
        ankorsOutcome: { ok: false, kind: "error", message: "Callback perdu" },
      }),
      mkItem({
        id: "b",
        productId: "p1",
        marketplace: "efashion",
        efashionOutcome: { ok: false, kind: "error", message: "Biblio manquante" },
      }),
    ];
    const groups = groupErrorsByProduct(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].productId).toBe("p1");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].items.map((i) => i.marketplace)).toEqual(["ankorstore", "efashion"]);
  });

  it("crée une carte distincte par produit", () => {
    const items = [
      mkItem({
        id: "a",
        productId: "p1",
        marketplace: "pfs",
        pfsOutcome: { ok: false, kind: "error", message: "Dup" },
      }),
      mkItem({
        id: "b",
        productId: "p2",
        marketplace: "faire",
        faireOutcome: { ok: false, kind: "error", message: "SH code" },
      }),
    ];
    const groups = groupErrorsByProduct(items);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.productId).sort()).toEqual(["p1", "p2"]);
  });

  it("garde la date de complétion la plus récente pour le libellé « il y a X min »", () => {
    const items = [
      mkItem({
        id: "old",
        productId: "p1",
        marketplace: "pfs",
        completedAt: "2026-07-13T10:00:00.000Z",
        pfsOutcome: { ok: false, kind: "error", message: "A" },
      }),
      mkItem({
        id: "recent",
        productId: "p1",
        marketplace: "efashion",
        completedAt: "2026-07-13T10:15:00.000Z",
        efashionOutcome: { ok: false, kind: "error", message: "B" },
      }),
    ];
    const [group] = groupErrorsByProduct(items);
    expect(group.latestCompletedAt).toBe("2026-07-13T10:15:00.000Z");
  });

  it("récupère la photo la plus récente si un item plus tardif en fournit une", () => {
    const items = [
      mkItem({
        id: "a",
        productId: "p1",
        firstImage: null,
        marketplace: "pfs",
        pfsOutcome: { ok: false, kind: "error", message: "A" },
      }),
      mkItem({
        id: "b",
        productId: "p1",
        firstImage: "/uploads/beliandjolie/produits/p1/main.webp",
        marketplace: "ankorstore",
        ankorsOutcome: { ok: false, kind: "error", message: "B" },
      }),
    ];
    const [group] = groupErrorsByProduct(items);
    expect(group.firstImage).toBe("/uploads/beliandjolie/produits/p1/main.webp");
  });

  it("retourne un tableau vide si aucun item", () => {
    expect(groupErrorsByProduct([])).toEqual([]);
  });
});
