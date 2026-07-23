"use client";

import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";

const TRUST_ITEMS = ["trustDelivery", "trustPayment", "trustSupport", "trustQuality"] as const;

export default function TrustBand() {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-secondary py-24 lg:py-28">
      <div className="container-site max-w-[1400px] mx-auto px-6 lg:px-10 grid grid-cols-1 md:grid-cols-4 gap-10 lg:gap-14">
        {TRUST_ITEMS.map((key, i) => {
          const num = String(i + 1).padStart(2, "0");
          return (
            <div key={key}>
              <div className="w-12 h-12 rounded-full border border-border flex items-center justify-center mb-5 font-heading text-sm font-medium text-text-secondary">
                {num}
              </div>
              <h3 className="font-heading font-semibold text-lg mb-2 text-text-primary leading-snug">
                {t(key)}
              </h3>
              <p className="font-body text-sm text-text-secondary leading-relaxed">
                {t(`${key}Desc`)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
