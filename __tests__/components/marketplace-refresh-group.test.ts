import { describe, it, expect } from "vitest";
import type { MarketplaceRefreshItem } from "@/components/admin/products/MarketplaceRefreshContext";
import {
  groupItemsByProduct,
  groupHasActive,
  groupHasError,
  groupAllDone,
  sortGroups,
  groupMatchesFilter,
  getMarketplaceOutcome,
  getLocalOutcomeForGroup,
} from "@/components/admin/products/marketplaceRefreshGroup";

function makeItem(overrides: Partial<MarketplaceRefreshItem>): MarketplaceRefreshItem {
  return {
    id: "id",
    productId: "p1",
    reference: "REF",
    productName: "Test product",
    firstImage: null,
    options: { local: false, pfs: true, ankorstore: false },
    mode: "refresh",
    marketplace: "pfs",
    status: "queued",
    ...overrides,
  };
}

describe("groupItemsByProduct", () => {
  it("returns an empty array when given no items", () => {
    expect(groupItemsByProduct([])).toEqual([]);
  });

  it("regroupe plusieurs items du même produit en une seule entrée", () => {
    const items = [
      makeItem({ id: "a", productId: "p1", marketplace: "pfs" }),
      makeItem({ id: "b", productId: "p1", marketplace: "ankorstore" }),
      makeItem({ id: "c", productId: "p1", marketplace: "efashion" }),
    ];
    const groups = groupItemsByProduct(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].productId).toBe("p1");
    expect(groups[0].items.map((i) => i.marketplace)).toEqual([
      "pfs",
      "ankorstore",
      "efashion",
    ]);
  });

  it("garde des groupes séparés pour des produits différents", () => {
    const items = [
      makeItem({ id: "a", productId: "p1" }),
      makeItem({ id: "b", productId: "p2" }),
    ];
    const groups = groupItemsByProduct(items);
    expect(groups).toHaveLength(2);
  });

  it("récupère la première image disponible parmi les items du groupe", () => {
    const items = [
      makeItem({ id: "a", productId: "p1", firstImage: null }),
      makeItem({ id: "b", productId: "p1", firstImage: "/uploads/img.webp" }),
    ];
    const groups = groupItemsByProduct(items);
    expect(groups[0].firstImage).toBe("/uploads/img.webp");
  });
});

describe("groupHasActive / groupHasError / groupAllDone", () => {
  it("groupHasActive = true si au moins un item est in_progress ou awaiting_callback", () => {
    const group = {
      productId: "p1",
      reference: "REF",
      productName: "x",
      firstImage: null,
      items: [
        makeItem({ id: "a", status: "done", pfsOutcome: { ok: true } }),
        makeItem({ id: "b", status: "in_progress" }),
      ],
    };
    expect(groupHasActive(group)).toBe(true);
  });

  it("groupHasError détecte une erreur sur n'importe quelle marketplace", () => {
    const group = {
      productId: "p1",
      reference: "REF",
      productName: "x",
      firstImage: null,
      items: [
        makeItem({
          id: "a",
          marketplace: "pfs",
          status: "done",
          pfsOutcome: { ok: true },
        }),
        makeItem({
          id: "b",
          marketplace: "ankorstore",
          status: "done",
          ankorsOutcome: { ok: false, kind: "error", message: "Boom" },
        }),
      ],
    };
    expect(groupHasError(group)).toBe(true);
  });

  it("groupAllDone = true seulement quand chaque item est en statut done", () => {
    const allDone = {
      productId: "p1",
      reference: "REF",
      productName: "x",
      firstImage: null,
      items: [
        makeItem({ id: "a", status: "done" }),
        makeItem({ id: "b", status: "done" }),
      ],
    };
    const oneQueued = {
      ...allDone,
      items: [
        makeItem({ id: "a", status: "done" }),
        makeItem({ id: "b", status: "queued" }),
      ],
    };
    expect(groupAllDone(allDone)).toBe(true);
    expect(groupAllDone(oneQueued)).toBe(false);
  });
});

describe("sortGroups", () => {
  it("place les groupes actifs avant les groupes en erreur, et les succès en dernier", () => {
    const groups = groupItemsByProduct([
      makeItem({
        id: "ok",
        productId: "p-ok",
        status: "done",
        marketplace: "pfs",
        pfsOutcome: { ok: true },
      }),
      makeItem({
        id: "err",
        productId: "p-err",
        status: "done",
        marketplace: "pfs",
        pfsOutcome: { ok: false, kind: "error", message: "x" },
      }),
      makeItem({
        id: "active",
        productId: "p-active",
        status: "in_progress",
      }),
    ]);
    const sorted = sortGroups(groups);
    expect(sorted.map((g) => g.productId)).toEqual([
      "p-active",
      "p-err",
      "p-ok",
    ]);
  });
});

