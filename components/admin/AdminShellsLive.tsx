"use client";

/**
 * Pont client entre `<LiveAdminWarningsProvider>` et les deux shells
 * (desktop + mobile) de la navigation admin. Reconstruit les mappings
 * d'affichage (`warningCounts` par href + mobileWarnings à plat) à chaque
 * fois que le hook de polling remonte de nouveaux chiffres, puis les
 * passe aux shells existants en props — pas besoin de les refondre.
 *
 * L'avantage de centraliser ici : la logique de dérivation (quelle entrée
 * de menu reçoit la pastille, avec quel tooltip) reste UNIQUE au lieu
 * d'être copiée dans chaque shell.
 */

import React from "react";
import AdminDesktopShell from "./AdminDesktopShell";
import AdminMobileNav from "./AdminMobileNav";
import { useLiveAdminWarnings } from "./LiveAdminWarningsProvider";
import { sumAttributeWarnings } from "@/lib/admin-warnings";

interface Props {
  shopName: string;
  userName: string;
  initials: string;
  children: React.ReactNode;
}

export default function AdminShellsLive({
  shopName,
  userName,
  initials,
  children,
}: Props) {
  const counts = useLiveAdminWarnings();

  // Le provider parent garantit une valeur initiale non-null — on ne peut
  // tomber ici qu'en cas de wiring cassé en dev. Rendre `null` est préférable
  // à un crash de toute la navigation admin.
  if (!counts) return null;

  const totalAttributeWarnings = sumAttributeWarnings(counts);

  const warningCounts: Record<
    string,
    { count: number; tooltip: string; title?: string; reasons?: string[]; hint?: string } | undefined
  > = {};

  if (totalAttributeWarnings > 0) {
    const plural = totalAttributeWarnings > 1 ? "s" : "";
    warningCounts["/admin/produits"] = {
      count: totalAttributeWarnings,
      tooltip: `${totalAttributeWarnings} traduction${plural} manquante${plural}`,
      title: `${totalAttributeWarnings} traduction${plural} à compléter`,
      hint: "Détail par ligne dans le sous-menu.",
    };
  }

  const mobileWarnings: Record<string, number> = {
    ...Object.fromEntries(
      Object.entries(warningCounts)
        .filter(([, w]) => w && w.count > 0)
        .map(([href, w]) => [href, w!.count]),
    ),
    "/admin/commandes": counts.pendingOrdersCount,
    "/admin/clients": counts.pendingUsersCount,
    "/admin/service-client": counts.openClaimsCount,
    "/admin/avis": counts.pendingReviewsCount,
  };

  return (
    <AdminDesktopShell
      shopName={shopName}
      userName={userName}
      initials={initials}
      warnings={warningCounts}
      pendingOrdersCount={counts.pendingOrdersCount}
      pendingUsersCount={counts.pendingUsersCount}
      openClaimsCount={counts.openClaimsCount}
      pendingReviewsCount={counts.pendingReviewsCount}
    >
      <AdminMobileNav
        userName={userName}
        initials={initials}
        warnings={mobileWarnings}
        shopName={shopName}
      />

      <main className="flex-1 p-4 md:p-6 lg:p-8 lg:bg-white lg:min-h-screen">
        {children}
      </main>
    </AdminDesktopShell>
  );
}
