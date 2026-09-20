"use client";

/**
 * Compte à rebours live pour l'affichage « Prochaine relance » d'un client.
 * Miroir de AbandonedCartCountdown — même comportement, palette identique.
 *
 * Anti-hydratation : au 1er render (SSR + 1re passe client) on affiche « … ».
 * Le compteur réel s'active seulement après montage — évite le mismatch
 * SSR/CSR d'une seconde qui pollue la console React.
 */

import { useEffect, useState } from "react";
import { formatCountdownDetailed } from "@/lib/inactive-client-config";

interface Props {
  stageIndex: number;
  nextAtIso: string;
}

export default function InactiveClientCountdown({ stageIndex, nextAtIso }: Props) {
  const target = new Date(nextAtIso).getTime();
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <p className="text-[12.5px] font-body text-text-primary tabular-nums leading-none">
        Stade {stageIndex}
      </p>
      <p className="text-[11px] font-body text-text-muted mt-1 tabular-nums">
        {nowMs === null
          ? "…"
          : Math.max(0, Math.floor((target - nowMs) / 1000)) === 0
            ? "envoi imminent…"
            : `dans ${formatCountdownDetailed(Math.max(0, Math.floor((target - nowMs) / 1000)))}`}
      </p>
    </div>
  );
}
