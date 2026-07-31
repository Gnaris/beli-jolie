import { describe, it, expect } from "vitest";
import { marketplaceDrawerAccent } from "@/lib/marketplace-drawer-shell";
import { MARKETPLACES_BRAND, type MarketplaceKey } from "@/lib/marketplaces-brand";

describe("marketplaceDrawerAccent", () => {
  it("mappe chaque marketplace à l'accent DrawerShell attendu", () => {
    expect(marketplaceDrawerAccent("pfs")).toBe("indigo");
    expect(marketplaceDrawerAccent("ankorstore")).toBe("sky");
    expect(marketplaceDrawerAccent("efashion")).toBe("rose");
    expect(marketplaceDrawerAccent("faire")).toBe("amber");
    expect(marketplaceDrawerAccent("microstore")).toBe("cyan");
  });

  it("retourne un accent pour toutes les clés de MARKETPLACES_BRAND (mapping exhaustif)", () => {
    const keys = Object.keys(MARKETPLACES_BRAND) as MarketplaceKey[];
    for (const k of keys) {
      const accent = marketplaceDrawerAccent(k);
      expect(typeof accent).toBe("string");
      expect(accent.length).toBeGreaterThan(0);
    }
  });
});
