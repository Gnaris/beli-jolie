import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";
import AccessCodeForm from "@/components/auth/AccessCodeForm";

export const metadata: Metadata = {
  title: "Connexion — Espace Professionnel",
  description: "Connectez-vous à votre espace professionnel Beli & Jolie.",
};

export default function ConnexionPage() {
  return (
    <div className="w-full max-w-md mx-auto">
      <Suspense fallback={<div className="w-full h-64 card animate-pulse" />}>
        <LoginForm />
      </Suspense>
      <p className="text-center mt-6">
        <a
          href="/inscription"
          className="text-sm font-medium text-text-secondary font-[family-name:var(--font-roboto)] hover:text-text-primary transition-colors"
        >
          Créer un compte professionnel →
        </a>
      </p>
      <p className="text-center mt-3">
        <a href="/mot-de-passe-oublie" className="text-sm text-text-muted font-[family-name:var(--font-roboto)] hover:text-text-secondary transition-colors">
          Mot de passe oublié ?
        </a>
      </p>

      {/* Séparateur */}
      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 border-t border-border" />
        <span className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">ou</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* Code d'accès invité */}
      <AccessCodeForm />
    </div>
  );
}
