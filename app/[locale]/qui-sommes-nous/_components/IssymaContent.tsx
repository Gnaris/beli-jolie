import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ISSYMA_PALETTE } from "@/components/issyma/theme";
import {
  DEFAULT_BUSINESS_HOURS,
  formatScheduleForDisplay,
  type BusinessHoursSchedule,
} from "@/lib/business-hours";
import { getCachedBusinessHours, getCachedCompanyInfo, getCachedProductCount } from "@/lib/cached-data";

const IMG = "/uploads/issyma/qui-sommes-nous";
const P = ISSYMA_PALETTE;

type AddressLines = {
  line1: string | null;
  line2: string | null;
};

function buildAddressLines(
  info: { address: string | null; city: string | null; postalCode: string | null } | null,
): AddressLines {
  const line1 = info?.address?.trim() || null;
  const cityParts = [info?.postalCode?.trim(), info?.city?.trim()].filter(
    (part): part is string => Boolean(part && part.length > 0),
  );
  const line2 = cityParts.length > 0 ? cityParts.join(" ") : null;
  return { line1, line2 };
}

function buildMapsHref(info: { address: string | null; city: string | null; postalCode: string | null } | null): string {
  const parts = [info?.address, info?.postalCode, info?.city].filter(
    (part): part is string => Boolean(part && part.trim().length > 0),
  );
  const query = parts.length > 0 ? parts.join(" ") : "CIFA Aubervilliers";
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

export default async function IssymaContent() {
  const [t, locale, companyInfo, businessHoursRaw, productCount] = await Promise.all([
    getTranslations("qsnIssyma"),
    getLocale(),
    getCachedCompanyInfo(),
    getCachedBusinessHours(),
    getCachedProductCount(),
  ]);

  const schedule: BusinessHoursSchedule = businessHoursRaw ?? DEFAULT_BUSINESS_HOURS;
  const scheduleRows = formatScheduleForDisplay(schedule, locale);
  const addressLines = buildAddressLines(companyInfo);
  const mapsHref = buildMapsHref(companyInfo);

  return (
    <main className="relative z-10" style={{ background: P.paper }}>
      {/* 1 · HERO split 50/50 */}
      <section className="relative overflow-hidden">
        <div className="grid lg:grid-cols-12 min-h-[82vh]">
          <div className="lg:col-span-6 flex items-center" style={{ background: P.paper }}>
            <div className="px-6 md:px-10 lg:px-16 py-16 lg:py-0 max-w-xl">
              <p className="eyebrow mb-6">{t("heroEyebrow")}</p>
              <h1
                className="serif font-extrabold tracking-tight leading-[0.95]"
                style={{
                  fontSize: "clamp(2.5rem, 5.2vw, 4.75rem)",
                  letterSpacing: "-0.03em",
                  color: P.ink,
                }}
              >
                {t("heroTitle1")}
                <br />
                <span className="italic font-light" style={{ color: P.wine700 }}>
                  {t("heroTitle2")}
                </span>
              </h1>
              <p
                className="mt-8 text-lg leading-relaxed max-w-md"
                style={{ color: P.inkSoft }}
              >
                <strong style={{ color: P.ink }} className="font-semibold">
                  {t("heroDescLead")}
                </strong>
                {t("heroDescRest")}
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link
                  href="/inscription"
                  className="btn-wine inline-flex items-center gap-2 rounded-full text-sm font-semibold px-6 py-3"
                >
                  {t("heroCta")} <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </div>
          <div className="lg:col-span-6 relative min-h-[400px] lg:min-h-0" style={{ background: P.blush50 }}>
            <Image
              src={`${IMG}/boutique-interior.png`}
              alt={t("heroImageAlt")}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          </div>
        </div>
      </section>

      {/* 2 · 4 FEATURE TILES — flat, icon only */}
      <section style={{ background: P.paper, borderTop: `1px solid ${P.borderSoft}`, borderBottom: `1px solid ${P.borderSoft}` }}>
        <div className="max-w-[1300px] mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-14">
            <FeatureTile
              icon={<IconHanger />}
              title={t("feature1Title", { count: productCount })}
              body={t("feature1Body")}
            />
            <FeatureTile
              icon={<IconTag />}
              title={t("feature2Title")}
              body={t("feature2Body")}
            />
            <FeatureTile
              icon={<IconClockArrow />}
              title={t("feature3Title")}
              body={t("feature3Body")}
            />
            <FeatureTile
              icon={<IconGlobe />}
              title={t("feature4Title")}
              body={t("feature4Body")}
            />
          </div>
        </div>
      </section>

      {/* 3 · PASSION POUR LA MODE — image gauche + texte droite */}
      <section style={{ background: P.paper }}>
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
          <div className="lg:col-span-6 relative min-h-[500px]" style={{ background: P.blush50 }}>
            <Image
              src={`${IMG}/collections-mailles.png`}
              alt={t("passionImageAlt")}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-32 flex items-center">
            <div className="max-w-xl">
              <p className="eyebrow mb-6">{t("passionEyebrow")}</p>
              <h2
                className="serif font-extrabold tracking-tight leading-[0.95]"
                style={{
                  fontSize: "clamp(2rem, 4vw, 3rem)",
                  letterSpacing: "-0.03em",
                  color: P.ink,
                }}
              >
                {t("passionTitle1")}
                <br />
                <span className="italic font-light" style={{ color: P.wine700 }}>
                  {t("passionTitle2")}
                </span>
              </h2>
              <p className="mt-8 leading-relaxed" style={{ color: P.inkSoft }}>
                {t("passionP1")}
              </p>
              <p className="mt-4 leading-relaxed" style={{ color: P.inkSoft }}>
                {t("passionP2")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · SHOWROOM — bande rose poudré, texte gauche + image droite */}
      <section id="showroom" style={{ background: P.blush50 }}>
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
          <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-32 flex items-center">
            <div className="max-w-xl">
              <p className="eyebrow mb-6">{t("showroomEyebrow")}</p>
              <h2
                className="serif font-extrabold tracking-tight leading-[0.95]"
                style={{
                  fontSize: "clamp(2rem, 4vw, 3rem)",
                  letterSpacing: "-0.03em",
                  color: P.ink,
                }}
              >
                {t("showroomTitle1")}
                <br />
                <span className="italic font-light" style={{ color: P.wine700 }}>
                  {t("showroomTitle2")}
                </span>
              </h2>
              <p className="mt-8 leading-relaxed" style={{ color: P.inkSoft }}>
                {t("showroomDescLead")}
                <strong style={{ color: P.ink }}>{t("showroomDescStrong")}</strong>
                {t("showroomDescRest")}
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-outline-wine inline-flex items-center gap-2 rounded-full text-sm font-semibold px-6 py-3"
                >
                  {t("showroomItinerary")} <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          </div>
          <div className="lg:col-span-6 relative min-h-[500px]" style={{ background: P.cream }}>
            <Image
              src={`${IMG}/boutique-interior.png`}
              alt={t("showroomImageAlt")}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* 5 · NOTRE ÉQUIPE — photo gauche + texte & 3 mini-cards droite */}
      <section style={{ background: P.paper, borderTop: `1px solid ${P.borderSoft}` }}>
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
          <div className="lg:col-span-6 relative min-h-[520px]" style={{ background: P.blush50 }}>
            <Image
              src={`${IMG}/team-boutique.png`}
              alt={t("teamImageAlt")}
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-28 flex items-center">
            <div className="max-w-xl w-full">
              <p className="eyebrow mb-6">{t("teamEyebrow")}</p>
              <h2
                className="serif font-extrabold tracking-tight leading-[0.95]"
                style={{
                  fontSize: "clamp(2rem, 4vw, 3rem)",
                  letterSpacing: "-0.03em",
                  color: P.ink,
                }}
              >
                {t("teamTitle1")}{" "}
                <span className="italic font-light" style={{ color: P.wine700 }}>
                  {t("teamTitle2")}
                </span>
              </h2>
              <p className="mt-8 leading-relaxed" style={{ color: P.inkSoft }}>
                {t("teamDesc")}
              </p>
              <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <TeamMini
                  icon={<IconHeart />}
                  title={t("team1Title")}
                  body={t("team1Body")}
                />
                <TeamMini
                  icon={<IconChat />}
                  title={t("team2Title")}
                  body={t("team2Body")}
                />
                <TeamMini
                  icon={<IconShield />}
                  title={t("team3Title")}
                  body={t("team3Body")}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6 · NOUVEAUTÉS — texte gauche + mosaïque de 4 vignettes droite */}
      <section style={{ background: P.blush50, borderTop: `1px solid ${P.borderSoft}`, borderBottom: `1px solid ${P.borderSoft}` }}>
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-24 lg:py-28 grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          <div className="lg:col-span-5">
            <p className="eyebrow mb-4">{t("newsEyebrow")}</p>
            <h2
              className="serif font-extrabold tracking-tight leading-[0.95]"
              style={{
                fontSize: "clamp(2rem, 4vw, 3rem)",
                letterSpacing: "-0.03em",
                color: P.ink,
              }}
            >
              {t("newsTitle1")}{" "}
              <span className="italic font-light" style={{ color: P.wine700 }}>
                {t("newsTitle2")}
              </span>
            </h2>
            <p className="mt-8 leading-relaxed" style={{ color: P.inkSoft }}>
              {t("newsDesc")}
            </p>
            <Link
              href="/produits"
              className="btn-wine mt-8 inline-flex items-center gap-2 rounded-full text-sm font-semibold px-6 py-3"
            >
              {t("newsCta")} <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <NewsThumb
                src={`${IMG}/collections-mailles.png`}
                alt={t("newsAlt1")}
                position="left center"
              />
              <NewsThumb
                src={`${IMG}/team-boutique.png`}
                alt={t("newsAlt2")}
                position="center center"
              />
              <NewsThumb
                src={`${IMG}/collections-mailles.png`}
                alt={t("newsAlt3")}
                position="right center"
              />
              <NewsThumb
                src={`${IMG}/boutique-interior.png`}
                alt={t("newsAlt4")}
                position="30% center"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 7 · INFOS PRATIQUES — adresse (BDD) + horaires (7 jours) + accès */}
      <section style={{ background: P.paper }}>
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <p className="eyebrow mb-12 text-center">{t("practicalEyebrow")}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-14">
            <InfoTile
              icon={<IconPin />}
              title={t("practicalAddressTitle")}
            >
              <div className="font-body text-[15px] leading-relaxed space-y-0.5" style={{ color: P.ink }}>
                <p>{addressLines.line1 ?? t("practicalAddressFallbackLine1")}</p>
                <p>{addressLines.line2 ?? t("practicalAddressFallbackLine2")}</p>
              </div>
            </InfoTile>
            <InfoTile
              icon={<IconClockArrow />}
              title={t("practicalHoursTitle")}
            >
              <ul className="space-y-1 text-[14px] font-body" style={{ color: P.ink }}>
                {scheduleRows.map((row) => (
                  <li key={row.day} className="flex items-center justify-between gap-4">
                    <span style={{ color: P.inkSoft }}>{row.day}</span>
                    <span>{row.hours}</span>
                  </li>
                ))}
              </ul>
            </InfoTile>
            <InfoTile
              icon={<IconMetro />}
              title={t("practicalAccessTitle")}
            >
              <div className="font-body text-[15px] leading-relaxed space-y-0.5" style={{ color: P.ink }}>
                <p>{t("practicalAccessLine1")}</p>
                <p>{t("practicalAccessLine2")}</p>
              </div>
            </InfoTile>
          </div>
        </div>
      </section>

      {/* 8 · CTA FINAL — wine-panel bordeaux */}
      <section id="cta" className="wine-panel" style={{ color: P.cream }}>
        <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center relative z-10">
          <p
            className="text-[11px] uppercase mb-6"
            style={{ color: `${P.cream}99`, letterSpacing: "0.4em" }}
          >
            {t("ctaEyebrow")}
          </p>
          <h2
            className="serif font-extrabold tracking-tight leading-[0.95]"
            style={{
              fontSize: "clamp(2.25rem, 5vw, 4rem)",
              letterSpacing: "-0.03em",
              color: P.cream,
            }}
          >
            {t("ctaTitle1")}{" "}
            <span className="italic font-light">{t("ctaTitle2")}</span>
          </h2>
          <p
            className="mt-8 text-lg leading-relaxed max-w-2xl mx-auto"
            style={{ color: `${P.cream}cc` }}
          >
            {t("ctaDesc")}
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/inscription"
              className="btn-cream inline-flex items-center gap-2 rounded-full text-sm font-semibold px-7 py-4"
            >
              {t("ctaButton")} <span aria-hidden>→</span>
            </Link>
            <Link
              href="/produits"
              className="btn-outline-cream inline-flex items-center gap-2 rounded-full text-sm font-semibold px-7 py-4"
            >
              {t("ctaSecondary")}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Sous-composants
   ───────────────────────────────────────────────────────────────────────── */

