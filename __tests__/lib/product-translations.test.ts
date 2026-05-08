import { describe, it, expect } from "vitest";
import { translateProduct } from "@/lib/product-translations";

describe("translateProduct (dictionnaire)", () => {
  it("renvoie le texte tel quel si la locale est fr", () => {
    expect(translateProduct("Bracelet doré", "fr")).toBe("Bracelet doré");
  });

  it("renvoie une chaîne vide si l'entrée est vide ou null", () => {
    expect(translateProduct("", "en")).toBe("");
    expect(translateProduct(null, "en")).toBe("");
    expect(translateProduct(undefined, "en")).toBe("");
  });

  it("traduit les noms de couleurs FR → EN", () => {
    expect(translateProduct("Rouge", "en").toLowerCase()).toContain("red");
    expect(translateProduct("Bleu", "en").toLowerCase()).toContain("blue");
    expect(translateProduct("Noir", "en").toLowerCase()).toContain("black");
  });

  it("traduit les compositions FR → EN", () => {
    expect(translateProduct("Acier inoxydable", "en").toLowerCase()).toContain("stainless steel");
    expect(translateProduct("Plaqué or", "en").toLowerCase()).toContain("gold plated");
  });

  it("garde la casse initiale (majuscule)", () => {
    const result = translateProduct("Rouge", "en");
    expect(result[0]).toBe(result[0].toUpperCase());
  });

  it("renvoie le texte original si la locale n'est pas dans le dictionnaire", () => {
    expect(translateProduct("Bracelet", "ko")).toBe("Bracelet");
  });
});
