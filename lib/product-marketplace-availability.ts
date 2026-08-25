/**
 * Helper pur — calcule, pour la modale post-save du formulaire produit,
 * quelles marketplaces doivent être considérées comme « déjà liées » (donc
 * proposables).
 *
 * Règle générale (édition d'un produit existant) : une marketplace est
 * considérée liée si son ID marketplace correspondant est posé sur
 * `initialData`. Sinon la 1ʳᵉ publication passe par le badge de la fiche.
 *
 * Exception « création vierge » (`mode="create"` + pas encore de `productId`) :
 * la cliente est sur `/admin/produits/nouveau` (avec ou sans `?dupliquerDe=…`).
 * Aucun ID marketplace ne peut être posé sur `initialData`. On force alors
 * chaque flag à `true` pour que la modale propose toutes les marketplaces
 * configurées + activées en une passe, au lieu d'obliger la cliente à ouvrir
 * la fiche et cliquer sur chaque badge marketplace un par un.
 *
 * La finalisation d'un draft (`mode="create"` + `productId` défini) garde le
 * comportement standard « seulement les marketplaces déjà liées » : c'est un
 * cas rare mais dans lequel le draft a été chargé depuis la DB et peut avoir
 * des IDs marketplace réels.
 */

export interface ProductMarketplaceAvailabilityInput {
  mode: "create" | "edit" | undefined;
  productId: string | undefined;
  initialData:
    | {
        pfsProductId?: string | null;
        ankorsProductId?: string | null;
        efashionReferenceBase?: string | null;
        faireProductId?: string | null;
        orderchampProductId?: string | null;
        microstoreProductId?: number | null;
      }
    | undefined;
}

export interface ProductMarketplaceAvailability {
  isFreshCreation: boolean;
  alreadyOnPfs: boolean;
  alreadyOnAnkorstore: boolean;
  alreadyOnEfashion: boolean;
  alreadyOnFaire: boolean;
  alreadyOnOrderchamp: boolean;
  alreadyOnMicrostore: boolean;
}

export function computeProductMarketplaceAvailability(
  input: ProductMarketplaceAvailabilityInput,
): ProductMarketplaceAvailability {
  const { mode, productId, initialData } = input;
  const isFreshCreation = mode === "create" && !productId;
  return {
    isFreshCreation,
    alreadyOnPfs: isFreshCreation || !!initialData?.pfsProductId,
    alreadyOnAnkorstore: isFreshCreation || !!initialData?.ankorsProductId,
    alreadyOnEfashion: isFreshCreation || !!initialData?.efashionReferenceBase,
    alreadyOnFaire: isFreshCreation || !!initialData?.faireProductId,
    alreadyOnOrderchamp: isFreshCreation || !!initialData?.orderchampProductId,
    alreadyOnMicrostore: isFreshCreation || initialData?.microstoreProductId != null,
  };
}
