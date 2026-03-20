import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { parseDisplayConfig } from "@/lib/product-display";
import SettingsMinOrderForm from "@/components/admin/settings/SettingsMinOrderForm";
import AdminPasswordResetButton from "@/components/admin/settings/AdminPasswordResetButton";
import MaintenanceModeToggle from "@/components/admin/settings/MaintenanceModeToggle";
import ProductDisplayConfig from "@/components/admin/settings/ProductDisplayConfig";
import StockDisplayConfig from "@/components/admin/settings/StockDisplayConfig";
import DarkModeToggle from "@/components/admin/settings/DarkModeToggle";

export const metadata: Metadata = { title: "Paramètres — Beli & Jolie Admin" };

export default async function ParametresPage() {
  const [minConfig, maintenanceConfig, displayConfigRow, stockVariantsConfig, stockProductsConfig, categories, dbCollections, dbTags] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "min_order_ht" } }),
    prisma.siteConfig.findUnique({ where: { key: "maintenance_mode" } }),
    prisma.siteConfig.findUnique({ where: { key: "product_display_config" } }),
    prisma.siteConfig.findUnique({ where: { key: "show_out_of_stock_variants" } }),
    prisma.siteConfig.findUnique({ where: { key: "show_out_of_stock_products" } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.collection.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const cookieStore = await cookies();
  const adminTheme = (cookieStore.get("bj_admin_theme")?.value === "dark" ? "dark" : "light") as "light" | "dark";

  const currentMinHT = minConfig ? parseFloat(minConfig.value) : 0;
  const maintenanceValue = maintenanceConfig?.value ?? "false";
  const inMaintenance = maintenanceValue === "true" || maintenanceValue === "auto";
  const isAutoMaintenance = maintenanceValue === "auto";
  const displayConfig = parseDisplayConfig(displayConfigRow?.value ?? null);
  const showOutOfStockVariants = stockVariantsConfig?.value !== "false"; // default true
  const showOutOfStockProducts = stockProductsConfig?.value !== "false"; // default true

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Paramètres</h1>
        <p className="page-subtitle">Configuration générale du site.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

      {/* Bloc 1 — Mode maintenance */}
      <div className="lg:col-span-2 bg-white border border-[#E5E5E5] rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-[#FEF3C7] flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 text-[#D97706]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
              Mode maintenance
            </h2>
            <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
              Lorsque la maintenance est activée, les clients sont redirigés vers une page
              d&apos;information et ne peuvent plus accéder au site. Les pages de connexion et
              d&apos;inscription restent accessibles. Vous seul pouvez continuer à naviguer en
              tant qu&apos;administrateur.
            </p>
          </div>
        </div>

        {/* Active warning banner */}
        {inMaintenance && (
          <div className={`mb-5 rounded-lg px-4 py-3 flex items-start gap-2 ${
            isAutoMaintenance
              ? "bg-[#FEE2E2] border border-[#FECACA]"
              : "bg-[#FEF3C7] border border-[#FDE68A]"
          }`}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isAutoMaintenance ? "text-[#EF4444]" : "text-[#D97706]"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
            <p className={`text-sm font-[family-name:var(--font-roboto)] ${isAutoMaintenance ? "text-[#B91C1C]" : "text-[#92400E]"}`}>
              {isAutoMaintenance ? (
                <>
                  <strong>Maintenance automatique</strong> — Le système a détecté des erreurs
                  critiques (connexion base de données ou erreurs serveur) et a activé la maintenance
                  automatiquement. Le site se rétablira automatiquement quand le problème sera résolu,
                  ou vous pouvez la désactiver manuellement.
                </>
              ) : (
                <>
                  <strong>Maintenance active</strong> — Le site est actuellement inaccessible aux
                  clients. Pensez à la désactiver dès que vos opérations sont terminées.
                </>
              )}
            </p>
          </div>
        )}

        <MaintenanceModeToggle currentValue={inMaintenance} isAuto={isAutoMaintenance} />
      </div>

      {/* Bloc 2 — Commande minimale */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
          Montant minimum de commande
        </h2>
        <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-5">
          Les clients ne pourront pas valider leur commande si le total HT des articles est inférieur à ce montant.
          Mettez <strong>0</strong> pour désactiver.
        </p>
        <SettingsMinOrderForm currentValue={currentMinHT} />
      </div>

      {/* Bloc 3 — Gestion des ruptures de stock */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-[#FEE2E2] flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#EF4444]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125 2.25 2.25m0 0 2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
            </svg>
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
              Gestion des ruptures de stock
            </h2>
            <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
              Contrôlez la visibilité des produits et variantes en rupture de stock côté client.
            </p>
          </div>
        </div>
        <StockDisplayConfig
          showOutOfStockVariants={showOutOfStockVariants}
          showOutOfStockProducts={showOutOfStockProducts}
        />
      </div>

      {/* Bloc 4 — Affichage des produits */}
      <div className="lg:col-span-2 bg-white border border-[#E5E5E5] rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-[#EDE9FE] flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#7C3AED]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
            </svg>
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
              Affichage des produits
            </h2>
            <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
              Configurez l&apos;ordre d&apos;affichage des produits sur le catalogue et les carrousels de la page d&apos;accueil.
              Les sections prioritaires s&apos;affichent en premier, suivies du reste des produits.
            </p>
          </div>
        </div>
        <ProductDisplayConfig
          config={displayConfig}
          categories={categories}
          collections={dbCollections}
          tags={dbTags}
        />
      </div>

      {/* Bloc 5 — Sécurité compte admin */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
          Mot de passe administrateur
        </h2>
        <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-5">
          Pour des raisons de sécurité, la modification du mot de passe se fait uniquement par email.
          Un lien valable 1 heure vous sera envoyé sur votre adresse email administrateur.
        </p>
        <AdminPasswordResetButton />
      </div>

      {/* Bloc 6 — Mode nuit */}
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-4 sm:p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-[#1E293B] flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#93C5FD]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
            </svg>
          </div>
          <div>
            <h2 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A] mb-1">
              Apparence
            </h2>
            <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
              Basculez entre le mode jour et le mode nuit pour l&apos;interface d&apos;administration.
              Ce réglage n&apos;affecte pas le site public.
            </p>
          </div>
        </div>
        <DarkModeToggle currentTheme={adminTheme} />
      </div>

      </div>{/* end grid */}
    </div>
  );
}
