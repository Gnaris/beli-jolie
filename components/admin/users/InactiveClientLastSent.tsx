/**
 * Affichage du dernier stade de relance inactivité envoyé au client.
 * Miroir de AbandonedCartLastSent.
 */

interface Props {
  stageIndex: number;
  atIso: string;
  stillExists: boolean;
}

export default function InactiveClientLastSent({
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
      {!stillExists && <span className="text-red-600"> (supprimé)</span>} · {date}
    </p>
  );
}
