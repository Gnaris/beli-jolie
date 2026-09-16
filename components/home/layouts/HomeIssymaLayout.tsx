import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { buildProductHandle } from "@/lib/product-url";
import PublicSidebar from "@/components/layout/PublicSidebar";
import type { CarouselProduct } from "@/components/home/ProductCarousel";
import type { HomeLayoutProps } from "./HomeLayoutProps";

/* ─────────────────────────────────────────────────────────────────────────
   Home Issyma — variante « Bordeaux Showroom »
   Palette bordeaux + crème + papier, inspirée de la capture validée par la
   cliente le 2026-09-16. Hero à 2 colonnes : panneau bordeaux avec silk +
   carte blanche « Comment commander ? ». Le reste de la page reprend la
   même palette pour cohérence (fond crème, cartes papier, accents wine).
   Modifier ici n'a AUCUN impact sur la home Beliandjolie
   (`HomeBeliandjolieLayout.tsx`).
   ───────────────────────────────────────────────────────────────────────── */

const PALETTE = {
  wine950: "#2a0f15",
  wine900: "#3d1620",
  wine800: "#4d1b28",
  wine700: "#5f2231",
  wine600: "#7a2a3c",
  wine500: "#8b3446",
  rose:    "#c98090", // accent chaud lisible sur fond bordeaux
  cream:   "#f4ead9",
  cream2:  "#e8d9c1",
  // paper reste blanc : uniquement pour la carte flottante "Comment
  // commander ?" du hero (seule surface claire de la page).
  paper:   "#ffffff",
  // Fond page = bordeaux profond. Toute la home Issyma vit dans cette
  // atmosphère wine, en alternance wine950 / wine900 section par section.
  page:    "#2a0f15",
  // Anciens "ink" / "inkSoft" / "border" gardés en clé pour compat mais
  // pointent maintenant vers la palette dark-wine (texte cream sur wine).
  ink:     "#f4ead9",
  inkSoft: "#e8d9c1",
  muted:   "#a89489",
  border:  "#4d1b28",
} as const;

// ── Texture soie SVG ────────────────────────────────────────────────────
// Utilisée dans le panneau bordeaux du hero + le bandeau CTA final. On la
// dessine en SVG (pas en CSS) pour obtenir des vraies vagues fluides comme
// sur la capture — les gradients CSS restaient trop plats/rectilignes.
function SilkTexture() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 800 600"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="silk-highlight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f4d4c4" stopOpacity="0" />
          <stop offset="0.5" stopColor="#f4d4c4" stopOpacity="1" />
          <stop offset="1" stopColor="#f4d4c4" stopOpacity="0" />
        </linearGradient>
        <filter id="silk-blur" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g transform="rotate(-14 400 300)" filter="url(#silk-blur)">
        <path d="M-200,60 Q200,30 500,70 T1100,55 L1100,95 Q800,70 500,110 T-200,100 Z" fill="url(#silk-highlight)" opacity="0.18" />
        <path d="M-200,150 Q200,115 500,155 T1100,140 L1100,190 Q800,160 500,200 T-200,190 Z" fill="url(#silk-highlight)" opacity="0.26" />
        <path d="M-200,240 Q200,205 500,245 T1100,230 L1100,290 Q800,255 500,300 T-200,285 Z" fill="url(#silk-highlight)" opacity="0.32" />
        <path d="M-200,340 Q200,305 500,345 T1100,330 L1100,395 Q800,360 500,405 T-200,390 Z" fill="url(#silk-highlight)" opacity="0.28" />
        <path d="M-200,450 Q200,410 500,455 T1100,440 L1100,500 Q800,465 500,510 T-200,495 Z" fill="url(#silk-highlight)" opacity="0.22" />
        <path d="M-200,550 Q200,515 500,555 T1100,540 L1100,590 Q800,555 500,600 T-200,585 Z" fill="url(#silk-highlight)" opacity="0.17" />
      </g>
    </svg>
  );
}

