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
      className="scroll-fade-up relative overflow-hidden py-20 lg:py-28"
      style={{
        background: "linear-gradient(135deg, #1A1A1A 0%, #2D2D2D 60%, #1A1A1A 100%)",
      }}
    >
      {/* Decorative grain pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 text-center px-6 max-w-2xl mx-auto">
        <span className="inline-block text-[11px] font-body tracking-[0.25em] uppercase text-white/50 mb-5">
          {t("heroBadge")}
        </span>
        <h2
          className="font-heading font-bold text-white leading-[1.1] mb-5"
          style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)", letterSpacing: "-0.01em" }}
        >
          {t("ctaTitle")}
        </h2>
        <p className="font-body text-white/65 text-base mb-9 max-w-lg mx-auto leading-relaxed">
          {t("ctaDesc")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/produits"
            className="px-8 py-3.5 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 hover:scale-[1.02] transition-all shadow-lg shadow-black/30"
          >
            {t("heroCta")}
          </Link>
          {!session && (
            <Link
              href="/inscription"
              className="px-8 py-3.5 border border-white/30 text-white font-heading font-medium text-sm rounded-full hover:bg-white/10 hover:border-white/50 transition-colors"
            >
              {t("heroRegister")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
