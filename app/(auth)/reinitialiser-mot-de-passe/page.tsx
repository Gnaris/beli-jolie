import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Nouveau mot de passe — ${shopName}` };
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const t = await getTranslations("auth.resetPassword");
  const { token } = await searchParams;
  return (
    <div className="w-full max-w-md mx-auto">
      <ResetPasswordForm token={token ?? ""} />
      <p className="text-center mt-6">
        <Link href="/connexion" className="text-sm font-medium text-text-secondary font-[family-name:var(--font-roboto)] hover:text-text-primary transition-colors">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