const ISSYMA_STYLES = `
  .issyma-home { background: ${PALETTE.page}; color: ${PALETTE.ink}; font-family: var(--font-roboto), 'Inter', system-ui, sans-serif; font-weight: 400; }
  /* .serif (nom historique — hérité de l'ancien design éditorial) désigne
     désormais le style d'affichage validé sur la capture 2026-09-16 :
     sans-serif bold Poppins avec tracking serré. On garde le nom pour
     limiter le diff, mais le rendu est bien sans-serif. */
  .issyma-home .serif { font-family: var(--font-poppins), 'Inter', system-ui, sans-serif; font-weight: 700; letter-spacing: -0.02em; }
  .issyma-home .eyebrow {
    font-family: var(--font-roboto), Inter, system-ui, sans-serif;
    font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase;
    color: ${PALETTE.wine700}; font-weight: 600;
  }
  .issyma-home .eyebrow-muted {
    font-family: var(--font-roboto), Inter, system-ui, sans-serif;
    font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase;
    color: ${PALETTE.muted}; font-weight: 500;
  }
  .issyma-home .wine-underline {
    display: inline-block; width: 32px; height: 1px;
    background: ${PALETTE.wine700}; vertical-align: middle; margin-right: 12px;
  }
  .issyma-home .hairline { border-top: 1px solid ${PALETTE.border}; }
  .issyma-home details > summary { list-style: none; cursor: pointer; }
  .issyma-home details > summary::-webkit-details-marker { display: none; }
  .issyma-home details .plus::before { content: "+"; }
  .issyma-home details[open] .plus::before { content: "−"; }
  .issyma-home .link-wine { color: ${PALETTE.wine700}; transition: color 200ms ease; }
  .issyma-home .link-wine:hover { color: ${PALETTE.wine500}; }

  /* ── Boutons ─────────────────────────────────────────────────────── */
  .issyma-home .btn-cream {
    background: ${PALETTE.cream}; color: ${PALETTE.wine900};
    transition: transform 200ms ease, background 200ms ease;
    box-shadow: 0 1px 0 rgba(0,0,0,0.06);
  }
  .issyma-home .btn-cream:hover { background: #fff3dd; transform: translateY(-1px); }
  .issyma-home .btn-outline-cream {
    border: 1px solid rgba(244, 234, 217, 0.4); color: ${PALETTE.cream};
    transition: background 200ms ease, border-color 200ms ease;
  }
  .issyma-home .btn-outline-cream:hover { background: rgba(244, 234, 217, 0.08); border-color: rgba(244, 234, 217, 0.65); }
  .issyma-home .btn-wine {
    background: ${PALETTE.wine700}; color: #fff;
    transition: background 200ms ease;
  }
  .issyma-home .btn-wine:hover { background: ${PALETTE.wine800}; }
  .issyma-home .btn-outline-wine {
    background: transparent; border: 1px solid ${PALETTE.wine700}; color: ${PALETTE.wine700};
    transition: background 200ms ease;
  }
  .issyma-home .btn-outline-wine:hover { background: rgba(122, 42, 60, 0.06); }

  /* ── Panneau bordeaux ─────────────────────────────────────────────
     Fond wine plein (fallback). Le hero pose par-dessus l'image
     /issyma-hero-bg.png via Image fill. Le CTA final utilise a la place
     la texture SVG SilkTexture. */
  .issyma-home .wine-panel {
    background: linear-gradient(135deg, ${PALETTE.wine900} 0%, ${PALETTE.wine700} 55%, ${PALETTE.wine600} 100%);
    position: relative;
    overflow: hidden;
  }

  /* ── Carte papier « Comment commander ? » ────────────────────────── */
  .issyma-home .paper-card {
    background: ${PALETTE.paper};
    border-radius: 20px;
    box-shadow:
      0 30px 60px -30px rgba(50, 15, 25, 0.25),
      0 8px 20px -12px rgba(50, 15, 25, 0.15);
  }
  .issyma-home .step-circle {
    background: ${PALETTE.wine700};
    color: ${PALETTE.cream};
    /* Sans-serif tabulaire + line-height 1 : sinon les chiffres héritent
       du serif Cormorant et se décalent dans le cercle (bug capture 22h55). */
    font-family: var(--font-poppins), 'Inter', system-ui, sans-serif;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .issyma-home .info-row {
    display: grid;
    grid-template-columns: 148px 1fr;
    gap: 20px;
    padding: 14px 0;
    border-top: 1px solid ${PALETTE.border};
    align-items: center;
  }
  .issyma-home .info-row:last-child { border-bottom: 1px solid ${PALETTE.border}; }
  /* Couleurs hardcodées : la carte papier "Comment commander ?" est la
     SEULE surface claire de la page. PALETTE.muted/inkSoft pointent sur
     du crème (pour le thème dark global) donc invisibles ici sur blanc. */
  .issyma-home .info-row .label {
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
    color: #8a7460; font-weight: 500;
  }
  .issyma-home .info-row .value {
    font-size: 14px; color: #3a2028; font-weight: 400;
  }
  .issyma-home .pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 18px; border-radius: 999px;
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600;
  }
  .issyma-home .showroom-badge {
    display: inline-flex; align-items: center; gap: 14px;
    padding: 12px 18px 12px 14px;
    border-radius: 14px;
    background: rgba(20, 8, 12, 0.55);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(244, 234, 217, 0.14);
    color: ${PALETTE.cream};
  }
  .issyma-home .showroom-badge .pin {
    width: 34px; height: 34px; border-radius: 10px;
    background: ${PALETTE.wine600};
    display: inline-flex; align-items: center; justify-content: center;
    color: ${PALETTE.cream};
  }

  /* ── Interactions cartes ─────────────────────────────────────────── */
  .issyma-home .cat-circle { transition: border-color 300ms ease, transform 400ms ease; }
  .issyma-home .cat-circle:hover { border-color: ${PALETTE.wine700}; transform: translateY(-2px); }
  .issyma-home .product-card img { transition: transform 700ms ease; }
  .issyma-home .product-card:hover img { transform: scale(1.04); }
  .issyma-home .collection-tile .overlay { transition: opacity 400ms ease; }
  .issyma-home .collection-tile:hover .overlay { opacity: 0.85; }

  /* ── Header PublicSidebar — thème bordeaux Issyma ────────────────── */
  /* Scopé à .issyma-home > header : n'affecte QUE la home Issyma. Fond
     wine950 semi-transparent pour s'intégrer au hero full-bleed bordeaux
     et rester lisible en dessous (nouveautés cream, etc). */
  .issyma-home > header {
    background-color: rgba(42, 15, 21, 0.92) !important;
    border-color: rgba(244, 234, 217, 0.12) !important;
    backdrop-filter: blur(10px);
  }
  .issyma-home > header .border-neutral-100,
  .issyma-home > header .border-neutral-200 {
    border-color: rgba(244, 234, 217, 0.12) !important;
  }
  /* Cible par classe uniquement — le Link next-intl transforme href="/"
     en /fr, donc un sélecteur [href="/"] ne match plus. Les 3 nœuds de
     shop name (mobile top, desktop, drawer) portent tous .font-heading. */
  .issyma-home > header a.font-heading {
    color: #ffffff !important;
    letter-spacing: 0.14em;
    font-weight: 700 !important;
  }
  .issyma-home > header nav a {
    color: ${PALETTE.cream2} !important;
  }
  .issyma-home > header nav a:hover,
  .issyma-home > header nav a[data-nav-active="true"] {
    color: ${PALETTE.cream} !important;
  }
  .issyma-home > header button {
    color: ${PALETTE.cream} !important;
  }
  .issyma-home > header button:hover {
    color: ${PALETTE.cream2} !important;
  }
  .issyma-home > header .cart-count { background-color: ${PALETTE.wine600} !important; color: ${PALETTE.cream} !important; }
`;

