import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getCachedSiteConfig, getCachedShopName } from "@/lib/cached-data";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface AuthLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AuthLayout({ children, params }: AuthLayoutProps) {
  const { locale: currentLocale } = await params;
  const [config, shopName] = await Promise.all([
    getCachedSiteConfig("maintenance_mode"),
    getCachedShopName(),
  ]);
  const inMaintenance = config?.value === "true";

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary">
      {/* Maintenance banner */}
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
                Site en maintenance
              </p>
              <p className="font-body text-sm text-[#92400E] mt-0.5">
                Notre plateforme est temporairement indisponible. Vous pouvez vous connecter
                ou créer un compte, mais l&apos;accès au site sera limité jusqu&apos;à la fin de la
                maintenance.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border gap-4">
        <Link
          href="/"
          aria-label={`Retour à l'accueil ${shopName}`}
          className="group inline-flex items-center gap-2 font-heading text-lg font-bold text-text-primary animate-blur-in hover:text-text-secondary transition-colors"
        >
          <svg
            className="w-5 h-5 text-text-muted group-hover:text-text-primary group-hover:-translate-x-0.5 transition-all"
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
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-body text-text-muted hover:text-text-primary px-3 py-1.5 rounded-lg hover:bg-bg-secondary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
            <span>Voir le catalogue</span>
          </Link>
          <LanguageSwitcher currentLocale={currentLocale} />
        </div>
      </div>

      {/* Centered form */}
      <main className="relative flex-1 flex items-center justify-center px-6 py-12 bg-bg-secondary">
        <div className="relative z-10 w-full flex items-center justify-center">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-2 text-xs font-body">
          <p className="text-text-muted">
            Plateforme réservée aux professionnels revendeurs
          </p>
          <nav className="flex items-center gap-4" aria-label="Liens rapides">
            <Link href="/" className="text-text-muted hover:text-text-primary transition-colors">
              Accueil
            </Link>
            <Link href="/produits" className="text-text-muted hover:text-text-primary transition-colors">
              Catalogue
            </Link>
            <Link href="/categories" className="text-text-muted hover:text-text-primary transition-colors">
              Catégories
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
