import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col">
      {/* En-tête */}
      <header className="bg-white border-b border-[#E5E5E5] py-4">
        <div className="container-site flex justify-center">
          <Link
            href="/"
            className="font-[family-name:var(--font-poppins)] text-xl font-semibold text-[#1A1A1A] tracking-wide"
          >
            Beli <span className="text-[#999999]">&</span> Jolie
          </Link>
        </div>
      </header>

      {/* Contenu */}
      <main className="flex-1 flex items-center justify-center py-10 px-4">
        {children}
      </main>

      {/* Pied de page */}
      <footer className="py-4 border-t border-[#E5E5E5] bg-white text-center">
        <p className="text-xs font-[family-name:var(--font-roboto)] text-[#999999]">
          © {new Date().getFullYear()} Beli & Jolie — Plateforme réservée aux professionnels
        </p>
      </footer>
    </div>
  );
}
