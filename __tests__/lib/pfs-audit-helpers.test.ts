/**
 * Tests unitaires : helpers partagés utilisés par l'audit PFS.
 *
 * Le runner d'audit (start/persistState) touche à Prisma et l'API PFS — hors
 * scope d'un test unitaire. On teste ici les briques pures qui déterminent
 * quels écarts sont automatiquement corrigeables (Lot B whitelist +
 * pullBlocked ad hoc), ce qui pilote :
 *   - le badge « X écarts · à la main » sur chaque carte produit ;
 *   - le compteur du bouton « Tout modifier depuis PFS » ;
 *   - le filtre « Corrigeables » / « À la main » de la modale.
 */

import { describe, it, expect } from "vitest";
import {
  countPullableIssues,
  isPullSupportedLotB,
  issueKey,
} from "@/lib/pfs-verify-apply-shared";
import type { PfsVerifyIssue } from "@/lib/pfs-verify";

function mkIssue(partial: Partial<PfsVerifyIssue>): PfsVerifyIssue {
  return {
    scope: "product",
    field: "name",
    fieldLabel: "Nom",
    pfsValue: "PFS",
    expectedValue: "Nous",
    ...partial,
  } as PfsVerifyIssue;
}

describe("countPullableIssues", () => {
  it("compte 0 sur une liste vide", () => {
    expect(countPullableIssues([])).toBe(0);
  });

  it("compte les champs scalaires supportés (Lot B)", () => {
    const issues: PfsVerifyIssue[] = [
      mkIssue({ scope: "product", field: "name", fieldLabel: "Nom" }),
      mkIssue({ scope: "product", field: "description", fieldLabel: "Description" }),
      mkIssue({ scope: "color", field: "price", fieldLabel: "Prix", colorRef: "ROSE", variantType: "UNIT" }),
    ];
    expect(countPullableIssues(issues)).toBe(3);
  });

  it("exclut les champs Lot C non pris en charge (composition/pays/genre/catégorie)", () => {
    const issues: PfsVerifyIssue[] = [
      mkIssue({ scope: "product", field: "composition", fieldLabel: "Composition" }),
      mkIssue({ scope: "product", field: "country", fieldLabel: "Pays" }),
      mkIssue({ scope: "product", field: "gender", fieldLabel: "Genre" }),
      mkIssue({ scope: "product", field: "category", fieldLabel: "Catégorie" }),
    ];
    expect(countPullableIssues(issues)).toBe(0);
  });

  it("exclut les écarts avec pullBlocked posé par le serveur", () => {
    const issues: PfsVerifyIssue[] = [
      mkIssue({ scope: "product", field: "name", fieldLabel: "Nom" }),
      mkIssue({
        scope: "product",
        field: "description",
        fieldLabel: "Description",
        pullBlocked: "Blocage ad hoc pour raison X",
      }),
    ];
    expect(countPullableIssues(issues)).toBe(1);
  });

  it("distingue produit pull-only mixte (Lot B + Lot C + bloqué)", () => {
    const issues: PfsVerifyIssue[] = [
      mkIssue({ scope: "product", field: "name", fieldLabel: "Nom" }),                    // OK
      mkIssue({ scope: "product", field: "category", fieldLabel: "Catégorie" }),          // Lot C
      mkIssue({ scope: "color", field: "stock", fieldLabel: "Stock",
        colorRef: "BLEU", variantType: "UNIT" }),                                          // OK
      mkIssue({ scope: "color", field: "price", fieldLabel: "Prix",
        colorRef: "BLEU", variantType: "UNIT", pullBlocked: "raison" }),                   // bloqué
    ];
    expect(countPullableIssues(issues)).toBe(2);
  });
});

describe("isPullSupportedLotB", () => {
  it("supporte les champs scalaires produit du Lot B", () => {
    expect(isPullSupportedLotB("product", "name")).toBe(true);
    expect(isPullSupportedLotB("product", "description")).toBe(true);
    expect(isPullSupportedLotB("product", "dimensions")).toBe(true);
    expect(isPullSupportedLotB("product", "isBestSeller")).toBe(true);
    expect(isPullSupportedLotB("product", "productStatus")).toBe(true);
  });

  it("ne supporte pas les champs Lot C (attributs à résoudre côté site)", () => {
    expect(isPullSupportedLotB("product", "composition")).toBe(false);
    expect(isPullSupportedLotB("product", "country")).toBe(false);
    expect(isPullSupportedLotB("product", "gender")).toBe(false);
    expect(isPullSupportedLotB("product", "category")).toBe(false);
    expect(isPullSupportedLotB("product", "family")).toBe(false);
  });

  it("supporte les champs variante Lot B (prix, stock, poids, actif, structurel)", () => {
    expect(isPullSupportedLotB("color", "price")).toBe(true);
    expect(isPullSupportedLotB("color", "stock")).toBe(true);
    expect(isPullSupportedLotB("color", "weight")).toBe(true);
    expect(isPullSupportedLotB("color", "isActive")).toBe(true);
    expect(isPullSupportedLotB("color", "missingVariant")).toBe(true);
    expect(isPullSupportedLotB("color", "extraVariant")).toBe(true);
  });
});

describe("issueKey", () => {
  it("produit une clé stable indépendante de l'ordre des champs", () => {
    const a = mkIssue({ scope: "color", field: "price", colorRef: "ROSE", variantType: "UNIT" });
    const b = mkIssue({ scope: "color", field: "price", colorRef: "ROSE", variantType: "UNIT" });
    expect(issueKey(a)).toBe(issueKey(b));
  });

  it("distingue deux écarts qui ne diffèrent que par la couleur", () => {
    const rose = mkIssue({ scope: "color", field: "price", colorRef: "ROSE", variantType: "UNIT" });
    const bleu = mkIssue({ scope: "color", field: "price", colorRef: "BLEU", variantType: "UNIT" });
    expect(issueKey(rose)).not.toBe(issueKey(bleu));
  });

  it("distingue produit vs couleur avec même field", () => {
    const p = mkIssue({ scope: "product", field: "name" });
    const c = mkIssue({ scope: "color", field: "name" as PfsVerifyIssue["field"], colorRef: "ROSE", variantType: "UNIT" });
    expect(issueKey(p)).not.toBe(issueKey(c));
  });
});
