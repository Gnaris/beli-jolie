import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { getCachedSiteConfig, getCachedShopName } from "@/lib/cached-data";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface AuthFullscreenLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AuthFullscreenLayout({
  children,
  params,
}: AuthFullscreenLayoutProps) {
  const { locale: currentLocale } = await params;
  const [config, shopName, tMeta] = await Promise.all([
    getCachedSiteConfig("maintenance_mode"),
    getCachedShopName(),
    getTranslations({ locale: currentLocale, namespace: "meta" }),
  ]);
  const inMaintenance = config?.value === "true";

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-white">
      {/* Bannière de maintenance */}
      {inMaintenance && (
        <div className="bg-[#F59E0B] px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-start gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 text-[#7C3900] flex-shrink-0 mt-0.5"
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
            <div>
              <p className="font-body text-sm font-semibold text-[#7C3900]">
                {tMeta("authLayoutMaintenanceTitle")}
              </p>
              <p className="font-body text-sm text-[#92400E] mt-0.5">
                {tMeta("authLayoutMaintenanceDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header : logo + catalogue + langue */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 gap-4 bg-white">
        <Link
          href="/"
          aria-label={`Retour à l'accueil ${shopName}`}
          className="group inline-flex items-center gap-2 font-heading text-lg font-bold text-slate-900 hover:text-slate-600 transition-colors"
        >
          <svg
            className="w-5 h-5 text-slate-400 group-hover:text-slate-900 group-hover:-translate-x-0.5 transition-all"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          <span>{shopName}</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/produits"
            aria-label={tMeta("authLayoutCatalogueLong")}
            className="inline-flex items-center gap-1.5 text-sm font-body font-semibold text-white bg-slate-900 border border-slate-900 px-3 sm:px-4 py-2 rounded-lg shadow-sm hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            <span className="hidden sm:inline">{tMeta("authLayoutCatalogueLong")}</span>
            <span className="sm:hidden">{tMeta("authLayoutCatalogueShort")}</span>
          </Link>
          <LanguageSwitcher currentLocale={currentLocale} />
        </div>
      </header>

      {/* Contenu plein écran sous le header */}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  );
}
