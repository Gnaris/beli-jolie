"use client";

import Link from "next/link";
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
    <section className="relative w-full min-h-screen flex items-center justify-center overflow-hidden">
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

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/40 to-black/20" />

      {/* Content */}
      <div className="relative z-10 text-center px-6 max-w-3xl mx-auto">
        {/* Badge */}
        <span
          className="inline-block text-xs sm:text-sm font-body tracking-widest uppercase text-white/80 border border-white/20 rounded-full px-5 py-1.5 mb-6 backdrop-blur-sm animate-[fadeUp_0.6s_ease-out_both]"
        >
          {t("heroBadge")}
        </span>

        {/* Title */}
        <h1 className="font-heading font-bold text-white leading-tight mb-4 animate-[fadeUp_0.6s_ease-out_0.15s_both]"
            style={{ fontSize: "clamp(2.25rem, 5vw, 4.5rem)" }}>
          {t("heroTitle1")}
          <br />
          <span className="text-accent">{t("heroTitle2")}</span>
        </h1>

        {/* Subtitle */}
        <p className="font-body text-white/70 text-base sm:text-lg max-w-xl mx-auto mb-8 animate-[fadeUp_0.6s_ease-out_0.3s_both]">
          {t("heroDesc", { count: String(productCount) })}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 animate-[fadeUp_0.6s_ease-out_0.45s_both]">
          <Link
            href="/produits"
            className="px-8 py-3 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 transition-colors"
          >
            {t("heroCta")}
          </Link>
          <Link
            href="/collections"
            className="px-8 py-3 border border-white/40 text-white font-heading font-medium text-sm rounded-full hover:bg-white/10 transition-colors"
          >
            {t("heroCtaSecondary")}
          </Link>
        </div>
      </div>

      {/* Bottom SVG curve */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="w-full h-8 sm:h-10 md:h-[60px] block">
          <path d="M0,60 L0,20 Q720,0 1440,20 L1440,60 Z" fill="var(--color-bg-primary)" />
        </svg>
      </div>
    </section>
  );
}
