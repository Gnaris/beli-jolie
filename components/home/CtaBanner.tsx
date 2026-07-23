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
      className="scroll-fade-up relative overflow-hidden bg-bg-darker text-white py-24 lg:py-32"
    >
      {/* Grain texture subtile */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.7) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-10 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-white/50 font-medium mb-6">
          {t("ctaEyebrow")}
        </p>
        <h2
          className="font-heading font-bold leading-tight mb-6 max-w-3xl mx-auto"
          style={{ fontSize: "clamp(2rem, 5vw, 4rem)", letterSpacing: "-0.02em" }}
        >
          {t("ctaTitle")}
        </h2>
        <p className="font-body text-white/70 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
          {t("ctaDesc")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/produits"
            className="inline-flex items-center gap-2 px-7 py-3.5 bg-white text-bg-darker font-heading font-medium text-sm rounded-full hover:bg-white/90 hover:-translate-y-0.5 transition-all shadow-lg shadow-black/30"
          >
            {t("heroCta")} <span aria-hidden>→</span>
          </Link>
          {!session && (
            <Link
              href="/inscription"
              className="inline-flex items-center gap-2 px-7 py-3.5 border border-white/30 text-white font-heading font-medium text-sm rounded-full hover:bg-white hover:text-bg-darker hover:border-white transition-colors"
            >
              {t("heroRegister")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
