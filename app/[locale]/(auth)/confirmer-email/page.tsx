import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCachedShopName } from "@/lib/cached-data";
import ConfirmEmailChangeClient from "@/components/client/ConfirmEmailChangeClient";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Confirmation d'email — ${shopName}`,
    robots: { index: false, follow: false },
  };
}

export default async function ConfirmEmailChangePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("auth.changeEmail");
  const { token } = await searchParams;

  return (
    <div className="w-full max-w-md mx-auto">
      <ConfirmEmailChangeClient token={token ?? ""} />
      <p className="text-center mt-6">
        <Link
          href="/espace-pro"
          className="text-sm font-medium text-text-secondary font-body hover:text-text-primary transition-colors"
        >
          {t("backToAccount")}
        </Link>
      </p>
    </div>
  );
}
