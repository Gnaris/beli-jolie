/**
 * STUB temporaire — recherche Ankorstore désactivée (2026-08-13).
 *
 * Cette server action alimentait la modale « Lier à un produit Ankorstore ».
 * Elle utilisait l'API partenaire OAuth2 qui est démantelée. Le rebranchement
 * sur le nouveau module `lib/ankorstore-bo/link.ts` (fonction `findLinkCandidates`)
 * viendra dans une itération dédiée à la liaison.
 *
 * En attendant, les fonctions retournent une erreur explicite pour ne pas
 * casser les composants qui les importent.
 */

"use server";

import type { AnkorstoreLinkPreview } from "@/app/actions/admin/ankorstore";

const DISABLED_ERROR =
  "Recherche Ankorstore désactivée temporairement pendant le chantier reverse-engineering. Utilise la modale mise à jour dès qu'elle sera disponible.";

export async function searchAndPreviewAnkorstoreByQuery(
  _productId?: string,
  _query?: string
): Promise<{ success: false; error: string }> {
  return { success: false, error: DISABLED_ERROR };
}

export async function searchAnkorstoreByBjProduct(): Promise<
  { success: false; error: string }
> {
  return { success: false, error: DISABLED_ERROR };
}

export async function previewAnkorstoreByProductId(): Promise<
  | { success: true; data: AnkorstoreLinkPreview; totalMatches: number }
  | { success: false; error: string }
> {
  return { success: false, error: DISABLED_ERROR };
}

export async function searchAnkorstoreProductsAction(): Promise<
  { success: false; error: string }
> {
  return { success: false, error: DISABLED_ERROR };
}

/**
 * STUB — appelé par linkMarketplaceAdapters (LinkMarketplaceModal unifié).
 * Retourne un résultat vide pour ne pas casser le build ; utilise plutôt
 * la nouvelle modale `LinkAnkorstoreProductModal` V2 branchée sur le
 * back-office reverse.
 */
export async function searchAnkorstoreCandidatesList(): Promise<
  { success: false; error: string }
> {
  return { success: false, error: DISABLED_ERROR };
}