function FeatureTile({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-5" style={{ color: P.wine700 }}>
        {icon}
      </div>
      <h3 className="serif font-semibold text-base mb-2" style={{ color: P.ink }}>
        {title}
      </h3>
      <p className="text-[14px] leading-relaxed" style={{ color: P.inkSoft }}>
        {body}
      </p>
    </div>
  );
}

function TeamMini({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-3" style={{ color: P.wine700 }}>
        {icon}
      </div>
      <h3 className="serif font-semibold text-sm mb-1" style={{ color: P.ink }}>
        {title}
      </h3>
      <p className="text-[13px] leading-relaxed" style={{ color: P.inkSoft }}>
        {body}
      </p>
    </div>
  );
}

function InfoTile({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5" style={{ color: P.wine700 }}>
        {icon}
      </div>
      <p
        className="text-[11px] uppercase mb-3"
        style={{ color: P.wine700, letterSpacing: "0.3em", fontWeight: 600 }}
      >
        {title}
      </p>
      {children}
    </div>
  );
}

function NewsThumb({
  src,
  alt,
  position,
}: {
  src: string;
  alt: string;
  position: string;
}) {
  return (
    <div
      className="relative aspect-square overflow-hidden rounded-2xl"
      style={{ background: P.cream }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(max-width: 1024px) 50vw, 25vw"
        style={{ objectPosition: position }}
        className="object-cover"
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Icônes (SVG inline, style Heroicons outline)
   ───────────────────────────────────────────────────────────────────────── */

const SVG_PROPS = {
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconHanger() {
  return (
    <svg {...SVG_PROPS} aria-hidden>
      <path d="M12 7a2 2 0 1 1 2 2v1" />
      <path d="M3.5 18l8.5-5.5L20.5 18" />
      <path d="M3.5 18h17" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg {...SVG_PROPS} aria-hidden>
      <path d="M20.5 12.5 12.5 20.5a1.5 1.5 0 0 1-2.1 0L3.5 13.6V3.5h10.1l6.9 6.9a1.5 1.5 0 0 1 0 2.1z" />
      <circle cx="8" cy="8" r="1.2" />
    </svg>
  );
}

function IconClockArrow() {
  return (
    <svg {...SVG_PROPS} aria-hidden>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 4v4h-4" />
      <path d="M12 7.5V12l2.5 1.5" />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg {...SVG_PROPS} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5a12 12 0 0 1 0 17M12 3.5a12 12 0 0 0 0 17" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg {...SVG_PROPS} width={24} height={24} aria-hidden>
      <path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10z" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg {...SVG_PROPS} width={24} height={24} aria-hidden>
      <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-5 4V7a2 2 0 0 1 2-2z" />
      <path d="M8 10h.01M12 10h.01" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg {...SVG_PROPS} width={24} height={24} aria-hidden>
      <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg {...SVG_PROPS} aria-hidden>
      <path d="M12 21s-7-6.3-7-11a7 7 0 1 1 14 0c0 4.7-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function IconMetro() {
  return (
    <svg {...SVG_PROPS} aria-hidden>
      <rect x="5" y="4" width="14" height="14" rx="3" />
      <path d="M8 10h8M8 13h8" />
      <path d="M9 18l-1.5 2M15 18l1.5 2" />
      <circle cx="9" cy="15.5" r="0.4" fill="currentColor" />
      <circle cx="15" cy="15.5" r="0.4" fill="currentColor" />
    </svg>
  );
}
