"use client";

import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";

interface HeroBannerProps {
  bannerImage: string | null;
  shopName: string;
  productCount: number;
}

export default function HeroBanner({ bannerImage, shopName, productCount }: HeroBannerProps) {
  const t = useTranslations("home");

  return (
    <section className="relative w-full min-h-[92vh] flex items-end overflow-hidden">
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

      {/* Gradient overlay — sombre en bas pour poser le texte */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/25 to-black/70" />

      {/* Content — aligné en bas à gauche façon magazine */}
      <div className="relative z-10 w-full">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 pb-16 lg:pb-24 text-white">
          <p className="text-white/80 text-[11px] sm:text-xs uppercase tracking-[0.3em] mb-6 animate-[fadeUp_0.6s_ease-out_both]">
            {t("heroBadge")}
          </p>
          <h1
            className="font-heading font-bold leading-[0.95] mb-8 max-w-4xl animate-[fadeUp_0.6s_ease-out_0.15s_both]"
            style={{ fontSize: "clamp(2.75rem, 7vw, 6rem)", letterSpacing: "-0.02em" }}
          >
            {t("heroTitle1")}
            <br />
            <span className="italic font-light text-white/85">{t("heroTitle2")}</span>
          </h1>
          <p className="font-body text-white/85 text-base sm:text-lg max-w-xl mb-10 font-light leading-relaxed animate-[fadeUp_0.6s_ease-out_0.3s_both]">
            {t("heroDesc", { count: String(productCount) })}
          </p>
          <div className="flex flex-wrap items-center gap-3 animate-[fadeUp_0.6s_ease-out_0.45s_both]">
            <Link
              href="/produits"
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-bg-darker font-heading font-medium text-sm rounded-full hover:bg-white/90 hover:-translate-y-0.5 transition-all shadow-lg shadow-black/10"
            >
              {t("heroCta")} <span aria-hidden>→</span>
            </Link>
            <Link
              href="/collections"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/40 text-white font-heading font-medium text-sm rounded-full hover:bg-white hover:text-bg-darker hover:border-white transition-colors"
            >
              {t("heroCtaSecondary")}
            </Link>
          </div>
        </div>
      </div>

      {/* Indicateur "Explorer" — desktop uniquement */}
      <div className="absolute bottom-8 right-8 text-white/70 text-[10px] uppercase tracking-[0.3em] hidden lg:flex flex-col items-center gap-3">
        <span>Explorer</span>
        <span className="w-px h-16 bg-white/40" />
      </div>
    </section>
  );
}
