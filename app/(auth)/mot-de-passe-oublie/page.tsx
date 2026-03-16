import type { Metadata } from "next";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Mot de passe oublié — Beli & Jolie" };

export default function ForgotPasswordPage() {
  return (
    <div className="w-full max-w-md mx-auto">
      <ForgotPasswordForm />
      <p className="text-center mt-6">
        <a href="/connexion" className="text-sm font-medium text-text-secondary font-[family-name:var(--font-roboto)] hover:text-text-primary transition-colors">
          ← Retour à la connexion
        </a>
      </p>
    </div>
  );
}
