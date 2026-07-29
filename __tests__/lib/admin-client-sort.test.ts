import { describe, it, expect } from "vitest";
import {
  parseClientSort,
  parseSortDir,
  defaultDirFor,
  dirLabel,
  isStatsSort,
  buildUserOrderBy,
  sortClientIdsByStats,
  formatSpent,
  CLIENT_SORT_OPTIONS,
  EMPTY_CLIENT_STATS,
  type ClientOrderStats,
} from "@/lib/admin-client-sort";

describe("parseClientSort", () => {
  it("accepte les 5 critères exposés dans le menu", () => {
    for (const opt of CLIENT_SORT_OPTIONS) {
      expect(parseClientSort(opt.value)).toBe(opt.value);
    }
  });

  it("retombe sur la date d'inscription si le paramètre est absent ou inconnu", () => {
    expect(parseClientSort(undefined)).toBe("created");
    expect(parseClientSort(null)).toBe("created");
    expect(parseClientSort("")).toBe("created");
    expect(parseClientSort("n_importe_quoi")).toBe("created");
    expect(parseClientSort("DROP TABLE")).toBe("created");
  });
});

describe("parseSortDir / defaultDirFor", () => {
  it("respecte un sens explicite", () => {
    expect(parseSortDir("asc", "orders")).toBe("asc");
    expect(parseSortDir("desc", "company")).toBe("desc");
  });

  it("applique le sens naturel du critère quand rien n'est demandé", () => {
    expect(parseSortDir(undefined, "company")).toBe("asc"); // société → A → Z
    expect(parseSortDir(undefined, "orders")).toBe("desc"); // plus de commandes d'abord
    expect(parseSortDir(undefined, "spent")).toBe("desc");
    expect(parseSortDir(undefined, "login")).toBe("desc"); // connexion la plus récente
    expect(parseSortDir(undefined, "created")).toBe("desc");
  });

  it("ignore une valeur de sens invalide", () => {
    expect(parseSortDir("ASC", "company")).toBe("asc");
    expect(parseSortDir("montant", "orders")).toBe("desc");
  });

  it("defaultDirFor couvre tous les critères", () => {
    for (const opt of CLIENT_SORT_OPTIONS) {
      expect(["asc", "desc"]).toContain(defaultDirFor(opt.value));
    }
  });
});

describe("dirLabel", () => {
  it("parle français métier, pas technique", () => {
    expect(dirLabel("company", "asc")).toBe("A → Z");
    expect(dirLabel("company", "desc")).toBe("Z → A");
    expect(dirLabel("orders", "desc")).toBe("Du plus grand nombre");
    expect(dirLabel("orders", "asc")).toBe("Du plus petit nombre");
    expect(dirLabel("login", "desc")).toBe("Connexion la plus récente");
    expect(dirLabel("created", "asc")).toBe("Plus anciens d'abord");
  });
});

describe("isStatsSort", () => {
  it("ne réclame les agrégats Order que pour commandes et montant", () => {
    expect(isStatsSort("orders")).toBe(true);
    expect(isStatsSort("spent")).toBe(true);
    expect(isStatsSort("created")).toBe(false);
    expect(isStatsSort("login")).toBe(false);
    expect(isStatsSort("company")).toBe(false);
  });
});

describe("buildUserOrderBy", () => {
  it("mappe chaque critère sur la bonne colonne", () => {
    expect(buildUserOrderBy("created", "desc")).toEqual({ createdAt: "desc" });
    expect(buildUserOrderBy("created", "asc")).toEqual({ createdAt: "asc" });
    expect(buildUserOrderBy("login", "desc")).toEqual({ lastLoginAt: "desc" });
    expect(buildUserOrderBy("login", "asc")).toEqual({ lastLoginAt: "asc" });
    expect(buildUserOrderBy("company", "asc")).toEqual({ company: "asc" });
    expect(buildUserOrderBy("company", "desc")).toEqual({ company: "desc" });
  });

  it("retombe sur la date d'inscription pour les critères agrégés (jamais utilisé, mais sûr)", () => {
    expect(buildUserOrderBy("orders", "desc")).toEqual({ createdAt: "desc" });
    expect(buildUserOrderBy("spent", "asc")).toEqual({ createdAt: "asc" });
  });
});

describe("sortClientIdsByStats", () => {
  const stats = new Map<string, ClientOrderStats>([
    ["marie", { count: 24, spent: 18430 }],
    ["paul", { count: 17, spent: 21050 }], // moins de commandes, mais panier plus gros
    ["sofia", { count: 12, spent: 7890 }],
  ]);
  // theo n'a aucune commande : absent de la map
  const ids = ["marie", "paul", "sofia", "theo"];

  it("classe du plus grand nombre de commandes au plus petit", () => {
    expect(sortClientIdsByStats(ids, stats, "orders", "desc")).toEqual([
      "marie",
      "paul",
      "sofia",
      "theo",
    ]);
  });

  it("classe du plus petit au plus grand en ordre croissant", () => {
    expect(sortClientIdsByStats(ids, stats, "orders", "asc")).toEqual([
      "theo",
      "sofia",
      "paul",
      "marie",
    ]);
  });

  it("classe par montant dépensé, indépendamment du nombre de commandes", () => {
    expect(sortClientIdsByStats(ids, stats, "spent", "desc")).toEqual([
      "paul",
      "marie",
      "sofia",
      "theo",
    ]);
  });

  it("traite un client sans commande comme 0 et non comme absent", () => {
    const result = sortClientIdsByStats(ids, stats, "spent", "asc");
    expect(result[0]).toBe("theo");
    expect(result).toHaveLength(4);
  });

  it("conserve l'ordre d'entrée pour les ex æquo (tri stable)", () => {
    const zeros = new Map<string, ClientOrderStats>();
    const inscrits = ["recent", "moyen", "ancien"]; // déjà triés par inscription desc
    expect(sortClientIdsByStats(inscrits, zeros, "orders", "desc")).toEqual(inscrits);
    expect(sortClientIdsByStats(inscrits, zeros, "orders", "asc")).toEqual(inscrits);
  });

  it("ne modifie pas le tableau d'origine", () => {
    const original = [...ids];
    sortClientIdsByStats(ids, stats, "orders", "desc");
    expect(ids).toEqual(original);
  });

  it("gère une liste vide", () => {
    expect(sortClientIdsByStats([], stats, "orders", "desc")).toEqual([]);
  });
});

describe("formatSpent", () => {
  it("affiche un montant en euros sans centimes", () => {
    // Intl fr-FR utilise des espaces insécables : on normalise avant comparaison
    const normalize = (s: string) => s.replace(/ | /g, " ");
    expect(normalize(formatSpent(18430))).toBe("18 430 €");
    expect(normalize(formatSpent(0))).toBe("0 €");
    expect(normalize(formatSpent(1234.56))).toBe("1 235 €");
  });
});

describe("EMPTY_CLIENT_STATS", () => {
  it("représente un client sans aucune commande", () => {
    expect(EMPTY_CLIENT_STATS).toEqual({ count: 0, spent: 0 });
  });
});
