"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import JewelrySceneLoader from "@/components/home/JewelrySceneLoader";

interface HeroBannerProps {
  isLoggedIn: boolean;
  productCount: number;
}

export default function HeroBanner({ isLoggedIn, productCount }: HeroBannerProps) {
  const t = useTranslations("home");

  return (
    <section className="bg-bg-dark relative overflow-hidden min-h-[600px] md:min-h-[650px]">
      {/* Three.js 3D jewelry animation — behind everything */}
      <div className="absolute inset-0">
        <JewelrySceneLoader />
      </div>

      {/* Dark overlay — pointer-events-none so hover reaches the canvas */}
      <div className="absolute inset-0 bg-[#1A1A1A]/70 pointer-events-none" />

      <div className="container-site py-24 md:py-32 relative z-10 pointer-events-none">
        <div className="grid md:grid-cols-2 gap-12 items-center">

          {/* Text */}
          <div className="pointer-events-auto">
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm text-white/80 text-[11px] font-medium uppercase tracking-[0.2em] px-3 py-1.5 rounded-full mb-8 font-[family-name:var(--font-roboto)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
              {t("heroBadge")}
            </div>
            <h1 className="font-[family-name:var(--font-poppins)] text-4xl md:text-5xl font-semibold leading-[1.1] text-text-inverse mb-6 drop-shadow-lg animate-slide-up">
              {t("heroTitle1")}<br />
              {t("heroTitle2")}
            </h1>
            <p className="text-white/70 text-base leading-relaxed font-[family-name:var(--font-roboto)] mb-10 max-w-md animate-slide-up stagger-2">
              {t("heroDesc", { count: productCount })}
            </p>
            <div className="flex flex-wrap gap-3 animate-zoom-fade stagger-4">
              {isLoggedIn ? (
                <Link href="/produits" className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)] shadow-lg">
                  {t("heroCta")}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                </Link>
              ) : (
                <>
                  <Link href="/connexion" className="inline-flex items-center gap-2 bg-bg-primary text-text-primary text-sm font-medium px-6 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors font-[family-name:var(--font-roboto)] shadow-lg">
                    {t("heroAccess")}
                  </Link>
                  <Link href="/inscription" className="inline-flex items-center gap-2 border border-white/25 text-text-inverse text-sm px-6 py-2.5 rounded-lg hover:bg-white/10 backdrop-blur-sm transition-colors font-[family-name:var(--font-roboto)]">
                    {t("heroRegister")}
                  </Link>
                </>
              )}
            </div>

            {/* Quick stats */}
            <div className="flex flex-wrap gap-6 mt-10 pt-10 border-t border-white/10">
              {[
                { value: `+${productCount}`, label: t("statsReferences") },
                { value: t("statsDeliveryValue"),  label: t("statsDelivery") },
                { value: t("statsProValue"),  label: t("statsPro") },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="font-[family-name:var(--font-poppins)] text-xl font-bold text-text-inverse">{stat.value}</p>
                  <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right panel — glass cards over 3D scene */}
          <div className="hidden md:flex flex-col gap-3 pointer-events-auto">
            <div className="bg-white/[0.07] backdrop-blur-md border border-white/15 rounded-2xl p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/20 flex items-center justify-center text-[#D4AF37]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                </div>
                <div>
                  <p className="text-text-inverse text-sm font-medium font-[family-name:var(--font-roboto)]">{t("cardExclusive")}</p>
                  <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)]">{t("cardPremium")}</p>
                </div>
              </div>
              <div className="h-px bg-white/5" />
              {[t("cardNecklaces"), t("cardBracelets"), t("cardRings"), t("cardEarrings")].map((cat) => (
                <div key={cat} className="flex items-center justify-between">
                  <span className="text-white/60 text-sm font-[family-name:var(--font-roboto)]">{cat}</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]/40" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.07] backdrop-blur-md border border-white/15 rounded-xl p-4">
                <p className="text-text-inverse text-lg font-bold font-[family-name:var(--font-poppins)]">{productCount}+</p>
                <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)] mt-0.5">{t("cardAvailable")}</p>
              </div>
              <div className="bg-white/[0.07] backdrop-blur-md border border-white/15 rounded-xl p-4">
                <p className="text-text-inverse text-lg font-bold font-[family-name:var(--font-poppins)]">100%</p>
                <p className="text-white/50 text-xs font-[family-name:var(--font-roboto)] mt-0.5">{t("cardSteel")}</p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
