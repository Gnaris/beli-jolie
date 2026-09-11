/**
 * Affichage du dernier stade de relance panier abandonné envoyé au client.
 * Complète `AbandonedCartCountdown` (qui montre le prochain stade à venir) en
 * indiquant ce que la cliente a *déjà* reçu.
 *
 * Si le stade a été supprimé de la configuration depuis son envoi, on garde
 * quand même le numéro historique + suffixe « (supprimé) » — comme ça la
 * cliente sait qu'un mail est bien parti même si le modèle correspondant
 * n'existe plus.
 */

interface Props {
  stageIndex: number;
  /** ISO string de l'envoi. */
  atIso: string;
  /** true si le stade existe encore dans la config actuelle. */
  stillExists: boolean;
}

export default function AbandonedCartLastSent({
  stageIndex,
  atIso,
  stillExists,
}: Props) {
  const at = new Date(atIso);
  const date = at.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
  return (
    <p className="text-[10.5px] font-body text-text-muted tabular-nums">
      Dernier envoi : Stade {stageIndex}
      {!stillExists && (
        <span className="text-red-600"> (supprimé)</span>
      )}{" "}
      · {date}
    </p>
  );
}
