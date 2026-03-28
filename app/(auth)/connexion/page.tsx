import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import LoginForm from "@/components/auth/LoginForm";
import AccessCodeForm from "@/components/auth/AccessCodeForm";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: "Connexion — Espace Professionnel B2B",
    description: `Connectez-vous à votre espace professionnel ${shopName}. Boutique réservée aux professionnels.`,
  };
}

export default function ConnexionPage() {
  return (
    <div className="w-full max-w-md mx-auto">

      {/* ── Bandeau B2B ── */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-xs font-body font-semibold px-4 py-1.5 rounded-full mb-5 uppercase tracking-wider">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Espace B2B
        </div>
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-2">
          Boutique réservée aux professionnels
        </h2>
        <p className="text-sm text-text-muted font-body leading-relaxed max-w-sm mx-auto">
          Cette boutique est exclusivement réservée aux revendeurs et professionnels.
        </p>
      </div>

      <Suspense fallback={<div className="w-full h-64 card animate-pulse" />}>
        <LoginForm />
      </Suspense>

      <p className="text-center mt-6">
        <a
          href="/inscription"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-primary font-body hover:underline transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
          </svg>
          Créer un compte professionnel
        </a>
      </p>
      <p className="text-center mt-3">
        <Link href="/mot-de-passe-oublie" className="text-sm text-text-muted font-body hover:text-text-secondary transition-colors">
          Mot de passe oublié ?
        </Link>
      </p>

      {/* Séparateur */}
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <span className="text-xs text-text-muted font-body">ou</span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>

      {/* Code d'accès invité */}
      <AccessCodeForm />
    </div>
  );
}
