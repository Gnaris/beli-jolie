/**
 * __tests__/lib/marketplace-enabled.test.ts
 *
 * Cœur métier du drapeau "Marketplace activée pour ce produit" :
 * filterOptionsByEnabled coupe silencieusement les options des marketplaces
 * désactivées et remonte la liste des marketplaces sautées.
 *
 * On teste ici la logique pure (pas de Prisma).
 */
import { describe, it, expect } from "vitest";
import {
  filterOptionsByEnabled,
  marketplaceDisabledMessage,
  type ProductMarketplaceEnabled,
} from "@/lib/marketplace-enabled";

const ALL_ENABLED: ProductMarketplaceEnabled = {
  pfs: true,
  ankorstore: true,
  efashion: true,
  faire: true,
};

describe("filterOptionsByEnabled", () => {
  it("ne change rien quand tout est activé", () => {
    const options = { pfs: true, ankorstore: true, efashion: true, faire: true };
    const { filtered, skipped } = filterOptionsByEnabled(options, ALL_ENABLED);
    expect(filtered).toEqual(options);
    expect(skipped).toEqual([]);
  });

  it("coupe PFS et remonte 'pfs' quand pfs est désactivé", () => {
    const options = { pfs: true, ankorstore: true, efashion: false, faire: false };
    const { filtered, skipped } = filterOptionsByEnabled(options, {
      ...ALL_ENABLED,
      pfs: false,
    });
    expect(filtered.pfs).toBe(false);
    expect(filtered.ankorstore).toBe(true);
    expect(skipped).toEqual(["pfs"]);
  });

  it("ne signale pas comme sauté un marketplace non demandé (option: false)", () => {
    const options = { pfs: false, ankorstore: true };
    const { filtered, skipped } = filterOptionsByEnabled(options, {
      ...ALL_ENABLED,
      pfs: false, // désactivé mais pas demandé → on n'ajoute pas à skipped
    });
    expect(filtered.pfs).toBe(false);
    expect(filtered.ankorstore).toBe(true);
    expect(skipped).toEqual([]);
  });

  it("coupe tous les marketplaces désactivés en un seul appel", () => {
    const options = { pfs: true, ankorstore: true, efashion: true, faire: true };
    const { filtered, skipped } = filterOptionsByEnabled(options, {
      pfs: false,
      ankorstore: false,
      efashion: true,
      faire: false,
    });
    expect(filtered.pfs).toBe(false);
    expect(filtered.ankorstore).toBe(false);
    expect(filtered.efashion).toBe(true);
    expect(filtered.faire).toBe(false);
    expect(skipped.sort()).toEqual(["ankorstore", "faire", "pfs"]);
  });

  it("préserve les autres clés de l'objet options passé en entrée", () => {
    const options = {
      pfs: true,
      local: true,
      intervalMs: 1000,
    } as { pfs?: boolean; local?: boolean; intervalMs?: number };
    const { filtered } = filterOptionsByEnabled(options, {
      ...ALL_ENABLED,
      pfs: false,
    });
    expect(filtered.pfs).toBe(false);
    expect((filtered as { local?: boolean }).local).toBe(true);
    expect((filtered as { intervalMs?: number }).intervalMs).toBe(1000);
  });

  it("n'altère pas l'objet options d'origine (retourne un clone)", () => {
    const options = { pfs: true, ankorstore: true };
    filterOptionsByEnabled(options, { ...ALL_ENABLED, pfs: false });
    expect(options.pfs).toBe(true);
    expect(options.ankorstore).toBe(true);
  });
});

describe("marketplaceDisabledMessage", () => {
  it("mentionne le libellé lisible du marketplace", () => {
    expect(marketplaceDisabledMessage("pfs")).toContain("Paris Fashion Shop");
    expect(marketplaceDisabledMessage("ankorstore")).toContain("Ankorstore");
    expect(marketplaceDisabledMessage("efashion")).toContain("eFashion");
    expect(marketplaceDisabledMessage("faire")).toContain("Faire");
  });

  it("invite explicitement à réactiver dans la fiche produit", () => {
    expect(marketplaceDisabledMessage("pfs")).toContain(
      "Publication marketplaces",
    );
  });
});
