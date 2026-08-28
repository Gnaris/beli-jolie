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
  const [tLogin, shopName] = await Promise.all([
    getTranslations({ locale, namespace: "auth.login" }),
    getCachedShopName(),
  ]);

  return (
    <div className="flex-1 min-h-0 grid lg:grid-cols-2">

      {/* ── Colonne visuelle (desktop uniquement) ── */}
      <aside
        aria-hidden
        className="hidden lg:flex flex-col justify-between p-14 xl:p-16 text-white relative overflow-hidden"
        style={{
          background:
            "radial-gradient(1200px 400px at 20% 0%, rgba(255,255,255,0.10), transparent 60%), radial-gradient(600px 400px at 100% 100%, rgba(255,255,255,0.06), transparent 60%), linear-gradient(160deg, #0b1a2b 0%, #1e3555 60%, #2b5b8a 100%)",
        }}
      >
        <div>
          <Link
            href="/"
            className="inline-block font-heading text-2xl font-light tracking-wide text-white hover:text-white/80 transition-colors"
          >
            {shopName}
          </Link>
          <div className="text-[10px] uppercase tracking-[0.3em] text-white/50 mt-2">
            {tLogin("b2bSpace")}
          </div>
        </div>

        <div className="max-w-md">
          <div className="w-10 h-px bg-white/40 mb-6" />
          <p className="font-heading text-3xl xl:text-4xl leading-tight font-light">
            {tLogin("proOnly")}
          </p>
          <p className="text-sm text-white/60 mt-5 leading-relaxed font-light">
            {tLogin("proOnlyDesc")}
          </p>
        </div>

        <div className="text-[11px] text-white/40 tracking-wider uppercase">
          {tLogin("b2bSpace")}
        </div>
      </aside>

      {/* ── Colonne formulaire ── */}
      <main className="flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-white overflow-y-auto">
        <div className="w-full max-w-sm">

          {/* Titre */}
          <div className="mb-8">
            <h1 className="font-heading text-3xl xl:text-4xl font-light tracking-tight text-slate-900">
              {tLogin("title")}
            </h1>
            <p className="text-sm text-slate-500 mt-3 font-light leading-relaxed">
              {tLogin("subtitle")}
            </p>
          </div>

          <Suspense fallback={<div className="w-full h-64 animate-pulse bg-slate-50 rounded-lg" />}>
            <LoginForm />
          </Suspense>

          {/* Séparateur fin */}
          <div className="my-7 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

          {/* Créer un compte */}
          <p className="text-center text-sm text-slate-500 font-light">
            {tLogin("noAccount")}
            <Link
              href="/inscription"
              className="text-slate-900 font-medium hover:text-[#2b5b8a] transition-colors ml-1.5"
            >
              {tLogin("createProAccount")}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
