import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Mot de passe oublié — ${shopName}` };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgotPassword");
  return (
    <div className="w-full max-w-md mx-auto">
      <ForgotPasswordForm />
      <p className="text-center mt-6">
        <Link href="/connexion" className="text-sm font-medium text-text-secondary font-body hover:text-text-primary transition-colors">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
