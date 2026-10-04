import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { getCachedShopName, getCachedProductCount } from "@/lib/cached-data";
import { getCurrentTenantId } from "@/lib/tenant";
import { getEffectiveTenantSlug } from "@/lib/tenant-preview";
import { buildAlternates } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
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
    const alternates = await buildAlternates("/qui-sommes-nous", locale);
    return {
      title: "Qui sommes-nous — Beli & Jolie",
      description:
        "Beli & Jolie : grossiste en bijoux fantaisie en acier inoxydable 304 avec placage PVD or 14 carats. Boutique et réserve à Aubervilliers. Guide complet des matières, du PVD et du placage or.",
      alternates,
    };
  }

  if (slug === "issyma") {
    const alternates = await buildAlternates("/qui-sommes-nous", locale);
    return {
      title: "Qui sommes-nous — ISSYMA · FORCYMA",
      description:
        "ISSYMA — FORCYMA, grossiste en prêt-à-porter féminin au CIFA d'Aubervilliers. Collections tendance, vente à l'unité, préparation 24-48 h, expédition France & Europe. Compte professionnel gratuit.",
      alternates,
    };
  }

  return {};
}

export default async function QuiSommesNousPage() {
  await getCurrentTenantId();
  const tenantSlug = await getEffectiveTenantSlug();

  if (tenantSlug === "issyma") {
    const shopName = await getCachedShopName();
    return (
      <div className="min-h-screen bg-bg-primary relative">
        <PublicSidebar shopName={shopName} tenantSlug={tenantSlug} />
        <IssymaContent />
        <Footer shopName={shopName} />
      </div>
    );
  }

  if (tenantSlug !== "beliandjolie") notFound();

  const [shopName, productCount] = await Promise.all([
    getCachedShopName(),
    getCachedProductCount(),
  ]);
  // Formatage à la française : 2500 → "2 500" (espace fine insécable).
  const productCountFmt = new Intl.NumberFormat("fr-FR").format(productCount);
  const IMG = "/uploads/beliandjolie/qui-sommes-nous";

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
                  La maison
                </p>
                <h1
                  className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2.75rem, 6vw, 5.5rem)", letterSpacing: "-0.03em" }}
                >
                  Grossiste
                  <br />
                  en bijoux
                  <br />
                  <span className="italic font-light">fantaisie.</span>
                </h1>
                <p className="mt-8 text-text-secondary text-lg leading-relaxed max-w-md font-body">
                  Fournisseur de bijoux fantaisie en{" "}
                  <strong className="text-text-primary font-semibold">
                    acier inoxydable 304 avec placage PVD or 14 carats
                  </strong>
                  . Boutique et réserve à Aubervilliers.
                </p>
                <div className="mt-10 flex items-center gap-4">
                  <div className="h-px flex-1 bg-text-primary max-w-[60px]" />
                  <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
                    Suivez le fil
                  </p>
                </div>
              </div>
            </div>
            <div className="lg:col-span-6 relative min-h-[400px] lg:min-h-0 bg-bg-tertiary">
              <Image
                src={`${IMG}/facade.jpg`}
                alt="Façade de la boutique Beli & Jolie à Aubervilliers"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
                priority
              />
              <div className="absolute bottom-6 right-6 bg-bg-primary/95 backdrop-blur rounded-full px-4 py-2 border border-border shadow-sm">
                <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted">
                  Aubervilliers · depuis 2022
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 2 · NOTRE APPROCHE */}
        <section className="bg-bg-primary border-y border-border">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6 text-center">
              Notre approche
            </p>
            <p
              className="font-heading font-extrabold text-text-primary text-center tracking-tight leading-[0.95]"
              style={{ fontSize: "clamp(1.75rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
            >
              Un catalogue clair, des prix affichés,
              <br />
              <span className="italic font-light">
                et un vrai contact quand vous avez besoin de nous.
              </span>
            </p>
            <div className="mt-16 grid md:grid-cols-3 gap-10 text-left">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— 01</p>
                <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">
                  Stock disponible immédiatement
                </h3>
                <p className="text-text-secondary text-[15px] leading-relaxed font-body">
                  Tout ce qui est en ligne est physiquement en réserve, à Aubervilliers. Commandé
                  avant 15 h, expédié le lendemain.
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— 02</p>
                <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">
                  Prix grossiste affichés
                </h3>
                <p className="text-text-secondary text-[15px] leading-relaxed font-body">
                  Dès la création de votre compte pro, vous accédez à l&apos;ensemble des tarifs.
                  Pas de demande de devis, pas de palier caché.
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">— 03</p>
                <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">
                  Contact direct
                </h3>
                <p className="text-text-secondary text-[15px] leading-relaxed font-body">
                  Un numéro de téléphone pour nous joindre. Si on ne décroche pas sur le moment,
                  on vous rappelle dans la journée.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 3 · CHIFFRES éditoriaux (fond sombre) */}
        <section className="bg-bg-dark text-text-inverse">
          <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-16 text-center">
              La maison en chiffres
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24">
              <BigStat value={productCountFmt} label="références" sub="en stock permanent" />
              <BigStat value="120" label="nouveautés" sub="arrivent chaque mois" />
              <BigStat value="24" suffix="h" label="expédition" sub="commande avant 15 h" />
              <BigStat value="3" suffix="ans" label="au service" sub="des boutiques pros" />
            </div>
          </div>
        </section>

        {/* 4 · LA MAISON — photo intérieur + texte */}
        <section className="bg-bg-primary">
          <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12 gap-0">
            <div className="lg:col-span-6 relative min-h-[500px] bg-bg-tertiary">
              <Image
                src={`${IMG}/boutique-vue-ensemble.jpg`}
                alt="Intérieur de la boutique Beli & Jolie, vue d'ensemble"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </div>
            <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-32 flex items-center">
              <div className="max-w-xl">
                <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                  La maison
                </p>
                <h2
                  className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
                >
                  Une adresse à Aubervilliers.
                  <br />
                  <span className="italic font-light">Pas un entrepôt.</span>
                </h2>
                <p className="mt-8 text-text-secondary leading-relaxed font-body">
                  Au cœur du quartier du textile, notre boutique accueille acheteuses pros et
                  commerçantes de passage. Chaque référence du catalogue en ligne est exposée en
                  permanence, prête à être touchée, essayée, comparée.
                </p>
                <p className="mt-4 text-text-secondary leading-relaxed font-body">
                  Vous venez une heure, vous repartez avec votre sélection le jour même — ou vous
                  nous laissez l&apos;envoyer en 24 h.
                </p>
                <div className="mt-10 flex items-center gap-4">
                  <div className="h-px w-10 bg-text-primary" />
                  <p className="text-text-muted text-xs uppercase tracking-[0.3em]">
                    90 rue de la Haie Coq · 93300
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
                  Reportage
                </p>
                <h2
                  className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
                >
                  Dans les allées.
                </h2>
              </div>
              <p className="hidden md:block text-text-muted text-xs uppercase tracking-[0.2em]">
                250 m² · {productCountFmt} références
              </p>
            </div>
            <div className="grid grid-cols-6 grid-rows-3 gap-3 md:gap-4 h-[520px] md:h-[640px]">
              <MosaicPhoto
                src={`${IMG}/allee-centrale.jpg`}
                alt="Allée centrale de la boutique"
                className="col-span-4 row-span-2"
              />
              <MosaicPhoto
                src={`${IMG}/vitrine-bijoux.jpg`}
                alt="Vitrine de bijoux dorés"
                className="col-span-2 row-span-1"
              />
              <MosaicPhoto
                src={`${IMG}/allee-laterale.jpg`}
                alt="Allée latérale avec étagères"
                className="col-span-2 row-span-2"
              />
              <MosaicPhoto
                src={`${IMG}/bagues-acier.jpg`}
                alt="Présentoir de bagues en acier inoxydable"
                className="col-span-2 row-span-1"
              />
              <MosaicPhoto
                src={`${IMG}/allee-vers-entree.jpg`}
                alt="Vue vers l'entrée de la boutique"
                className="col-span-2 row-span-1"
              />
            </div>
          </div>
        </section>

        {/* 6 · L'ARRIÈRE-BOUTIQUE */}
        <section className="bg-bg-primary">
          <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <div className="max-w-2xl mb-14 lg:mb-20">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">
                L&apos;arrière-boutique
              </p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                Ce que vous ne verrez pas en magasin.
                <br />
                <span className="italic font-light">Mais qui part chez vous.</span>
              </h2>
              <p className="mt-6 text-text-secondary leading-relaxed max-w-xl font-body">
                Derrière le rideau, notre réserve. Deux allées d&apos;étagères compartimentées,
                chaque pochette identifiée, chaque référence prête à être prélevée. C&apos;est ce
                qui permet d&apos;expédier avant le lendemain soir, même sur les gros volumes.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-3 md:gap-6">
              <div className="rounded-2xl overflow-hidden bg-bg-tertiary aspect-[4/5] md:aspect-[3/4] relative">
                <Image
                  src={`${IMG}/reserve-1.jpg`}
                  alt="Vue de la réserve, allée d'étagères compartimentées"
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
              <div className="rounded-2xl overflow-hidden bg-bg-tertiary aspect-[4/5] md:aspect-[3/4] relative">
                <Image
                  src={`${IMG}/reserve-2.jpg`}
                  alt="Réserve de stock, pochettes identifiées"
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                />
              </div>
            </div>
            <div className="mt-10 flex flex-wrap gap-10 pt-10 border-t border-border">
              <SmallStat value={productCountFmt} label="références identifiées" />
              <SmallStat value="24 h" label="de la commande au colis" />
              <SmallStat value="0" label="intermédiaire, 0 dropshipping" />
            </div>
          </div>
        </section>

        {/* 7 · GUIDE MATIÈRES (SEO éditorial long format) */}
        <section id="guide-matieres" className="bg-bg-secondary border-y border-border">
          <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-24 lg:py-32">
            <header className="max-w-3xl mx-auto text-center mb-16">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">Guide</p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.5rem)", letterSpacing: "-0.03em" }}
              >
                Nos matières, <span className="italic font-light">décryptées.</span>
              </h2>
              <p className="mt-8 text-text-secondary text-lg leading-relaxed font-body">
                Tous les bijoux Beli &amp; Jolie sont en{" "}
                <strong className="text-text-primary font-semibold">
                  acier inoxydable 304 avec placage PVD or 14 carats
                </strong>
                . Si cette ligne ne vous dit pas grand-chose, cet article est fait pour vous. On
                vous explique ce que ça veut dire, pourquoi on a choisi cette technologie, et
                comment elle se compare aux autres matières du marché.
              </p>
              <p className="mt-4 text-text-muted text-sm font-body">
                Temps de lecture : 7 minutes · Mis à jour en 2026
              </p>
            </header>

            {/* Sommaire ancré */}
            <aside className="max-w-3xl mx-auto bg-bg-primary border border-border rounded-2xl p-6 lg:p-8 mb-16">
              <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-4">
                Dans cet article
              </p>
              <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-text-secondary text-sm font-body">
                <TocItem n="01" href="#inox" label="L'acier inoxydable, c'est quoi ?" />
                <TocItem n="02" href="#acier-304" label="L'acier 304 : la référence" />
                <TocItem n="03" href="#pvd" label="Le placage PVD, la technologie clé" />
                <TocItem n="04" href="#carats" label="9K, 14K, 18K, 24K : les carats" />
                <TocItem n="05" href="#autres" label="Laiton, argent, titane, vermeil" />
                <TocItem n="06" href="#choix" label="Pourquoi 304 + PVD 14K ?" />
                <TocItem n="07" href="#entretien" label="Entretien de vos bijoux" />
                <TocItem n="08" href="#faq-matieres" label="Questions fréquentes" />
              </ol>
            </aside>

            <article className="max-w-3xl mx-auto space-y-16 text-text-secondary text-[17px] leading-[1.75] font-body">
              <GuideSection
                id="inox"
                n="01"
                title="L'acier inoxydable, c'est quoi exactement ?"
              >
                <p>
                  L&apos;<strong className="text-text-primary">acier inoxydable</strong> (ou «
                  inox ») est un alliage composé de fer, de chrome (minimum 10,5 %) et de carbone.
                  Le chrome crée en surface une fine couche d&apos;oxyde invisible qui empêche le
                  métal de rouiller — même en présence d&apos;eau, de transpiration ou de produits
                  ménagers.
                </p>
                <p className="mt-4">
                  Pour la bijouterie, cette propriété change tout : contrairement au laiton ou au
                  cuivre, un bijou en acier inox{" "}
                  <strong className="text-text-primary">
                    ne noircit pas sur la peau, ne tache pas les vêtements et ne provoque pas
                    d&apos;allergies au nickel
                  </strong>{" "}
                  (dans ses qualités les plus pures).
                </p>
                <p className="mt-4">
                  Il existe plusieurs centaines de nuances d&apos;acier inoxydable, chacune
                  optimisée pour un usage précis. Celle qui s&apos;est imposée en bijouterie
                  fantaisie, c&apos;est le <strong className="text-text-primary">304</strong>.
                </p>
              </GuideSection>

              <GuideSection
                id="acier-304"
                n="02"
                title="L'acier 304 : la référence en bijouterie"
              >
                <p>
                  L&apos;<strong className="text-text-primary">acier inoxydable 304</strong> est
                  la nuance d&apos;acier la plus utilisée en bijouterie fantaisie, et plus
                  largement dans toutes les industries exigeantes : alimentaire, cuisine
                  professionnelle, matériel médical. Composé de 18 % de chrome et 8 % de nickel,
                  il offre une excellente résistance à l&apos;oxydation, se travaille finement
                  (gravure, polissage, formes complexes) et accepte parfaitement les traitements
                  de surface comme le PVD.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  Un acier compatible avec toutes les peaux
                </h4>
                <p>
                  Le nickel contenu dans le 304 est présent sous{" "}
                  <strong className="text-text-primary">
                    forme stable, encapsulée dans la matrice métallique
                  </strong>
                  . Il est compatible avec la très grande majorité des peaux. Et dès qu&apos;un
                  bijou est plaqué (comme c&apos;est systématiquement le cas chez nous), le
                  placage isole totalement la peau du substrat : il n&apos;y a plus de contact
                  direct avec l&apos;acier.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  Résistance et longévité
                </h4>
                <p>
                  Le 304 résiste très bien à l&apos;eau, à l&apos;humidité, aux produits ménagers
                  et à la transpiration normale. Dans le cadre d&apos;un bijou plaqué PVD, c&apos;est
                  le substrat idéal : stable chimiquement, facile à finir, et compatible avec un
                  placage haute qualité qui prolonge largement la durée de vie du bijou.
                </p>

                <div className="bg-bg-primary border border-border rounded-2xl p-6 mt-8">
                  <p className="text-text-muted text-xs uppercase tracking-[0.2em] mb-3">
                    À retenir
                  </p>
                  <ul className="space-y-2 text-[15px]">
                    <RetainItem>
                      Le <strong className="text-text-primary">304</strong> est l&apos;acier le
                      plus utilisé en bijouterie fantaisie dans le monde.
                    </RetainItem>
                    <RetainItem>
                      Compatible avec la très grande majorité des peaux, y compris sensibles.
                    </RetainItem>
                    <RetainItem>
                      Combiné à un{" "}
                      <strong className="text-text-primary">placage PVD de qualité</strong>, il
                      offre une longévité remarquable (voir section suivante).
                    </RetainItem>
                  </ul>
                </div>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">
                  Et les autres aciers ?
                </h4>
                <p>
                  On croise parfois les termes « acier 316 » ou « acier chirurgical ». Il
                  s&apos;agit d&apos;autres nuances d&apos;acier inoxydable, utilisées
                  historiquement pour des applications très spécifiques (industrie marine,
                  médical). En bijouterie fantaisie, ces appellations sont souvent mises en avant
                  comme argument marketing — mais dans l&apos;usage quotidien d&apos;un bijou
                  plaqué, la différence pour la cliente est{" "}
                  <strong className="text-text-primary">imperceptible</strong>. Ce qui fait
                  vraiment la différence sur la durée de vie, c&apos;est la qualité du placage.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">
                  Et le titane ?
                </h4>
                <p>
                  Le titane est plus léger et quasiment incassable. Il est principalement utilisé
                  en piercing médical et en lunetterie haut de gamme. En bijouterie fantaisie, il
                  reste rare car il est{" "}
                  <strong className="text-text-primary">difficile à travailler finement</strong>{" "}
                  (gravure, moulage) et son prix de matière première est bien plus élevé. On en
                  trouve surtout sur des bracelets homme et des alliances.
                </p>
              </GuideSection>

              <GuideSection
                id="pvd"
                n="03"
                title="Le placage PVD — la vraie différence avec le reste du marché"
              >
                <p>
                  <strong className="text-text-primary">PVD</strong> signifie{" "}
                  <em>Physical Vapor Deposition</em> (dépôt physique en phase vapeur). C&apos;est
                  une technologie de placage sous vide, à haute température (environ 400 °C), qui
                  vaporise des atomes d&apos;or (ou d&apos;autres métaux) et les projette sur la
                  surface du bijou. Le dépôt est si fin qu&apos;il se mesure en microns, mais si
                  dense qu&apos;il devient{" "}
                  <strong className="text-text-primary">quasi-moléculairement lié</strong> au
                  support.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">
                  PVD vs. placage électrolytique (galvanique)
                </h4>
                <p>
                  Le placage traditionnel, dit{" "}
                  <strong className="text-text-primary">galvanique</strong> ou{" "}
                  <strong className="text-text-primary">électrolytique</strong>, trempe le bijou
                  dans un bain d&apos;or liquide traversé par un courant électrique. Simple,
                  rapide, bon marché — mais le dépôt reste superficiel et s&apos;use rapidement :
                </p>
                <div className="overflow-x-auto mt-6">
                  <table className="w-full text-[15px] border-collapse">
                    <thead>
                      <tr className="border-y-2 border-text-primary">
                        <th className="text-left py-3 pr-4 font-heading font-semibold text-text-primary">
                          Critère
                        </th>
                        <th className="text-left py-3 px-4 font-heading font-semibold text-text-primary">
                          Galvanique
                        </th>
                        <th className="text-left py-3 pl-4 font-heading font-semibold text-text-primary">
                          PVD
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <PvdRow label="Épaisseur" galv="0,5 — 3 microns" pvd="0,3 — 1 micron, mais ultra dense" />
                      <PvdRow
                        label="Durée de vie"
                        galv="6 mois à 2 ans"
                        pvd={<strong className="text-text-primary">3 à 10 ans</strong>}
                      />
                      <PvdRow
                        label="Résistance à l'usure"
                        galv="Faible"
                        pvd={<strong className="text-text-primary">4 à 8× supérieure</strong>}
                      />
                      <PvdRow label="Résistance à l'eau / mer" galv="Médiocre" pvd="Excellente" />
                      <PvdRow
                        label="Impact environnemental"
                        galv="Bains chimiques, eaux usées polluées"
                        pvd="Procédé sous vide, propre"
                      />
                      <PvdRow label="Coût de production" galv="Faible" pvd="2 à 3× plus cher" />
                    </tbody>
                  </table>
                </div>
                <p className="mt-6">
                  Concrètement : un bijou plaqué PVD porté quotidiennement garde son éclat{" "}
                  <strong className="text-text-primary">plusieurs années</strong>. Un bijou
                  galvanique, lui, montre ses premiers signes d&apos;usure au bout de quelques
                  mois (zones ternies sur les angles, le fermoir, les points de contact avec la
                  peau).
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">
                  Le PVD, c&apos;est aussi une protection pour l&apos;acier
                </h4>
                <p>
                  Un point rarement expliqué dans les fiches techniques :{" "}
                  <strong className="text-text-primary">
                    dès qu&apos;un acier est recouvert d&apos;un placage PVD de qualité, le
                    substrat n&apos;est plus en contact avec l&apos;extérieur
                  </strong>
                  . L&apos;eau chlorée, l&apos;eau de mer, la transpiration, les cosmétiques —
                  rien de tout cela ne touche l&apos;acier derrière le placage. Le PVD agit comme
                  une barrière physique étanche, un peu comme une peinture de protection sur une
                  carrosserie.
                </p>
                <p className="mt-4">
                  Résultat pratique :{" "}
                  <strong className="text-text-primary">
                    la qualité du placage PVD devient le vrai facteur de longévité
                  </strong>
                  . Épaisseur, uniformité, maîtrise du procédé — c&apos;est ce qui fait qu&apos;un
                  bijou garde son éclat 3, 5 ou 10 ans. C&apos;est sur cette qualité de placage
                  que nous avons concentré tous nos efforts d&apos;approvisionnement.
                </p>
              </GuideSection>

              <GuideSection
                id="carats"
                n="04"
                title="Les carats : pourquoi 14K, et pas 18K ou 24K ?"
              >
                <p>
                  Le <strong className="text-text-primary">carat</strong> (noté K ou kt, à ne pas
                  confondre avec le carat des pierres précieuses) mesure la pureté de l&apos;or.
                  L&apos;or pur fait 24 carats, soit 100 % d&apos;or. En-dessous, on parle
                  d&apos;un alliage : l&apos;or est mélangé avec d&apos;autres métaux (cuivre,
                  argent, palladium, zinc) pour le durcir et modifier sa couleur.
                </p>

                <div className="overflow-x-auto mt-6">
                  <table className="w-full text-[15px] border-collapse">
                    <thead>
                      <tr className="border-y-2 border-text-primary">
                        <th className="text-left py-3 pr-4 font-heading font-semibold text-text-primary">
                          Carat
                        </th>
                        <th className="text-left py-3 px-4 font-heading font-semibold text-text-primary">
                          % d&apos;or
                        </th>
                        <th className="text-left py-3 pl-4 font-heading font-semibold text-text-primary">
                          Usage courant
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      <CaratRow
                        k="24K"
                        pct="99,9 %"
                        usage="Lingots d'investissement. Trop mou pour la bijouterie portée."
                      />
                      <CaratRow
                        k="22K"
                        pct="91,6 %"
                        usage="Standard Asie, Moyen-Orient. Jaune très soutenu."
                      />
                      <CaratRow k="18K" pct="75 %" usage="Standard européen de la haute joaillerie." />
                      <CaratRow
                        k="14K"
                        pct={<strong className="text-text-primary">58,5 %</strong>}
                        usage={
                          <strong className="text-text-primary">
                            Standard US, Canada, nord Europe. Résistant, teinte équilibrée.
                          </strong>
                        }
                        highlight
                      />
                      <CaratRow
                        k="9K"
                        pct="37,5 %"
                        usage="Minimum légal pour l'appellation « or » en France. Teinte pâle."
                      />
                    </tbody>
                  </table>
                </div>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-10 mb-3">
                  Pourquoi le 14K pour un placage ?
                </h4>
                <p>
                  Pour un placage PVD, le carat ne mesure pas la quantité d&apos;or déposée mais{" "}
                  <strong className="text-text-primary">la teinte visuelle finale</strong>. Le PVD
                  14K reproduit la couleur or jaune du 14 carats : un jaune soutenu mais pas trop
                  vif, chaud mais pas rosé. C&apos;est l&apos;équilibre que recherchent 80 % des
                  acheteuses occidentales — ni trop « asiatique jaune pur », ni trop « rose gold ».
                </p>
                <p className="mt-4">
                  Le PVD 18K existe aussi (teinte plus pâle, légèrement verdâtre) et le PVD rose
                  gold (ajout de cuivre). Mais le 14K reste{" "}
                  <strong className="text-text-primary">
                    la teinte la plus universelle en bijouterie fantaisie
                  </strong>
                  .
                </p>
              </GuideSection>

              <GuideSection id="autres" n="05" title="Les autres matières que vous croiserez">
                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  Le laiton (plaqué or ou brut)
                </h4>
                <p>
                  Alliage de cuivre (60-70 %) et de zinc (30-40 %). C&apos;est la matière la plus
                  répandue en bijouterie fantaisie bas de gamme. Avantages : bon marché, facile à
                  travailler, se dore joliment. Inconvénients :{" "}
                  <strong className="text-text-primary">
                    noircit au contact de la peau
                  </strong>{" "}
                  (oxydation du cuivre),{" "}
                  <strong className="text-text-primary">
                    peut provoquer des allergies
                  </strong>{" "}
                  (chez 10 à 20 % de la population pour le cuivre), et le placage galvanique
                  s&apos;use en 6 à 18 mois. Si vous entendez « bijou plaqué or 3 microns »,
                  c&apos;est généralement du laiton galvanisé.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  Le zamak
                </h4>
                <p>
                  Alliage zinc-aluminium-magnésium-cuivre, utilisé pour les bijoux moulés très
                  fins (breloques détaillées, charms). Avantage : permet des formes impossibles
                  autrement. Inconvénient :{" "}
                  <strong className="text-text-primary">cassant, s&apos;oxyde rapidement</strong>,
                  de qualité très variable selon le fournisseur.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  L&apos;argent 925 (sterling)
                </h4>
                <p>
                  92,5 % d&apos;argent, 7,5 % de cuivre. Matière noble, hypoallergénique,
                  intemporelle. Son défaut : il{" "}
                  <strong className="text-text-primary">noircit (sulfuration)</strong> au contact
                  de l&apos;air et de la peau, demandant un polissage régulier. Son prix est 5 à
                  15× supérieur à l&apos;acier plaqué.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  Le vermeil
                </h4>
                <p>
                  Argent 925 recouvert d&apos;une couche d&apos;or d&apos;au moins{" "}
                  <strong className="text-text-primary">5 microns</strong>, obligatoire par la loi
                  française. Allie la noblesse de l&apos;argent et l&apos;éclat de l&apos;or.
                  Luxueux, mais fragile (l&apos;or étant mou, le vermeil se raye) et coûteux.
                </p>

                <h4 className="font-heading font-semibold text-text-primary text-lg mt-8 mb-3">
                  L&apos;or massif
                </h4>
                <p>
                  Bijouterie fine, prix élevés, revente possible chez un bijoutier. On distingue
                  l&apos;or jaune, blanc (allié avec palladium), rose (allié avec cuivre). Rare en
                  gros volumes, inaccessible pour la plupart des revendeuses fantaisie.
                </p>
              </GuideSection>

              <GuideSection
                id="choix"
                n="06"
                title="Pourquoi nous avons choisi l'acier 304 + PVD 14K"
              >
                <p>
                  Nous avons fait le choix de ne proposer qu&apos;une seule qualité : l&apos;
                  <strong className="text-text-primary">
                    acier inoxydable 304 avec placage PVD or 14 carats
                  </strong>
                  . Trois raisons :
                </p>

                <div className="grid md:grid-cols-3 gap-5 mt-8">
                  <ChoixCard
                    n="01"
                    title="Compatible avec toutes les peaux"
                    body="Le substrat acier est entièrement isolé par le placage PVD : aucun contact direct avec la peau, pas de réaction au nickel. Zéro retour SAV pour allergie depuis que nous avons basculé."
                  />
                  <ChoixCard
                    n="02"
                    title="Durable grâce au PVD"
                    body="Le placage PVD de qualité tient 3 à 10 ans sans s'écailler. Vos clientes reviennent pour de nouveaux modèles, pas pour des rachats forcés."
                  />
                  <ChoixCard
                    n="03"
                    title="Accessible"
                    body="Un prix de gros compatible avec les marges d'une boutique indépendante. Pas de ticket d'entrée joaillerie, pas de minimum absurde."
                  />
                </div>

                <p className="mt-8">
                  Notre priorité d&apos;approvisionnement, c&apos;est la{" "}
                  <strong className="text-text-primary">qualité du placage PVD</strong>{" "}
                  (épaisseur, uniformité, procédé). C&apos;est ce qui fait vraiment la différence
                  sur la durée de vie du bijou en vitrine comme au poignet de vos clientes.
                </p>
                <p className="mt-4">
                  Nous ne proposons <strong className="text-text-primary">pas</strong> d&apos;or
                  massif ni de vermeil, parce que ce n&apos;est pas notre cœur de cible. Nous
                  nous adressons à des revendeuses qui veulent un produit{" "}
                  <strong className="text-text-primary">
                    fiable, revendable, régulièrement renouvelé
                  </strong>
                  , pas une pièce d&apos;investissement.
                </p>
              </GuideSection>

              <GuideSection
                id="entretien"
                n="07"
                title="Entretien : les bons gestes à transmettre à vos clientes"
              >
                <p>
                  Un bijou en acier 304 + PVD 14K peut durer{" "}
                  <strong className="text-text-primary">10 ans ou plus</strong> si quelques règles
                  sont respectées. Voici celles que nous recommandons :
                </p>

                <div className="space-y-4 mt-8">
                  <EntretienRow
                    n="1."
                    title="À retirer avant"
                    body="Douche, piscine, mer, sauna, séance de sport. L'eau chlorée et la transpiration intense accélèrent l'usure du placage, même PVD."
                  />
                  <EntretienRow
                    n="2."
                    title="Toujours en dernier"
                    body={
                      <>
                        Mettre les bijoux <em>après</em> la crème, le parfum, le maquillage et la
                        laque. Les parfums alcoolisés et les cosmétiques sont les premiers
                        responsables du ternissement.
                      </>
                    }
                  />
                  <EntretienRow
                    n="3."
                    title="Rangement à l'abri"
                    body="Dans leur pochette d'origine ou une boîte à bijoux, à l'abri de la lumière directe et de l'humidité. Pas en vrac avec d'autres bijoux (frottements = rayures)."
                  />
                  <EntretienRow
                    n="4."
                    title="Nettoyage doux"
                    body={
                      <>
                        Chiffon microfibre sec pour la poussière. Pour un nettoyage en profondeur
                        : eau tiède + une goutte de savon de Marseille, puis sécher.{" "}
                        <strong className="text-text-primary">Jamais</strong> de dentifrice,
                        d&apos;alcool, d&apos;ammoniaque ou de produit pour l&apos;argenterie.
                      </>
                    }
                  />
                </div>
              </GuideSection>

              <GuideSection id="faq-matieres" n="08" title="Questions fréquentes sur les matières">
                <div className="divide-y divide-border border-y border-border bg-bg-primary rounded-2xl overflow-hidden mt-6">
                  <GuideFaq q="Est-ce que mes bijoux peuvent noircir ?">
                    Non. L&apos;acier inoxydable ne noircit pas et ne tache pas la peau,
                    contrairement au laiton ou au cuivre. Et même en cas d&apos;usure du placage,
                    le substrat acier reste chimiquement stable. Si vous constatez un ternissement,
                    c&apos;est généralement dû à un dépôt de cosmétiques — un chiffon microfibre
                    et de l&apos;eau tiède savonneuse suffisent.
                  </GuideFaq>
                  <GuideFaq q="Et pour les allergies au nickel ?">
                    L&apos;acier 304 contient techniquement un peu de nickel, mais sous forme
                    stable, encapsulée dans la matrice métallique. En plus, le placage PVD isole
                    totalement le substrat de la peau — il n&apos;y a donc pas de contact direct
                    avec l&apos;acier. La norme européenne EN 1811 impose une migration de nickel
                    inférieure à 0,5 µg/cm²/semaine : nos bijoux sont très largement sous ce seuil.
                  </GuideFaq>
                  <GuideFaq q="Puis-je porter mes bijoux à la piscine ou à la mer ?">
                    Techniquement, oui : le placage PVD forme une barrière étanche qui protège
                    totalement le bijou de l&apos;eau chlorée ou saline. En pratique, nous
                    recommandons quand même de retirer vos bijoux avant la baignade, par simple
                    précaution — comme pour tout bijou de qualité. Vos pièces vous dureront
                    d&apos;autant plus longtemps.
                  </GuideFaq>
                  <GuideFaq q="Puis-je prendre une douche avec ?">
                    Techniquement oui — l&apos;acier et le PVD résistent à l&apos;eau. Mais le
                    shampoing, le savon et le calcaire laissent des dépôts qui ternissent
                    l&apos;éclat. On recommande donc de les retirer, par principe de précaution.
                  </GuideFaq>
                  <GuideFaq q="Comment distinguer un placage PVD d'un galvanique ?">
                    Visuellement, c&apos;est quasi impossible neuf. La différence apparaît à
                    l&apos;usage : au bout de 6 mois de port quotidien, un galvanique commence à
                    montrer des zones ternies sur les angles, le PVD reste intact. Un fournisseur
                    sérieux documente systématiquement son procédé.
                  </GuideFaq>
                  <GuideFaq q="Les bijoux PVD contiennent-ils vraiment de l'or ?">
                    Oui — le placage PVD 14K dépose une fine couche d&apos;or réel (allié selon le
                    carat choisi). La quantité d&apos;or est faible (quelques milligrammes par
                    bijou), ce qui explique pourquoi un bijou plaqué, même PVD, n&apos;a pas de
                    valeur de revente comme un bijou en or massif.
                  </GuideFaq>
                </div>
              </GuideSection>
            </article>

            {/* Encart conclusion */}
            <div className="max-w-3xl mx-auto mt-20 bg-bg-dark text-text-inverse rounded-3xl p-10 md:p-14 text-center">
              <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-4">
                En résumé
              </p>
              <p
                className="font-heading font-extrabold text-text-inverse tracking-tight leading-[1.05]"
                style={{ fontSize: "clamp(1.5rem, 2.6vw, 2rem)", letterSpacing: "-0.03em" }}
              >
                Tous nos bijoux :{" "}
                <span className="italic font-light">acier inoxydable 304 + PVD or 14K</span>.
                <br />
                Durables, compatibles avec toutes les peaux, revendables en toute tranquillité.
              </p>
              <Link
                href="/produits"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-white text-text-primary text-sm font-heading font-semibold px-6 py-3 hover:bg-white/90 transition"
              >
                Voir notre catalogue <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* 8 · SHOWROOM — photo + bloc sombre adresse */}
        <section id="showroom" className="bg-bg-primary">
          <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
            <div className="lg:col-span-7 relative min-h-[500px] bg-bg-tertiary">
              <Image
                src={`${IMG}/allee-principale.jpg`}
                alt="Allée principale de la boutique Beli & Jolie"
                fill
                sizes="(max-width: 1024px) 100vw, 58vw"
                className="object-cover"
              />
            </div>
            <div className="lg:col-span-5 bg-bg-dark text-text-inverse px-6 md:px-10 lg:px-16 py-20 lg:py-28 flex items-center">
              <div className="max-w-sm">
                <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6">
                  Venir nous voir
                </p>
                <h2
                  className="font-heading font-extrabold text-text-inverse tracking-tight leading-[0.95]"
                  style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
                >
                  Toucher avant d&apos;acheter.
                </h2>
                <p className="mt-6 text-white/80 leading-relaxed font-body">
                  Boutique ouverte sans rendez-vous. On vous reçoit, on vous laisse flâner, et on
                  reste disponibles pour vous conseiller si besoin.
                </p>
                <dl className="mt-10 space-y-5 text-sm border-t border-white/20 pt-8 font-body">
                  <div>
                    <dt className="text-white/50 uppercase tracking-[0.2em] text-[10px] mb-1">
                      Adresse
                    </dt>
                    <dd>90 rue de la Haie Coq — 93300 Aubervilliers</dd>
                  </div>
                  <div>
                    <dt className="text-white/50 uppercase tracking-[0.2em] text-[10px] mb-1">
                      Horaires
                    </dt>
                    <dd>
                      Lun — Ven · 9 h — 18 h
                      <br />
                      Sam · 10 h — 16 h
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/50 uppercase tracking-[0.2em] text-[10px] mb-1">
                      Téléphone
                    </dt>
                    <dd>07 82 75 81 58</dd>
                  </div>
                </dl>
                <div className="mt-10 flex flex-wrap gap-3">
                  <a
                    href="https://maps.google.com/?q=90+rue+de+la+Haie+Coq+93300+Aubervilliers"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full bg-white text-text-primary text-sm font-heading font-semibold px-5 py-3 hover:bg-white/90"
                  >
                    Itinéraire ↗
                  </a>
                  <a
                    href="tel:0782758158"
                    className="rounded-full border border-white/30 text-text-inverse text-sm font-heading font-semibold px-5 py-3 hover:bg-white/10"
                  >
                    Nous appeler
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
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">
                Vos questions
              </p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                On vous répond, sans détour.
              </h2>
              <p className="mt-6 text-text-secondary leading-relaxed font-body">
                Vous ne trouvez pas la réponse ? Appelez-nous. On préfère vraiment.
              </p>
              <a
                href="tel:0782758158"
                className="mt-6 inline-flex items-center gap-2 text-text-primary font-heading font-semibold hover:underline"
              >
                07 82 75 81 58 →
              </a>
            </div>
            <div className="lg:col-span-8">
              <div className="divide-y divide-border border-y border-border bg-bg-primary">
                <PracticalFaq q="Les articles sont-ils vendus à l'unité ?">
                  Oui, nos modèles peuvent être commandés à l&apos;unité, sans lot ni pack imposé.
                </PracticalFaq>
                <PracticalFaq q="Pourquoi les prix ne sont-ils pas affichés ?">
                  Nos tarifs grossiste sont réservés aux professionnels. Créez gratuitement votre
                  compte pour consulter les prix et les stocks.
                </PracticalFaq>
                <PracticalFaq q="Sous quel délai les commandes sont-elles préparées ?">
                  Les commandes en ligne passées avant 15 h sont généralement expédiées le
                  lendemain ouvré (sous 24 h).
                </PracticalFaq>
                <PracticalFaq q="Livrez-vous en France et en Europe ?">
                  Oui, nous livrons en France, dans les DOM-TOM et dans plusieurs pays européens.
                </PracticalFaq>
              </div>
            </div>
          </div>
        </section>

        {/* 10 · CTA FINAL */}
        <section id="cta" className="bg-bg-primary">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center">
            <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
              Et maintenant ?
            </p>
            <h2
              className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
              style={{ fontSize: "clamp(2.5rem, 5.5vw, 4.5rem)", letterSpacing: "-0.03em" }}
            >
              Rejoignez les boutiques
              <br className="hidden md:block" /> qui commandent chez nous.
            </h2>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/inscription"
                className="inline-flex items-center gap-2 rounded-full bg-bg-dark text-text-inverse text-sm font-heading font-semibold px-7 py-4 hover:opacity-90 transition"
              >
                Créer mon compte pro <span aria-hidden>→</span>
              </Link>
              <a
                href="#showroom"
                className="inline-flex items-center gap-2 rounded-full border border-border text-text-primary text-sm font-heading font-semibold px-7 py-4 hover:bg-bg-secondary transition"
              >
                Venir à la boutique
              </a>
            </div>
            <p className="mt-8 text-text-muted text-xs uppercase tracking-[0.3em]">
              KBIS validé sous 24 h · 100 % gratuit
            </p>
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

function MosaicPhoto({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
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
      <h3 className="font-heading font-bold text-text-primary text-2xl md:text-3xl mb-6 tracking-tight">
        {title}
      </h3>
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
        <svg
          className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
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
        <svg
          className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-6 pb-6 text-text-secondary leading-relaxed font-body">{children}</div>
    </details>
  );
}
