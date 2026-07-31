/**
 * Tests pour lib/ankorstore-option-dedup.ts
 *
 * Ankorstore refuse deux variantes qui portent la même paire (color, size),
 * même si les SKU sont distincts. Ce garde-fou détecte le cas côté BJ avant
 * le kickoff, ce qui évite un aller-retour webhook en erreur 15 min plus tard.
 */
import { describe, it, expect } from "vitest";
import {
  findDuplicateAnkorstoreOptions,
  formatDuplicateOptionsError,
} from "@/lib/ankorstore-option-dedup";

describe("lib/ankorstore-option-dedup", () => {
  describe("findDuplicateAnkorstoreOptions", () => {
    it("returns empty when all variants have distinct (color, size) pairs", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        {
          sku: "A_rouge_11111111",
          options: [
            { name: "color", value: "Rouge" },
            { name: "size", value: "TU" },
          ],
        },
        {
          sku: "A_bleu_22222222",
          options: [
            { name: "color", value: "Bleu" },
            { name: "size", value: "TU" },
          ],
        },
      ]);
      expect(dupes).toEqual([]);
    });

    it("returns empty for same color but different sizes", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        {
          sku: "A_rouge_S_11111111",
          options: [
            { name: "color", value: "Rouge" },
            { name: "size", value: "S" },
          ],
        },
        {
          sku: "A_rouge_M_22222222",
          options: [
            { name: "color", value: "Rouge" },
            { name: "size", value: "M" },
          ],
        },
      ]);
      expect(dupes).toEqual([]);
    });

    it("detects the Issyma incident case (13164FLEUR jaune duplicate)", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        {
          sku: "13164FLEUR_jaune_6sj5x46r",
          options: [
            { name: "color", value: "Jaune" },
            { name: "size", value: "TU" },
          ],
        },
        {
          sku: "13164FLEUR_jaune_5lxlnna6",
          options: [
            { name: "color", value: "Jaune" },
            { name: "size", value: "TU" },
          ],
        },
      ]);
      expect(dupes).toHaveLength(1);
      expect(dupes[0].colorLabel).toBe("Jaune");
      expect(dupes[0].sizeLabel).toBe("TU");
      expect(dupes[0].skus).toHaveLength(2);
    });

    it("treats accents and case as equivalent (Doré == doré == DORÉ)", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        {
          sku: "A_dore_1",
          options: [
            { name: "color", value: "Doré" },
            { name: "size", value: "TU" },
          ],
        },
        {
          sku: "A_dore_2",
          options: [
            { name: "color", value: "dore" },
            { name: "size", value: "TU" },
          ],
        },
        {
          sku: "A_dore_3",
          options: [
            { name: "color", value: "DORÉ" },
            { name: "size", value: "TU" },
          ],
        },
      ]);
      expect(dupes).toHaveLength(1);
      expect(dupes[0].skus).toHaveLength(3);
    });

    it("groups all SKUs of the same duplicate", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        { sku: "s1", options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }] },
        { sku: "s2", options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }] },
        { sku: "s3", options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }] },
      ]);
      expect(dupes).toHaveLength(1);
      expect(dupes[0].skus).toEqual(["s1", "s2", "s3"]);
    });

    it("returns multiple groups when several duplicate pairs exist", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        { sku: "r1", options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }] },
        { sku: "r2", options: [{ name: "color", value: "Rouge" }, { name: "size", value: "TU" }] },
        { sku: "b1", options: [{ name: "color", value: "Bleu" }, { name: "size", value: "M" }] },
        { sku: "b2", options: [{ name: "color", value: "Bleu" }, { name: "size", value: "M" }] },
      ]);
      expect(dupes).toHaveLength(2);
    });

    it("handles missing options without crashing", () => {
      const dupes = findDuplicateAnkorstoreOptions([
        { sku: "s1", options: [] },
        { sku: "s2", options: [] },
      ]);
      // Deux variantes sans options = même paire vide → doublon.
      expect(dupes).toHaveLength(1);
    });
  });

  describe("formatDuplicateOptionsError", () => {
    it("returns empty string when no duplicates", () => {
      expect(formatDuplicateOptionsError([])).toBe("");
    });

    it("mentions the color label and number of variants", () => {
      const msg = formatDuplicateOptionsError([
        { colorLabel: "Jaune", sizeLabel: "TU", skus: ["a", "b"] },
      ]);
      expect(msg).toContain("Jaune");
      expect(msg).toContain("2 variantes");
      expect(msg.toLowerCase()).toContain("dédoubl");
    });

    it("mentions the size label when different from TU", () => {
      const msg = formatDuplicateOptionsError([
        { colorLabel: "Rouge", sizeLabel: "M", skus: ["a", "b"] },
      ]);
      expect(msg).toContain("Rouge");
      expect(msg).toContain("M");
    });

    it("omits the size label when it is TU (uninformative)", () => {
      const msg = formatDuplicateOptionsError([
        { colorLabel: "Jaune", sizeLabel: "TU", skus: ["a", "b"] },
      ]);
      expect(msg).not.toContain('taille "TU"');
    });

    it("joins several duplicate groups with commas", () => {
      const msg = formatDuplicateOptionsError([
        { colorLabel: "Rouge", sizeLabel: "TU", skus: ["a", "b"] },
        { colorLabel: "Bleu", sizeLabel: "M", skus: ["c", "d"] },
      ]);
      expect(msg).toContain("Rouge");
      expect(msg).toContain("Bleu");
    });
  });
});
