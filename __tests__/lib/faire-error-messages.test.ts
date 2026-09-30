/**
 * Traduction des messages d'erreur bruts Faire en messages orientés action.
 *
 * Les deux patterns qu'on doit rattraper prioritairement :
 *  - « Duplicate variants with same options » : une variante orpheline existe
 *    chez Faire mais n'est pas liée en BJ. Résolution propre = délier + relier
 *    via la modale (elle re-matche toutes les variantes et lie les orphelines).
 *  - « PRODUCT_NEEDS_AT_LEAST_ONE_OPTION » : la fiche Faire est publiée avec
 *    une variante nue (sans axe couleur), et Faire refuse toute restructuration.
 *    Résolution = dépublier/archiver côté Faire puis ↻ Rafraîchir dans BJ.
 */
import { describe, it, expect } from "vitest";
import { translateFaireUpdateError } from "@/lib/faire-error-messages";

describe("translateFaireUpdateError", () => {
  it("retourne null pour un message inconnu (garde le brut affiché)", () => {
    expect(translateFaireUpdateError("Some totally unrelated error")).toBeNull();
    expect(translateFaireUpdateError("")).toBeNull();
  });

  it("traduit 'Duplicate variants with same options' en message action", () => {
    const result = translateFaireUpdateError("Duplicate variants with same options");
    expect(result).not.toBeNull();
    expect(result).toMatch(/variante.*existe déjà chez Faire.*n'est pas liée/i);
    expect(result).toContain("Délier");
    expect(result).toContain("Relier");
    expect(result).toContain("modale");
  });

  it("traduit aussi quand le message brut contient 'Duplicate variants' dans une phrase plus longue", () => {
    const result = translateFaireUpdateError(
      "Duplicate variants with same options (variant: po_abc123)",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Délier");
  });

  it("traduit 'PRODUCT_NEEDS_AT_LEAST_ONE_OPTION' en message action clair", () => {
    const result = translateFaireUpdateError(
      "Cannot delete variant: PRODUCT_NEEDS_AT_LEAST_ONE_OPTION",
    );
    expect(result).not.toBeNull();
    expect(result).toMatch(/publiée avec une seule variante/i);
    // Propose d'abord la voie non destructive (délier + relier)
    expect(result).toContain("Délier");
    expect(result).toContain("Relier");
    // Puis fallback Rafraîchir
    expect(result).toMatch(/dépubli/i);
    expect(result).toContain("Rafraîchir");
  });

  it("traduit aussi la formulation FR 'au moins une option'", () => {
    const result = translateFaireUpdateError(
      "Erreur : produit doit avoir au moins une option",
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Délier");
    expect(result).toContain("Rafraîchir");
  });

  it("est insensible à la casse sur Duplicate variants", () => {
    const result = translateFaireUpdateError("duplicate VARIANTS with same OPTIONS");
    expect(result).not.toBeNull();
    expect(result).toContain("Délier");
  });
});
