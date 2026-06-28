import { describe, it, expect, vi } from "vitest";
import {
  buildAdminProductsWhere,
  buildAdminProductsOrderBy,
  findProductIdsWithMissingVariantImages,
} from "@/lib/admin-products-filter";

describe("buildAdminProductsWhere", () => {
  it("returns an empty where when no filter is active", () => {
    expect(buildAdminProductsWhere({})).toEqual({});
  });

  it("by default: name contains OR reference startsWith (LIKE 'abc%')", () => {
    const where = buildAdminProductsWhere({ q: "abc" });
    expect(where.OR).toEqual([
      { name: { contains: "abc" } },
      { reference: { startsWith: "abc" } },
    ]);
  });

  it("applies an exact reference match (uppercased) when exactRef is true", () => {
    const where = buildAdminProductsWhere({ q: "ref-42", exactRef: true });
    expect(where).toEqual({ reference: { equals: "REF-42" } });
  });

  it("supports multiple comma-separated terms in fuzzy mode (OR across each, ref startsWith)", () => {
    const where = buildAdminProductsWhere({ q: "abc, def , ghi" });
    expect(where.OR).toEqual([
      { name: { contains: "abc" } },
      { reference: { startsWith: "abc" } },
      { name: { contains: "def" } },
      { reference: { startsWith: "def" } },
      { name: { contains: "ghi" } },
      { reference: { startsWith: "ghi" } },
    ]);
  });

  it("supports multiple comma-separated references in exactRef mode (IN, uppercased)", () => {
    const where = buildAdminProductsWhere({ q: "ref-1, ref-2", exactRef: true });
    expect(where).toEqual({ reference: { in: ["REF-1", "REF-2"] } });
  });

  it("ignores empty terms between commas", () => {
    const where = buildAdminProductsWhere({ q: ",abc,, ,def,", exactRef: true });
    expect(where).toEqual({ reference: { in: ["ABC", "DEF"] } });
  });

  it("filters by category id", () => {
    expect(buildAdminProductsWhere({ cat: "cat-1" }).categoryId).toBe("cat-1");
  });

  it("filters by sub-category via the M2M relation", () => {
    const where = buildAdminProductsWhere({ subCat: "sub-1" });
    expect(where.subCategories).toEqual({ some: { id: "sub-1" } });
  });

  it("filters by tag via the join table", () => {
    const where = buildAdminProductsWhere({ tag: "tag-1" });
    expect(where.tags).toEqual({ some: { tagId: "tag-1" } });
  });

  it("filters by composition via the join table", () => {
    const where = buildAdminProductsWhere({ composition: "comp-1" });
    expect(where.compositions).toEqual({ some: { compositionId: "comp-1" } });
  });

  it("ignores composition filter when value is empty", () => {
    expect(buildAdminProductsWhere({ composition: "" }).compositions).toBeUndefined();
  });

  it("filters best-sellers when bestSeller is '1'", () => {
    expect(buildAdminProductsWhere({ bestSeller: "1" }).isBestSeller).toBe(true);
  });

  it("ignores best-seller filter when value is empty", () => {
    expect(buildAdminProductsWhere({ bestSeller: "" }).isBestSeller).toBeUndefined();
  });

  it("filters never-refreshed products with refresh=never", () => {
    const where = buildAdminProductsWhere({ refresh: "never" });
    expect(where.lastRefreshedAt).toBeNull();
  });

  it("filters already refreshed products with refresh=refreshed", () => {
    const where = buildAdminProductsWhere({ refresh: "refreshed" });
    expect(where.lastRefreshedAt).toEqual({ not: null });
  });

  it("filters recently refreshed products (30 days window) with refresh=recent", () => {
    const now = new Date("2026-04-27T12:00:00Z");
    const where = buildAdminProductsWhere({ refresh: "recent", now });
    const expected = new Date(now);
    expected.setDate(expected.getDate() - 30);
    expect(where.lastRefreshedAt).toEqual({ gte: expected });
  });

  it("maps DRAFT status to OFFLINE + isIncomplete=true", () => {
    const where = buildAdminProductsWhere({ status: "DRAFT" });
    expect(where).toMatchObject({ status: "OFFLINE", isIncomplete: true });
  });

  it("maps OFFLINE status to OFFLINE + isIncomplete=false (excludes drafts)", () => {
    const where = buildAdminProductsWhere({ status: "OFFLINE" });
    expect(where).toMatchObject({ status: "OFFLINE", isIncomplete: false });
  });

  it("passes ONLINE / ARCHIVED through unchanged", () => {
    expect(buildAdminProductsWhere({ status: "ONLINE" }).status).toBe("ONLINE");
    expect(buildAdminProductsWhere({ status: "ARCHIVED" }).status).toBe("ARCHIVED");
  });

  it("combines price min and max into a single colors.some clause", () => {
    const where = buildAdminProductsWhere({ minPrice: 10, maxPrice: 50 });
    expect(where.colors).toEqual({ some: { unitPrice: { gte: 10, lte: 50 } } });
  });

  it("combines price and stock into the same colors.some clause", () => {
    const where = buildAdminProductsWhere({ minPrice: 10, stockBelow: 5 });
    expect(where.colors).toEqual({
      some: { unitPrice: { gte: 10 }, stock: { lte: 5 } },
    });
  });

  it("applies stock threshold alone", () => {
    const where = buildAdminProductsWhere({ stockBelow: 3 });
    expect(where.colors).toEqual({ some: { stock: { lte: 3 } } });
  });

  it("applies dateFrom and clamps dateTo to end of day", () => {
    const where = buildAdminProductsWhere({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
    });
    const created = where.createdAt as { gte: Date; lte: Date };
    expect(created.gte).toEqual(new Date("2026-01-01"));
    expect(created.lte.getHours()).toBe(23);
    expect(created.lte.getMinutes()).toBe(59);
  });

  it("supports several filters at once without clobbering them", () => {
    const where = buildAdminProductsWhere({
      cat: "c1",
      subCat: "s1",
      tag: "t1",
      bestSeller: "1",
      refresh: "never",
      status: "ONLINE",
    });
    expect(where).toMatchObject({
      categoryId: "c1",
      subCategories: { some: { id: "s1" } },
      tags: { some: { tagId: "t1" } },
      isBestSeller: true,
      lastRefreshedAt: null,
      status: "ONLINE",
    });
  });

  it("does not apply any lastRefreshedAt where clause for refresh=dateDesc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "dateDesc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("does not apply any lastRefreshedAt where clause for refresh=dateAsc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "dateAsc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("does not apply any lastRefreshedAt where clause for refresh=modifiedDesc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "modifiedDesc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("does not apply any lastRefreshedAt where clause for refresh=modifiedAsc (it's a sort, not a filter)", () => {
    const where = buildAdminProductsWhere({ refresh: "modifiedAsc" });
    expect(where.lastRefreshedAt).toBeUndefined();
  });

  it("restricts to the given productIdsIn list when provided", () => {
    const where = buildAdminProductsWhere({ productIdsIn: ["p1", "p2"] });
    expect(where.id).toEqual({ in: ["p1", "p2"] });
  });

  it("returns no products when productIdsIn is an empty array (zero matches)", () => {
    const where = buildAdminProductsWhere({ productIdsIn: [] });
    expect(where.id).toEqual({ in: [] });
  });

  it("does not set where.id when productIdsIn is null or undefined", () => {
    expect(buildAdminProductsWhere({ productIdsIn: null }).id).toBeUndefined();
    expect(buildAdminProductsWhere({}).id).toBeUndefined();
  });

  it("combines productIdsIn with other filters without clobbering them", () => {
    const where = buildAdminProductsWhere({
      productIdsIn: ["p1"],
      cat: "c1",
      status: "ONLINE",
    });
    expect(where).toMatchObject({
      id: { in: ["p1"] },
      categoryId: "c1",
      status: "ONLINE",
    });
  });

  it("excludes the given productIdsNotIn list when provided", () => {
    const where = buildAdminProductsWhere({ productIdsNotIn: ["p1", "p2"] });
    expect(where.id).toEqual({ notIn: ["p1", "p2"] });
  });

  it("sets where.id with empty notIn when productIdsNotIn is an empty array", () => {
    const where = buildAdminProductsWhere({ productIdsNotIn: [] });
    expect(where.id).toEqual({ notIn: [] });
  });

  it("does not set where.id when productIdsNotIn is null or undefined", () => {
    expect(buildAdminProductsWhere({ productIdsNotIn: null }).id).toBeUndefined();
  });

  it("combines productIdsIn and productIdsNotIn on where.id without clobbering", () => {
    const where = buildAdminProductsWhere({
      productIdsIn: ["p1", "p2"],
      productIdsNotIn: ["p3"],
    });
    expect(where.id).toEqual({ in: ["p1", "p2"], notIn: ["p3"] });
  });

  it("requires both product and all UNIT colors to be linked when pfsLink=linked", () => {
    const where = buildAdminProductsWhere({ pfsLink: "linked" });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
    ]);
  });

  it("matches products that are unlinked OR have at least one unlinked UNIT color when pfsLink=unlinked", () => {
    const where = buildAdminProductsWhere({ pfsLink: "unlinked" });
    expect(where.pfsProductId).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { pfsProductId: null },
          { colors: { some: { saleType: "UNIT", pfsVariantId: null } } },
        ],
      },
    ]);
  });

  it("ignores pfsLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ pfsLink: "" }).pfsProductId).toBeUndefined();
    expect(buildAdminProductsWhere({ pfsLink: "lol" }).pfsProductId).toBeUndefined();
  });

  it("requires both product and all UNIT colors to be linked when ankorsLink=linked", () => {
    const where = buildAdminProductsWhere({ ankorsLink: "linked" });
    expect(where.ankorsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } } },
    ]);
  });

  it("matches products that are unlinked OR have at least one unlinked UNIT color when ankorsLink=unlinked", () => {
    const where = buildAdminProductsWhere({ ankorsLink: "unlinked" });
    expect(where.ankorsProductId).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { ankorsProductId: null },
          { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } },
        ],
      },
    ]);
  });

  it("ignores ankorsLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ ankorsLink: "" }).ankorsProductId).toBeUndefined();
    expect(buildAdminProductsWhere({ ankorsLink: "x" }).ankorsProductId).toBeUndefined();
  });

  it("combines pfsLink and ankorsLink without clobbering each other", () => {
    const where = buildAdminProductsWhere({ pfsLink: "linked", ankorsLink: "unlinked" });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
      {
        OR: [
          { ankorsProductId: null },
          { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } },
        ],
      },
    ]);
  });

  it("requires reference base set and all UNIT colors linked when efashionLink=linked", () => {
    const where = buildAdminProductsWhere({ efashionLink: "linked" });
    expect(where.efashionReferenceBase).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", efashionProductId: null } } } },
    ]);
  });

  it("matches products without reference base OR with at least one unlinked UNIT color when efashionLink=unlinked", () => {
    const where = buildAdminProductsWhere({ efashionLink: "unlinked" });
    expect(where.efashionReferenceBase).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { efashionReferenceBase: null },
          { colors: { some: { saleType: "UNIT", efashionProductId: null } } },
        ],
      },
    ]);
  });

  it("ignores efashionLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ efashionLink: "" }).efashionReferenceBase).toBeUndefined();
    expect(buildAdminProductsWhere({ efashionLink: "nope" }).efashionReferenceBase).toBeUndefined();
  });

  it("requires both product and all UNIT colors to be linked when faireLink=linked", () => {
    const where = buildAdminProductsWhere({ faireLink: "linked" });
    expect(where.faireProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", faireVariantId: null } } } },
    ]);
  });

  it("matches products without faireProductId OR with at least one unlinked UNIT color when faireLink=unlinked", () => {
    const where = buildAdminProductsWhere({ faireLink: "unlinked" });
    expect(where.faireProductId).toBeUndefined();
    expect(where.AND).toEqual([
      {
        OR: [
          { faireProductId: null },
          { colors: { some: { saleType: "UNIT", faireVariantId: null } } },
        ],
      },
    ]);
  });

  it("ignores faireLink when value is empty or unknown", () => {
    expect(buildAdminProductsWhere({ faireLink: "" }).faireProductId).toBeUndefined();
    expect(buildAdminProductsWhere({ faireLink: "nope" }).faireProductId).toBeUndefined();
  });

  it("syncRequired='1' ajoute un OR sur les quatre drapeaux *SyncRequired (AND avec les autres filtres)", () => {
    const where = buildAdminProductsWhere({ syncRequired: "1" });
    expect(where.AND).toEqual([
      {
        OR: [
          { pfsSyncRequired: true },
          { ankorsSyncRequired: true },
          { efashionSyncRequired: true },
          { faireSyncRequired: true },
        ],
      },
    ]);
  });

  it("ignore syncRequired pour toute autre valeur que '1'", () => {
    expect(buildAdminProductsWhere({ syncRequired: "" }).AND).toBeUndefined();
    expect(buildAdminProductsWhere({ syncRequired: "0" }).AND).toBeUndefined();
    expect(buildAdminProductsWhere({ syncRequired: "true" }).AND).toBeUndefined();
  });

  it("syncRequired combiné avec un filtre lien marketplace : les deux contraintes coexistent", () => {
    const where = buildAdminProductsWhere({ pfsLink: "linked", syncRequired: "1" });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
      {
        OR: [
          { pfsSyncRequired: true },
          { ankorsSyncRequired: true },
          { efashionSyncRequired: true },
          { faireSyncRequired: true },
        ],
      },
    ]);
  });

  it("locked='1' restreint à Product.locked=true", () => {
    expect(buildAdminProductsWhere({ locked: "1" }).locked).toBe(true);
  });

  it("ignore locked pour toute autre valeur que '1'", () => {
    expect(buildAdminProductsWhere({ locked: "" }).locked).toBeUndefined();
    expect(buildAdminProductsWhere({ locked: "0" }).locked).toBeUndefined();
    expect(buildAdminProductsWhere({ locked: "true" }).locked).toBeUndefined();
  });

  it("locked combiné avec d'autres filtres : les contraintes coexistent", () => {
    const where = buildAdminProductsWhere({ locked: "1", cat: "c1", status: "ONLINE" });
    expect(where).toMatchObject({
      locked: true,
      categoryId: "c1",
      status: "ONLINE",
    });
  });

  describe("Dernier export marketplace", () => {
    const NOW = new Date("2026-06-24T12:00:00Z");

    it("ignore les filtres vides (par défaut)", () => {
      const where = buildAdminProductsWhere({
        pfsExportedAt: "",
        efashionExportedAt: "",
        microstoreExportedAt: "",
        ankorstoreExportedAt: "",
        now: NOW,
      });
      expect(where.AND).toBeUndefined();
    });

    it("pfsExportedAt='never' filtre sur pfsLastExportedAt IS NULL", () => {
      const where = buildAdminProductsWhere({ pfsExportedAt: "never", now: NOW });
      expect(where.AND).toEqual([{ pfsLastExportedAt: null }]);
    });

    it("efashionExportedAt='never' filtre sur efashionLastExportedAt IS NULL", () => {
      const where = buildAdminProductsWhere({ efashionExportedAt: "never", now: NOW });
      expect(where.AND).toEqual([{ efashionLastExportedAt: null }]);
    });

    it("microstoreExportedAt='never' filtre sur microstoreLastExportedAt IS NULL", () => {
      const where = buildAdminProductsWhere({ microstoreExportedAt: "never", now: NOW });
      expect(where.AND).toEqual([{ microstoreLastExportedAt: null }]);
    });

    it("ankorstoreExportedAt='never' filtre sur ankorstoreLastExportedAt IS NULL", () => {
      const where = buildAdminProductsWhere({ ankorstoreExportedAt: "never", now: NOW });
      expect(where.AND).toEqual([{ ankorstoreLastExportedAt: null }]);
    });

    it("lt7d : retient les produits exportés dans les 7 derniers jours (gte cutoff)", () => {
      const where = buildAdminProductsWhere({ pfsExportedAt: "lt7d", now: NOW });
      const cutoff = new Date(NOW);
      cutoff.setDate(cutoff.getDate() - 7);
      expect(where.AND).toEqual([{ pfsLastExportedAt: { gte: cutoff } }]);
    });

    it("lt30d : retient les produits exportés dans les 30 derniers jours", () => {
      const where = buildAdminProductsWhere({ pfsExportedAt: "lt30d", now: NOW });
      const cutoff = new Date(NOW);
      cutoff.setDate(cutoff.getDate() - 30);
      expect(where.AND).toEqual([{ pfsLastExportedAt: { gte: cutoff } }]);
    });

    it("gt30d : retient les produits exportés il y a plus de 30 jours (lt cutoff)", () => {
      const where = buildAdminProductsWhere({ pfsExportedAt: "gt30d", now: NOW });
      const cutoff = new Date(NOW);
      cutoff.setDate(cutoff.getDate() - 30);
      expect(where.AND).toEqual([{ pfsLastExportedAt: { lt: cutoff } }]);
    });

    it("gt90d : retient les produits exportés il y a plus de 90 jours", () => {
      const where = buildAdminProductsWhere({ pfsExportedAt: "gt90d", now: NOW });
      const cutoff = new Date(NOW);
      cutoff.setDate(cutoff.getDate() - 90);
      expect(where.AND).toEqual([{ pfsLastExportedAt: { lt: cutoff } }]);
    });

    it("ignore les valeurs inconnues", () => {
      const where = buildAdminProductsWhere({ pfsExportedAt: "bidon", now: NOW });
      expect(where.AND).toBeUndefined();
    });

    it("combine les 4 filtres marketplace en AND", () => {
      const where = buildAdminProductsWhere({
        pfsExportedAt: "never",
        efashionExportedAt: "lt7d",
        microstoreExportedAt: "gt30d",
        ankorstoreExportedAt: "lt30d",
        now: NOW,
      });
      const c7  = new Date(NOW); c7.setDate(c7.getDate() - 7);
      const c30 = new Date(NOW); c30.setDate(c30.getDate() - 30);
      expect(where.AND).toEqual([
        { pfsLastExportedAt: null },
        { efashionLastExportedAt: { gte: c7 } },
        { microstoreLastExportedAt: { lt: c30 } },
        { ankorstoreLastExportedAt: { gte: c30 } },
      ]);
    });

    it("se combine avec d'autres filtres (status, cat) sans écraser le AND", () => {
      const where = buildAdminProductsWhere({
        status: "ONLINE",
        cat: "c1",
        ankorstoreExportedAt: "never",
        now: NOW,
      });
      expect(where).toMatchObject({ status: "ONLINE", categoryId: "c1" });
      expect(where.AND).toEqual([{ ankorstoreLastExportedAt: null }]);
    });

    it("coexiste avec syncRequired et pfsLink (AND empilé)", () => {
      const where = buildAdminProductsWhere({
        pfsLink: "linked",
        syncRequired: "1",
        pfsExportedAt: "never",
        now: NOW,
      });
      expect(where.AND).toEqual([
        { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
        {
          OR: [
            { pfsSyncRequired: true },
            { ankorsSyncRequired: true },
            { efashionSyncRequired: true },
            { faireSyncRequired: true },
          ],
        },
        { pfsLastExportedAt: null },
      ]);
    });
  });

  it("combines all three marketplace filters without clobbering each other", () => {
    const where = buildAdminProductsWhere({
      pfsLink: "linked",
      ankorsLink: "linked",
      efashionLink: "unlinked",
    });
    expect(where.pfsProductId).toEqual({ not: null });
    expect(where.ankorsProductId).toEqual({ not: null });
    expect(where.efashionReferenceBase).toBeUndefined();
    expect(where.AND).toEqual([
      { NOT: { colors: { some: { saleType: "UNIT", pfsVariantId: null } } } },
      { NOT: { colors: { some: { saleType: "UNIT", ankorsVariantId: null } } } },
      {
        OR: [
          { efashionReferenceBase: null },
          { colors: { some: { saleType: "UNIT", efashionProductId: null } } },
        ],
      },
    ]);
  });
});

