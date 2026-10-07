import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { getCachedShopName, getCachedProductCount } from "@/lib/cached-data";
import { getCurrentTenantId } from "@/lib/tenant";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import { buildAlternates } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import IssymaShell from "@/components/issyma/IssymaShell";
import IssymaContent from "./_components/IssymaContent";

export const revalidate = 7200;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  await getCurrentTenantId();
  const slug = await getEffectiveTenantSlug();
  const { locale } = await params;

  if (slug === "beliandjolie") {
    const [alternates, t] = await Promise.all([
      buildAlternates("/qui-sommes-nous", locale),
      getTranslations({ locale, namespace: "qsnBeli" }),
    ]);
    return {
      title: t("metaTitle"),
      description: t("metaDescription"),
      alternates,
    };
  }

  if (slug === "issyma") {
    const alternates = await buildAlternates("/qui-sommes-nous", locale);
    const t = await getTranslations({ locale, namespace: "qsnIssyma" });
    return {
      title: t("metaTitle"),
      description: t("metaDescription"),
      alternates,
    };
  }

  return {};
}

export default async function QuiSommesNousPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await getCurrentTenantId();
  const tenantSlug = await getEffectiveTenantSlug();
  const { locale } = await params;

  if (tenantSlug === "issyma") {
    const shopName = await getCachedShopName();
    return (
      <IssymaShell shopName={shopName}>
        <IssymaContent />
      </IssymaShell>
    );
  }

  if (tenantSlug !== "beliandjolie") notFound();

  const [shopName, productCount, t] = await Promise.all([
    getCachedShopName(),
    getCachedProductCount(),
    getTranslations({ locale, namespace: "qsnBeli" }),
  ]);
  // Formatage à la locale : 2500 → "2 500" (fr), "2,500" (en), etc.
  const productCountFmt = new Intl.NumberFormat(locale).format(productCount);
  const IMG = "/uploads/beliandjolie/qui-sommes-nous";

  const strong = (chunks: React.ReactNode) => <strong className="text-text-primary font-semibold">{chunks}</strong>;
  const italic = (chunks: React.ReactNode) => <em className="italic font-light">{chunks}</em>;
  const emTag = (chunks: React.ReactNode) => <em>{chunks}</em>;

  return (
    <div className="min-h-screen bg-bg-primary relative">
      <PublicSidebar shopName={shopName} tenantSlug={tenantSlug ?? undefined} />

      <main className="relative z-10">
        {/* 1 · HERO éditorial split 50/50 */}
        <section className="relative overflow-hidden">
          <div className="grid lg:grid-cols-12 min-h-[85vh]">
            <div className="lg:col-span-6 flex items-center bg-bg-primary">
              <div className="px-6 md:px-10 lg:px-16 py-16 lg:py-0 max-w-xl">
                <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                  {t("heroEyebrow")}
                </p>
                <h1
                  className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2.75rem, 6vw, 5.5rem)", letterSpacing: "-0.03em" }}
                >
                  {t("heroTitle1")}
                  <br />
                  {t("heroTitle2")}
                  <br />
                  <span className="italic font-light">{t("heroTitleItalic")}</span>
                </h1>
                <p className="mt-8 text-text-secondary text-lg leading-relaxed max-w-md font-body">
                  {t.rich("heroSubtitle", { strong })}
                </p>
                <div className="mt-10 flex items-center gap-4">
                  <div className="h-px flex-1 bg-text-primary max-w-[60px]" />
                  <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
                    {t("heroScrollLabel")}
                  </p>
                </div>
              </div>
            </div>
            <div className="lg:col-span-6 relative min-h-[400px] lg:min-h-0 bg-bg-tertiary">
              <Image
                src={`${IMG}/facade.jpg`}
                alt={t("heroImageAlt")}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
                priority
              />
              <div className="absolute bottom-6 right-6 bg-bg-primary/95 backdrop-blur rounded-full px-4 py-2 border border-border shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted">
                  {t("heroBadge")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 2 · NOTRE APPROCHE */}
        <section className="bg-bg-primary border-y border-border">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6 text-center">
              {t("approcheEyebrow")}
            </p>
            <p
              className="font-heading font-extrabold text-text-primary text-center tracking-tight leading-[0.95]"
              style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
            >
              {t("approcheTitle1")}
              <br />
              <span className="italic font-light">{t("approcheTitleItalic")}</span>
            </p>
            <div className="mt-16 grid md:grid-cols-3 gap-10 text-left">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— 01</p>
                <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">
                  {t("approche1Title")}
                </h3>
                <p className="text-text-secondary text-[15px] leading-relaxed font-body">
                  {t("approche1Body")}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— 02</p>
                <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">
                  {t("approche2Title")}
                </h3>
                <p className="text-text-secondary text-[15px] leading-relaxed font-body">
                  {t("approche2Body")}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— 03</p>
                <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">
                  {t("approche3Title")}
                </h3>
                <p className="text-text-secondary text-[15px] leading-relaxed font-body">
                  {t("approche3Body")}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 3 · CHIFFRES éditoriaux (fond sombre) */}
        <section className="bg-bg-dark text-text-inverse">
          <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-16 text-center">
              {t("chiffresEyebrow")}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24">
              <BigStat value={productCountFmt} label={t("chiffresRefLabel")} sub={t("chiffresRefSub")} />
              <BigStat value={t("chiffresNewValue")} label={t("chiffresNewLabel")} sub={t("chiffresNewSub")} />
              <BigStat value={t("chiffresExpValue")} suffix={t("chiffresExpSuffix")} label={t("chiffresExpLabel")} sub={t("chiffresExpSub")} />
              <BigStat value={t("chiffresYearsValue")} suffix={t("chiffresYearsSuffix")} label={t("chiffresYearsLabel")} sub={t("chiffresYearsSub")} />
            </div>
          </div>
        </section>

        {/* 4 · LA MAISON — photo intérieur + texte */}
        <section className="bg-bg-primary">
          <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12 gap-0">
            <div className="lg:col-span-6 relative min-h-[500px] bg-bg-tertiary">
              <Image
                src={`${IMG}/boutique-vue-ensemble.jpg`}
                alt={t("maisonImageAlt")}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
            <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-32 flex items-center">
              <div className="max-w-xl">
                <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                  {t("maisonEyebrow")}
                </p>
                <h2
                  className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
                >
                  {t("maisonTitle1")}
                  <br />
                  <span className="italic font-light">{t("maisonTitleItalic")}</span>
                </h2>
                <p className="mt-8 text-text-secondary leading-relaxed font-body">
                  {t("maisonP1")}
                </p>
                <p className="mt-4 text-text-secondary leading-relaxed font-body">
                  {t("maisonP2")}
                </p>
                <div className="mt-10 flex items-center gap-4">
                  <div className="h-px w-10 bg-text-primary" />
                  <p className="text-text-muted text-xs uppercase tracking-[0.3em]">
                    {t("maisonAddress")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5 · MOSAÏQUE "Dans les allées" */}
        <section className="bg-bg-secondary border-y border-border">
          <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-20 lg:py-28">
            <div className="flex items-end justify-between mb-10 lg:mb-14">
              <div>
                <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-3">
                  {t("alleesEyebrow")}
                </p>
                <h2
                  className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
                >
                  {t("alleesTitle")}
                </h2>
              </div>
              <p className="hidden md:block text-text-muted text-xs uppercase tracking-[0.2em]">
                {t("alleesInfo", { count: productCountFmt })}
              </p>
            </div>
            <div className="grid grid-cols-6 grid-rows-3 gap-3 md:gap-4 h-[520px] md:h-[640px]">
              <MosaicPhoto src={`${IMG}/allee-centrale.jpg`} alt={t("alleesAlt1")} className="col-span-4 row-span-2" />
              <MosaicPhoto src={`${IMG}/vitrine-bijoux.jpg`} alt={t("alleesAlt2")} className="col-span-2 row-span-1" />
              <MosaicPhoto src={`${IMG}/allee-laterale.jpg`} alt={t("alleesAlt3")} className="col-span-2 row-span-2" />
              <MosaicPhoto src={`${IMG}/bagues-acier.jpg`} alt={t("alleesAlt4")} className="col-span-2 row-span-1" />
              <MosaicPhoto src={`${IMG}/allee-vers-entree.jpg`} alt={t("alleesAlt5")} className="col-span-2 row-span-1" />
            </div>
          </div>
        </section>

        {/* 6 · L'ARRIÈRE-BOUTIQUE */}
        <section className="bg-bg-primary">
          <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <div className="max-w-2xl mb-14 lg:mb-20">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">
                {t("arriereEyebrow")}
              </p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                {t("arriereTitle1")}
                <br />
                <span className="italic font-light">{t("arriereTitleItalic")}</span>
              </h2>
              <p className="mt-6 text-text-secondary leading-relaxed max-w-xl font-body">
                {t("arriereBody")}
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3 md:gap-6">
              <div className="rounded-2xl overflow-hidden bg-bg-tertiary aspect-[4/5] md:aspect-[3/4] relative">
                <Image src={`${IMG}/reserve-1.jpg`} alt={t("arriereAlt1")} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
              </div>
              <div className="rounded-2xl overflow-hidden bg-bg-tertiary aspect-[4/5] md:aspect-[3/4] relative">
                <Image src={`${IMG}/reserve-2.jpg`} alt={t("arriereAlt2")} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
              </div>
            </div>
            <div className="mt-10 flex flex-wrap gap-10 pt-10 border-t border-border">
              <SmallStat value={productCountFmt} label={t("arriereStat1Label")} />
              <SmallStat value={t("arriereStat2Value")} label={t("arriereStat2Label")} />
              <SmallStat value={t("arriereStat3Value")} label={t("arriereStat3Label")} />
            </div>
          </div>
        </section>

        {/* 7 · GUIDE MATIÈRES (SEO éditorial long format) */}
        <section id="guide-matieres" className="bg-bg-secondary border-y border-border">
          <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <header className="max-w-3xl mx-auto text-center mb-16">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">{t("guideEyebrow")}</p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.5rem)", letterSpacing: "-0.03em" }}
              >
                {t("guideTitle1")} <span className="italic font-light">{t("guideTitleItalic")}</span>
              </h2>
              <p className="mt-8 text-text-secondary text-lg leading-relaxed font-body">
                {t.rich("guideIntro", { strong })}
              </p>
              <p className="mt-4 text-text-muted text-sm font-body">{t("guideReadingTime")}</p>
            </header>

            {/* Sommaire ancré */}
            <aside className="max-w-3xl mx-auto bg-bg-primary border border-border rounded-2xl p-6 lg:p-8 mb-16">
              <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-4">{t("guideTocTitle")}</p>
              <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-text-secondary text-sm font-body">
                <TocItem n="01" href="#inox" label={t("guideToc01")} />
                <TocItem n="02" href="#acier-304" label={t("guideToc02")} />
                <TocItem n="03" href="#pvd" label={t("guideToc03")} />
                <TocItem n="04" href="#carats" label={t("guideToc04")} />
                <TocItem n="05" href="#autres" label={t("guideToc05")} />
                <TocItem n="06" href="#choix" label={t("guideToc06")} />
                <TocItem n="07" href="#entretien" label={t("guideToc07")} />
                <TocItem n="08" href="#faq-matieres" label={t("guideToc08")} />
              </ol>
            </aside>

            <article className="max-w-3xl mx-auto space-y-16 text-text-secondary text-[17px] leading-[1.75] font-body">
              <GuideSection id="inox" n="01" title={t("inoxTitle")}>
                <p>{t.rich("inoxP1", { strong })}</p>
                <p className="mt-4">{t.rich("inoxP2", { strong })}</p>
                <p className="mt-4">{t.rich("inoxP3", { strong })}</p>
              </GuideSection>

              <GuideSection id="acier-304" n="02" title={t("acier304Title")}>
                <p>{t.rich("acier304P1", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("acier304H1")}</h4>
                <p>{t.rich("acier304P2", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("acier304H2")}</h4>
                <p>{t("acier304P3")}</p>
                <div className="bg-bg-primary border border-border rounded-2xl p-6 mt-8">
                  <p className="text-text-muted text-xs uppercase tracking-[0.2em] mb-3">{t("acier304RetainTitle")}</p>
                  <ul className="space-y-2 text-[15px]">
                    <RetainItem>{t.rich("acier304Retain1", { strong })}</RetainItem>
                    <RetainItem>{t("acier304Retain2")}</RetainItem>
                    <RetainItem>{t.rich("acier304Retain3", { strong })}</RetainItem>
                  </ul>
                </div>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">{t("acier304H3")}</h4>
                <p>{t.rich("acier304P4", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">{t("acier304H4")}</h4>
                <p>{t.rich("acier304P5", { strong })}</p>
              </GuideSection>

              <GuideSection id="pvd" n="03" title={t("pvdTitle")}>
                <p>{t.rich("pvdP1", { strong, em: emTag })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">{t("pvdH1")}</h4>
                <p>{t.rich("pvdP2", { strong })}</p>
                <div className="overflow-x-auto mt-6">
                  <table className="w-full text-[15px] border-collapse">
                    <thead>
                      <tr className="border-y-2 border-text-primary">
                        <th className="text-left py-3 pr-4 font-heading font-semibold text-text-primary">{t("pvdTableCriterion")}</th>
                        <th className="text-left py-3 px-4 font-heading font-semibold text-text-primary">{t("pvdTableGalvanic")}</th>
                        <th className="text-left py-3 pl-4 font-heading font-semibold text-text-primary">{t("pvdTablePvd")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <PvdRow label={t("pvdRow1Label")} galv={t("pvdRow1Galv")} pvd={t("pvdRow1Pvd")} />
                      <PvdRow label={t("pvdRow2Label")} galv={t("pvdRow2Galv")} pvd={t.rich("pvdRow2Pvd", { strong })} />
                      <PvdRow label={t("pvdRow3Label")} galv={t("pvdRow3Galv")} pvd={t.rich("pvdRow3Pvd", { strong })} />
                      <PvdRow label={t("pvdRow4Label")} galv={t("pvdRow4Galv")} pvd={t("pvdRow4Pvd")} />
                      <PvdRow label={t("pvdRow5Label")} galv={t("pvdRow5Galv")} pvd={t("pvdRow5Pvd")} />
                      <PvdRow label={t("pvdRow6Label")} galv={t("pvdRow6Galv")} pvd={t("pvdRow6Pvd")} />
                    </tbody>
                  </table>
                </div>
                <p className="mt-6">{t.rich("pvdP3", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">{t("pvdH2")}</h4>
                <p>{t.rich("pvdP4", { strong })}</p>
                <p className="mt-4">{t.rich("pvdP5", { strong })}</p>
              </GuideSection>

              <GuideSection id="carats" n="04" title={t("caratsTitle")}>
                <p>{t.rich("caratsP1", { strong })}</p>
                <div className="overflow-x-auto mt-6">
                  <table className="w-full text-[15px] border-collapse">
                    <thead>
                      <tr className="border-y-2 border-text-primary">
                        <th className="text-left py-3 pr-4 font-heading font-semibold text-text-primary">{t("caratsTableCarat")}</th>
                        <th className="text-left py-3 px-4 font-heading font-semibold text-text-primary">{t("caratsTablePct")}</th>
                        <th className="text-left py-3 pl-4 font-heading font-semibold text-text-primary">{t("caratsTableUsage")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <CaratRow k={t("caratsRow1K")} pct={t("caratsRow1Pct")} usage={t("caratsRow1Usage")} />
                      <CaratRow k={t("caratsRow2K")} pct={t("caratsRow2Pct")} usage={t("caratsRow2Usage")} />
                      <CaratRow k={t("caratsRow3K")} pct={t("caratsRow3Pct")} usage={t("caratsRow3Usage")} />
                      <CaratRow k={t("caratsRow4K")} pct={t.rich("caratsRow4Pct", { strong })} usage={t.rich("caratsRow4Usage", { strong })} highlight />
                      <CaratRow k={t("caratsRow5K")} pct={t("caratsRow5Pct")} usage={t("caratsRow5Usage")} />
                    </tbody>
                  </table>
                </div>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">{t("caratsH1")}</h4>
                <p>{t.rich("caratsP2", { strong })}</p>
                <p className="mt-4">{t.rich("caratsP3", { strong })}</p>
              </GuideSection>

              <GuideSection id="autres" n="05" title={t("autresTitle")}>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("autresLaitonTitle")}</h4>
                <p>{t.rich("autresLaitonBody", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("autresZamakTitle")}</h4>
                <p>{t.rich("autresZamakBody", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("autresArgentTitle")}</h4>
                <p>{t.rich("autresArgentBody", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("autresVermeilTitle")}</h4>
                <p>{t.rich("autresVermeilBody", { strong })}</p>
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">{t("autresOrMassifTitle")}</h4>
                <p>{t("autresOrMassifBody")}</p>
              </GuideSection>

              <GuideSection id="choix" n="06" title={t("choixTitle")}>
                <p>{t.rich("choixIntro", { strong })}</p>
                <div className="grid md:grid-cols-3 gap-5 mt-8">
                  <ChoixCard n="01" title={t("choix1Title")} body={t("choix1Body")} />
                  <ChoixCard n="02" title={t("choix2Title")} body={t("choix2Body")} />
                  <ChoixCard n="03" title={t("choix3Title")} body={t("choix3Body")} />
                </div>
                <p className="mt-8">{t.rich("choixConclusion1", { strong })}</p>
                <p className="mt-4">{t.rich("choixConclusion2", { strong })}</p>
              </GuideSection>

              <GuideSection id="entretien" n="07" title={t("entretienTitle")}>
                <p>{t.rich("entretienIntro", { strong })}</p>
                <div className="space-y-4 mt-8">
                  <EntretienRow n={t("entretien1N")} title={t("entretien1Title")} body={t("entretien1Body")} />
                  <EntretienRow n={t("entretien2N")} title={t("entretien2Title")} body={t.rich("entretien2Body", { em: emTag })} />
                  <EntretienRow n={t("entretien3N")} title={t("entretien3Title")} body={t("entretien3Body")} />
                  <EntretienRow n={t("entretien4N")} title={t("entretien4Title")} body={t.rich("entretien4Body", { strong })} />
                </div>
              </GuideSection>

              <GuideSection id="faq-matieres" n="08" title={t("faqMatieresTitle")}>
                <div className="divide-y divide-border border-y border-border bg-bg-primary rounded-2xl overflow-hidden mt-6">
                  <GuideFaq q={t("faqMatieres1Q")}>{t("faqMatieres1A")}</GuideFaq>
                  <GuideFaq q={t("faqMatieres2Q")}>{t("faqMatieres2A")}</GuideFaq>
                  <GuideFaq q={t("faqMatieres3Q")}>{t("faqMatieres3A")}</GuideFaq>
                  <GuideFaq q={t("faqMatieres4Q")}>{t("faqMatieres4A")}</GuideFaq>
                  <GuideFaq q={t("faqMatieres5Q")}>{t("faqMatieres5A")}</GuideFaq>
                  <GuideFaq q={t("faqMatieres6Q")}>{t("faqMatieres6A")}</GuideFaq>
                </div>
              </GuideSection>
            </article>

            {/* Encart conclusion */}
            <div className="max-w-3xl mx-auto mt-20 bg-bg-dark text-text-inverse rounded-3xl p-10 md:p-14 text-center">
              <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-4">{t("resumeEyebrow")}</p>
              <p
                className="font-heading font-extrabold text-text-inverse tracking-tight leading-[1.05]"
                style={{ fontSize: "clamp(1.5rem, 2.6vw, 2rem)", letterSpacing: "-0.03em" }}
              >
                {t.rich("resumeTitle", { italic })}
              </p>
              <Link
                href="/produits"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-white text-text-primary text-sm font-heading font-semibold px-6 py-3 hover:bg-white/90 transition"
              >
                {t("resumeCta")} <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* 8 · SHOWROOM — photo + bloc sombre adresse */}
        <section id="showroom" className="bg-bg-primary">
          <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
            <div className="lg:col-span-7 relative min-h-[500px] bg-bg-tertiary">
              <Image src={`${IMG}/allee-principale.jpg`} alt={t("showroomImageAlt")} fill sizes="(max-width: 1024px) 100vw, 58vw" className="object-cover" />
            </div>
            <div className="lg:col-span-5 bg-bg-dark text-text-inverse px-6 md:px-10 lg:px-16 py-20 lg:py-28 flex items-center">
              <div className="max-w-sm">
                <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6">{t("showroomEyebrow")}</p>
                <h2
                  className="font-heading font-extrabold text-text-inverse tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
                >
                  {t("showroomTitle")}
                </h2>
                <p className="mt-6 text-white/80 leading-relaxed font-body">{t("showroomBody")}</p>
                <dl className="mt-10 space-y-5 text-sm border-t border-white/20 pt-8 font-body">
                  <div>
                    <dt className="text-white/50 uppercase tracking-[0.2em] text-[10px] mb-1">{t("showroomAddressLabel")}</dt>
                    <dd>{t("showroomAddressValue")}</dd>
                  </div>
                  <div>
                    <dt className="text-white/50 uppercase tracking-[0.2em] text-[10px] mb-1">{t("showroomHoursLabel")}</dt>
                    <dd>
                      {t("showroomHoursWeek")}
                      <br />
                      {t("showroomHoursSat")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/50 uppercase tracking-[0.2em] text-[10px] mb-1">{t("showroomPhoneLabel")}</dt>
                    <dd>{t("showroomPhoneValue")}</dd>
                  </div>
                </dl>
                <div className="mt-10 flex flex-wrap gap-3">
                  <a
                    href="https://maps.google.com/?q=90+rue+de+la+Haie+Coq+93300+Aubervilliers"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-white text-text-primary text-sm font-heading font-semibold px-5 py-3 hover:bg-white/90"
                  >
                    {t("showroomCtaDirections")}
                  </a>
                  <a href="tel:0782758158" className="rounded-full border border-white/30 text-text-inverse text-sm font-heading font-semibold px-5 py-3 hover:bg-white/10">
                    {t("showroomCtaCall")}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 9 · FAQ pratique */}
        <section className="bg-bg-secondary border-y border-border">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-28 grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-4">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">{t("faqPratiqueEyebrow")}</p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                {t("faqPratiqueTitle")}
              </h2>
              <p className="mt-6 text-text-secondary leading-relaxed font-body">{t("faqPratiqueBody")}</p>
              <a href="tel:0782758158" className="mt-6 inline-flex items-center gap-2 text-text-primary font-heading font-semibold hover:underline">
                {t("faqPratiquePhone")}
              </a>
            </div>
            <div className="lg:col-span-8">
              <div className="divide-y divide-border border-y border-border bg-bg-primary">
                <PracticalFaq q={t("faqPratique1Q")}>{t("faqPratique1A")}</PracticalFaq>
                <PracticalFaq q={t("faqPratique2Q")}>{t("faqPratique2A")}</PracticalFaq>
                <PracticalFaq q={t("faqPratique3Q")}>{t("faqPratique3A")}</PracticalFaq>
                <PracticalFaq q={t("faqPratique4Q")}>{t("faqPratique4A")}</PracticalFaq>
              </div>
            </div>
          </div>
        </section>

        {/* 10 · CTA FINAL */}
        <section id="cta" className="bg-bg-primary">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center">
            <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">{t("ctaEyebrow")}</p>
            <h2
              className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
              style={{ fontSize: "clamp(2.5rem, 5.5vw, 4.5rem)", letterSpacing: "-0.03em" }}
            >
              {t("ctaTitle1")}
              <br className="hidden md:block" /> {t("ctaTitle2")}
            </h2>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/inscription"
                className="inline-flex items-center gap-2 rounded-full bg-bg-dark text-text-inverse text-sm font-heading font-semibold px-7 py-4 hover:opacity-90 transition"
              >
                {t("ctaRegister")} <span aria-hidden>→</span>
              </Link>
              <a
                href="#showroom"
                className="inline-flex items-center gap-2 rounded-full border border-border text-text-primary text-sm font-heading font-semibold px-7 py-4 hover:bg-bg-secondary transition"
              >
                {t("ctaShowroom")}
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer shopName={shopName} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Sous-composants purement visuels
   ───────────────────────────────────────────────────────────────────────── */

function BigStat({
  value,
  suffix,
  label,
  sub,
}: {
  value: string;
  suffix?: string;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-baseline gap-6">
      <span
        className="font-heading font-extrabold text-text-inverse tracking-tight leading-[0.95]"
        style={{
          fontSize: "clamp(5rem, 10vw, 9rem)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.03em",
        }}
      >
        {value}
        {suffix && <span className="text-white/50 text-5xl ml-2">{suffix}</span>}
      </span>
      <div>
        <p className="font-heading font-semibold text-white text-base">{label}</p>
        <p className="text-white/60 text-sm font-body">{sub}</p>
      </div>
    </div>
  );
}

function SmallStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p
        className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
        style={{
          fontSize: "clamp(2.5rem, 4vw, 3.5rem)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </p>
      <p className="text-text-muted text-xs uppercase tracking-[0.2em] mt-2 font-body">{label}</p>
    </div>
  );
}

function MosaicPhoto({ src, alt, className }: { src: string; alt: string; className: string }) {
  return (
    <div className={`${className} rounded-2xl overflow-hidden bg-bg-tertiary relative`}>
      <Image src={src} alt={alt} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" />
    </div>
  );
}

function TocItem({ n, href, label }: { n: string; href: string; label: string }) {
  return (
    <li>
      <a href={href} className="hover:text-text-primary hover:underline">
        <span className="text-text-muted">{n}</span> &nbsp;{label}
      </a>
    </li>
  );
}

function GuideSection({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— {n}</p>
      <h3 className="font-heading font-bold text-text-primary text-2xl md:text-3xl mb-6 tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

function RetainItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-text-primary">→</span>
      <span>{children}</span>
    </li>
  );
}

function PvdRow({
  label,
  galv,
  pvd,
}: {
  label: string;
  galv: React.ReactNode;
  pvd: React.ReactNode;
}) {
  return (
    <tr>
      <td className="py-3 pr-4 text-text-muted">{label}</td>
      <td className="py-3 px-4">{galv}</td>
      <td className="py-3 pl-4">{pvd}</td>
    </tr>
  );
}

function CaratRow({
  k,
  pct,
  usage,
  highlight,
}: {
  k: string;
  pct: React.ReactNode;
  usage: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <tr className={highlight ? "bg-bg-primary" : undefined}>
      <td className="py-3 pr-4">
        <strong className="text-text-primary">{k}</strong>
      </td>
      <td className="py-3 px-4">{pct}</td>
      <td className="py-3 pl-4">{usage}</td>
    </tr>
  );
}

function ChoixCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-6">
      <p
        className="font-heading font-extrabold text-text-primary leading-[0.95]"
        style={{ fontSize: "2.5rem", letterSpacing: "-0.03em" }}
      >
        {n}
      </p>
      <h4 className="font-heading font-semibold text-text-primary text-base mt-3">{title}</h4>
      <p className="mt-2 text-[15px] font-body text-text-secondary">{body}</p>
    </div>
  );
}

function EntretienRow({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 bg-bg-primary border border-border rounded-xl p-5">
      <span className="text-text-primary font-heading font-bold text-xl shrink-0">{n}</span>
      <div>
        <p className="font-heading font-semibold text-text-primary">{title}</p>
        <p className="text-[15px] mt-1 font-body text-text-secondary">{body}</p>
      </div>
    </div>
  );
}

function GuideFaq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="list-none cursor-pointer p-5 flex items-center justify-between hover:bg-bg-secondary">
        <span className="font-heading font-semibold text-text-primary">{q}</span>
        <svg className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-5 pb-5 text-[15px] font-body text-text-secondary">{children}</div>
    </details>
  );
}

function PracticalFaq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="list-none cursor-pointer p-6 flex items-center justify-between hover:bg-bg-secondary">
        <span className="font-heading font-semibold text-text-primary text-lg">{q}</span>
        <svg className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-6 pb-6 text-text-secondary leading-relaxed font-body">{children}</div>
    </details>
  );
}
