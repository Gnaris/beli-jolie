import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Connexion — Espace Professionnel",
  description: "Connectez-vous à votre espace professionnel Beli & Jolie.",
};

/**
 * Page de connexion
 * LoginForm est wrappé dans Suspense car il utilise useSearchParams()
 */
export default function ConnexionPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-md h-64 bg-[#FDFAF6] border border-[#D4CCBE] animate-pulse" />}>
      <LoginForm />
    </Suspense>
  );
}
