"use client";

import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { useTranslations } from "next-intl";
import {
  DEFAULT_HERO_OVERLAY,
  heroOverlayBackground,
  type HeroOverlaySettings,
} from "@/lib/hero-overlay";

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
   *
   * `titleLine1` = 1ʳᵉ ligne du titre (rendu normal).
   * `titleLine2` = 2ᵉ ligne du titre (rendu **italic light** pour rythmer le
   * hero — cf. maquette validée par la cliente).
   */
  heroEyebrow?: string;
  heroTitleLine1?: string;
  heroTitleLine2?: string;
  heroDescription?: string;
  heroCtaSecondaryLabel?: string;
  heroCtaSecondaryHref?: string;
  overlay?: HeroOverlaySettings;
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
  overlay,
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
  const productCountFormatted = new Intl.NumberFormat("fr-FR").format(productCount);

  return (
    <section
      className="relative w-full bg-bg-darker text-white overflow-hidden"
      style={{ minHeight: "clamp(520px, 68vh, 720px)" }}
    >
      {/* Image de fond optionnelle. Le voile (couleur / dégradé / opacité) est
          paramétrable depuis Paramètres → Vitrine → Accueil. */}
      {bannerImage && (
        <>
          <Image
            src={bannerImage}
            alt={shopName}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div
            className="absolute inset-0"
            style={{ background: heroOverlayBackground(overlay ?? DEFAULT_HERO_OVERLAY) }}
          />
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

      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-10 py-24 lg:py-32 flex flex-col justify-center min-h-[inherit]">
        {/* Surtitre discret */}
        <p className="text-[11px] uppercase tracking-[0.28em] text-white/45 font-body font-medium">
          {eyebrow}
        </p>

        {/* Titre XXL sur 2 lignes — 2ᵉ ligne en italic light pour rythmer */}
        <h1
          className="font-heading font-bold leading-[1.05] tracking-tight max-w-3xl mt-5"
          style={{ fontSize: "clamp(2.4rem, 5.2vw, 4.5rem)", letterSpacing: "-0.02em" }}
        >
          {title1}
          <br />
          <span className="italic font-light">{title2}</span>
        </h1>

        {/* Description */}
        <p className="mt-6 max-w-xl text-white/75 text-base sm:text-lg leading-relaxed font-body">
          {description}
        </p>

        {/* CTA principaux */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/produits"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-bg-darker font-heading font-semibold text-sm hover:bg-white/90 transition"
          >
            {t("heroCta")}
            <span aria-hidden>→</span>
          </Link>
          <Link
            href={cta2Href}
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full border border-white/25 text-white font-heading text-sm hover:bg-white hover:text-bg-darker transition-colors"
          >
            {cta2Label}
          </Link>
        </div>

        {/* Compteur discret « + de X références » */}
        {productCount > 0 && (
          <p className="mt-10 text-[11px] uppercase tracking-[0.28em] text-white/40 font-body font-medium">
            + de {productCountFormatted} références en stock
          </p>
        )}
      </div>
    </section>
  );
}
