import type { Metadata } from "next";
import { Suspense } from "react";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import LoginForm from "@/components/auth/LoginForm";
import { getCachedShopName } from "@/lib/cached-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
  ]);
  return {
    title: tMeta("loginTitle"),
    description: tMeta("loginDescription", { shopName }),
  };
}

export default async function ConnexionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tLogin = await getTranslations({ locale, namespace: "auth.login" });
  return (
    <div className="w-full max-w-md mx-auto">

      {/* ── Bandeau B2B ── */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-bg-dark text-text-inverse text-xs font-body font-semibold px-4 py-1.5 rounded-full mb-5 uppercase tracking-wider">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          {tLogin("b2bSpace")}
        </div>
        <h2 className="font-heading text-lg font-semibold text-text-primary mb-2">
          {tLogin("proOnly")}
        </h2>
        <p className="text-sm text-text-muted font-body leading-relaxed max-w-sm mx-auto">
          {tLogin("proOnlyDesc")}
        </p>
      </div>

      <Suspense fallback={<div className="w-full h-64 card animate-pulse" />}>
        <LoginForm />
      </Suspense>

      <p className="text-center mt-6">
        <Link
          href="/inscription"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-text-primary font-body hover:underline transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
          </svg>
          {tLogin("createProAccount")}
        </Link>
      </p>
      <p className="text-center mt-3">
        <Link href="/mot-de-passe-oublie" className="text-sm text-text-muted font-body hover:text-text-secondary transition-colors">
          {tLogin("forgotPassword")}
        </Link>
      </p>
    </div>
  );
}
