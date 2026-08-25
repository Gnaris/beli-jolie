"use client";

import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";

const TRUST_ITEMS = ["trustDelivery", "trustPayment", "trustSupport", "trustQuality"] as const;

const ICONS: Record<string, React.ReactNode> = {
  trustDelivery: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M8 3v3M16 3v3" />
    </svg>
  ),
  trustPayment: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  trustSupport: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 12a9 9 0 1 1-9-9" />
      <path d="M15 3h6v6" />
      <path d="M13 11l8-8" />
    </svg>
  ),
  trustQuality: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 7h11l3 4h2v6h-3M4 7v10h3" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
};

export default function TrustBand() {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-20 lg:py-24">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="max-w-xl mb-14">
          <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-2">Notre engagement</p>
          <h2
            className="font-heading font-bold text-text-primary"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.02em" }}
          >
            Pourquoi les boutiques nous choisissent.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-3xl overflow-hidden border border-border">
          {TRUST_ITEMS.map((key, i) => {
            const num = String(i + 1).padStart(2, "0");
            return (
              <div key={key} className="bg-bg-primary p-8 lg:p-10">
                <div className="flex items-center justify-between mb-6">
                  <span className="font-heading font-bold text-4xl text-text-muted/40">{num}</span>
                  <span className="text-text-primary">{ICONS[key]}</span>
                </div>
                <h3 className="font-heading font-semibold text-lg text-text-primary">{t(key)}</h3>
                <p className="mt-2 text-text-secondary text-sm leading-relaxed">{t(`${key}Desc`)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
