import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCurrentTenant } from "@/lib/tenant";
import { getMarketplaceMaintenance } from "@/lib/platform-config";
import MarketplaceMaintenanceToggle from "@/components/admin/settings/MarketplaceMaintenanceToggle";

/** Slugs du tenant "maître" — seuls autorisés à voir cette page. */
const PLATFORM_ADMIN_TENANT_SLUGS = new Set(["beliandjolie", "beli-jolie"]);

export const metadata: Metadata = {
  title: "Contrôle plateforme — Admin",
  robots: { index: false, follow: false },
};

const MARKETPLACES = [
  {
    key: "pfs" as const,
    label: "Paris Fashion Shop",
    letter: "P",
    gradient: "linear-gradient(135deg,#4f46e5,#6366f1)",
  },
  {
    key: "ankorstore" as const,
    label: "Ankorstore",
    letter: "A",
    gradient: "linear-gradient(135deg,#0ea5e9,#38bdf8)",
  },
  {
    key: "efashion" as const,
    label: "eFashion Paris",
    letter: "E",
    gradient: "linear-gradient(135deg,#db2777,#ec4899)",
  },
  {
    key: "faire" as const,
    label: "Faire",
    letter: "F",
    gradient: "linear-gradient(135deg,#f59e0b,#fbbf24)",
  },
];

export default async function PlateformePage() {
  const tenant = await requireCurrentTenant();
  if (!PLATFORM_ADMIN_TENANT_SLUGS.has(tenant.slug)) notFound();

  const maintenance = await getMarketplaceMaintenance();
  const activeCount = MARKETPLACES.filter((m) => maintenance[m.key]).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Hero aurora */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-50 via-bg-primary to-bg-primary border border-border p-6 md:p-8">
        <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full blur-3xl bg-violet-300/30" aria-hidden />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-primary/80 border border-violet-200 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
            <span className="font-body text-[10px] uppercase tracking-[0.18em] text-violet-700 font-semibold">
              Contrôle plateforme
            </span>
          </div>
          <h1 className="font-heading text-2xl md:text-3xl font-bold text-text-primary">
            Maintenance marketplaces
          </h1>
          <p className="font-body text-sm text-text-secondary mt-2 max-w-2xl">
            Ces interrupteurs affectent <strong>toutes les boutiques</strong> de la plateforme. Une marketplace en
            maintenance devient inutilisable pour publier, synchroniser, rafraîchir ou supprimer un produit.
            Le badge apparaîtra hachuré sur les fiches produit avec un tooltip « En maintenance ».
          </p>
          {activeCount > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
              <span className="font-body text-xs font-semibold">
                {activeCount} marketplace{activeCount > 1 ? "s" : ""} en maintenance
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Liste des marketplaces */}
      <div className="space-y-3">
        {MARKETPLACES.map((m) => (
          <MarketplaceMaintenanceToggle
            key={m.key}
            marketplace={m.key}
            label={m.label}
            letter={m.letter}
            gradient={m.gradient}
            currentValue={maintenance[m.key]}
          />
        ))}
      </div>

      <div className="rounded-2xl bg-bg-secondary border border-border p-4">
        <p className="font-body text-xs text-text-secondary">
          <strong className="text-text-primary">Effets d'un flip vers « En maintenance »</strong> :
          les nouveaux jobs sont refusés avec un message d'erreur, les jobs en file sont classés FAILED (rien n'est envoyé
          au marketplace), les boutons Publier / Rafraîchir / Synchroniser / Délier deviennent des no-op côté serveur, et
          les badges sur les produits apparaissent hachurés. Aucune donnée n'est modifiée côté marketplace.
        </p>
      </div>
    </div>
  );
}
