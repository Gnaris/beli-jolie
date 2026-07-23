"use client";

import { useTranslations } from "next-intl";

export default function TrustMarquee() {
  const t = useTranslations("home");

  const items = [
    t("marqueeDelivery"),
    t("marqueeMinOrder"),
    t("marqueeQuality"),
    t("marqueeMadeIn"),
    t("marqueeStock"),
    t("marqueeReturns"),
  ];

  // On duplique la liste pour un défilement infini fluide
  const loop = [...items, ...items];

  return (
    <div className="bg-bg-darker text-white/80 py-4 overflow-hidden">
      <div className="marquee-track flex gap-12 whitespace-nowrap text-[11px] uppercase tracking-[0.25em]">
        {loop.map((label, i) => (
          <span key={i} className="inline-flex items-center gap-12">
            <span>{label}</span>
            <span aria-hidden className="text-white/40">·</span>
          </span>
        ))}
      </div>
      <style>{`
        .marquee-track {
          animation: marquee-scroll 40s linear infinite;
          width: max-content;
        }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track { animation: none; }
        }
      `}</style>
    </div>
  );
}