// ── Card produit (utilisée par Nouveautés + Best sellers) ────────────────
function ProductCardIssyma({ p, badge }: { p: CarouselProduct; badge?: string }) {
  const primary = p.colors.find((c) => c.isPrimary) ?? p.colors[0];
  const href = `/produits/${buildProductHandle(p.name, p.reference)}`;
  const image = primary?.firstImage ?? null;
  const price = primary ? primary.unitPrice : null;

  return (
    <Link href={href} className="product-card group block">
      <div className="relative aspect-square overflow-hidden rounded-2xl" style={{ background: PALETTE.wine800 }}>
        {image ? (
          <Image src={image} alt={p.name} width={800} height={800} className="w-full h-full object-cover" />
        ) : null}
        {badge && (
          <span
            className="absolute top-4 left-4 text-[10px] tracking-[0.24em] uppercase px-3 py-1 rounded-full backdrop-blur"
            style={{ color: PALETTE.wine800, background: `${PALETTE.paper}e6`, border: `1px solid ${PALETTE.border}` }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="mt-5">
        <h3 className="serif text-xl" style={{ color: PALETTE.ink }}>{p.name}</h3>
        {primary?.name && (
          <p className="text-sm mt-1 font-light" style={{ color: PALETTE.muted }}>{primary.name}</p>
        )}
        {price != null && (
          <p className="text-sm mt-2 tracking-wide" style={{ color: PALETTE.wine700 }}>
            {price.toFixed(2).replace(".", ",")} €
          </p>
        )}
      </div>
    </Link>
  );
}

export default async function HomeIssymaLayout({
  shopName,
  newCards,
  bestSellerCards,
  categories,
  collections,
  reviews,
  faqItems,
  jsonLdBlocks,
}: HomeLayoutProps) {
  const t = await getTranslations("home");

  // ⚠️ Hero Issyma = 100 % hardcodé (cliente 2026-09-16, capture bordeaux).
  // On ignore volontairement `heroOverrides` / `bannerImage` : la config admin
  // de la section « Contenu accueil » est masquée pour le tenant Issyma —
  // le hero fait partie intégrante de la charte visuelle et ne doit pas être
  // modifiable par erreur depuis Paramètres.

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ISSYMA_STYLES }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }} />

      <div className="issyma-home min-h-screen antialiased">

        {/* ─── HEADER PUBLIC ────────────────────────────────────────────── */}
        <PublicSidebar shopName={shopName} />

        {/* ─── HERO ─────────────────────────────────────────────────────── */}
        {/* Panneau bordeaux FULL-BLEED (edge-to-edge, aucun crème visible) :
            image `public/issyma-hero-bg.png` (silk bordeaux à gauche → cream
            rosé à droite) posée en fond via <Image fill>. La carte papier
            « Comment commander ? » flotte à l'intérieur sur la droite, elle
            se pose naturellement sur la zone cream de l'image. */}
        <section className="wine-panel relative overflow-hidden">
          <Image
            src="/issyma-hero-bg.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-left lg:object-center"
          />
          {/* Voile bordeaux dégradé sur la gauche : garantit la lisibilité
              du titre / description / boutons quelle que soit la teinte
              exacte de la soie sous le texte. Transparent sur la droite
              pour préserver la zone cream où se pose la carte papier. */}
          <div
            aria-hidden
            className="absolute inset-0 z-[1] pointer-events-none"
            style={{
              background: `linear-gradient(90deg, rgba(42, 15, 21, 0.55) 0%, rgba(42, 15, 21, 0.28) 22%, rgba(42, 15, 21, 0.08) 42%, transparent 58%)`,
            }}
          />
          <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 lg:gap-8 items-stretch py-10 sm:py-12 lg:py-14">

              {/* ── Colonne gauche : texte à même le fond bordeaux ── */}
              <div className="p-2 sm:p-4 lg:p-6 flex flex-col min-h-[520px] lg:min-h-[600px]">
                <p className="eyebrow" style={{ color: `${PALETTE.cream2}cc` }}>
                  Grossiste en prêt-à-porter féminin B2B · CIFA Aubervilliers
                </p>

                <h1 className="serif mt-8"
                    style={{
                      color: PALETTE.cream,
                      fontSize: "clamp(2.4rem, 5.4vw, 4.6rem)",
                      lineHeight: 1.05,
                    }}>
                  Des produits tendance<br />
                  pour votre boutique
                </h1>

                <p className="mt-8 max-w-lg text-[15px] leading-[1.7] font-light"
                   style={{ color: `${PALETTE.cream}cc` }}>
                  Plus de 600 références disponibles pour les boutiques et
                  revendeurs professionnels. Vente à l&apos;unité, nouveautés
                  régulières et livraison en France et en Europe.
                </p>

                <div className="mt-10 flex flex-wrap gap-3">
                  <Link
                    href="/produits"
                    className="btn-cream inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
                  >
                    Découvrir le catalogue
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link
                    href="/inscription"
                    className="btn-outline-cream inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
                  >
                    Créer un compte pro
                    <span aria-hidden="true">→</span>
                  </Link>
                </div>

                <div className="flex-1" />

                <div className="mt-12">
                  <div className="showroom-badge">
                    <span className="pin">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                    </span>
                    <div className="flex flex-col leading-tight">
                      <span className="eyebrow" style={{ color: `${PALETTE.cream2}b3` }}>Showroom</span>
                      <span className="text-[15px] mt-1 font-medium" style={{ color: PALETTE.cream }}>
                        Marché CIFA · lot 165 · Aubervilliers
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Carte papier « Comment commander ? » ── */}
              <div className="paper-card p-8 sm:p-10 lg:p-11 flex flex-col">
                <h2 className="serif uppercase"
                    style={{
                      color: PALETTE.wine800,
                      fontSize: "clamp(1.5rem, 2.2vw, 1.9rem)",
                      letterSpacing: "0.02em",
                    }}>
                  Comment commander ?
                </h2>
                <p className="mt-2 text-sm" style={{ color: "#8a7460" }}>
                  Un parcours simple, réservé aux professionnels.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="pill btn-wine">Vente à l&apos;unité</span>
                  <span className="pill btn-outline-wine">Minimum 100 € HT</span>
                </div>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                  {[
                    { n: "1", title: "Créez votre compte pro", desc: "Inscription gratuite" },
                    { n: "2", title: "Choisissez vos articles", desc: "À l'unité, sans lot ni pack" },
                    { n: "3", title: "Validez dès 100 € HT",   desc: "Paiement sécurisé par carte" },
                    { n: "4", title: "Recevez ou retirez",     desc: "Livraison France et Europe" },
                  ].map((s) => (
                    <div key={s.n} className="flex gap-4">
                      <span className="step-circle w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0">
                        {s.n}
                      </span>
                      <div>
                        {/* Hardcode : PALETTE.ink/muted pointent sur cream/rose
                            (thème dark de la page). Ici on est sur la carte
                            blanche, il faut du texte sombre. */}
                        <p className="text-[15px] font-semibold leading-tight" style={{ color: "#2a1418" }}>{s.title}</p>
                        <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "#8a7460" }}>{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex-1 min-h-[16px]" />

                <div className="mt-8">
                  <div className="info-row">
                    <span className="label">Au showroom</span>
                    <span className="value">Retrait immédiat, sans commande préalable</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Commande web</span>
                    <span className="value">Préparation sous 24-48 h ouvrées</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Paiement</span>
                    <span className="value">Carte bancaire</span>
                  </div>
                  <div className="info-row">
                    <span className="label">Livraison</span>
                    <span className="value">GLS · DPD · Chronopost · Colissimo · UPS</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ─── NOUVEAUTÉS ───────────────────────────────────────────────── */}
        {newCards.length > 0 && (
          <section style={{ background: PALETTE.wine900 }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-14 sm:mb-16">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("newProductsEyebrow")}</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.ink }}>
                    Les dernières <span className="italic" style={{ color: PALETTE.wine700 }}>nouveautés</span>.
                  </h2>
                </div>
                <Link href="/produits?new=1" className="link-wine text-[12px] tracking-[0.24em] uppercase self-start sm:self-end font-semibold">
                  {t("newProductsMore")} →
                </Link>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
                {newCards.slice(0, 4).map((p) => <ProductCardIssyma key={p.id} p={p} />)}
              </div>
            </div>
            <div className="hairline" />
          </section>
        )}

        {/* ─── NOTRE ENGAGEMENT ─────────────────────────────────────────── */}
        <section style={{ background: PALETTE.page }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-32">
            <div className="max-w-3xl mb-16 sm:mb-20">
              <p className="eyebrow mb-5"><span className="wine-underline" />Notre engagement</p>
              <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.ink }}>
                Pourquoi les boutiques <br className="hidden md:block" />
                nous <span className="italic" style={{ color: PALETTE.wine700 }}>choisissent</span>.
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-12 gap-y-14">
              {[
                { n: "01", title: "Préparation rapide", desc: "24-48 h ouvrées entre la commande et l'expédition." },
                { n: "02", title: "Vente à l'unité",    desc: "Sans lot ni pack imposé — composez librement votre sélection." },
                { n: "03", title: "Paiement sécurisé",  desc: "Carte bancaire via Stripe, protection professionnelle." },
                { n: "04", title: "Service client",     desc: "Une équipe réactive et dédiée aux professionnels." },
              ].map((it) => (
                <div key={it.n}>
                  <p className="serif text-5xl sm:text-6xl font-medium leading-none" style={{ color: PALETTE.wine700 }}>{it.n}</p>
                  <span className="block w-8 h-[1px] mt-5" style={{ background: PALETTE.wine700 }} />
                  <h3 className="serif text-2xl mt-6" style={{ color: PALETTE.ink }}>{it.title}</h3>
                  <p className="text-[15px] mt-3 font-light leading-relaxed" style={{ color: PALETTE.inkSoft }}>{it.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hairline" />
        </section>

        {/* ─── CATÉGORIES ───────────────────────────────────────────────── */}
        {categories.length > 0 && (
          <section style={{ background: PALETTE.wine900 }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="text-center max-w-2xl mx-auto mb-16">
                <p className="eyebrow mb-4">Explorer</p>
                <h2 className="serif text-4xl sm:text-5xl leading-tight" style={{ color: PALETTE.ink }}>
                  Nos <span className="italic" style={{ color: PALETTE.wine700 }}>catégories</span>.
                </h2>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-6 sm:gap-8">
                {categories.map((c) => (
                  <Link key={c.id} href={`/categories/${c.slug}`} className="flex flex-col items-center gap-4 group">
                    <div
                      className="cat-circle w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden"
                      style={{ border: `1px solid ${PALETTE.border}`, background: PALETTE.wine800 }}
                    >
                      {c.image ? (
                        <Image src={c.image} alt={c.name} width={200} height={200} className="w-full h-full object-cover" />
                      ) : null}
                    </div>
                    <span className="serif text-lg text-center leading-tight" style={{ color: PALETTE.ink }}>{c.name}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="hairline" />
          </section>
        )}

        {/* ─── COLLECTIONS ──────────────────────────────────────────────── */}
        {collections.length > 0 && (
          <section style={{ background: PALETTE.page }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-14 sm:mb-16">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />À la une</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.ink }}>
                    Nos <span className="italic" style={{ color: PALETTE.wine700 }}>collections</span>.
                  </h2>
                </div>
                <Link href="/collections" className="link-wine text-[12px] tracking-[0.24em] uppercase self-start sm:self-end font-semibold">
                  Toutes les collections →
                </Link>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
                {collections[0] && (
                  <Link
                    href={collections[0].slug ? `/collections/${collections[0].slug}` : "/collections"}
                    className="collection-tile relative rounded-2xl overflow-hidden aspect-[4/5] lg:aspect-auto lg:h-[560px] block group"
                    style={{ background: PALETTE.wine800 }}
                  >
                    {collections[0].image && (
                      <Image src={collections[0].image} alt={collections[0].name} fill className="object-cover" />
                    )}
                    <div className="overlay absolute inset-0" style={{ background: `linear-gradient(to top, ${PALETTE.wine950}f2, ${PALETTE.wine900}66, transparent)` }} />
                    <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-10">
                      <p className="eyebrow mb-3" style={{ color: `${PALETTE.cream2}cc` }}>Collection</p>
                      <h3 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.cream }}>{collections[0].name}</h3>
                      <p className="text-sm mt-3 font-light" style={{ color: `${PALETTE.cream}b3` }}>{collections[0]._count.products} pièces</p>
                    </div>
                  </Link>
                )}

                <div className="grid grid-cols-1 gap-6 lg:gap-8">
                  {collections.slice(1, 3).map((col) => (
                    <Link
                      key={col.id}
                      href={col.slug ? `/collections/${col.slug}` : "/collections"}
                      className="collection-tile relative rounded-2xl overflow-hidden aspect-[16/10] lg:h-[268px] block group"
                      style={{ background: PALETTE.wine800 }}
                    >
                      {col.image && (
                        <Image src={col.image} alt={col.name} fill className="object-cover" />
                      )}
                      <div className="overlay absolute inset-0" style={{ background: `linear-gradient(to top, ${PALETTE.wine950}f2, ${PALETTE.wine900}66, transparent)` }} />
                      <div className="absolute inset-0 flex flex-col justify-end p-8">
                        <p className="eyebrow mb-2" style={{ color: `${PALETTE.cream2}cc` }}>Collection</p>
                        <h3 className="serif text-3xl sm:text-4xl" style={{ color: PALETTE.cream }}>{col.name}</h3>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
            <div className="hairline" />
          </section>
        )}

        {/* ─── BEST SELLERS ─────────────────────────────────────────────── */}
        {bestSellerCards.length > 0 && (
          <section style={{ background: PALETTE.wine900 }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-14 sm:mb-16">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("bestsellersEyebrow")}</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.ink }}>
                    Nos <span className="italic" style={{ color: PALETTE.wine700 }}>best sellers</span>.
                  </h2>
                </div>
                <Link href="/produits?bestseller=1" className="link-wine text-[12px] tracking-[0.24em] uppercase self-start sm:self-end font-semibold">
                  {t("bestsellersMore")} →
                </Link>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
                {bestSellerCards.slice(0, 4).map((p) => <ProductCardIssyma key={p.id} p={p} badge="★ Best seller" />)}
              </div>
            </div>
            <div className="hairline" />
          </section>
        )}

        {/* ─── AVIS CLIENTS ─────────────────────────────────────────────── */}
        {reviews.length > 0 && (
          <section style={{ background: PALETTE.page }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="max-w-2xl mb-14 sm:mb-16">
                <p className="eyebrow mb-4"><span className="wine-underline" />{t("reviewsEyebrow")}</p>
                <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.ink }}>
                  Paroles de <span className="italic" style={{ color: PALETTE.wine700 }}>boutiques</span>.
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
                {reviews.slice(0, 3).map((r) => (
                  <blockquote
                    key={r.id}
                    className="rounded-2xl p-8 sm:p-10"
                    style={{ background: PALETTE.wine800, border: `1px solid ${PALETTE.wine700}` }}
                  >
                    <span className="serif text-6xl leading-none block -mb-4" style={{ color: PALETTE.wine700 }}>&ldquo;</span>
                    <p className="serif italic text-lg leading-relaxed" style={{ color: PALETTE.ink }}>
                      {r.text}
                    </p>
                    <footer className="mt-8 flex items-center justify-between">
                      <div className="text-xs tracking-[0.2em] uppercase" style={{ color: PALETTE.muted }}>
                        {r.name}
                      </div>
                      <div className="text-sm tracking-widest" style={{ color: PALETTE.wine700 }}>
                        {"★".repeat(Math.max(0, Math.min(5, r.rating)))}
                      </div>
                    </footer>
                  </blockquote>
                ))}
              </div>
            </div>
            <div className="hairline" />
          </section>
        )}

        {/* ─── FAQ ÉDITORIALE ───────────────────────────────────────────── */}
        {faqItems.length > 0 && (
          <section style={{ background: PALETTE.wine900 }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-32">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
                <div>
                  <p className="eyebrow mb-5"><span className="wine-underline" />{t("faqEyebrow")}</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.ink }}>
                    Avant de <span className="italic" style={{ color: PALETTE.wine700 }}>commander</span>.
                  </h2>
                  <p className="mt-6 max-w-lg font-light text-[15px] leading-relaxed" style={{ color: PALETTE.inkSoft }}>
                    Nous avons rassemblé les questions les plus courantes des professionnels.
                    Prenez le temps de les parcourir — vous y trouverez sans doute votre réponse.
                  </p>

                  <div className="mt-10 rounded-2xl p-8" style={{ background: PALETTE.page, border: `1px solid ${PALETTE.border}` }}>
                    <p className="serif text-2xl leading-snug" style={{ color: PALETTE.ink }}>
                      {t("faqContactTitle")}
                    </p>
                    <p className="mt-3 text-[15px] font-light" style={{ color: PALETTE.inkSoft }}>
                      {t("faqContactDesc")}
                    </p>
                    <Link
                      href="/nous-contacter"
                      className="mt-6 inline-flex items-center gap-3 px-6 py-3 rounded-full text-[12px] tracking-[0.24em] uppercase font-medium transition hover:opacity-90"
                      style={{ background: PALETTE.wine700, color: PALETTE.cream }}
                    >
                      {t("faqContactCta")} →
                    </Link>
                  </div>
                </div>

                <div className="lg:pt-10">
                  <div style={{ borderTop: `1px solid ${PALETTE.border}` }}>
                    {faqItems.map((item, idx) => (
                      <details key={item.id} open={idx < 2} style={{ borderBottom: `1px solid ${PALETTE.border}` }}>
                        <summary className="flex items-start justify-between gap-6 py-6">
                          <span className="serif text-xl sm:text-2xl leading-snug" style={{ color: PALETTE.ink }}>
                            {item.question}
                          </span>
                          <span className="plus text-2xl font-light shrink-0 leading-none mt-1" style={{ color: PALETTE.wine700 }} />
                        </summary>
                        <p className="pb-6 pr-10 font-light text-[15px] leading-relaxed" style={{ color: PALETTE.inkSoft }}>
                          {item.answer}
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ─── CTA BANDEAU BORDEAUX ─────────────────────────────────────── */}
        <section className="wine-panel" style={{ borderRadius: 0 }}>
          <SilkTexture />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-16 sm:py-20 flex flex-col md:flex-row md:items-center md:justify-between gap-10 relative z-10">
            <div className="max-w-2xl">
              <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.cream }}>
                Prêt à enrichir votre boutique ?
              </h2>
              <p className="mt-4 text-lg font-light" style={{ color: `${PALETTE.cream}d9` }}>
                Rejoignez les boutiques qui ont choisi {shopName} pour leur sélection professionnelle.
              </p>
            </div>
            <Link
              href="/inscription"
              className="btn-cream inline-flex items-center gap-3 px-10 py-5 rounded-full text-[13px] tracking-[0.22em] uppercase font-semibold self-start md:self-auto"
            >
              Créer un compte professionnel <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        {/* ─── FOOTER ───────────────────────────────────────────────────── */}
        <footer style={{ background: PALETTE.wine950 }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-20">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
              <div>
                <p className="serif text-2xl tracking-[0.18em]" style={{ color: PALETTE.cream }}>{shopName.toUpperCase()}</p>
                <p className="mt-5 text-sm font-light leading-relaxed max-w-xs" style={{ color: `${PALETTE.cream}99` }}>
                  Grossiste prêt-à-porter féminin pour les boutiques exigeantes. Vente à l&apos;unité, expédition rapide, service dédié.
                </p>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${PALETTE.cream2}cc` }}>La maison</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${PALETTE.cream}99` }}>
                  <li><Link href="/a-propos"      className="hover:opacity-80 transition">À propos</Link></li>
                  <li><Link href="/nous-contacter" className="hover:opacity-80 transition">Contact</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${PALETTE.cream2}cc` }}>Boutique</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${PALETTE.cream}99` }}>
                  <li><Link href="/produits?new=1"        className="hover:opacity-80 transition">Nouveautés</Link></li>
                  <li><Link href="/categories"            className="hover:opacity-80 transition">Catégories</Link></li>
                  <li><Link href="/collections"           className="hover:opacity-80 transition">Collections</Link></li>
                  <li><Link href="/produits?bestseller=1" className="hover:opacity-80 transition">Best sellers</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${PALETTE.cream2}cc` }}>Aide</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${PALETTE.cream}99` }}>
                  <li><Link href="/cgv"                className="hover:opacity-80 transition">CGV</Link></li>
                  <li><Link href="/mentions-legales"   className="hover:opacity-80 transition">Mentions légales</Link></li>
                  <li><Link href="/confidentialite"    className="hover:opacity-80 transition">Confidentialité</Link></li>
                </ul>
              </div>
            </div>

            <div className="mt-16 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center"
                 style={{ borderTop: `1px solid ${PALETTE.wine800}` }}>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: `${PALETTE.cream}80` }}>
                © {new Date().getFullYear()} {shopName} · Tous droits réservés
              </p>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: `${PALETTE.cream}80` }}>
                Marché CIFA · Aubervilliers
              </p>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
