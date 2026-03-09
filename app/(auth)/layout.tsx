import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false }, // Ne pas indexer les pages auth
};

/**
 * Layout des pages d'authentification
 * Design épuré centré — sans navbar ni footer du site principal
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col">
      {/* En-tête minimaliste avec logo */}
      <header className="py-6 border-b border-[#E2E8F0] bg-[#FFFFFF]">
        <div className="container-site flex justify-center">
          <Link
            href="/"
            className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#0F172A] tracking-wide"
          >
            Beli <span className="text-[#0F3460]">&</span> Jolie
          </Link>
        </div>
      </header>

      {/* Contenu de la page auth */}
      <main className="flex-1 flex items-center justify-center py-10 px-4">
        {children}
      </main>

      {/* Pied de page minimaliste */}
      <footer className="py-4 border-t border-[#E2E8F0] text-center">
        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#94A3B8]">
          © {new Date().getFullYear()} Beli & Jolie — Plateforme réservée aux professionnels
        </p>
      </footer>
    </div>
  );
}
