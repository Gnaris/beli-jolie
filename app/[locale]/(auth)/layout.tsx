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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link href="/" className="font-heading text-lg font-bold text-text-primary animate-blur-in">
          {shopName}
        </Link>
        <LanguageSwitcher currentLocale={currentLocale} />
      </div>

      {/* Centered form */}
      <main className="relative flex-1 flex items-center justify-center px-6 py-12 bg-bg-secondary">
        <div className="relative z-10 w-full flex items-center justify-center">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border text-center">
        <p className="text-xs text-text-muted font-body">
          Plateforme réservée aux professionnels revendeurs
        </p>
      </footer>
    </div>
  );
}
