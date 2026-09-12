import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { getCachedShopName, getCachedSiteConfig } from "@/lib/cached-data";
import { getCurrentTenantId } from "@/lib/tenant";
import { buildAlternates } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";

export const revalidate = 7200;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  await getCurrentTenantId();
  const { locale } = await params;
  const [shopName, tMeta, alternates] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
    buildAlternates("/a-propos", locale),
  ]);
  return {
    title: tMeta("aboutTitle"),
    description: tMeta("aboutDescription", { shopName }),
    alternates,
  };
}

/**
 * Petit helper : chaque section de la page « À propos » peut être surchargée
 * via SiteConfig (`about_intro`, `about_history_body`, `about_showroom_body`,
 * `about_team_body`, `about_newness_body`, `about_delivery_body`).
 * Fallback = message i18n générique.
 */
function sectionText(override: string | null | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export default async function AboutPage() {
  await getCurrentTenantId();
  const [
    shopName,
    t,
    aboutIntroRow,
    aboutHistoryRow,
    aboutShowroomRow,
    aboutTeamRow,
    aboutNewnessRow,
    aboutDeliveryRow,
    aboutPhoto1Row,
    aboutPhoto2Row,
    aboutPhoto3Row,
    aboutPhoto4Row,
    aboutPhoto5Row,
    aboutPhoto6Row,
  ] = await Promise.all([
    getCachedShopName(),
    getTranslations("about"),
    getCachedSiteConfig("about_intro"),
    getCachedSiteConfig("about_history_body"),
    getCachedSiteConfig("about_showroom_body"),
    getCachedSiteConfig("about_team_body"),
    getCachedSiteConfig("about_newness_body"),
    getCachedSiteConfig("about_delivery_body"),
    getCachedSiteConfig("about_photo_1_url"),
    getCachedSiteConfig("about_photo_2_url"),
    getCachedSiteConfig("about_photo_3_url"),
    getCachedSiteConfig("about_photo_4_url"),
    getCachedSiteConfig("about_photo_5_url"),
    getCachedSiteConfig("about_photo_6_url"),
  ]);

  const intro = sectionText(aboutIntroRow?.value, t("intro"));
  const historyBody = sectionText(aboutHistoryRow?.value, t("historyBody"));
  const showroomBody = sectionText(aboutShowroomRow?.value, t("showroomBody"));
  const teamBody = sectionText(aboutTeamRow?.value, t("teamBody"));
  const newnessBody = sectionText(aboutNewnessRow?.value, t("newnessBody"));
  const deliveryBody = sectionText(aboutDeliveryRow?.value, t("deliveryBody"));

  // 6 emplacements photos : chaque slot affiche la vraie photo si la cliente
  // en a chargé une dans Paramètres → Vitrine, sinon un placeholder visuel.
  const aboutPhotos: (string | null)[] = [
    aboutPhoto1Row?.value?.trim() || null,
    aboutPhoto2Row?.value?.trim() || null,
    aboutPhoto3Row?.value?.trim() || null,
    aboutPhoto4Row?.value?.trim() || null,
    aboutPhoto5Row?.value?.trim() || null,
    aboutPhoto6Row?.value?.trim() || null,
  ];

  return (
    <div className="min-h-screen bg-bg-primary relative">
      <PublicSidebar shopName={shopName} />

      <main className="relative z-10">
        {/* Hero éditorial ── */}
        <section className="bg-gradient-to-b from-bg-secondary to-bg-primary border-b border-border">
          <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16 lg:py-24 text-center">
            <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted font-body mb-4">
              {t("eyebrow")}
            </p>
            <h1
              className="font-heading font-bold text-text-primary leading-[1.05] tracking-tight max-w-3xl mx-auto"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              {t("title", { shopName })}
            </h1>
            <p className="mt-6 max-w-2xl mx-auto text-text-secondary text-base sm:text-lg leading-relaxed font-body">
              {intro}
            </p>
          </div>
        </section>

        {/* Sections principales ── grille 2 colonnes */}
        <section className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="grid md:grid-cols-2 gap-10 lg:gap-14">
            <AboutBlock title={t("historyTitle")} body={historyBody} />
            <AboutBlock title={t("showroomTitle")} body={showroomBody} />
            <AboutBlock title={t("teamTitle")} body={teamBody} />
            <AboutBlock title={t("newnessTitle")} body={newnessBody} />
          </div>
        </section>

        {/* Section livraisons full width ── */}
        <section className="bg-bg-secondary border-y border-border">
          <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-14 lg:py-20 text-center">
            <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted font-body mb-4">
              {t("deliveryTitle")}
            </p>
            <p className="font-body text-text-secondary text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
              {deliveryBody}
            </p>
          </div>
        </section>

        {/* Grille photos placeholders ── */}
        <section className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16 lg:py-20">
          <div className="text-center mb-10">
            <h2 className="font-heading text-2xl md:text-3xl font-bold text-text-primary tracking-tight">
              {t("photosTitle")}
            </h2>
            <p className="mt-2 text-text-muted text-sm font-body">
              {t("photosCaption")}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {aboutPhotos.map((photo, i) => (
              <div
                key={i}
                className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-gradient-to-br from-bg-tertiary to-bg-secondary border border-border"
              >
                {photo ? (
                  <Image
                    src={photo}
                    alt={t("photoAlt", { index: i + 1 })}
                    fill
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-text-muted">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.3}
                        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                    <span className="text-[11px] uppercase tracking-[0.2em] font-body">
                      {t("photoPlaceholder")}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* CTA final ── */}
        <section className="bg-bg-dark text-text-inverse">
          <div className="max-w-[900px] mx-auto px-6 lg:px-10 py-14 lg:py-20 text-center">
            <h2 className="font-heading text-2xl md:text-3xl font-bold tracking-tight">
              {t("ctaTitle")}
            </h2>
            <p className="mt-3 text-white/75 text-sm sm:text-base leading-relaxed max-w-xl mx-auto font-body">
              {t("ctaBody")}
            </p>
            <Link
              href="/inscription"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white text-text-primary text-sm font-heading font-semibold px-6 py-3 hover:bg-white/90 transition"
            >
              {t("ctaButton")}
              <span aria-hidden>→</span>
            </Link>
          </div>
        </section>
      </main>

      <Footer shopName={shopName} />
    </div>
  );
}

function AboutBlock({ title, body }: { title: string; body: string }) {
  return (
    <article className="bg-bg-primary border border-border rounded-2xl p-6 lg:p-8 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-body mb-3">
        {title}
      </p>
      <p className="font-body text-text-secondary text-[15px] leading-relaxed whitespace-pre-line">
        {body}
      </p>
    </article>
  );
}
