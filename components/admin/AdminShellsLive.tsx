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

import React, { useEffect, useState } from "react";
import AdminDesktopShell from "./AdminDesktopShell";
import AdminMobileNav from "./AdminMobileNav";
import AdminMobileSubnav from "./AdminMobileSubnav";
import AdminPageHeader from "./AdminPageHeader";
import AdminPageTransition from "./AdminPageTransition";
import { useLiveAdminWarnings } from "./LiveAdminWarningsProvider";
import { buildAttributeWarningReasons, sumAttributeWarnings } from "@/lib/admin-warnings";
import type { AdminTheme } from "@/lib/admin-theme";

interface Props {
  shopName: string;
  userName: string;
  initials: string;
  adminTheme: AdminTheme;
  children: React.ReactNode;
}

export default function AdminShellsLive({
  shopName,
  userName,
  initials,
  adminTheme,
  children,
}: Props) {
  const counts = useLiveAdminWarnings();
  const [isScrolled, setIsScrolled] = useState(false);
  // Expand sidebar au survol : affiche les labels à côté des icônes et
  // décale le contenu principal pour laisser la place.
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Détection scroll pour poser un fond blanc + ombre sur le header
  // quand on dépasse le top. Seuil 8px (évite de clignoter au moindre
  // mouvement).
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

    // Pastille sur chaque sous-entrée du menu « Produits ». Les hrefs doivent
    // matcher ATTRIBUT_TABS (components/admin/attributs/AttributsTabs.tsx),
    // source unique de vérité pour la sous-nav produits/attributs.
    // On n'écrit PAS sur /admin/produits ici : la clé est déjà prise par le
    // parent (sum) sur l'item « Produits » de la sidebar et du drawer mobile.
    const subEntries: [string, number, string][] = [
      ["/admin/produits/attributs?onglet=categories",   counts.untranslatedCategoriesCount + counts.untranslatedSubCategoriesCount, "catégorie"],
      ["/admin/produits/attributs?onglet=couleurs",     counts.unusedColorsCount,                                                   "couleur"],
      ["/admin/produits/attributs?onglet=compositions", counts.unusedCompositionsCount,                                             "composition"],
      ["/admin/produits/attributs?onglet=mots-cles",    counts.unusedTagsCount,                                                     "mot-clé"],
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
      adminTheme={adminTheme}
      warnings={warningCounts}
      pendingOrdersCount={counts.pendingOrdersCount}
      pendingUsersCount={counts.pendingUsersCount}
      openClaimsCount={counts.openClaimsCount}
      pendingReviewsCount={counts.pendingReviewsCount}
      sidebarExpanded={sidebarExpanded}
      onSidebarExpandedChange={setSidebarExpanded}
    >
      <AdminMobileNav
        userName={userName}
        initials={initials}
        warnings={mobileWarnings}
        shopName={shopName}
      />

      {/* Sous-nav mobile : pastilles sticky sous la top-bar, visible
          uniquement sur les pages avec onglets (produits/marketing). */}
      <AdminMobileSubnav />

      {/* Header de page : sticky top-3, suit le scroll. Fond blanc +
          ombre discrète apparaissent dès qu'on scrolle sous le header
          pour qu'il se démarque du contenu qui défile. */}
      <div
        className={`hidden lg:block lg:sticky lg:top-0 lg:z-30 lg:px-3 lg:pt-3 lg:transition-all lg:duration-200 ${
          isScrolled ? "lg:pb-3 lg:bg-white/80 lg:backdrop-blur-md lg:shadow-[0_8px_18px_-10px_rgba(9,9,11,0.18)]" : ""
        }`}
      >
        <AdminPageHeader shopName={shopName} userName={userName} initials={initials} />
      </div>

      {/* Contenu principal : décalé à droite de la sidebar. La sidebar
          est fixed, donc on compense via padding-left (pas de ml). Le
          padding transitionne entre 92px (sidebar collapsed) et 260px
          (sidebar expand sur hover) pour que le contenu rétrécisse en
          douceur quand les labels apparaissent. */}
      <main
        className={`flex-1 p-4 md:p-6 lg:pt-6 lg:pr-6 lg:pb-6 lg:transition-[padding-left] lg:duration-300 lg:ease-out ${
          sidebarExpanded ? "lg:pl-[260px]" : "lg:pl-[92px]"
        }`}
      >
        <AdminPageTransition>
          <div className="lg:bg-white lg:border lg:border-zinc-200/80 lg:rounded-2xl lg:shadow-sm lg:p-8 lg:min-h-[calc(100vh-180px)]">
            {children}
          </div>
        </AdminPageTransition>
      </main>
    </AdminDesktopShell>
  );
}
