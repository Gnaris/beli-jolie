"use client";

import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";

interface HeroBannerProps {
  bannerImage: string | null;
  shopName: string;
  productCount: number;
  /**
   * Overrides SiteConfig (par tenant). Non fournis → fallback sur les messages
   * i18n génériques (voir home.hero* dans messages/fr.json).
   *
   * Clés SiteConfig associées (posées dans Paramètres → Contenu accueil) :
   *   home_hero_eyebrow, home_hero_title_line1, home_hero_title_line2,
   *   home_hero_description, home_hero_cta_secondary_label,
   *   home_hero_cta_secondary_href
   */
  heroEyebrow?: string;
  heroTitleLine1?: string;
  heroTitleLine2?: string;
  heroDescription?: string;
  heroCtaSecondaryLabel?: string;
  heroCtaSecondaryHref?: string;
}

export default function HeroBanner({
  bannerImage,
  shopName,
  productCount,
  heroEyebrow,
  heroTitleLine1,
  heroTitleLine2,
  heroDescription,
  heroCtaSecondaryLabel,
  heroCtaSecondaryHref,
}: HeroBannerProps) {
  const t = useTranslations("home");

  const eyebrow = heroEyebrow?.trim() || t("heroBadge");
  const title1 = heroTitleLine1?.trim() || t("heroTitle1");
  const title2 = heroTitleLine2?.trim() || t("heroTitle2");
  // Si un texte custom est défini côté SiteConfig, on l'utilise tel quel (pas
  // de placeholder {count}). Sinon fallback i18n qui affiche le compteur live.
  const description = heroDescription?.trim() || t("heroDesc", { count: String(productCount) });
  const cta2Label = heroCtaSecondaryLabel?.trim() || t("heroCtaSecondary");
  const cta2Href = heroCtaSecondaryHref?.trim() || "/collections";

  return (
    <section
      className="relative w-full bg-bg-darker text-white overflow-hidden"
      style={{ minHeight: "clamp(460px, 58vh, 620px)" }}
    >
      {/* Image de fond optionnelle (assombrie) */}
      {bannerImage && (
        <>
          <Image
            src={bannerImage}
            alt={shopName}
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-bg-darker/75 via-bg-darker/35 to-transparent" />
        </>
      )}

      {/* Grille de fond très discrète — sans image seulement */}
      {!bannerImage && (
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      )}

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-10 py-12 lg:py-14 grid lg:grid-cols-12 gap-10 items-center min-h-[inherit]">

        {/* Colonne texte */}
        <div className="lg:col-span-8">
          <div className="inline-flex items-center gap-2 mb-5 text-[11px] uppercase tracking-[0.3em] text-gold">
            <span className="w-1.5 h-1.5 rounded-full bg-gold" />
            {eyebrow}
          </div>

          <h1
            className="font-heading font-bold leading-[1] max-w-3xl"
            style={{ fontSize: "clamp(1.9rem, 4vw, 3.25rem)", letterSpacing: "-0.02em" }}
          >
            {title1}
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="absolute left-0 right-0 bg-gold"
                style={{ bottom: "0.08em", height: "0.28em", opacity: 0.85, zIndex: 0 }}
              />
              <span className="relative">{title2}</span>
            </span>
          </h1>

          <p className="mt-4 max-w-lg text-white/70 text-sm sm:text-base leading-relaxed">
            {description}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/produits"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-bg-darker font-heading font-semibold text-sm hover:bg-white/90 transition"
            >
              {t("heroCta")}
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={cta2Href}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-white/25 text-white font-heading text-sm hover:bg-white hover:text-bg-darker transition-colors"
            >
              {cta2Label}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