describe("groupMatchesFilter", () => {
  const makeGroup = (items: MarketplaceRefreshItem[]) => ({
    productId: "p1",
    reference: "REF",
    productName: "x",
    firstImage: null,
    items,
  });

  it("'all' matche toujours", () => {
    expect(
      groupMatchesFilter(makeGroup([makeItem({ status: "done" })]), "all"),
    ).toBe(true);
  });

  it("'in_progress' matche les groupes avec au moins un item queued, in_progress ou awaiting_callback", () => {
    expect(
      groupMatchesFilter(
        makeGroup([
          makeItem({ status: "done", pfsOutcome: { ok: true } }),
          makeItem({ id: "b", status: "in_progress" }),
        ]),
        "in_progress",
      ),
    ).toBe(true);
    expect(
      groupMatchesFilter(
        makeGroup([makeItem({ status: "done", pfsOutcome: { ok: true } })]),
        "in_progress",
      ),
    ).toBe(false);
  });

  it("'error' matche les groupes ayant au moins une erreur", () => {
    expect(
      groupMatchesFilter(
        makeGroup([
          makeItem({
            status: "done",
            pfsOutcome: { ok: false, kind: "error", message: "x" },
          }),
        ]),
        "error",
      ),
    ).toBe(true);
  });

  it("'success' matche seulement les groupes entièrement terminés sans erreur", () => {
    expect(
      groupMatchesFilter(
        makeGroup([
          makeItem({ status: "done", pfsOutcome: { ok: true } }),
          makeItem({
            id: "b",
            marketplace: "ankorstore",
            status: "done",
            ankorsOutcome: { ok: true },
          }),
        ]),
        "success",
      ),
    ).toBe(true);

    // 1 succès + 1 erreur → pas "success"
    expect(
      groupMatchesFilter(
        makeGroup([
          makeItem({ status: "done", pfsOutcome: { ok: true } }),
          makeItem({
            id: "b",
            marketplace: "ankorstore",
            status: "done",
            ankorsOutcome: { ok: false, kind: "error", message: "boom" },
          }),
        ]),
        "success",
      ),
    ).toBe(false);

    // En cours → pas "success"
    expect(
      groupMatchesFilter(
        makeGroup([makeItem({ status: "in_progress" })]),
        "success",
      ),
    ).toBe(false);
  });
});

describe("getMarketplaceOutcome", () => {
  it("retourne l'outcome correspondant à la marketplace de l'item", () => {
    const pfsItem = makeItem({
      marketplace: "pfs",
      pfsOutcome: { ok: true },
      ankorsOutcome: { ok: false, kind: "error", message: "x" },
    });
    expect(getMarketplaceOutcome(pfsItem)).toEqual({ ok: true });

    const ankorsItem = makeItem({
      marketplace: "ankorstore",
      ankorsOutcome: { ok: false, kind: "error", message: "x" },
    });
    expect(getMarketplaceOutcome(ankorsItem)?.ok).toBe(false);

    const efashionItem = makeItem({
      marketplace: "efashion",
      efashionOutcome: { ok: true, archived: true },
    });
    expect(getMarketplaceOutcome(efashionItem)).toEqual({
      ok: true,
      archived: true,
    });
  });
});

describe("getLocalOutcomeForGroup", () => {
  it("retourne le 1er localOutcome trouvé sur un item avec options.local", () => {
    const group = {
      productId: "p1",
      reference: "REF",
      productName: "x",
      firstImage: null,
      items: [
        makeItem({
          id: "a",
          options: { local: false, pfs: true, ankorstore: false },
        }),
        makeItem({
          id: "b",
          options: { local: true, pfs: true, ankorstore: false },
          localOutcome: { ok: true },
        }),
      ],
    };
    expect(getLocalOutcomeForGroup(group)).toEqual({ ok: true });
  });

  it("retourne undefined si aucun item n'a fait de mise à jour locale", () => {
    const group = {
      productId: "p1",
      reference: "REF",
      productName: "x",
      firstImage: null,
      items: [
        makeItem({ options: { local: false, pfs: true, ankorstore: false } }),
      ],
    };
    expect(getLocalOutcomeForGroup(group)).toBeUndefined();
  });
});
