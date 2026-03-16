import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";

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
    </div>
  );
}
