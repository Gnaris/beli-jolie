import { getServerSession } from "next-auth";
import { redirect, Link } from "@/i18n/navigation";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import ClaimWizard from "@/components/client/claims/ClaimWizard";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tClaims] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "claims" }),
  ]);
  return { title: tClaims("metaNewTitle", { shopName }) };
}

export default async function NewClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const locale = await getLocale();
  if (!session) return redirect({ href: "/connexion", locale });
  if (session.user.status !== "APPROVED") return redirect({ href: "/espace-pro", locale });

  const t = await getTranslations({ locale, namespace: "claims" });
  const { order } = await searchParams;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/espace-pro/service-client"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary font-body transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t("backToList")}
        </Link>
        <h1 className="font-heading text-2xl font-bold text-text-primary mt-3">{t("newClaim")}</h1>
        <p className="text-sm text-text-secondary font-body mt-1">{t("newPageIntro")}</p>
      </div>
      <ClaimWizard initialOrderId={order ?? undefined} />
    </div>
  );
}
