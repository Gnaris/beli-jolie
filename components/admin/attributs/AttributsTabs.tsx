"use client";

import { useEffect, useRef, useState } from "react";

export type AttributTab =
  | "produits"
  | "categories"
  | "couleurs"
  | "compositions"
  | "saisons"
  | "tailles"
  | "codes-sh"
  | "mots-cles";

export const ATTRIBUT_TABS: { id: AttributTab; label: string; href: string }[] = [
  { id: "produits",     label: "Tous les produits", href: "/admin/produits" },
  { id: "categories",   label: "Catégories",        href: "/admin/produits/attributs?onglet=categories" },
  { id: "couleurs",     label: "Couleurs",          href: "/admin/produits/attributs?onglet=couleurs" },
  { id: "compositions", label: "Compositions",      href: "/admin/produits/attributs?onglet=compositions" },
  { id: "saisons",      label: "Saisons",           href: "/admin/produits/attributs?onglet=saisons" },
  { id: "tailles",      label: "Tailles",           href: "/admin/produits/attributs?onglet=tailles" },
  { id: "codes-sh",     label: "Codes SH",          href: "/admin/produits/attributs?onglet=codes-sh" },
  { id: "mots-cles",    label: "Mots-clés",         href: "/admin/produits/attributs?onglet=mots-cles" },
];

/**
 * Résout l'onglet actif à partir du pathname + query. Supporte les anciennes
 * URLs d'attributs (redirigeables) pour la rétrocompat.
 */
export function resolveActiveTab(pathname: string, onglet: string | null): AttributTab {
  if (pathname === "/admin/produits") return "produits";
  if (pathname === "/admin/produits/attributs") {
    const match = ATTRIBUT_TABS.find((t) => t.id === onglet);
    return match?.id ?? "categories";
  }
  if (pathname.startsWith("/admin/categories"))   return "categories";
  if (pathname.startsWith("/admin/couleurs"))     return "couleurs";
  if (pathname.startsWith("/admin/compositions")) return "compositions";
  if (pathname.startsWith("/admin/saisons"))      return "saisons";
  if (pathname.startsWith("/admin/tailles"))      return "tailles";
  if (pathname.startsWith("/admin/codes-sh"))     return "codes-sh";
  if (pathname.startsWith("/admin/mots-cles"))    return "mots-cles";
  return "produits";
}

interface Props {
  activeTab: AttributTab;
  children: React.ReactNode;
}

/**
 * Wrapper d'animation entre onglets d'attributs produits. La barre de tabs
 * elle-même vit dans AdminPageHeader → sous-nav header global (fusion
 * 2026-10-21). Ici on gère uniquement le slide gauche/droite au change de
 * `activeTab`, selon la direction (position du nouvel onglet vs l'ancien).
 */
export default function AttributsTabs({ activeTab, children }: Props) {
  const previousTab = useRef<AttributTab>(activeTab);
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    const prevIdx = ATTRIBUT_TABS.findIndex((t) => t.id === previousTab.current);
    const nextIdx = ATTRIBUT_TABS.findIndex((t) => t.id === activeTab);
    if (prevIdx !== nextIdx) {
      setDirection(nextIdx > prevIdx ? 1 : -1);
    }
    previousTab.current = activeTab;
  }, [activeTab]);

  return (
    <div
      key={activeTab}
      className="animate-[attrSlide_320ms_cubic-bezier(0.22,1,0.36,1)]"
      style={{ ["--slide-dir" as string]: direction === 1 ? "28px" : "-28px" }}
    >
      {children}
    </div>
  );
}
