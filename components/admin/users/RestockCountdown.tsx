"use client";

/**
 * Petit compteur live « envoi prévu dans X » pour la colonne « Retour en
 * stock » de /admin/marketing. Miroir simplifié d'AbandonedCartCountdown —
 * pas de stades, juste le temps restant jusqu'à `scheduledSendAt`.
 */

import { useEffect, useState } from "react";

interface Props {
  nextAtIso: string;
  entriesCount: number;
}

function format(seconds: number): string {
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

export default function RestockCountdown({ nextAtIso, entriesCount }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(nextAtIso).getTime();
  const remainingSec = Math.floor((target - now) / 1000);

  // Date dépassée : le worker va envoyer au prochain tick (toutes les 2 min).
  // On affiche « Envoi imminent » plutôt que « Envoi dans 0 s » / un négatif.
  const label =
    remainingSec <= 0 ? "Envoi imminent" : `Envoi dans ${format(remainingSec)}`;

  return (
    <span className="text-[12px] font-body font-semibold">
      {label}
      <span className="ml-1 text-[11px] font-normal opacity-80">
        · {entriesCount} produit{entriesCount > 1 ? "s" : ""}
      </span>
    </span>
  );
}
