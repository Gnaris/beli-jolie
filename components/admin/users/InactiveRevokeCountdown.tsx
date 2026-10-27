"use client";

/**
 * Compte à rebours live pour l'affichage « Prochaine désactivation auto »
 * d'un client. Miroir de InactiveClientCountdown mais pour la feature de
 * désactivation automatique pour inactivité (badge rouge).
 *
 * Trois types d'évènement affichés :
 *  - warning        → prochain mail d'avertissement (compte APPROVED, aucun
 *                     avertissement précédent valide)
 *  - deactivation   → bascule APPROVED → DEACTIVATED (avertissement déjà
 *                     envoyé, grâce en cours)
 *  - probation_end  → fin de la probation à la réactivation (si pas de
 *                     commande d'ici là, re-DEACTIVATED)
 *
 * Anti-hydratation : au 1er render on affiche « … », le compteur se branche
 * après montage.
 */

import { useEffect, useState } from "react";
import { formatCountdownDetailed } from "@/lib/inactive-client-config";
import type { InactiveRevokeNextEventType } from "@/app/actions/admin/inactive-client-revoke";

interface Props {
  type: InactiveRevokeNextEventType;
  nextAtIso: string;
}

const LABELS: Record<InactiveRevokeNextEventType, string> = {
  warning: "Avertissement",
  deactivation: "Désactivation",
  probation_end: "Fin de probation",
};

export default function InactiveRevokeCountdown({ type, nextAtIso }: Props) {
  const target = new Date(nextAtIso).getTime();
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft =
    nowMs === null ? null : Math.max(0, Math.floor((target - nowMs) / 1000));

  return (
    <div>
      <p className="text-[12.5px] font-body font-semibold text-red-900 tabular-nums leading-none">
        {LABELS[type]}
      </p>
      <p className="text-[11px] font-body text-red-700 mt-1 tabular-nums">
        {secondsLeft === null
          ? "…"
          : secondsLeft === 0
            ? "imminent…"
            : `dans ${formatCountdownDetailed(secondsLeft)}`}
      </p>
    </div>
  );
}
