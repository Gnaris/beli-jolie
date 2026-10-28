"use client";

/**
 * Compteur live « envoi prévu dans X » pour la colonne « Suivi commande »
 * de /admin/contact-client. Basé sur `Order.shippedAt + 10 j` quand le mail
 * n'a pas encore été envoyé (`reviewRequestEmailSentAt is null`).
 */

import { useEffect, useState } from "react";

interface Props {
  nextAtIso: string;
  orderNumber: string;
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

export default function OrderFollowupCountdown({ nextAtIso, orderNumber }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const target = new Date(nextAtIso).getTime();
  const remainingSec = Math.floor((target - now) / 1000);

  // Date dépassée : le worker va envoyer au prochain tick (toutes les heures).
  const label =
    remainingSec <= 0 ? "Envoi imminent" : `Envoi dans ${format(remainingSec)}`;

  return (
    <span className="text-[12px] font-body font-semibold">
      {label}
      <span className="ml-1 text-[11px] font-normal opacity-80">· {orderNumber}</span>
    </span>
  );
}
