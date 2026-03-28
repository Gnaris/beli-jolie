"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

export default function CtaBanner() {
  const t = useTranslations("home");
  const { data: session } = useSession();

  return (
    <section className="relative overflow-hidden bg-bg-dark py-16 sm:py-20">
      {/* Decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        {/* Subtle radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-accent/[0.03] rounded-full blur-3xl" />
      </div>

      <div className="container-site relative z-10 text-center">
        {/* Decorative diamond */}
        <div className="flex justify-center mb-6">
          <svg className="w-6 h-6 text-accent animate-slow-rotate" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 17l-6.5 4 2-7.5L2 9h7z" />
          </svg>
        </div>

        <h2 className="font-[family-name:var(--font-poppins)] text-xl sm:text-2xl md:text-3xl font-bold text-white mb-4">
          {t("ctaTitle")}
        </h2>
        <p className="font-[family-name:var(--font-roboto)] text-sm sm:text-base text-white/60 max-w-lg mx-auto mb-8 leading-relaxed">
          {t("ctaDesc")}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/produits"
            className="inline-flex items-center gap-2 bg-accent text-bg-dark font-[family-name:var(--font-poppins)] font-semibold text-sm px-7 py-3 rounded-lg hover:bg-accent-dark transition-colors duration-200"
          >
            {t("heroCta")} &rarr;
          </Link>
          {!session && (
            <Link
              href="/inscription"
              className="inline-flex items-center gap-2 border border-white/20 text-white/80 font-[family-name:var(--font-roboto)] font-medium text-sm px-6 py-3 rounded-lg hover:bg-white/5 hover:border-white/30 transition-all duration-200"
            >
              {t("heroRegister")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
