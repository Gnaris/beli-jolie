"use client";

import { Link } from "@/i18n/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";

export default function CtaBanner() {
  const { data: session } = useSession();
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  return (
    <section
      ref={sectionRef}
      className="scroll-fade-up relative overflow-hidden bg-bg-darker text-white py-20 lg:py-28"
    >
      {/* Grille fond très discrète */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-10 text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/50 mb-4">{t("ctaEyebrow")}</p>
        <h2
          className="font-heading font-bold leading-[1.05] mx-auto max-w-3xl"
          style={{ fontSize: "clamp(2rem, 5vw, 4rem)", letterSpacing: "-0.02em" }}
        >
          {t("ctaTitle")}
        </h2>
        <p className="mt-6 max-w-lg mx-auto text-white/70 leading-relaxed">{t("ctaDesc")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/produits"
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 transition"
          >
            {t("heroCta")} <span aria-hidden>→</span>
          </Link>
          {!session && (
            <Link
              href="/inscription"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/25 text-white font-heading text-sm rounded-full hover:bg-white hover:text-bg-darker transition-colors"
            >
              {t("heroRegister")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
