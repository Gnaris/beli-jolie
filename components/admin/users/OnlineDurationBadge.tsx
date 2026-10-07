"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/duration-format";

interface Props {
  /**
   * Date de connexion (lastLoginAt côté serveur). Le compteur affiche la
   * durée écoulée depuis cette date, mise à jour toutes les secondes
   * côté navigateur (zéro requête serveur).
   */
  lastLoginAt: Date | string | null;
  /**
   * `stacked` (défaut) : pastille au-dessus + "Depuis Xmin Ys" en dessous
   * (version table). `inline` : "En ligne · depuis Xmin" sur une ligne
   * (version carte mobile).
   */
  variant?: "stacked" | "inline";
}

/**
 * Pastille « En ligne · depuis Xmin Ys » avec compteur local qui tick
 * toutes les secondes. Si `lastLoginAt` est absent, retombe sur un
 * affichage neutre.
 *
 * À monter uniquement quand on sait déjà que le client est en ligne
 * (via `isOnline(lastSeenAt)` côté parent). Sans quoi la durée affichée
 * n'a pas de sens pour une personne qui a quitté le site.
 */
export default function OnlineDurationBadge({ lastLoginAt, variant = "stacked" }: Props) {
  const loginTs = lastLoginAt ? new Date(lastLoginAt).getTime() : null;
  const [elapsed, setElapsed] = useState<number>(() =>
    loginTs ? Date.now() - loginTs : 0,
  );

  useEffect(() => {
    if (loginTs == null) return;
    const tick = () => setElapsed(Date.now() - loginTs);
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [loginTs]);

  if (variant === "inline") {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
        <span className="relative inline-flex w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
          <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
        </span>
        <span className="tabular-nums">
          En ligne{loginTs ? ` · depuis ${formatDuration(elapsed)}` : ""}
        </span>
      </span>
    );
  }

  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-xs font-body font-medium text-emerald-700">
        <span className="relative inline-flex w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-70" />
          <span className="relative w-2 h-2 rounded-full bg-emerald-500" />
        </span>
        En ligne
      </span>
      <p className="text-[11px] font-body mt-0.5 text-text-secondary tabular-nums">
        {loginTs ? `Depuis ${formatDuration(elapsed)}` : "Connectée"}
      </p>
    </>
  );
}