describe("findProductIdsWithMissingVariantImages", () => {
  it("returns the productIds reported by the raw query", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([
      { productId: "p1" },
      { productId: "p2" },
    ]);
    const ids = await findProductIdsWithMissingVariantImages({ $queryRaw } as never);
    expect(ids).toEqual(["p1", "p2"]);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array when no product has a variant without images", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    const ids = await findProductIdsWithMissingVariantImages({ $queryRaw } as never);
    expect(ids).toEqual([]);
  });
});

describe("buildAdminProductsOrderBy", () => {
  it("defaults to createdAt desc when no refresh value is given", () => {
    expect(buildAdminProductsOrderBy()).toEqual([{ createdAt: "desc" }]);
  });

  it("defaults to createdAt desc for empty / filter-only refresh values", () => {
    expect(buildAdminProductsOrderBy("")).toEqual([{ createdAt: "desc" }]);
    expect(buildAdminProductsOrderBy("never")).toEqual([{ createdAt: "desc" }]);
    expect(buildAdminProductsOrderBy("refreshed")).toEqual([{ createdAt: "desc" }]);
    expect(buildAdminProductsOrderBy("recent")).toEqual([{ createdAt: "desc" }]);
  });

  it("sorts by lastRefreshedAt desc with never-refreshed products last for refresh=dateDesc", () => {
    expect(buildAdminProductsOrderBy("dateDesc")).toEqual([
      { lastRefreshedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ]);
  });

  it("sorts by lastRefreshedAt asc with never-refreshed products last for refresh=dateAsc", () => {
    expect(buildAdminProductsOrderBy("dateAsc")).toEqual([
      { lastRefreshedAt: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
    ]);
  });

  it("sorts by updatedAt desc for refresh=modifiedDesc (most recently edited first)", () => {
    expect(buildAdminProductsOrderBy("modifiedDesc")).toEqual([
      { updatedAt: "desc" },
    ]);
  });

  it("sorts by updatedAt asc for refresh=modifiedAsc (oldest edited first)", () => {
    expect(buildAdminProductsOrderBy("modifiedAsc")).toEqual([
      { updatedAt: "asc" },
    ]);
  });
});
