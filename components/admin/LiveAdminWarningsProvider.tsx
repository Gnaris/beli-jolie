"use client";

/**
 * Provider + hook qui garde les pastilles de la navigation admin en direct.
 *
 * - Valeur initiale fournie par le server component (évite tout flash de
 *   contenu au premier rendu).
 * - Rafraîchissement périodique côté navigateur toutes les ~25 s via un GET
 *   /api/admin/warnings. Les 11 count() Prisma tournent en parallèle,
 *   l'impact serveur est négligeable.
 * - Pause complète quand l'onglet n'est pas visible (document.visibilityState),
 *   avec un fetch immédiat au moment où il redevient visible — la cliente
 *   voit les chiffres à jour dès qu'elle revient sur l'onglet.
 * - Dedup par comparaison superficielle : si rien n'a changé, pas de setState
 *   → zéro re-render inutile.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AdminWarningsCounts } from "@/lib/admin-warnings";

const POLL_INTERVAL_MS = 25_000;

const LiveAdminWarningsContext = createContext<AdminWarningsCounts | null>(null);

function sameCounts(a: AdminWarningsCounts, b: AdminWarningsCounts): boolean {
  return (
    a.untranslatedCount === b.untranslatedCount &&
    a.unusedColorsCount === b.unusedColorsCount &&
    a.unusedCompositionsCount === b.unusedCompositionsCount &&
    a.unusedTagsCount === b.unusedTagsCount &&
    a.untranslatedCategoriesCount === b.untranslatedCategoriesCount &&
    a.untranslatedSubCategoriesCount === b.untranslatedSubCategoriesCount &&
    a.pendingOrdersCount === b.pendingOrdersCount &&
    a.pendingUsersCount === b.pendingUsersCount &&
    a.openClaimsCount === b.openClaimsCount &&
    a.pendingReviewsCount === b.pendingReviewsCount
  );
}

interface Props {
  initial: AdminWarningsCounts;
  children: React.ReactNode;
}

export function LiveAdminWarningsProvider({ initial, children }: Props) {
  const [counts, setCounts] = useState<AdminWarningsCounts>(initial);
  // Ref sur la dernière valeur connue pour comparer SANS redéclencher l'effet
  // à chaque changement d'état (sinon l'intervalle serait reset en boucle).
  const latest = useRef<AdminWarningsCounts>(initial);
  latest.current = counts;

  useEffect(() => {
    let aborted = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      if (aborted) return;
      try {
        const res = await fetch("/api/admin/warnings", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data = (await res.json()) as AdminWarningsCounts;
        if (aborted) return;
        if (!sameCounts(latest.current, data)) {
          setCounts(data);
        }
      } catch {
        // Erreurs réseau silencieuses : la pastille affiche l'ancienne valeur
        // jusqu'au prochain tick. Pas la peine de polluer la console admin.
      }
    }

    function start() {
      if (timer) return;
      // Fetch immédiat au start pour rattraper tout retard pendant le hide.
      void refresh();
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      aborted = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return (
    <LiveAdminWarningsContext.Provider value={counts}>
      {children}
    </LiveAdminWarningsContext.Provider>
  );
}

/**
 * Lit les compteurs live. Si appelé hors du provider (ne devrait jamais
 * arriver — tout le layout admin est wrappé), remonte `null` au lieu de
 * crasher ; le composant peut alors retomber sur ses valeurs server-side.
 */
export function useLiveAdminWarnings(): AdminWarningsCounts | null {
  return useContext(LiveAdminWarningsContext);
}
