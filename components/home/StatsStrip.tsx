"use client";

import { useTranslations } from "next-intl";

interface StatsStripProps {
  productCount: number;
  collectionCount: number;
}

export default function StatsStrip({ productCount, collectionCount }: StatsStripProps) {
  const t = useTranslations("home");

  const stats = [
    { value: `+${productCount}`, label: t("statsReferences") },
    { value: t("statsDeliveryValue"), label: t("statsDelivery") },
    { value: `${collectionCount}`, label: t("collections") },
    { value: t("statsProValue"), label: t("statsPro") },
  ];

  return (
    <section className="py-8 sm:py-10 bg-bg-secondary">
      <div className="container-site">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="text-center py-4 animate-zoom-fade"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <p className="font-heading text-2xl sm:text-3xl font-bold text-text-primary">
                {stat.value}
              </p>
              <p className="font-body text-xs sm:text-sm text-text-muted mt-1 tracking-wide uppercase">
                {stat.label}
              </p>
              <div className="h-px w-8 bg-accent/40 mx-auto mt-3" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
