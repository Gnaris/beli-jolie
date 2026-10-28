/**
 * Faire — nom de couleur envoyé au portail.
 *
 * Pourquoi : les pastilles de couleur affichées dans l'interface acheteur Faire
 * sont générées par Faire à partir du nom texte envoyé. Faire reconnaît mal les
 * mots français (« Noir / Bordeaux / Marine » ressortaient avec des pastilles
 * aberrantes — Noir en dark red, Bordeaux en bleu, etc.). Depuis 2026-10-28 on
 * envoie en priorité la traduction anglaise de la couleur quand elle existe en
 * BDD (`ColorTranslation.locale = "en"`), ce qui donne les bonnes pastilles.
 */
import { describe, it, expect } from "vitest";
import { faireColorNameOf } from "@/lib/faire-publish";

describe("faireColorNameOf", () => {
  it("retourne l'override manuel quand défini (priorité max)", () => {
    expect(
      faireColorNameOf("Noir", "Charbon", [{ locale: "en", name: "Black" }]),
    ).toBe("Charbon");
  });

  it("retourne la traduction anglaise quand pas d'override", () => {
    expect(
      faireColorNameOf("Noir", null, [{ locale: "en", name: "Black" }]),
    ).toBe("Black");
  });

  it("retourne le nom FR si pas de traduction anglaise", () => {
    expect(faireColorNameOf("Noir", null, [])).toBe("Noir");
    expect(faireColorNameOf("Noir", null, undefined)).toBe("Noir");
  });

  it("ignore une traduction anglaise vide ou blanks", () => {
    expect(
      faireColorNameOf("Beige", null, [{ locale: "en", name: "   " }]),
    ).toBe("Beige");
  });

  it("ignore un override vide ou blanks (fallback EN puis FR)", () => {
    expect(
      faireColorNameOf("Marine", "  ", [{ locale: "en", name: "Navy" }]),
    ).toBe("Navy");
    expect(faireColorNameOf("Marine", "", undefined)).toBe("Marine");
  });

  it("fallback « Couleur » si tout est vide", () => {
    expect(faireColorNameOf(undefined, null, undefined)).toBe("Couleur");
  });
});
