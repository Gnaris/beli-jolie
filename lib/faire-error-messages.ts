/**
 * Traduction des messages d'erreur bruts remontés par Faire en messages
 * orientés action pour l'admin non-dev.
 *
 * Chaque pattern décrit un état sortant du fonctionnement normal (variante
 * orpheline, fiche publiée bloquée, etc.) qui ne peut être débloqué que par
 * une action manuelle précise — on la nomme explicitement dans le message.
 */

const DUPLICATE_VARIANTS_MESSAGE =
  "⚠️ Faire bloque la mise à jour : au moins une de tes couleurs existe déjà côté Faire mais n'est pas rattachée dans BJ (une variante « orpheline »). " +
  "Pour la rattacher proprement :\n" +
  "1. Ouvre le widget marketplaces (icône flottante en bas à droite).\n" +
  "2. Sur la ligne Faire, clique **Délier** puis **Relier à une fiche existante**.\n" +
  "3. Dans la fenêtre qui s'ouvre, associe chacune de tes couleurs BJ à la fiche Faire. Sur la ou les variantes marquées « orpheline », clique **Importer** — ça les rattache automatiquement.\n" +
  "4. Relance la synchro.";

const PUBLISHED_LOCK_MESSAGE =
  "⚠️ Faire bloque la mise à jour : ta fiche Faire n'a qu'une variante sans couleur, et Faire refuse de la modifier tant qu'elle est publiée. " +
  "Deux façons de débloquer, essaie A d'abord :\n\n" +
  "**A — Sans rien casser (recommandé)** : ouvre le widget marketplaces (icône flottante en bas à droite) → sur la ligne Faire, clique **Délier**, puis **Relier à une fiche existante**. Une fenêtre s'ouvre : associe chacune de tes couleurs BJ à la fiche Faire. Si des variantes Faire apparaissent en « orphelines », clique **Importer** pour les rattacher.\n\n" +
  "**B — Si A ne marche pas** :\n" +
  "1. Va sur ton back-office Faire → ouvre cette fiche → clique **Dépublier** ou **Archiver**.\n" +
  "2. Reviens ici → clique le bouton **↻ (Rafraîchir)**, pas Synchroniser.\n" +
  "→ Ce bouton supprime la vieille fiche Faire et en crée une nouvelle à la place, cette fois avec toutes tes couleurs. ⚠️ Nouveau lien Faire (l'ancien ne marchera plus).";

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
