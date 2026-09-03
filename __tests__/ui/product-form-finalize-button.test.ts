import { describe, it, expect } from "vitest";

// Bouton « Finaliser le produit » sur un brouillon (mode create + productId).
//
// Contexte du bug corrigé le 2026-09-03 :
//   Un ancien fix (commit c45c89485, 2026-07-02) avait ajouté une condition
//   `isDraftFinalize = mode === "create" && !!productId` qui grisait
//   systématiquement le bouton « Finaliser le produit » sur un brouillon, sur
//   la théorie qu'« Enregistrer en brouillon » ferait doublon.
//
//   Or `handleSaveDraft` force `isIncomplete: true` dans son payload : il ne
//   sort donc jamais le produit du mode brouillon. Résultat : plus aucun bouton
//   ne permettait de finaliser un brouillon depuis l'interface (bug signalé
//   sur le produit E262E — bouton grisé, aucun message d'erreur).
//
//   Le fix retire cette condition : le bouton reste cliquable dès qu'aucune
//   opération en cours ne le bloque (isPending / isSyncLocked / isUploading).
//   `handleSave`, qui est exécuté au clic, sait déjà retirer le drapeau
//   brouillon en mode create quand la fiche est complète.

function computeFinalizeButtonDisabled({
  isPending,
  isSyncLocked,
  isUploading,
}: {
  isPending: boolean;
  isSyncLocked: boolean;
  isUploading: boolean;
}) {
  return isPending || isSyncLocked || isUploading;
}

describe("ProductForm — bouton « Finaliser le produit » sur brouillon", () => {
  it("brouillon (create + productId) : bouton cliquable quand rien ne bloque", () => {
    const disabled = computeFinalizeButtonDisabled({
      isPending: false,
      isSyncLocked: false,
      isUploading: false,
    });
    expect(disabled).toBe(false);
  });

  it("brouillon : bouton grisé pendant l'enregistrement en cours", () => {
    const disabled = computeFinalizeButtonDisabled({
      isPending: true,
      isSyncLocked: false,
      isUploading: false,
    });
    expect(disabled).toBe(true);
  });

  it("brouillon : bouton grisé pendant la publication marketplace (sync lock)", () => {
    const disabled = computeFinalizeButtonDisabled({
      isPending: false,
      isSyncLocked: true,
      isUploading: false,
    });
    expect(disabled).toBe(true);
  });

  it("brouillon : bouton grisé pendant le téléversement des photos", () => {
    const disabled = computeFinalizeButtonDisabled({
      isPending: false,
      isSyncLocked: false,
      isUploading: true,
    });
    expect(disabled).toBe(true);
  });
});
