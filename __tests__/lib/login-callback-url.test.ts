import { describe, it, expect } from "vitest";
import { stripLocaleFromCallbackUrl } from "@/lib/login-callback-url";

const LOCALES = ["fr", "en"] as const;

describe("stripLocaleFromCallbackUrl", () => {
  it("retire le préfixe de locale en début d'URL", () => {
    expect(stripLocaleFromCallbackUrl("/fr/commandes", LOCALES)).toBe("/commandes");
    expect(stripLocaleFromCallbackUrl("/en/panier", LOCALES)).toBe("/panier");
  });

  it("retourne \"/\" quand l'URL est juste la racine de locale", () => {
    expect(stripLocaleFromCallbackUrl("/fr", LOCALES)).toBe("/");
    expect(stripLocaleFromCallbackUrl("/fr/", LOCALES)).toBe("/");
  });

  it("laisse une URL sans préfixe de locale inchangée", () => {
    expect(stripLocaleFromCallbackUrl("/commandes", LOCALES)).toBe("/commandes");
    expect(stripLocaleFromCallbackUrl("/", LOCALES)).toBe("/");
  });

  it("ne confond pas un chemin qui commence par les mêmes lettres avec un préfixe de locale", () => {
    expect(stripLocaleFromCallbackUrl("/france", LOCALES)).toBe("/france");
    expect(stripLocaleFromCallbackUrl("/entreprise", LOCALES)).toBe("/entreprise");
  });

  it("retourne \"/\" pour une chaîne vide", () => {
    expect(stripLocaleFromCallbackUrl("", LOCALES)).toBe("/");
  });
});
