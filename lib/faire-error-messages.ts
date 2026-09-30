/**
 * Traduction des messages d'erreur bruts remontés par Faire en messages
 * orientés action pour l'admin non-dev.
 *
 * Chaque pattern décrit un état sortant du fonctionnement normal (variante
 * orpheline, fiche publiée bloquée, etc.) qui ne peut être débloqué que par
 * une action manuelle précise — on la nomme explicitement dans le message.
 */

const DUPLICATE_VARIANTS_MESSAGE =
  "⚠️ Faire refuse la mise à jour : au moins une variante existe déjà chez Faire mais n'est pas liée à ce produit BJ. " +
  "Pour débloquer proprement : dans le widget marketplace, clique **Délier de Faire** puis **Relier à une fiche Faire existante** — la modale re-matchera toutes les couleurs (utilise « Importer » pour les variantes orphelines). " +
  "Relance ensuite la synchro.";

const PUBLISHED_LOCK_MESSAGE =
  "⚠️ Faire refuse de restructurer cette fiche : elle est publiée avec une seule variante et Faire exige au moins une option (couleur/taille) pour tout produit publié. " +
  "Deux façons de débloquer : " +
  "**A — Non destructive (à essayer en premier)** : dans le widget marketplace, clique **Délier de Faire** puis **Relier à une fiche Faire existante** — la modale te permet de re-matcher les couleurs (utilise « Importer » sur les orphelines). " +
  "**B — Si A ne suffit pas** : sur ton back-office Faire, **dépublie ou archive** cette fiche, puis reviens ici et clique **↻ Rafraîchir** (pas Synchroniser). La fiche sera recréée avec l'axe couleur. ⚠️ L'URL Faire change.";

/**
 * Reconnaît les patterns d'erreur Faire connus et retourne un message
 * orienté action. Retourne `null` pour un message non reconnu (l'appelant
 * conserve alors le brut Faire tel quel).
 */
export function translateFaireUpdateError(rawMessage: string): string | null {
  if (!rawMessage) return null;

  if (/duplicate\s+variants\s+with\s+same\s+options/i.test(rawMessage)) {
    return DUPLICATE_VARIANTS_MESSAGE;
  }

  if (
    /PRODUCT_NEEDS_AT_LEAST_ONE_OPTION/i.test(rawMessage) ||
    /au moins une option/i.test(rawMessage)
  ) {
    return PUBLISHED_LOCK_MESSAGE;
  }

  return null;
}
