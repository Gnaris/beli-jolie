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
import { buildAttributeWarningReasons, sumAttributeWarnings } from "@/lib/admin-warnings";

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
    // Détail par type dans l'info-bulle — évite le total opaque qui envoyait
    // la cliente filtrer les produits (filtre à 0) alors que le trou était
    // par exemple sur les mots-clés.
    const reasons = buildAttributeWarningReasons(counts);

    const pluralTotal = totalAttributeWarnings > 1 ? "s" : "";
    warningCounts["/admin/produits"] = {
      count: totalAttributeWarnings,
      tooltip: `${totalAttributeWarnings} traduction${pluralTotal} manquante${pluralTotal}`,
      title: `${totalAttributeWarnings} traduction${pluralTotal} à compléter`,
      reasons,
      hint: "Ouvrez le sous-menu « Produits » : la pastille indique où cliquer.",
    };

    // Pastille sur chaque sous-entrée concernée du menu « Produits ». Les hrefs
    // doivent matcher PRODUCT_SUBNAV dans AdminDesktopShell / AdminMobileNav.
    // On n'écrit PAS sur /admin/produits ici : la clé est déjà prise par le
    // parent (sum). La sous-entrée « Tous les produits » partage ce href et
    // affichera donc la même pastille — acceptable (même destination).
    const subEntries: [string, number, string][] = [
      ["/admin/categories",   counts.untranslatedCategoriesCount + counts.untranslatedSubCategoriesCount, "catégorie"],
      ["/admin/couleurs",     counts.unusedColorsCount,                                                   "couleur"],
      ["/admin/compositions", counts.unusedCompositionsCount,                                             "composition"],
      ["/admin/mots-cles",    counts.unusedTagsCount,                                                     "mot-clé"],
    ];
    for (const [href, count, singular] of subEntries) {
      if (count <= 0) continue;
      const plural = count > 1 ? "s" : "";
      const label = singular === "mot-clé" ? (count > 1 ? "mots-clés" : "mot-clé") : `${singular}${plural}`;
      warningCounts[href] = {
        count,
        tooltip: `${count} ${label} sans traduction`,
        title: `${count} ${label} sans traduction`,
        hint: "Cliquez pour compléter la traduction anglaise.",
      };
    }
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
