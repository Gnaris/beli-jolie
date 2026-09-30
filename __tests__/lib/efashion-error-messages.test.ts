/**
 * Traduction des messages d'erreur bruts remontés par eFashion en messages
 * lisibles pour l'admin non-dev. Les patterns « référence déjà utilisée »
 * traduisent tous le même problème racine : plusieurs fiches actives chez
 * eFashion partagent la même reference_base, ce qui ne peut se résoudre que
 * par un Rafraîchir (recréation propre du produit).
 */
import { describe, it, expect } from "vitest";
import { consolidateEfashionUpdateErrors } from "@/lib/efashion-error-messages";

describe("consolidateEfashionUpdateErrors", () => {
  it("laisse passer inchangés les messages qui ne matchent aucun pattern connu", () => {
    const result = consolidateEfashionUpdateErrors(
      [
        "syncPhotos(3899066): TypeError: fetch failed",
        "updateProduit(3899067): eFashion GraphQL: erreur inconnue",
      ],
      "735B",
    );
    expect(result).toEqual([
      "syncPhotos(3899066): TypeError: fetch failed",
      "updateProduit(3899067): eFashion GraphQL: erreur inconnue",
    ]);
  });

  it("consolide en 1 seul message les erreurs 'référence de base déjà utilisée'", () => {
    const errors = [
      `updateProduit(3899066): eFashion GraphQL: La référence de base "735B" est déjà utilisée par le produit actif "735B-NOIR".`,
      `updateProduit(3899067): eFashion GraphQL: La référence de base "735B" est déjà utilisée par le produit actif "735B-BEIGE".`,
      `updateProduit(3899068): eFashion GraphQL: La référence de base "735B" est déjà utilisée par le produit actif "735B-BEIGE".`,
    ];
    const result = consolidateEfashionUpdateErrors(errors, "735B");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/plusieurs fiches actives/i);
    expect(result[0]).toContain("Rafraîchir");
    expect(result[0]).toContain("735B");
  });

  it("consolide aussi le pattern 'référence X-COULEUR déjà utilisée par un autre produit actif'", () => {
    const errors = [
      `updateProduit(3881883): eFashion GraphQL: La référence "10037-BRUN FONCÉ" est déjà utilisée par un autre produit actif.`,
      `updateProduit(3881877): eFashion GraphQL: La référence "10037-NOIR" est déjà utilisée par un autre produit actif.`,
    ];
    const result = consolidateEfashionUpdateErrors(errors, "10037");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/plusieurs fiches actives/i);
    expect(result[0]).toContain("Rafraîchir");
  });

  it("produit quand même le message clair même quand une seule erreur match", () => {
    const errors = [
      `updateProduit(3899066): eFashion GraphQL: La référence de base "735B" est déjà utilisée par le produit actif "735B-NOIR".`,
    ];
    const result = consolidateEfashionUpdateErrors(errors, "735B");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/plusieurs fiches actives/i);
  });

  it("préserve les autres erreurs non-consolidées à côté du message consolidé", () => {
    const errors = [
      `updateProduit(3899066): eFashion GraphQL: La référence de base "735B" est déjà utilisée par le produit actif "735B-NOIR".`,
      `syncPhotos(3899066): TypeError: fetch failed`,
    ];
    const result = consolidateEfashionUpdateErrors(errors, "735B");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/plusieurs fiches actives/i);
    expect(result[1]).toBe("syncPhotos(3899066): TypeError: fetch failed");
  });

  it("renvoie un tableau vide si l'entrée est vide", () => {
    expect(consolidateEfashionUpdateErrors([], "735B")).toEqual([]);
  });
});
