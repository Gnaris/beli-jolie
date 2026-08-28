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

/**
 * Doit-on proposer Microstore dans la modale « propager les modifications »
 * du formulaire fiche produit ?
 *
 * Règle : dès que le produit est déjà lié à Microstore ET que l'option
 * Microstore est configurée côté site + activée pour le produit, on propose
 * — quel que soit le nouveau statut (ONLINE / OFFLINE / ARCHIVED).
 *
 * Depuis 2026-08-25, /goods/update accepte `disable=1|0` : un passage OFFLINE
 * ou ARCHIVED doit se propager pour masquer la fiche H5 côté acheteuses.
 */
export function shouldProposeMicrostoreOnFormSave(input: {
  hasMicrostoreConfig: boolean;
  microstoreEnabledForProduct: boolean;
  alreadyLinkedToMicrostore: boolean;
  onlyOrderchampFieldChanged: boolean;
}): boolean {
  if (input.onlyOrderchampFieldChanged) return false;
  if (!input.hasMicrostoreConfig) return false;
  if (!input.microstoreEnabledForProduct) return false;
  if (!input.alreadyLinkedToMicrostore) return false;
  return true;
}
