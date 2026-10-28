import type { Metadata } from "next";
import MarketingTabs, { type MarketingTab } from "@/components/admin/contact-client/MarketingTabs";
import EnvoyerMailsView from "@/components/admin/contact-client/views/EnvoyerMailsView";
import ModelesMailView from "@/components/admin/contact-client/views/ModelesMailView";
import WhatsappView from "@/components/admin/contact-client/views/WhatsappView";
import PanierAbandonneView from "@/components/admin/contact-client/views/PanierAbandonneView";
import InactiviteView from "@/components/admin/contact-client/views/InactiviteView";
import RetourStockView from "@/components/admin/contact-client/views/RetourStockView";
import SuiviCommandeView from "@/components/admin/contact-client/views/SuiviCommandeView";
import SystemeView from "@/components/admin/contact-client/views/SystemeView";

export const metadata: Metadata = { title: "Contact Client — Admin" };
export const dynamic = "force-dynamic";

const VALID_TABS: MarketingTab[] = [
  "envoyer",
  "modeles",
  "whatsapp",
  "panier-abandonne",
  "inactivite",
  "retour-en-stock",
  "suivi-commande",
  "systeme",
];

function parseTab(raw: string | string[] | undefined): MarketingTab {
  if (typeof raw !== "string") return "envoyer";
  return (VALID_TABS as string[]).includes(raw) ? (raw as MarketingTab) : "envoyer";
}

/**
 * Page unifiée Marketing — fusion 2026-10-21.
 *
 * Les sous-pages statiques (`/mails`, `/whatsapp`, `/mails/panier-abandonne`,
 * `/mails/inactivite`, `/mails/retour-en-stock`, `/mails/systeme`) sont
 * toutes dispatchées depuis cette URL unique via `?onglet=X`. Seule la route
 * dynamique `mails/newsletter/[id]` reste à part (édition d'un template
 * nécessite un `id` spécifique).
 *
 * Les 6 anciennes URLs continuent de fonctionner côté bookmarks → redirect
 * vers la bonne vue avec query param.
 */
export default async function MarketingPage({
  searchParams,
}: {
  // Même type que celui de EnvoyerMailsView + `onglet` pour piloter le switch.
  searchParams: Promise<{
    onglet?: string | string[];
    status?: string;
    tab?: string;
    page?: string;
    per?: string;
    mp?: string;
    q?: string;
    sort?: string;
    dir?: string;
    view?: string;
    withEmail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = parseTab(sp.onglet);

  let view: React.ReactNode = null;
  switch (tab) {
    case "envoyer":          view = <EnvoyerMailsView searchParams={sp} />;    break;
    case "modeles":          view = <ModelesMailView />;                       break;
    case "whatsapp":         view = <WhatsappView />;                          break;
    case "panier-abandonne": view = <PanierAbandonneView />;                   break;
    case "inactivite":       view = <InactiviteView />;                        break;
    case "retour-en-stock":  view = <RetourStockView />;                       break;
    case "suivi-commande":   view = <SuiviCommandeView />;                     break;
    case "systeme":          view = <SystemeView />;                           break;
  }

  return (
    <div className="max-w-[1800px] mx-auto px-4 md:px-6 xl:px-8 py-6">
      <MarketingTabs activeTab={tab}>{view}</MarketingTabs>
    </div>
  );
}
