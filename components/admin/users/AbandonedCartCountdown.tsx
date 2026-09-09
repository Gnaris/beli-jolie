"use client";

/**
 * Compte à rebours live pour la colonne « Prochaine relance » de la liste
 * clients. Rafraîchit toutes les secondes côté client sans re-render de la
 * page — le composant serveur passe juste `nextAt` (ISO string).
 *
 * Affiche par exemple : « Stade 2 dans 2 j 3 h ».
 */

import { useEffect, useState } from "react";
import { formatCountdownDetailed } from "@/lib/abandoned-cart-config";

interface Props {
  stageIndex: number;
  /** ISO string du prochain envoi. */
  nextAtIso: string;
}

export default function AbandonedCartCountdown({ stageIndex, nextAtIso }: Props) {
  const target = new Date(nextAtIso).getTime();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsRemaining = Math.max(0, Math.floor((target - Date.now()) / 1000));

  return (
    <div>
      <p className="text-[12.5px] font-body text-text-primary tabular-nums leading-none">
        Stade {stageIndex}
      </p>
      <p className="text-[11px] font-body text-text-muted mt-1 tabular-nums">
        {secondsRemaining === 0 ? "envoi imminent…" : `dans ${formatCountdownDetailed(secondsRemaining)}`}
      </p>
    </div>
  );
}
