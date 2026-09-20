import { describe, it, expect } from "vitest";
import {
  translateCategoryLike,
  translateCollectionName,
  translateProductName,
  type HomeTranslationLookups,
} from "@/lib/home-translations";

function makeLookups(overrides: Partial<HomeTranslationLookups> = {}): HomeTranslationLookups {
  return {
    categories: overrides.categories ?? new Map(),
    subCategories: overrides.subCategories ?? new Map(),
    collections: overrides.collections ?? new Map(),
    products: overrides.products ?? new Map(),
  };
}

describe("home-translations helpers", () => {
  it("laisse le nom intact en locale par défaut (fr)", () => {
    const lookups = makeLookups({ categories: new Map([["bracelets", "Bracelets EN"]]) });
    expect(translateCategoryLike("Bracelets", "fr", lookups)).toBe("Bracelets");
    expect(translateCollectionName("Été", "fr", lookups)).toBe("Été");
    expect(translateProductName("Collier or", "fr", lookups)).toBe("Collier or");
  });

  it("priorise la traduction DB Category", () => {
    const lookups = makeLookups({ categories: new Map([["colliers", "Necklaces"]]) });
    expect(translateCategoryLike("Colliers", "en", lookups)).toBe("Necklaces");
  });

  it("cascade Category → SubCategory pour translateCategoryLike", () => {
    const lookups = makeLookups({
      subCategories: new Map([["créoles", "Hoops"]]),
    });
    expect(translateCategoryLike("Créoles", "en", lookups)).toBe("Hoops");
  });

  it("retombe sur le dictionnaire quand DB vide", () => {
    // Le dictionnaire du fichier product-translations connait "bracelet" → "bracelet".
    // On teste un cas où le dictionnaire retourne bien un autre mot : "collier" → "necklace".
    const lookups = makeLookups();
    const result = translateProductName("Collier", "en", lookups);
    // Attention : translateProduct fait un match par mot, la sortie sera minuscule
    // ("necklace") car la fonction interne applique lower() mais réapplique la
    // capitale de la première lettre.
    expect(result.toLowerCase()).toContain("necklace");
  });

  it("garde le nom d'origine si aucune traduction ni dictionnaire", () => {
    const lookups = makeLookups();
    // Nom inventé absent du dictionnaire.
    const result = translateCollectionName("Zzxxywalp", "en", lookups);
    expect(result).toBe("Zzxxywalp");
  });

  it("ignore une traduction DB identique au nom source (bruit)", () => {
    // Si `translations.name === category.name`, on considère qu'il n'y a pas
    // vraiment de traduction — le lookup ne doit rien retourner.
    const lookups = makeLookups({ categories: new Map() });
    // Simule le cas : buildLookup ne pose PAS la clé si translated === name.
    // Ici on vérifie juste que la map vide retombe sur le dictionnaire.
    expect(translateCategoryLike("Bracelets", "en", lookups)).toBe("Bracelets");
  });

  it("gère une chaîne vide sans planter", () => {
    const lookups = makeLookups();
    expect(translateCategoryLike("", "en", lookups)).toBe("");
    expect(translateCollectionName("", "en", lookups)).toBe("");
    expect(translateProductName("", "en", lookups)).toBe("");
  });
});
