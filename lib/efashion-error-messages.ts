/**
 * Traduction des messages d'erreur bruts remontés par eFashion en messages
 * lisibles pour l'admin non-dev.
 *
 * Le cas « référence déjà utilisée » revient sur plusieurs variantes à la fois
 * quand le produit a fini avec plusieurs fiches actives partageant la même
 * reference_base côté eFashion (typiquement deux « principales » créées lors
 * d'un ancien bug de re-publish/soft-delete raté). Le pavé technique brut
 * décourage l'admin et masque la seule vraie action qui débloque : Rafraîchir
 * (recrée les fiches avec de nouveaux IDs, l'ancienne série est soft-supprimée).
 */

// eFashion renvoie deux formulations très proches pour le même problème :
//  - « La référence de base "X" est déjà utilisée par le produit actif "X-COULEUR" »
//  - « La référence "X-COULEUR" est déjà utilisée par un autre produit actif »
const REFERENCE_CONFLICT_PATTERN =
  /La référence(?: de base)?\s+"[^"]+"\s+est déjà utilisée/i;

function buildReferenceConflictMessage(refBase: string): string {
  return (
    `⚠️ eFashion voit plusieurs fiches actives partageant la référence "${refBase}" — ` +
    `impossible de les mettre à jour tant qu'elles coexistent. ` +
    `Clique sur ↻ Rafraîchir (au lieu de Synchroniser) : les anciennes fiches seront ` +
    `soft-supprimées et 1 seule série neuve sera recréée proprement. ` +
    `⚠️ Les URLs eFashion changeront (nouveaux IDs).`
  );
}

/**
 * Prend les messages d'erreur bruts accumulés pendant un `updateProduit` sur
 * les variantes d'un produit, et renvoie une liste condensée. Le pattern
 * « référence déjà utilisée » (qui remonte typiquement N fois — une par
 * variante) est fusionné en 1 message unique orienté action.
 */
export function consolidateEfashionUpdateErrors(
  errors: ReadonlyArray<string>,
  referenceBase: string,
): string[] {
  const others: string[] = [];
  let hasReferenceConflict = false;
  for (const err of errors) {
    if (REFERENCE_CONFLICT_PATTERN.test(err)) {
      hasReferenceConflict = true;
    } else {
      others.push(err);
    }
  }
  const out: string[] = [];
  if (hasReferenceConflict) {
    out.push(buildReferenceConflictMessage(referenceBase));
  }
  out.push(...others);
  return out;
}
