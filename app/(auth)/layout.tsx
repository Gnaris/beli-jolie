import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getCachedSiteConfig, getCachedProductCount } from "@/lib/cached-data";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import FloatingGems from "@/components/ui/FloatingGems";
import StaffAvailability from "@/components/auth/StaffAvailability";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [config, cookieStore, productCount] = await Promise.all([
    getCachedSiteConfig("maintenance_mode"),
    cookies(),
    getCachedProductCount(),
  ]);
  const currentLocale = cookieStore.get("bj_locale")?.value ?? "fr";
  const inMaintenance = config?.value === "true";
  const formattedCount = new Intl.NumberFormat("fr-FR").format(productCount);

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
              <p className="font-[family-name:var(--font-roboto)] text-sm font-semibold text-[#7C3900]">
                Site en maintenance
              </p>
              <p className="font-[family-name:var(--font-roboto)] text-sm text-[#92400E] mt-0.5">
                Notre plateforme est temporairement indisponible. Vous pouvez vous connecter
                ou créer un compte, mais l&apos;accès au site sera limité jusqu&apos;à la fin de la
                maintenance.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border lg:hidden">
        <Link href="/" className="font-[family-name:var(--font-poppins)] text-lg font-bold text-text-primary animate-blur-in">
          Beli & Jolie
        </Link>
        <LanguageSwitcher currentLocale={currentLocale} />
      </div>

      {/* Split layout: left brand panel (desktop) + right form */}
      <main className="relative flex-1 flex">
        {/* Left brand panel — desktop only */}
        <div className="hidden lg:flex lg:w-[45%] xl:w-[40%] bg-bg-dark relative overflow-hidden flex-col justify-between p-10 xl:p-14">
          {/* Background decorative elements */}
          <div className="absolute inset-0 opacity-[0.03]">
            <div className="absolute top-20 left-10 w-72 h-72 border border-white rounded-full" />
            <div className="absolute bottom-32 right-8 w-48 h-48 border border-white rotate-45" />
            <div className="absolute top-1/2 left-1/3 w-32 h-32 border border-white rounded-full" />
          </div>

          <div className="relative z-10">
            <Link href="/" className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-white animate-blur-in">
              Beli <span className="text-white/40">&</span> Jolie
            </Link>
          </div>

          <div className="relative z-10 space-y-6">
            <h2 className="font-[family-name:var(--font-poppins)] text-3xl xl:text-4xl font-semibold text-white leading-tight">
              Votre partenaire<br />
              <span className="text-white/50">bijoux B2B</span>
            </h2>
            <p className="text-white/40 text-sm leading-relaxed font-[family-name:var(--font-roboto)] max-w-xs">
              Accédez à notre catalogue de bijoux en acier inoxydable. Prix grossiste, livraison rapide, qualité premium.
            </p>
            <div className="flex gap-8 pt-4">
              {[
                { value: formattedCount, label: "Références" },
                { value: "100%", label: "Acier inox" },
                { value: "B2B", label: "Professionnel" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="font-[family-name:var(--font-poppins)] text-lg font-bold text-white">{stat.value}</p>
                  <p className="text-white/30 text-xs font-[family-name:var(--font-roboto)] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Disponibilité staff */}
            <div className="pt-2">
              <StaffAvailability variant="dark" />
            </div>
          </div>

          <div className="relative z-10 flex items-center gap-3">
            <LanguageSwitcher currentLocale={currentLocale} />
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex-1 relative flex items-center justify-center px-6 py-12">
          <FloatingGems />
          <div className="relative z-10 w-full flex items-center justify-center">
            {children}
          </div>
        </div>
      </main>

      {/* Footer — mobile only */}
      <footer className="px-6 py-4 border-t border-border text-center lg:hidden">
        <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
          Plateforme réservée aux professionnels revendeurs
        </p>
      </footer>
    </div>
  );
}
