import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center px-6 py-4 border-b border-border">
        <Link href="/" className="font-[family-name:var(--font-poppins)] text-lg font-bold text-text-primary">
          Beli & Jolie
        </Link>
      </div>

      {/* Centered form */}
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        {children}
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
