import { describe, it, expect } from "vitest";
import {
  SETTINGS_TILES,
  GROUP_ORDER,
  getTileMeta,
  isSettingsTile,
  resolveOpenTile,
} from "@/lib/settings-tiles";

describe("SETTINGS_TILES", () => {
  it("expose 12 tuiles", () => {
    expect(SETTINGS_TILES).toHaveLength(12);
  });

  it("chaque clé a un label, description, groupe et accent", () => {
    for (const key of SETTINGS_TILES) {
      const m = getTileMeta(key);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(10);
      expect(GROUP_ORDER.some((g) => g.key === m.group)).toBe(true);
      expect(["slate", "sky", "emerald", "violet", "rose", "amber"]).toContain(m.accent);
    }
  });

  it("les titres sont uniques", () => {
    const titles = SETTINGS_TILES.map((k) => getTileMeta(k).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("chaque groupe déclaré est représenté par au moins une tuile", () => {
    const usedGroups = new Set(SETTINGS_TILES.map((k) => getTileMeta(k).group));
    for (const g of GROUP_ORDER) {
      expect(usedGroups.has(g.key)).toBe(true);
    }
  });
});

describe("isSettingsTile", () => {
  it("accepte les tuiles connues", () => {
    expect(isSettingsTile("vitrine")).toBe(true);
    expect(isSettingsTile("marketplaces")).toBe(true);
    expect(isSettingsTile("maintenance")).toBe(true);
  });

  it("rejette les valeurs inconnues ou mal cassées", () => {
    expect(isSettingsTile("inconnu")).toBe(false);
    expect(isSettingsTile("")).toBe(false);
    expect(isSettingsTile("VITRINE")).toBe(false);
  });
});

describe("resolveOpenTile — rétrocompat des liens historiques", () => {
  it("prend ?open= en priorité si valide", () => {
    expect(resolveOpenTile({ open: "paiement" })).toBe("paiement");
    expect(resolveOpenTile({ open: "paiement", tab: "marketplaces" })).toBe("paiement");
  });

  it("ignore un ?open= invalide et tombe sur ?tab= si connu", () => {
    expect(resolveOpenTile({ open: "n-importe-quoi", tab: "marketplaces" })).toBe("marketplaces");
  });

  it("mappe les 14 anciens onglets vers les 12 tuiles", () => {
    expect(resolveOpenTile({ tab: "general" })).toBe("vitrine");
    expect(resolveOpenTile({ tab: "societe" })).toBe("societe");
    expect(resolveOpenTile({ tab: "catalogue" })).toBe("regles");
    expect(resolveOpenTile({ tab: "carrousels" })).toBe("contenu");
    expect(resolveOpenTile({ tab: "stock" })).toBe("regles");
    expect(resolveOpenTile({ tab: "maintenance" })).toBe("maintenance");
    expect(resolveOpenTile({ tab: "livraison" })).toBe("livraison");
    expect(resolveOpenTile({ tab: "paiement" })).toBe("paiement");
    expect(resolveOpenTile({ tab: "marketplaces" })).toBe("marketplaces");
    expect(resolveOpenTile({ tab: "horaires" })).toBe("horaires");
    expect(resolveOpenTile({ tab: "traduction" })).toBe("traduction");
    expect(resolveOpenTile({ tab: "seo" })).toBe("contenu");
    expect(resolveOpenTile({ tab: "messagerie" })).toBe("messagerie");
    expect(resolveOpenTile({ tab: "affichage" })).toBe("compte");
  });

  it("retourne null si aucun param exploitable", () => {
    expect(resolveOpenTile({})).toBeNull();
    expect(resolveOpenTile({ tab: "unknown" })).toBeNull();
    expect(resolveOpenTile({ open: undefined, tab: undefined })).toBeNull();
    expect(resolveOpenTile({ tab: 42 as unknown as string })).toBeNull();
  });
});
