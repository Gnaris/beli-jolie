import { describe, it, expect } from "vitest";
import {
  normalizeReviewInput,
  formatReviewerName,
  REVIEW_TEXT_MIN,
  REVIEW_TEXT_MAX,
} from "@/lib/customer-reviews";

describe("normalizeReviewInput", () => {
  it("accepte une entrée valide", () => {
    const result = normalizeReviewInput({
      rating: 4,
      text: "Ma cliente a adoré, moi aussi. Livraison rapide, prix corrects.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rating).toBe(4);
      expect(result.text).toBe(
        "Ma cliente a adoré, moi aussi. Livraison rapide, prix corrects.",
      );
    }
  });

  it("refuse une note non numérique", () => {
    const result = normalizeReviewInput({ rating: "abc", text: "Un long texte valide qui dépasse largement le minimum autorisé." });
    expect(result.ok).toBe(false);
  });

  it("refuse une note hors bornes", () => {
    const tooHigh = normalizeReviewInput({ rating: 99, text: "Un long texte valide qui dépasse largement le minimum autorisé." });
    const tooLow = normalizeReviewInput({ rating: 0, text: "Un long texte valide qui dépasse largement le minimum autorisé." });
    expect(tooHigh.ok).toBe(false);
    expect(tooLow.ok).toBe(false);
  });

  it("arrondit une note décimale", () => {
    const result = normalizeReviewInput({ rating: 4.6, text: "Un long texte valide qui dépasse largement le minimum autorisé." });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rating).toBe(5);
  });

  it("refuse un texte trop court", () => {
    const result = normalizeReviewInput({ rating: 5, text: "trop court" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`${REVIEW_TEXT_MIN}`);
  });

  it("refuse un texte trop long", () => {
    const result = normalizeReviewInput({
      rating: 5,
      text: "x".repeat(REVIEW_TEXT_MAX + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(`${REVIEW_TEXT_MAX}`);
  });

  it("normalise les espaces multiples", () => {
    const result = normalizeReviewInput({
      rating: 5,
      text: "  Un    texte   avec\n\n\ndes espaces    partout mais suffisamment long.  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(
        "Un texte avec des espaces partout mais suffisamment long.",
      );
    }
  });
});

describe("formatReviewerName", () => {
  it("prénom + initiale du nom (cas standard)", () => {
    expect(formatReviewerName({ firstName: "Sophie", lastName: "Legrand" })).toBe("Sophie L.");
  });

  it("prénom seul quand pas de nom", () => {
    expect(formatReviewerName({ firstName: "Nadia", lastName: "" })).toBe("Nadia");
    expect(formatReviewerName({ firstName: "Nadia", lastName: null })).toBe("Nadia");
  });

  it("initiale seule quand pas de prénom", () => {
    expect(formatReviewerName({ firstName: null, lastName: "Martin" })).toBe("M.");
  });

  it("trim les espaces", () => {
    expect(formatReviewerName({ firstName: "  Claire  ", lastName: "  Morel  " })).toBe("Claire M.");
  });

  it("fallback « Anonyme » quand aucun nom (ex. comptes importés PFS avec firstName='')", () => {
    expect(formatReviewerName({ firstName: null, lastName: null })).toBe("Anonyme");
    expect(formatReviewerName({ firstName: "", lastName: "" })).toBe("Anonyme");
    expect(formatReviewerName({ firstName: "   ", lastName: "   " })).toBe("Anonyme");
  });
});
