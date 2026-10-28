"use client";

import { useEffect, useRef, useState } from "react";

export type MarketingTab =
  | "envoyer"
  | "modeles"
  | "whatsapp"
  | "panier-abandonne"
  | "inactivite"
  | "retour-en-stock"
  | "suivi-commande"
  | "systeme";

export const MARKETING_TABS: { id: MarketingTab; label: string; href: string }[] = [
  { id: "envoyer",          label: "Client",            href: "/admin/contact-client" },
  { id: "modeles",          label: "Modèles de mail",   href: "/admin/contact-client?onglet=modeles" },
  { id: "whatsapp",         label: "Modèles WhatsApp",  href: "/admin/contact-client?onglet=whatsapp" },
  { id: "panier-abandonne", label: "Panier abandonné",  href: "/admin/contact-client?onglet=panier-abandonne" },
  { id: "inactivite",       label: "Inactivité",        href: "/admin/contact-client?onglet=inactivite" },
  { id: "retour-en-stock",  label: "Retour en stock",   href: "/admin/contact-client?onglet=retour-en-stock" },
  { id: "suivi-commande",   label: "Suivi commande",    href: "/admin/contact-client?onglet=suivi-commande" },
  { id: "systeme",          label: "Mails système",     href: "/admin/contact-client?onglet=systeme" },
];

export function resolveMarketingTab(pathname: string, onglet: string | null): MarketingTab {
  if (pathname === "/admin/contact-client") {
    const match = MARKETING_TABS.find((t) => t.id === onglet);
    return match?.id ?? "envoyer";
  }
  if (pathname.startsWith("/admin/contact-client/mails/panier-abandonne")) return "panier-abandonne";
  if (pathname.startsWith("/admin/contact-client/mails/inactivite"))       return "inactivite";
  if (pathname.startsWith("/admin/contact-client/mails/retour-en-stock"))  return "retour-en-stock";
  if (pathname.startsWith("/admin/contact-client/mails/suivi-commande"))   return "suivi-commande";
  if (pathname.startsWith("/admin/contact-client/mails/systeme"))          return "systeme";
  if (pathname.startsWith("/admin/contact-client/mails"))                  return "modeles";
  if (pathname.startsWith("/admin/contact-client/whatsapp"))               return "whatsapp";
  return "envoyer";
}

interface Props {
  activeTab: MarketingTab;
  children: React.ReactNode;
}

export default function MarketingTabs({ activeTab, children }: Props) {
  const previousTab = useRef<MarketingTab>(activeTab);
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    const prevIdx = MARKETING_TABS.findIndex((t) => t.id === previousTab.current);
    const nextIdx = MARKETING_TABS.findIndex((t) => t.id === activeTab);
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
