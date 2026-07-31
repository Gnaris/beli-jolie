/**
 * Tests pour lib/ankorstore-error-fr.ts
 *
 * Vérifie que les messages bruts renvoyés par Ankorstore sont convertis en
 * phrases françaises actionnables pour la cliente.
 */
import { describe, it, expect } from "vitest";
import {
  translateAnkorstoreErrorBundle,
  translateAnkorstoreErrorMessage,
} from "@/lib/ankorstore-error-fr";

describe("lib/ankorstore-error-fr", () => {
  describe("translateAnkorstoreErrorMessage — cas incidents Issyma 2026-07-31", () => {
    it("traduit « image height too small »", () => {
      const fr = translateAnkorstoreErrorMessage(
        "The image height is too small (339px). Minimum height expected is 500px.",
      );
      expect(fr).toContain("trop courte");
      expect(fr).toContain("339 px");
      expect(fr).toContain("500 px");
      expect(fr).toContain("500×500");
    });

    it("traduit « image width too small »", () => {
      const fr = translateAnkorstoreErrorMessage(
        "The image width is too small (420px). Minimum width expected is 500px.",
      );
      expect(fr).toContain("trop étroite");
      expect(fr).toContain("420 px");
    });

    it("traduit « duplicated options » et cite les SKU concernés", () => {
      const fr = translateAnkorstoreErrorMessage(
        "Product variants with SKU: 13164FLEUR_jaune_6sj5x46r,13164FLEUR_jaune_5lxlnna6 have duplicated options",
      );
      expect(fr.toLowerCase()).toContain("plusieurs variantes");
      expect(fr).toContain("13164FLEUR_jaune_6sj5x46r,13164FLEUR_jaune_5lxlnna6");
      expect(fr.toLowerCase()).toContain("dédoubl");
    });

    it("traduit « at least 1 image required »", () => {
      const fr = translateAnkorstoreErrorMessage(
        "At least 1 image is required to create an active product.",
      );
      expect(fr).toContain("au moins une photo");
      expect(fr).toContain("couleurs");
    });
  });

  describe("translateAnkorstoreErrorMessage — autres motifs connus", () => {
    it("traduit « retail must be greater than wholesale »", () => {
      const fr = translateAnkorstoreErrorMessage(
        "Retail price (3,50 €) must be greater than Wholesale price",
      );
      expect(fr).toContain("prix de vente public");
      expect(fr).toContain("marge");
    });

    it("traduit « SKU maximum »", () => {
      const fr = translateAnkorstoreErrorMessage("Sku maximum length exceeded");
      expect(fr).toContain("SKU");
      expect(fr).toContain("48 caractères");
    });

    it("traduit un external_id dupliqué", () => {
      const fr = translateAnkorstoreErrorMessage(
        "external_id already taken by another product",
      );
      expect(fr).toContain("référence externe");
      expect(fr.toLowerCase()).toContain("déliez");
    });
  });

  describe("translateAnkorstoreErrorMessage — fallback message inconnu", () => {
    it("préfixe « Erreur Ankorstore » pour un motif non couvert", () => {
      const fr = translateAnkorstoreErrorMessage("Some unknown random error blah");
      expect(fr).toBe("Erreur Ankorstore : Some unknown random error blah");
    });

    it("préserve un message vide", () => {
      expect(translateAnkorstoreErrorMessage("")).toBe("");
      expect(translateAnkorstoreErrorMessage("   ")).toBe("");
    });
  });

  describe("translateAnkorstoreErrorBundle", () => {
    it("traduit un unique message préfixé validation_error", () => {
      const fr = translateAnkorstoreErrorBundle(
        "validation_error: At least 1 image is required to create an active product.",
      );
      expect(fr).toContain("au moins une photo");
      expect(fr).not.toContain("validation_error");
    });

    it("dédoublonne les traductions identiques", () => {
      // Ankorstore répète souvent le même message pour chaque variante.
      const fr = translateAnkorstoreErrorBundle(
        "validation_error: At least 1 image is required to create an active product. ; At least 1 image is required to create an active product.",
      );
      const occurrences = fr.split("au moins une photo").length - 1;
      expect(occurrences).toBe(1);
    });

    it("joint plusieurs traductions distinctes avec ·", () => {
      const fr = translateAnkorstoreErrorBundle(
        "validation_error: The image height is too small (339px). Minimum height expected is 500px. ; Product variants with SKU: a,b have duplicated options",
      );
      expect(fr).toContain("trop courte");
      expect(fr).toContain("plusieurs variantes");
      expect(fr).toContain("·");
    });

    it("gère plusieurs sections validation_error séparées par —", () => {
      const fr = translateAnkorstoreErrorBundle(
        "validation_error: At least 1 image is required to create an active product. — validation_error: The image height is too small (100px). Minimum height expected is 500px.",
      );
      expect(fr).toContain("au moins une photo");
      expect(fr).toContain("trop courte");
    });

    it("renvoie une chaîne vide pour une entrée vide", () => {
      expect(translateAnkorstoreErrorBundle("")).toBe("");
    });
  });
});
