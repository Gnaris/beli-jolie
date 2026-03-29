"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

interface HeroBannerProps {
  bannerImage: string | null;
  shopName: string;
}

export default function HeroBanner({ bannerImage, shopName }: HeroBannerProps) {
  const t = useTranslations("home");

  return (
    <section className="bg-bg-dark relative overflow-hidden min-h-[320px] sm:min-h-[450px] md:min-h-[600px] flex items-center">
      {/* Background */}
      <div className="absolute inset-0">
        {bannerImage ? (
          <Image
            src={bannerImage}
            alt={shopName}
            fill
            className="object-cover"
            priority
            unoptimized
          />
        ) : (
          <div className="w-full h-full bg-bg-dark" />
        )}
        {/* Gradient overlay — always present for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A]/85 via-[#0F172A]/35 to-[#0F172A]/10" />
      </div>

      {/* Decorative accent line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent opacity-60" />

      {/* Content overlay */}
      <div className="relative z-10 container-site pb-16 sm:pb-20 md:pb-28 pt-24 sm:pt-28">
        <div className="max-w-xl animate-slide-up">
          {/* Badge */}
          <span className="inline-block text-[10px] sm:text-xs font-body font-medium tracking-[0.15em] uppercase text-accent border border-accent/30 bg-accent/10 px-3 py-1 rounded-full mb-4 backdrop-blur-sm">
            {t("heroBadge")}
          </span>

          {/* Title */}
          <h1 className="font-heading text-2xl sm:text-4xl md:text-5xl font-bold text-text-inverse leading-[1.15] mb-4">
            {t("heroTitle1")}
            <br />
            <span className="text-accent">{t("heroTitle2")}</span>
          </h1>

          {/* Description */}
          <p className="font-body text-sm sm:text-base text-white/70 leading-relaxed mb-6 max-w-md">
            {t("heroDesc", { count: "500" })}
          </p>

          {/* CTA */}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/produits"
              className="btn-primary text-white font-semibold text-sm px-6 py-2.5 rounded-xl"
            >
              {t("heroCta")} &rarr;
            </Link>
            <Link
              href="/collections"
              className="inline-flex items-center text-sm font-medium text-white/80 border border-white/20 bg-white/5 backdrop-blur-sm px-5 py-2.5 rounded-lg hover:bg-white/10 hover:border-white/30 transition-all duration-200 font-body"
            >
              {t("collections")}
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom decorative curve */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 48" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-6 sm:h-8 md:h-12" preserveAspectRatio="none">
          <path d="M0 48h1440V24C1200 0 960 40 720 40S240 0 0 24v24z" fill="var(--color-bg-secondary)" />
        </svg>
      </div>
    </section>
  );
}
