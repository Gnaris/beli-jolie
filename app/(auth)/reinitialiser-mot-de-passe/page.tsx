import type { Metadata } from "next";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Nouveau mot de passe — Beli & Jolie" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="w-full max-w-md mx-auto">
      <ResetPasswordForm token={token ?? ""} />
      <p className="text-center mt-6">
        <a href="/connexion" className="text-sm font-medium text-text-secondary font-[family-name:var(--font-roboto)] hover:text-text-primary transition-colors">
          ← Retour à la connexion
        </a>
      </p>
    </div>
  );
}
