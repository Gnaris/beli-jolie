import Image from "next/image";
import { Link } from "@/i18n/navigation";

const IMG = "/uploads/issyma/qui-sommes-nous";

export default function IssymaContent() {
  return (
    <main className="relative z-10 bg-bg-primary">
      {/* 1 · HERO split 50/50 */}
      <section className="relative overflow-hidden">
        <div className="grid lg:grid-cols-12 min-h-[82vh]">
          <div className="lg:col-span-6 flex items-center bg-bg-primary">
            <div className="px-6 md:px-10 lg:px-16 py-16 lg:py-0 max-w-xl">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                À propos de nous
              </p>
              <h1
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2.5rem, 5.2vw, 4.75rem)", letterSpacing: "-0.03em" }}
              >
                Une histoire
                <br />
                <span className="italic font-light">au service des boutiques.</span>
              </h1>
              <p className="mt-8 text-text-secondary text-lg leading-relaxed max-w-md font-body">
                <strong className="text-text-primary font-semibold">ISSYMA — FORCYMA</strong> est un
                grossiste en prêt-à-porter féminin dédié aux professionnels de la mode. Nous
                sélectionnons avec passion des collections tendance, accessibles et de qualité pour
                accompagner les boutiques et détaillants dans leur réussite au quotidien.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link
                  href="/inscription"
                  className="inline-flex items-center gap-2 rounded-full bg-bg-dark text-text-inverse text-sm font-heading font-semibold px-6 py-3 hover:opacity-90 transition"
                >
                  Créer un compte professionnel <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </div>
          <div className="lg:col-span-6 relative min-h-[400px] lg:min-h-0 bg-bg-tertiary">
            <Image
              src={`${IMG}/boutique-interior.png`}
              alt="Intérieur du showroom ISSYMA – FORCYMA au CIFA d'Aubervilliers"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
              priority
            />
          </div>
        </div>
      </section>

      {/* 2 · 4 FEATURE TILES — flat, icon only */}
      <section className="bg-bg-primary border-y border-border">
        <div className="max-w-[1300px] mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-14">
            <FeatureTile
              icon={<IconHanger />}
              title="Plus de 400 références"
              body="Un large choix de modèles sans cesse renouvelés."
            />
            <FeatureTile
              icon={<IconTag />}
              title="Vente à l'unité"
              body="Pas d'obligation de palettes, flexibilité totale pour les professionnels."
            />
            <FeatureTile
              icon={<IconClockArrow />}
              title="Préparation 24-48 h"
              body="Vos commandes rapidement préparées et expédiées."
            />
            <FeatureTile
              icon={<IconGlobe />}
              title="France & Europe"
              body="Expédition en France et dans toute l'Europe."
            />
          </div>
        </div>
      </section>

      {/* 3 · PASSION POUR LA MODE — image gauche + texte droite */}
      <section className="bg-bg-primary">
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
          <div className="lg:col-span-6 relative min-h-[500px] bg-bg-tertiary">
            <Image
              src={`${IMG}/collections-mailles.png`}
              alt="Collections ISSYMA – FORCYMA, pièces en maille et portants"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-32 flex items-center">
            <div className="max-w-xl">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                Notre philosophie
              </p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                Une passion pour la mode
                <br />
                <span className="italic font-light">et pour les professionnels.</span>
              </h2>
              <p className="mt-8 text-text-secondary leading-relaxed font-body">
                ISSYMA — FORCYMA sélectionne les meilleures tendances au fil des saisons. Pour chaque
                collection, nous choisissons des pièces soigneusement sourcées et des matières de
                qualité à des prix compétitifs.
              </p>
              <p className="mt-4 text-text-secondary leading-relaxed font-body">
                Notre objectif : vous permettre de proposer à votre clientèle de petites comme de
                grandes pépites, saison après saison.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · SHOWROOM — bande gris chaud, texte gauche + image droite */}
      <section id="showroom" className="bg-bg-tertiary">
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
          <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-32 flex items-center">
            <div className="max-w-xl">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                Le showroom
              </p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                Découvrez nos collections
                <br />
                <span className="italic font-light">en showroom.</span>
              </h2>
              <p className="mt-8 text-text-secondary leading-relaxed font-body">
                Nous vous accueillons au{" "}
                <strong className="text-text-primary">CIFA d&apos;Aubervilliers</strong> pour
                découvrir nos collections en vrai, les toucher, les essayer et échanger avec notre
                équipe. Une expérience privilégiée pour affiner vos sélections commerciales.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <a
                  href="https://maps.google.com/?q=CIFA+Aubervilliers+Lot+143"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-primary text-text-primary text-sm font-heading font-semibold px-6 py-3 hover:bg-bg-secondary transition"
                >
                  Voir l&apos;itinéraire <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          </div>
          <div className="lg:col-span-6 relative min-h-[500px] bg-bg-secondary">
            <Image
              src={`${IMG}/boutique-interior.png`}
              alt="Showroom ISSYMA – FORCYMA, pièces disposées en boutique"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* 5 · NOTRE ÉQUIPE — photo gauche + texte & 3 mini-cards droite */}
      <section className="bg-bg-primary border-t border-border">
        <div className="max-w-[1400px] mx-auto grid lg:grid-cols-12">
          <div className="lg:col-span-6 relative min-h-[520px] bg-bg-tertiary">
            <Image
              src={`${IMG}/team-boutique.png`}
              alt="L'équipe ISSYMA – FORCYMA accueillant des professionnelles autour d'une sélection"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div className="lg:col-span-6 px-6 md:px-10 lg:px-20 py-20 lg:py-28 flex items-center">
            <div className="max-w-xl w-full">
              <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-6">
                Notre équipe
              </p>
              <h2
                className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
              >
                Une équipe <span className="italic font-light">à votre écoute.</span>
              </h2>
              <p className="mt-8 text-text-secondary leading-relaxed font-body">
                Notre équipe vous accompagne au quotidien : conseil, suivi des collections,
                informations sur les nouveautés. Nous mettons notre savoir-faire au service de la
                mode féminine pour que vos clientes trouvent toujours leur bonheur.
              </p>
              <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <TeamMini
                  icon={<IconHeart />}
                  title="Conseil personnalisé"
                  body="Un suivi humain et des réponses adaptées."
                />
                <TeamMini
                  icon={<IconChat />}
                  title="Suivi régulier"
                  body="Un contact direct avec notre équipe."
                />
                <TeamMini
                  icon={<IconShield />}
                  title="Service après-vente"
                  body="Une équipe disponible pour vos retours."
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6 · NOUVEAUTÉS — texte gauche + mosaïque de 4 vignettes droite */}
      <section className="bg-bg-secondary border-y border-border">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-24 lg:py-28 grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          <div className="lg:col-span-5">
            <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-4">
              Nos collections toujours renouvelées
            </p>
            <h2
              className="font-heading font-extrabold text-text-primary tracking-tight leading-[0.95]"
              style={{ fontSize: "clamp(2rem, 4vw, 3rem)", letterSpacing: "-0.03em" }}
            >
              Des nouveautés <span className="italic font-light">chaque semaine.</span>
            </h2>
            <p className="mt-8 text-text-secondary leading-relaxed font-body">
              Nous renouvelons régulièrement notre catalogue avec les dernières pièces des grandes
              marques et nos nouvelles créations. Que vous recherchiez une pièce intemporelle ou le
              dernier it-item, vous le trouverez dans la boutique.
            </p>
            <Link
              href="/produits"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-bg-dark text-text-inverse text-sm font-heading font-semibold px-6 py-3 hover:opacity-90 transition"
            >
              Voir les nouveautés <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="lg:col-span-7">
            <div className="grid grid-cols-2 gap-3 md:gap-4">
              <NewsThumb
                src={`${IMG}/collections-mailles.png`}
                alt="Portants de pièces en maille"
                position="left center"
              />
              <NewsThumb
                src={`${IMG}/team-boutique.png`}
                alt="Blouse bordeaux en vitrine"
                position="center center"
              />
              <NewsThumb
                src={`${IMG}/collections-mailles.png`}
                alt="Pulls en maille empilés"
                position="right center"
              />
              <NewsThumb
                src={`${IMG}/boutique-interior.png`}
                alt="Détail d'un présentoir au showroom"
                position="30% center"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 7 · INFOS PRATIQUES — 3 colonnes, icon only */}
      <section className="bg-bg-primary">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-20 lg:py-24">
          <p className="text-[11px] uppercase tracking-[0.4em] text-text-muted mb-12 text-center">
            Nos informations pratiques
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 lg:gap-14">
            <InfoTile
              icon={<IconPin />}
              title="CIFA — Lot 143"
              lines={["6 rue de la Haie Coq", "93300 Aubervilliers"]}
            />
            <InfoTile
              icon={<IconClockArrow />}
              title="Horaires d'ouverture"
              lines={["Lun — Ven · 9 h — 18 h", "Sam · 10 h — 16 h"]}
            />
            <InfoTile
              icon={<IconMetro />}
              title="Accès"
              lines={["Facilement accessible", "en transports en commun"]}
            />
          </div>
        </div>
      </section>

      {/* 8 · CTA FINAL — section sombre */}
      <section id="cta" className="bg-bg-dark text-text-inverse">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-10 py-24 lg:py-32 text-center">
          <p className="text-[11px] uppercase tracking-[0.4em] text-white/50 mb-6">
            Professionnels de la mode
          </p>
          <h2
            className="font-heading font-extrabold text-text-inverse tracking-tight leading-[0.95]"
            style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)", letterSpacing: "-0.03em" }}
          >
            Prêt à découvrir{" "}
            <span className="italic font-light">le catalogue&nbsp;?</span>
          </h2>
          <p className="mt-8 text-white/80 text-lg leading-relaxed max-w-2xl mx-auto font-body">
            Accédez à l&apos;ensemble de nos références et bénéficiez de prix de gros grâce à votre
            compte professionnel.
          </p>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/inscription"
              className="inline-flex items-center gap-2 rounded-full bg-white text-text-primary text-sm font-heading font-semibold px-7 py-4 hover:bg-white/90 transition"
            >
              Créer un compte professionnel <span aria-hidden>→</span>
            </Link>
            <Link
              href="/produits"
              className="inline-flex items-center gap-2 rounded-full border border-white/30 text-text-inverse text-sm font-heading font-semibold px-7 py-4 hover:bg-white/10 transition"
            >
              Voir le catalogue
            </Link>
          </div>
          <p className="mt-8 text-white/50 text-xs uppercase tracking-[0.3em]">
            KBIS validé sous 24 h · 100 % gratuit
          </p>
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
      <div className="text-text-primary mb-5">{icon}</div>
      <h3 className="font-heading font-semibold text-text-primary text-base mb-2">{title}</h3>
      <p className="text-text-secondary text-[14px] leading-relaxed font-body">{body}</p>
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
      <div className="text-text-primary mb-3">{icon}</div>
      <h3 className="font-heading font-semibold text-text-primary text-sm mb-1">{title}</h3>
      <p className="text-text-secondary text-[13px] leading-relaxed font-body">{body}</p>
    </div>
  );
}

function InfoTile({
  icon,
  title,
  lines,
}: {
  icon: React.ReactNode;
  title: string;
  lines: string[];
}) {
  return (
    <div>
      <div className="text-text-primary mb-5">{icon}</div>
      <p className="text-[11px] uppercase tracking-[0.3em] text-text-muted mb-3">{title}</p>
      <div className="text-text-primary font-body text-[15px] leading-relaxed space-y-0.5">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
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
    <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-tertiary">
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
