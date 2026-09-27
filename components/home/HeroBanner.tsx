"use client";

import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";

interface HeroBannerProps {
  productCount: number;
}

export default function HeroBanner({ productCount }: HeroBannerProps) {
  const t = useTranslations("home");
  const productCountFormatted = new Intl.NumberFormat("fr-FR").format(productCount);

  return (
    <section
      className="relative w-full bg-bg-darker text-white overflow-hidden"
      style={{ minHeight: "clamp(520px, 68vh, 720px)" }}
    >
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-10 py-24 lg:py-32 flex flex-col justify-center min-h-[inherit]">
        <p className="text-[11px] uppercase tracking-[0.28em] text-white/45 font-body font-medium">
          {t("heroBadge")}
        </p>

        <h1
          className="font-heading font-bold leading-[1.05] tracking-tight max-w-3xl mt-5"
          style={{ fontSize: "clamp(2.4rem, 5.2vw, 4.5rem)", letterSpacing: "-0.02em" }}
        >
          {t("heroTitle1")}
          <br />
          <span className="italic font-light">{t("heroTitle2")}</span>
        </h1>

        <p className="mt-6 max-w-xl text-white/75 text-base sm:text-lg leading-relaxed font-body">
          {t("heroDesc", { count: String(productCount) })}
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/produits"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-bg-darker font-heading font-semibold text-sm hover:bg-white/90 transition"
          >
            {t("heroCta")}
            <span aria-hidden>→</span>
          </Link>
          <Link
            href="/collections"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full border border-white/25 text-white font-heading text-sm hover:bg-white hover:text-bg-darker transition-colors"
          >
            {t("heroCtaSecondary")}
          </Link>
        </div>

        {productCount > 0 && (
          <p className="mt-10 text-[11px] uppercase tracking-[0.28em] text-white/40 font-body font-medium">
            + de {productCountFormatted} références en stock
          </p>
        )}
      </div>
    </section>
  );
}
