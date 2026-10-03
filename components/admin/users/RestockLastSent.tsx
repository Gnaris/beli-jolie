"use client";

/**
 * Affiche la date du dernier mail « retour en stock » envoyé à ce client.
 * Miroir d'AbandonedCartLastSent — version minimale (pas de stade à afficher).
 */

interface Props {
  atIso: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function RestockLastSent({ atIso }: Props) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-body text-text-muted bg-bg-secondary"
      title={`Dernier envoi retour en stock : ${new Date(atIso).toLocaleString("fr-FR")}`}
    >
      Envoyé {formatDate(atIso)}
    </span>
  );
}
