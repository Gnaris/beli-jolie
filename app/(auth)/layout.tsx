import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import FloatingGems from "@/components/ui/FloatingGems";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [config, cookieStore] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { key: "maintenance_mode" } }),
    cookies(),
  ]);
  const currentLocale = cookieStore.get("bj_locale")?.value ?? "fr";
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Link href="/" className="font-[family-name:var(--font-poppins)] text-lg font-bold text-text-primary animate-blur-in">
          Beli & Jolie
        </Link>
        <LanguageSwitcher currentLocale={currentLocale} />
      </div>

      {/* Centered form */}
      <main className="relative flex-1 flex items-center justify-center px-6 py-12">
        <FloatingGems />
        <div className="relative z-10 w-full flex items-center justify-center">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-border text-center">
        <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
          Plateforme réservée aux professionnels revendeurs
        </p>
      </footer>
    </div>
  );
}
