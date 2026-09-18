import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { getCachedShopName, getCachedSiteConfig } from "@/lib/cached-data";
import { getCurrentTenantId, getCurrentTenantSlug } from "@/lib/tenant";
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
  const tenantSlug = await getCurrentTenantSlug();
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

  // 6 emplacements photos : on n'affiche QUE les slots réellement chargés
  // par la cliente dans Paramètres → Vitrine. Si aucune photo n'a été
  // chargée, la section entière est masquée (pas de placeholders vides).
  const aboutPhotos: string[] = [
    aboutPhoto1Row?.value?.trim(),
    aboutPhoto2Row?.value?.trim(),
    aboutPhoto3Row?.value?.trim(),
    aboutPhoto4Row?.value?.trim(),
    aboutPhoto5Row?.value?.trim(),
    aboutPhoto6Row?.value?.trim(),
  ].filter((url): url is string => Boolean(url && url.length > 0));

  return (
    <div className="min-h-screen bg-bg-primary relative">
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />

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

        {/* Grille photos ── masquée si aucune photo chargée */}
        {aboutPhotos.length > 0 && (
          <section className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16 lg:py-20">
            <div className="text-center mb-10">
              <h2 className="font-heading text-2xl md:text-3xl font-bold text-text-primary tracking-tight">
                {t("photosTitle")}
              </h2>
              <p className="mt-2 text-text-muted text-sm font-body">
                {t("photosCaption")}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3 md:gap-4">
              {aboutPhotos.map((photo, i) => (
                <div
                  key={i}
                  className="relative aspect-[4/5] w-[calc(50%-0.375rem)] md:w-[calc(33.333%-0.667rem)] rounded-2xl overflow-hidden bg-gradient-to-br from-bg-tertiary to-bg-secondary border border-border"
                >
                  <Image
                    src={photo}
                    alt={t("photoAlt", { index: i + 1 })}
                    fill
                    sizes="(max-width: 768px) 50vw, 33vw"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

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
