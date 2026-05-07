import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return { title: `Nouveau mot de passe — ${shopName}` };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.resetPassword");
  const { token } = await searchParams;
  return (
    <div className="w-full max-w-md mx-auto">
      <ResetPasswordForm token={token ?? ""} />
      <p className="text-center mt-6">
        <Link href="/connexion" className="text-sm font-medium text-text-secondary font-body hover:text-text-primary transition-colors">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
