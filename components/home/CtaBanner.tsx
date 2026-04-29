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
      className="scroll-fade-up relative overflow-hidden py-20 lg:py-24"
      style={{ backgroundColor: "#111111" }}
    >
      {/* Subtle radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, rgba(75,85,99,0.1) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 text-center px-6 max-w-2xl mx-auto">
        <h2
          className="font-heading font-bold text-white leading-tight mb-4"
          style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)" }}
        >
          {t("ctaTitle")}
        </h2>
        <p className="font-body text-white/60 text-base mb-8 max-w-lg mx-auto">
          {t("ctaDesc")}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/produits"
            className="px-8 py-3 bg-white text-bg-darker font-heading font-semibold text-sm rounded-full hover:bg-white/90 transition-colors"
          >
            {t("heroCta")}
          </Link>
          {!session && (
            <Link
              href="/inscription"
              className="px-8 py-3 border border-white/30 text-white font-heading font-medium text-sm rounded-full hover:bg-white/10 transition-colors"
            >
              {t("heroRegister")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
