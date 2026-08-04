/**
 * Éligibilité d'un produit à une propagation vers Microstore.
 *
 * Contrairement à PFS/Ankor/eFashion/Faire qui filtrent sur l'existence
 * d'un identifiant marketplace (donc excluent naturellement les brouillons
 * — jamais liés), l'API Microstore `/goods/import_v1` est un upsert par
 * `item_ref` : un premier push crée la fiche côté Microstore. Sans garde,
 * pousser un brouillon créerait une fiche incomplète chez Microstore.
 */

export interface MicrostorePropagationInput {
  microstoreEnabled?: boolean;
  isIncomplete: boolean;
}

export function isMicrostorePropagationEligible(
  p: MicrostorePropagationInput,
): boolean {
  return !!p.microstoreEnabled && !p.isIncomplete;
}
