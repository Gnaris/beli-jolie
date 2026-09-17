import { describe, it, expect } from "vitest";
import { resolveCountryCode } from "@/lib/countries";

/**
 * Anti-régression : le tunnel commande /api/carriers exige un code ISO
 * alpha-2 (2 lettres, ex. "FR") pour interroger Easy-Express / Smarty365.
 * `saveShippingAddress` (server action) passe désormais la valeur saisie
 * dans `resolveCountryCode` avant écriture en base :
 *   - libellé texte hérité (« France ») → normalisé en « FR »
 *   - code ISO déjà valide → conservé tel quel
 *   - valeur inconnue → throw explicite côté serveur
 *
 * Incident source : Marion Cousin (joliesgirly@gmail.com, boutique Issyma,
 * 17/09/2026, iPhone). Le champ Pays était en texte libre, elle a tapé
 * « France » (6 caractères) et vu 6 fois « Paramètres invalides » avant de
 * finir par comprendre qu'il fallait taper « FR ». Fix combiné :
 * CountryField (menu déroulant côté UI) + garde-fou serveur ci-dessous.
 */
describe("Garde-fou pays / tunnel commande", () => {
  it("accepte un code ISO déjà saisi", () => {
    expect(resolveCountryCode("FR")).toBe("FR");
    expect(resolveCountryCode("BE")).toBe("BE");
    expect(resolveCountryCode("fr")).toBe("FR");
  });

  it("normalise un libellé pays complet (le cas Marion aurait été sauvé)", () => {
    expect(resolveCountryCode("France")).toBe("FR");
    expect(resolveCountryCode("FRANCE")).toBe("FR");
    expect(resolveCountryCode("Belgique")).toBe("BE");
    expect(resolveCountryCode("Portugal")).toBe("PT");
  });

  it("refuse un pays inconnu / vide (throw explicite côté saveShippingAddress)", () => {
    expect(resolveCountryCode("")).toBeNull();
    expect(resolveCountryCode(null)).toBeNull();
    expect(resolveCountryCode(undefined)).toBeNull();
    expect(resolveCountryCode("Pays inexistant")).toBeNull();
    expect(resolveCountryCode("ZZ")).toBeNull();
  });
});
