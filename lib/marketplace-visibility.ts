/**
 * Règle transversale UX (voir mémoire
 * `feedback_marketplace_modal_all_marketplaces.md`) :
 *
 * Toute modale « push marketplaces » (Synchroniser, Rafraîchir, save fiche,
 * bulk edit…) doit envisager les 6 marketplaces, MAIS chaque case n'apparaît
 * QUE si le produit est déjà lié à cette marketplace. La 1ʳᵉ publication
 * passe par le badge coloré de la fiche produit — sinon on laisse le worker
 * tourner à vide sur des IDs absents et la cliente voit un toast « succès »
 * trompeur.
 *
 * `isMarketplaceLinked` centralise la règle « déjà lié » par marketplace :
 *   - PFS/Ankor/Faire/OC : présence de `{mkt}ProductId`
 *   - eFashion : au moins une couleur avec `efashionProductId`
 *   - Microstore : `microstoreLastPushedAt` posé (l'API native le populate au
 *     premier push, cf. CLAUDE.md § Microstore)
 */

export interface MarketplaceLinkInput {
  pfsProductId?: string | number | null;
  ankorsProductId?: string | number | null;
  faireProductId?: string | number | null;
  orderchampProductId?: string | number | null;
  microstoreLastPushedAt?: string | Date | null;
  colors?: ReadonlyArray<{ efashionProductId?: string | number | null }>;
}

export type MarketplaceKind =
  | "pfs"
  | "ankorstore"
  | "efashion"
  | "faire"
  | "orderchamp"
  | "microstore";

export function isMarketplaceLinked(
  product: MarketplaceLinkInput,
  marketplace: MarketplaceKind,
): boolean {
  switch (marketplace) {
    case "pfs":
      return !!product.pfsProductId;
    case "ankorstore":
      return !!product.ankorsProductId;
    case "efashion":
      return (product.colors ?? []).some((c) => c.efashionProductId != null);
    case "faire":
      return !!product.faireProductId;
    case "orderchamp":
      return !!product.orderchampProductId;
    case "microstore":
      return product.microstoreLastPushedAt != null;
  }
}
