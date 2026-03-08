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
    <div className="min-h-screen bg-[#F7F3EC] flex flex-col">
      {/* En-tête minimaliste avec logo */}
      <header className="py-6 border-b border-[#D4CCBE] bg-[#FDFAF6]">
        <div className="container-site flex justify-center">
          <Link
            href="/"
            className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#2C2418] tracking-wide"
          >
            Beli <span className="text-[#8B7355]">&</span> Jolie
          </Link>
        </div>
      </header>

      {/* Contenu de la page auth */}
      <main className="flex-1 flex items-center justify-center py-10 px-4">
        {children}
      </main>

      {/* Pied de page minimaliste */}
      <footer className="py-4 border-t border-[#D4CCBE] text-center">
        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#B8A48A]">
          © {new Date().getFullYear()} Beli & Jolie — Plateforme réservée aux professionnels
        </p>
      </footer>
    </div>
  );
}
