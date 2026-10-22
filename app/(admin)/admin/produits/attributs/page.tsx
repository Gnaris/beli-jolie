import type { Metadata } from "next";
import AttributsTabs, { type AttributTab } from "@/components/admin/attributs/AttributsTabs";
import CategoriesView from "@/components/admin/attributs/views/CategoriesView";
import CouleursView from "@/components/admin/attributs/views/CouleursView";
import CompositionsView from "@/components/admin/attributs/views/CompositionsView";
import SaisonsView from "@/components/admin/attributs/views/SaisonsView";
import TaillesView from "@/components/admin/attributs/views/TaillesView";
import CodesShView from "@/components/admin/attributs/views/CodesShView";
import MotsClesView from "@/components/admin/attributs/views/MotsClesView";

export const metadata: Metadata = { title: "Attributs produits — Admin" };

const VALID_TABS: AttributTab[] = [
  "categories",
  "couleurs",
  "compositions",
  "saisons",
  "tailles",
  "codes-sh",
  "mots-cles",
];

function parseTab(raw: string | string[] | undefined): AttributTab {
  if (typeof raw !== "string") return "categories";
  return (VALID_TABS as string[]).includes(raw) ? (raw as AttributTab) : "categories";
}

export default async function AttributsPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string | string[] }>;
}) {
  // Next 16 : searchParams est une Promise.
  const sp = await searchParams;
  const tab = parseTab(sp.onglet);

  // Server-side dispatch : chaque vue est un async RSC qui fetch ses propres
  // données. L'onglet actif pilote le switch — l'URL unique
  // `/admin/produits/attributs?onglet=X` évite d'avoir 7 pages distinctes.
  let view: React.ReactNode = null;
  switch (tab) {
    case "categories":   view = <CategoriesView />;   break;
    case "couleurs":     view = <CouleursView />;     break;
    case "compositions": view = <CompositionsView />; break;
    case "saisons":      view = <SaisonsView />;      break;
    case "tailles":      view = <TaillesView />;      break;
    case "codes-sh":     view = <CodesShView />;      break;
    case "mots-cles":    view = <MotsClesView />;     break;
  }

  return (
    <div className="w-full px-4 md:px-6 lg:px-8 py-6">
      <AttributsTabs activeTab={tab}>{view}</AttributsTabs>
    </div>
  );
}
