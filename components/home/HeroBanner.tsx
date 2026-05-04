"use client";

import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";

interface HeroBannerProps {
  bannerImage: string | null;
  shopName: string;
  productCount: number;
}

export default function HeroBanner({ bannerImage, shopName, productCount }: HeroBannerProps) {
  const t = useTranslations("home");

  return (
    <section className="relative w-full min-h-[88vh] flex items-center justify-center overflow-hidden">
      {/* Background image */}
      {bannerImage ? (
        <Image
          src={bannerImage}
          alt={shopName}
          fill
          priority
          sizes="100vw"
          className="object-cover"
          style={{ willChange: "transform" }}
        />
      ) : (
        <div className="absolute inset-0 bg-bg-darker" />
      )}

      {/* Gradient overlay - subtler, more elegant */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/20 to-black/60" />

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-3xl mx-auto">
        {/* Badge */}
        <span
          className="inline-block text-[11px] sm:text-xs font-body tracking-[0.2em] uppercase text-white/90 border border-white/25 rounded-full px-5 py-1.5 mb-7 backdrop-blur-md bg-white/5 animate-[fadeUp_0.6s_ease-out_both]"
        >
          {t("heroBadge")}
        </span>

        {/* Title */}
        <h1 className="font-heading font-bold text-white leading-[1.05] mb-5 animate-[fadeUp_0.6s_ease-out_0.15s_both]"
            style={{ fontSize: "clamp(2.5rem, 5.5vw, 5rem)", letterSpacing: "-0.02em" }}>
          {t("heroTitle1")}
          <br />
          <span className="italic font-light text-white/85">{t("heroTitle2")}</span>
        </h1>

        {/* Subtitle */}
        <p className="font-body text-white/75 text-base sm:text-lg max-w-xl mx-auto mb-9 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
          {t("heroDesc", { count: String(productCount) })}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-[fadeUp_0.6s_ease-out_0.45s_both]">
          <Link
            href="/produits"
            className="px-8 py-3.5 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 hover:scale-[1.02] transition-all shadow-lg shadow-black/10"
          >
            {t("heroCta")}
          </Link>
          <Link
            href="/collections"
            className="px-8 py-3.5 border border-white/40 text-white font-heading font-medium text-sm rounded-full hover:bg-white/10 hover:border-white/60 transition-colors"
          >
            {t("heroCtaSecondary")}
          </Link>
        </div>
      </div>
    </section>
  );
}
