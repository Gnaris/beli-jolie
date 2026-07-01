import { describe, it, expect } from "vitest";
import { buildTranslationsMap } from "@/lib/translations";

describe("buildTranslationsMap", () => {
  it("seed FR depuis le nom de base quand aucune traduction n'est fournie", () => {
    expect(buildTranslationsMap("Colliers", [])).toEqual({ fr: "Colliers" });
  });

  it("ajoute les autres locales aux côtés du FR seedé", () => {
    expect(
      buildTranslationsMap("Colliers", [{ locale: "en", name: "Necklaces" }]),
    ).toEqual({ fr: "Colliers", en: "Necklaces" });
  });

  it("un enregistrement FR explicite surcharge le nom de base", () => {
    expect(
      buildTranslationsMap("Colliers", [{ locale: "fr", name: "Colliers V2" }]),
    ).toEqual({ fr: "Colliers V2" });
  });

  it("garde toutes les locales même inconnues", () => {
    expect(
      buildTranslationsMap("Bagues", [
        { locale: "en", name: "Rings" },
        { locale: "de", name: "Ringe" },
      ]),
    ).toEqual({ fr: "Bagues", en: "Rings", de: "Ringe" });
  });
});
