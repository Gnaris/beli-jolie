"use client";

import { useTranslations } from "next-intl";
import { useScrollReveal } from "./useScrollReveal";

/**
 * Section pédagogique home BJ (refonte 2026-09-28) — explique en clair aux
 * revendeuses ce que veut dire « Acier 304L · Placage PVD 14K » et pourquoi
 * ça change quelque chose pour leurs clientes finales. Placée après les
 * best-sellers, avant la bande réassurance.
 *
 * 4 blocs pédagogiques : matière (304L), placage (PVD), résistance à l'eau,
 * tenue de l'éclat. Textes 100 % éditables via les clés `home.materialQuality.*`
 * dans messages/fr.json + en.json.
 */
const NAVY = "#0b1b34";

const BLOCKS = [
  { key: "block1", icon: <IconShield /> },
  { key: "block2", icon: <IconSparkle /> },
  { key: "block3", icon: <IconDroplet /> },
  { key: "block4", icon: <IconStar /> },
] as const;

export default function MaterialQualitySection() {
  const t = useTranslations("home");
  const sectionRef = useScrollReveal();

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-primary py-20 lg:py-24">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">

        {/* En-tête */}
        <div className="max-w-2xl mb-14">
          <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">
            {t("materialQuality.eyebrow")}
          </p>
          <h2
            className="font-heading font-bold text-text-primary"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.02em" }}
          >
            {t("materialQuality.title")}
          </h2>
          <p
            className="mt-3 text-sm font-heading font-semibold uppercase tracking-[0.18em]"
            style={{ color: NAVY }}
          >
            {t("materialQuality.subtitle")}
          </p>
          <p className="mt-5 text-text-secondary leading-relaxed">
            {t("materialQuality.intro")}
          </p>
        </div>

        {/* Grille 4 cartes */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          {BLOCKS.map(({ key, icon }) => (
            <article
              key={key}
              className="rounded-2xl border border-border bg-bg-primary p-6 lg:p-7 shadow-sm"
            >
              <div
                className="h-10 w-10 rounded-full grid place-items-center text-white mb-4"
                style={{ backgroundColor: NAVY }}
              >
                {icon}
              </div>
              <h3 className="font-heading font-semibold text-base text-text-primary">
                {t(`materialQuality.${key}Title`)}
              </h3>
              <p className="mt-2 text-sm text-text-secondary leading-relaxed">
                {t(`materialQuality.${key}Desc`)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Icônes SVG (stroke 2, lucide-like) ─────────────────────────── */

function IconShield() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v6c0 5 3.5 9.4 8 11 4.5-1.6 8-6 8-11V5l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconSparkle() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}
function IconDroplet() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 5.5 11c-2 3 .5 8 6.5 8s8.5-5 6.5-8L12 2Z" />
    </svg>
  );
}
function IconStar() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3 6.5 7 1-5 5 1 7-6-3.5L6 21.5l1-7-5-5 7-1L12 2Z" />
    </svg>
  );
}
