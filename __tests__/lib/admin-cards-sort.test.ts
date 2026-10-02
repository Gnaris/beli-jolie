import { describe, it, expect } from "vitest";
import {
  parseAdminCardsSort,
  isAdminCardStatsSort,
  sortCardIdsByStats,
  ADMIN_CARDS_SORT_VALUES,
  type AdminCardOrderStats,
} from "@/lib/admin-cards-sort";

describe("parseAdminCardsSort", () => {
  it("accepte toutes les valeurs connues", () => {
    for (const v of ADMIN_CARDS_SORT_VALUES) {
      expect(parseAdminCardsSort(v)).toBe(v);
    }
  });

  it("retombe sur created si inconnu / absent", () => {
    expect(parseAdminCardsSort(undefined)).toBe("created");
    expect(parseAdminCardsSort(null)).toBe("created");
    expect(parseAdminCardsSort("")).toBe("created");
    expect(parseAdminCardsSort("DROP TABLE")).toBe("created");
  });
});

describe("isAdminCardStatsSort", () => {
  it("vrai uniquement pour les tris CA / nb de commandes", () => {
    expect(isAdminCardStatsSort("amount_desc")).toBe(true);
    expect(isAdminCardStatsSort("amount_asc")).toBe(true);
    expect(isAdminCardStatsSort("count_desc")).toBe(true);
    expect(isAdminCardStatsSort("count_asc")).toBe(true);
  });

  it("faux pour les autres (created, order_*)", () => {
    expect(isAdminCardStatsSort("created")).toBe(false);
    expect(isAdminCardStatsSort("order_desc")).toBe(false);
    expect(isAdminCardStatsSort("order_asc")).toBe(false);
  });
});

describe("sortCardIdsByStats", () => {
  const stats = new Map<string, AdminCardOrderStats>([
    ["a", { count: 3, amount: 100 }],
    ["b", { count: 10, amount: 50 }],
    ["c", { count: 1, amount: 500 }],
    // "d" absent → traité comme { count: 0, amount: 0 }
  ]);
  const ids = ["a", "b", "c", "d"];

  it("trie par CA décroissant (le + élevé d'abord)", () => {
    expect(sortCardIdsByStats(ids, stats, "amount_desc")).toEqual(["c", "a", "b", "d"]);
  });

  it("trie par CA croissant (le + bas d'abord, fiche sans commande première)", () => {
    expect(sortCardIdsByStats(ids, stats, "amount_asc")).toEqual(["d", "b", "a", "c"]);
  });

  it("trie par nb de commandes décroissant", () => {
    expect(sortCardIdsByStats(ids, stats, "count_desc")).toEqual(["b", "a", "c", "d"]);
  });

  it("trie par nb de commandes croissant", () => {
    expect(sortCardIdsByStats(ids, stats, "count_asc")).toEqual(["d", "c", "a", "b"]);
  });

  it("ne modifie pas le tableau source", () => {
    const original = ["a", "b", "c"];
    sortCardIdsByStats(original, stats, "amount_desc");
    expect(original).toEqual(["a", "b", "c"]);
  });

  it("renvoie l'ordre d'origine si le tri n'est pas stats-based", () => {
    expect(sortCardIdsByStats(ids, stats, "created")).toEqual(ids);
    expect(sortCardIdsByStats(ids, stats, "order_desc")).toEqual(ids);
  });

  it("sort stable : ex æquo gardent leur ordre d'arrivée", () => {
    const tied = new Map<string, AdminCardOrderStats>([
      ["x", { count: 5, amount: 100 }],
      ["y", { count: 5, amount: 100 }],
      ["z", { count: 5, amount: 100 }],
    ]);
    expect(sortCardIdsByStats(["x", "y", "z"], tied, "amount_desc")).toEqual(["x", "y", "z"]);
    expect(sortCardIdsByStats(["z", "y", "x"], tied, "count_desc")).toEqual(["z", "y", "x"]);
  });
});
