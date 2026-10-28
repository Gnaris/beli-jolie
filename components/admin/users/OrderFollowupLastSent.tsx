"use client";

/**
 * Affiche la date du dernier mail « suivi commande » envoyé à ce client.
 * Miroir de RestockLastSent — version minimale.
 */

interface Props {
  atIso: string;
  orderNumber: string;
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

export default function OrderFollowupLastSent({ atIso, orderNumber }: Props) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-body text-text-muted bg-bg-secondary"
      title={`Dernier mail de suivi envoyé pour ${orderNumber} : ${new Date(atIso).toLocaleString("fr-FR")}`}
    >
      Envoyé {formatDate(atIso)}
    </span>
  );
}
