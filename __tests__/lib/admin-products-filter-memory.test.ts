/**
 * Tests pour lib/admin-products-filter-memory.ts
 *
 * Garantit que les filtres de la page /admin/produits sont :
 *  - sauvegardés dans sessionStorage quand l'URL en contient,
 *  - restaurés quand l'URL est nue mais qu'une mémoire existe,
 *  - vidés quand l'admin clique « Effacer les filtres ».
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ADMIN_PRODUCTS_FILTERS_STORAGE_KEY,
  extractFiltersQueryString,
  hasAnyFilter,
  saveFilters,
  loadFiltersToRestore,
  clearFilters,
} from "@/lib/admin-products-filter-memory";

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  };
}

describe("extractFiltersQueryString", () => {
  it("ne garde que les clés de filtres et pagination connues", () => {
    const qs = "q=rose&tab=categories&cat=abc&random=foo&page=3";
    const extracted = new URLSearchParams(extractFiltersQueryString(qs));
    expect(extracted.get("q")).toBe("rose");
    expect(extracted.get("cat")).toBe("abc");
    expect(extracted.get("page")).toBe("3");
    expect(extracted.get("tab")).toBeNull();
    expect(extracted.get("random")).toBeNull();
  });

  it("retourne une chaîne vide quand aucun filtre n'est présent", () => {
    expect(extractFiltersQueryString("")).toBe("");
    expect(extractFiltersQueryString("tab=categories")).toBe("");
  });

  it("ignore les paramètres vides", () => {
    expect(extractFiltersQueryString("q=&cat=")).toBe("");
  });

  it("garde les filtres de lien marketplace (pfsLink, ankorsLink, efashionLink, faireLink)", () => {
    const extracted = new URLSearchParams(
      extractFiltersQueryString("pfsLink=linked&ankorsLink=unlinked&efashionLink=linked&faireLink=unlinked"),
    );
    expect(extracted.get("pfsLink")).toBe("linked");
    expect(extracted.get("ankorsLink")).toBe("unlinked");
    expect(extracted.get("efashionLink")).toBe("linked");
    expect(extracted.get("faireLink")).toBe("unlinked");
  });

  it("garde le filtre syncRequired (synchronisation marketplace nécessaire)", () => {
    const extracted = new URLSearchParams(
      extractFiltersQueryString("syncRequired=any"),
    );
    expect(extracted.get("syncRequired")).toBe("any");
  });
});

describe("hasAnyFilter", () => {
  it("vrai dès qu'au moins un filtre est posé", () => {
    expect(hasAnyFilter("status=ONLINE")).toBe(true);
    expect(hasAnyFilter("page=2")).toBe(true);
  });

  it("faux quand seul un onglet est présent", () => {
    expect(hasAnyFilter("tab=couleurs")).toBe(false);
    expect(hasAnyFilter("")).toBe(false);
  });
});

describe("saveFilters / loadFiltersToRestore / clearFilters", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("sauve les filtres présents dans l'URL", () => {
    saveFilters("status=ONLINE&cat=abc&tab=ignored", storage);
    const saved = storage.getItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY);
    expect(saved).not.toBeNull();
    const params = new URLSearchParams(saved as string);
    expect(params.get("status")).toBe("ONLINE");
    expect(params.get("cat")).toBe("abc");
    expect(params.get("tab")).toBeNull();
  });

  it("n'écrase pas la mémoire quand l'URL n'a aucun filtre", () => {
    storage.setItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY, "status=ONLINE");
    saveFilters("", storage);
    expect(storage.getItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY)).toBe("status=ONLINE");
  });

  it("propose la restauration quand URL nue + mémoire existante", () => {
    storage.setItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY, "status=ONLINE&page=2");
    expect(loadFiltersToRestore("", storage)).toBe("status=ONLINE&page=2");
  });

  it("ne restaure rien quand l'URL contient déjà un filtre", () => {
    storage.setItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY, "status=ONLINE");
    expect(loadFiltersToRestore("cat=xyz", storage)).toBeNull();
  });

  it("ne restaure rien quand la mémoire est vide", () => {
    expect(loadFiltersToRestore("", storage)).toBeNull();
  });

  it("considère un onglet seul comme une URL nue (restauration autorisée)", () => {
    storage.setItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY, "status=OFFLINE");
    expect(loadFiltersToRestore("tab=couleurs", storage)).toBe("status=OFFLINE");
  });

  it("clearFilters vide la mémoire", () => {
    storage.setItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY, "status=ONLINE");
    clearFilters(storage);
    expect(storage.getItem(ADMIN_PRODUCTS_FILTERS_STORAGE_KEY)).toBeNull();
  });

  it("avale silencieusement une exception sessionStorage", () => {
    const broken: Storage = {
      get length() {
        return 0;
      },
      clear: () => undefined,
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
      key: () => null,
    };
    expect(() => saveFilters("status=ONLINE", broken)).not.toThrow();
    expect(() => loadFiltersToRestore("", broken)).not.toThrow();
    expect(() => clearFilters(broken)).not.toThrow();
    expect(loadFiltersToRestore("", broken)).toBeNull();
  });
});
