import { describe, it, expect } from "vitest";
import { effectiveProductErrors, isProductReady } from "@/components/admin/products/import/effective-status";
import type { PreviewProduct } from "@/app/api/admin/products/import/preview/route";
import type { ProductOverride } from "@/components/admin/products/import/EditableProductCard";

/**
 * Vérifie que les corrections faites dans l'UI éditable du récapitulatif
 * (overrides locaux) lèvent bien les erreurs serveur correspondantes et
 * débloquent le bouton « Confirmer l'importation ».
 */

function makeProduct(partial: Partial<PreviewProduct>): PreviewProduct {
  return {
    reference: "REF-001",
    name: "",
    description: undefined,
    category: undefined,
    composition: undefined,
    manufacturingCountry: undefined,
    season: undefined,
    variants: [],
    categoryFound: true,
    subCategoriesFound: true,
    compositionsFound: true,
    referenceExists: false,
    totalErrors: 0,
    productErrors: [],
    previewStatus: "ok",
    ...partial,
  };
}

describe("effectiveProductErrors", () => {
  it("retire l'erreur « Nom manquant » dès que override.name est rempli", () => {
    const product = makeProduct({ productErrors: ["Nom manquant."] });
    const override: ProductOverride = { reference: "REF-001", name: "Mon Produit" };
    expect(effectiveProductErrors(product, override)).toEqual([]);
  });

  it("retire l'erreur « Détail taille unique manquant » dès que override.sizeDetailsTu est rempli", () => {
    const product = makeProduct({
      productErrors: ["Détail taille unique manquant (obligatoire quand une variante utilise « Taille unique »)."],
    });
    const override: ProductOverride = { reference: "REF-001", sizeDetailsTu: "52-56" };
    expect(effectiveProductErrors(product, override)).toEqual([]);
  });

  it("retire plusieurs erreurs en parallèle", () => {
    const product = makeProduct({
      productErrors: ["Nom manquant.", "Description manquante.", "Catégorie manquante.", "Saison manquante."],
    });
    const override: ProductOverride = {
      reference: "REF-001",
      name: "X",
      description: "Y",
      category: "Bijoux",
      season: "Été 2026",
    };
    expect(effectiveProductErrors(product, override)).toEqual([]);
  });

  it("conserve les erreurs non corrigées par les overrides", () => {
    const product = makeProduct({
      productErrors: ["Nom manquant.", "Composition manquante."],
    });
    const override: ProductOverride = { reference: "REF-001", name: "X" };
    expect(effectiveProductErrors(product, override)).toEqual(["Composition manquante."]);
  });

  it("ignore les overrides à chaîne vide ou blanc", () => {
    const product = makeProduct({ productErrors: ["Nom manquant."] });
    const override: ProductOverride = { reference: "REF-001", name: "   " };
    expect(effectiveProductErrors(product, override)).toEqual(["Nom manquant."]);
  });

  it("ne touche pas aux erreurs non listées dans les résolutions (ex: « Référence existe déjà »)", () => {
    const product = makeProduct({
      productErrors: [`La référence "REF-001" existe déjà.`],
    });
    const override: ProductOverride = { reference: "REF-001", name: "Test" };
    expect(effectiveProductErrors(product, override)).toEqual([`La référence "REF-001" existe déjà.`]);
  });

  it("retombe sur la donnée serveur si l'override n'est pas défini sur ce champ", () => {
    // Le fichier Excel a déjà un nom → l'erreur ne devrait pas être présente
    // côté serveur, mais on simule un cas où elle l'est par erreur.
    const product = makeProduct({
      name: "Déjà saisi",
      productErrors: ["Nom manquant."],
    });
    const override: ProductOverride = { reference: "REF-001" };
    // Override absent → fallback sur product.name = "Déjà saisi"
    expect(effectiveProductErrors(product, override)).toEqual([]);
  });

  it("retire l'erreur « Catégorie introuvable » quand on choisit une catégorie existante", () => {
    // Reproduit le bug signalé : l'Excel indique « Bracelet » qui n'existe pas en
    // base — le serveur renvoie « Catégorie "Bracelet" introuvable. » — la cliente
    // sélectionne « Bracelets » dans le dropdown → l'erreur doit disparaître.
    const product = makeProduct({
      productErrors: [`Catégorie "Bracelet" introuvable.`],
    });
    const override: ProductOverride = { reference: "REF-001", category: "Bracelets" };
    expect(effectiveProductErrors(product, override)).toEqual([]);
  });

  it("retire l'erreur « Couleur principale introuvable » quand on choisit une couleur de variante", () => {
    const product = makeProduct({
      productErrors: [`Couleur principale "Doré antique" introuvable parmi les variantes.`],
    });
    const override: ProductOverride = { reference: "REF-001", primaryColor: "Doré" };
    expect(effectiveProductErrors(product, override)).toEqual([]);
  });
});

describe("isProductReady", () => {
  it("rend prêt un produit dont toutes les erreurs sont résolues par overrides", () => {
    const product = makeProduct({
      productErrors: ["Nom manquant.", "Catégorie manquante."],
    });
    const override: ProductOverride = {
      reference: "REF-001",
      name: "Mon produit",
      category: "Bijoux",
    };
    expect(isProductReady(product, override)).toBe(true);
  });

  it("reste bloqué si la référence existe déjà en base", () => {
    const product = makeProduct({ referenceExists: true });
    const override: ProductOverride = { reference: "REF-001" };
    expect(isProductReady(product, override)).toBe(false);
  });

  it("reste bloqué si une variante a une erreur", () => {
    const product = makeProduct({
      variants: [
        { color: "Bleu", saleType: "UNIT", unitPrice: 10, stock: 5, colorFound: true, errors: ["Prix invalide."] },
      ],
    });
    const override: ProductOverride = { reference: "REF-001" };
    expect(isProductReady(product, override)).toBe(false);
  });

  it("reste bloqué tant qu'il reste une erreur produit non corrigée", () => {
    const product = makeProduct({
      productErrors: ["Nom manquant.", "Composition manquante."],
    });
    const override: ProductOverride = { reference: "REF-001", name: "X" };
    expect(isProductReady(product, override)).toBe(false);
  });

  it("est prêt quand il n'y a aucune erreur dès le départ", () => {
    const product = makeProduct({});
    const override: ProductOverride = { reference: "REF-001" };
    expect(isProductReady(product, override)).toBe(true);
  });
});
