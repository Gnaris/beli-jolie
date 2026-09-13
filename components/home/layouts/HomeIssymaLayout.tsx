import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { buildProductHandle } from "@/lib/product-url";
import { heroOverlayBackground } from "@/lib/hero-overlay";
import PublicSidebar from "@/components/layout/PublicSidebar";
import type { CarouselProduct } from "@/components/home/ProductCarousel";
import type { HomeLayoutProps } from "./HomeLayoutProps";

/* ─────────────────────────────────────────────────────────────────────────
   Home Issyma — variante « Éditoriale magazine »
   Design luxe sombre : noir chaud pourpré + accent rose poudré + serif
   Cormorant Garamond. Palette et sections validées par la cliente sur les
   maquettes HTML (`Downloads/issyma-home-v1-editorial.html`).
   Modifier ici n'a AUCUN impact sur la home Beliandjolie
   (`HomeBeliandjolieLayout.tsx`).
   ───────────────────────────────────────────────────────────────────────── */

const PALETTE = {
  bg:       "#161011",
  bgAlt:    "#1f1618",
  card:     "#2a1e21",
  border:   "#3a2a2d",
  text:     "#f5eae4",
  muted:    "#a89489",
  rose:     "#c98090",
  roseSoft: "#e8c7ce",
  roseCta:  "#c07a89",
} as const;

const ISSYMA_STYLES = `
  .issyma-home { background: ${PALETTE.bg}; color: ${PALETTE.text}; font-weight: 300; }
  .issyma-home .serif { font-family: var(--font-cormorant), 'Cormorant Garamond', Georgia, serif; letter-spacing: -0.01em; }
  .issyma-home .eyebrow {
    font-family: var(--font-roboto), Inter, system-ui, sans-serif;
    font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase;
    color: ${PALETTE.rose}; font-weight: 500;
  }
  .issyma-home .rose-underline {
    display: inline-block; width: 32px; height: 1px;
    background: ${PALETTE.rose}; vertical-align: middle; margin-right: 12px;
  }
  .issyma-home .hairline { border-top: 1px solid ${PALETTE.border}; }
  .issyma-home details > summary { list-style: none; cursor: pointer; }
  .issyma-home details > summary::-webkit-details-marker { display: none; }
  .issyma-home details .plus::before { content: "+"; }
  .issyma-home details[open] .plus::before { content: "−"; }
  .issyma-home .cat-circle { transition: border-color 300ms ease, transform 400ms ease; }
  .issyma-home .cat-circle:hover { border-color: ${PALETTE.rose}; transform: translateY(-2px); }
  .issyma-home .product-card img { transition: transform 700ms ease; }
  .issyma-home .product-card:hover img { transform: scale(1.04); }
  .issyma-home .collection-tile .overlay { transition: opacity 400ms ease; }
  .issyma-home .collection-tile:hover .overlay { opacity: 0.85; }
  .issyma-home .link-rose { color: ${PALETTE.rose}; transition: color 200ms ease; }
  .issyma-home .link-rose:hover { color: ${PALETTE.roseSoft}; }
  .issyma-home .btn-rose {
    background: ${PALETTE.roseCta}; color: ${PALETTE.text};
    transition: background 200ms ease;
  }
  .issyma-home .btn-rose:hover { background: #b26a79; }
  .issyma-home .btn-outline-rose {
    border: 1px solid ${PALETTE.rose}; color: ${PALETTE.text};
    transition: background 200ms ease, color 200ms ease;
  }
  .issyma-home .btn-outline-rose:hover { background: rgba(201,128,144,0.08); color: ${PALETTE.roseSoft}; }
  .issyma-home .hero-grain {
    background-image:
      radial-gradient(1200px 600px at 20% 0%, rgba(201,128,144,0.10), transparent 60%),
      radial-gradient(900px 500px at 90% 20%, rgba(232,199,206,0.06), transparent 60%);
  }

  /* Override PublicSidebar → thème sombre Issyma.
     Scopé au sélecteur .issyma-home > header : n'affecte QUE la home Issyma,
     les autres pages Issyma (produits, catégories, etc.) gardent leur
     rendu clair Beliandjolie. */
  .issyma-home > header {
    background-color: rgba(22, 16, 17, 0.92) !important;
    border-color: ${PALETTE.border} !important;
    backdrop-filter: blur(10px);
  }
  .issyma-home > header .border-neutral-100,
  .issyma-home > header .border-neutral-200 {
    border-color: ${PALETTE.border} !important;
  }
  /* Logo (mobile + desktop) */
  .issyma-home > header a[href="/"].font-heading {
    color: ${PALETTE.text} !important;
    font-family: var(--font-cormorant), 'Cormorant Garamond', serif !important;
    letter-spacing: 0.14em;
  }
  /* Nav links */
  .issyma-home > header nav a {
    color: ${PALETTE.muted} !important;
  }
  .issyma-home > header nav a:hover,
  .issyma-home > header nav a[data-nav-active="true"] {
    color: ${PALETTE.text} !important;
  }
  /* Icônes (recherche, user, panier, burger) */
  .issyma-home > header button {
    color: ${PALETTE.text} !important;
  }
  .issyma-home > header button:hover {
    color: ${PALETTE.rose} !important;
  }
  /* Compteur panier — préserve son fond rose brand */
  .issyma-home > header .cart-count { background-color: ${PALETTE.rose} !important; color: ${PALETTE.bg} !important; }
`;

// ── Card produit (utilisée par Nouveautés + Best sellers) ────────────────
function ProductCardIssyma({ p, badge }: { p: CarouselProduct; badge?: string }) {
  const primary = p.colors.find((c) => c.isPrimary) ?? p.colors[0];
  const href = `/produits/${buildProductHandle(p.name, p.reference)}`;
  const image = primary?.firstImage ?? null;
  const price = primary ? primary.unitPrice : null;

  return (
    <Link href={href} className="product-card group block">
      <div className="relative aspect-square overflow-hidden rounded-2xl" style={{ background: PALETTE.card }}>
        {image ? (
          <Image src={image} alt={p.name} width={800} height={800} className="w-full h-full object-cover" />
        ) : null}
        {badge && (
          <span
            className="absolute top-4 left-4 text-[10px] tracking-[0.24em] uppercase px-3 py-1 rounded-full backdrop-blur"
            style={{ color: PALETTE.rose, background: `${PALETTE.bg}b3` }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="mt-5">
        <h3 className="serif text-xl" style={{ color: PALETTE.text }}>{p.name}</h3>
        {primary?.name && (
          <p className="text-sm mt-1 font-light" style={{ color: PALETTE.muted }}>{primary.name}</p>
        )}
        {price != null && (
          <p className="text-sm mt-2 tracking-wide" style={{ color: PALETTE.rose }}>
            {price.toFixed(2).replace(".", ",")} €
          </p>
        )}
      </div>
    </Link>
  );
}

export default async function HomeIssymaLayout({
  shopName,
  bannerImage,
  heroOverrides,
  productCount,
  newCards,
  bestSellerCards,
  categories,
  collections,
  reviews,
  faqItems,
  jsonLdBlocks,
}: HomeLayoutProps) {
  const t = await getTranslations("home");

  // Fallbacks éditoriaux (respectent l'esprit du design) — la cliente peut
  // toujours override via SiteConfig depuis Paramètres → Contenu accueil.
  const heroEyebrow = heroOverrides.heroEyebrow || `Grossiste bijoux fantaisie · Depuis 2018`;
  const heroTitle1  = heroOverrides.heroTitleLine1 || `L'élégance`;
  const heroTitle2  = heroOverrides.heroTitleLine2 || `sans compromis.`;
  const heroDesc    = heroOverrides.heroDescription ||
    `Une sélection pointue pensée pour les boutiques exigeantes — expédition en 24 à 48 h, sans lot imposé.`;
  const heroCtaLabel = heroOverrides.heroCtaSecondaryLabel || `Ouvrir un compte pro`;
  const heroCtaHref  = heroOverrides.heroCtaSecondaryHref  || `/inscription`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ISSYMA_STYLES }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }} />

      <div className="issyma-home min-h-screen antialiased">

        {/* ─── HEADER PUBLIC ────────────────────────────────────────────── */}
        {/* Même composant que Beliandjolie — expose : badge de statut client
            (Vérifié / Non vérifié / Admin), icône user avec dropdown login/
            inscription/déconnexion, recherche, panier + compteur, menu mobile.
            Reste sticky, se cale sous la bannière défilante via
            `--announcement-height`. */}
        <PublicSidebar shopName={shopName} />

        {/* ─── HERO ─────────────────────────────────────────────────────── */}
        {/* `isolate` : crée un nouveau stacking context — sinon la bannière
            de fond, envoyée en absolute derrière, se retrouve masquée par le
            fond `#161011` du wrapper parent. */}
        <section className="relative hero-grain isolate overflow-hidden">
          {bannerImage && (
            <div aria-hidden className="absolute inset-0 z-0 pointer-events-none">
              <Image src={bannerImage} alt="" fill className="object-cover" />
              {/* Voile configurable depuis Paramètres → Contenu accueil (type,
                  direction, couleur, opacité). Même helper que la home BJ pour
                  garder la cohérence côté admin. */}
              <div
                className="absolute inset-0"
                style={{ background: heroOverlayBackground(heroOverrides.overlay) }}
              />
              {/* Fondu bas → couleur du fond section pour raccorder proprement
                  avec la section suivante (indépendant du voile ci-dessus). */}
              <div
                className="absolute inset-x-0 bottom-0 h-40"
                style={{
                  background: `linear-gradient(180deg, transparent 0%, ${PALETTE.bg} 100%)`,
                }}
              />
            </div>
          )}
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pt-24 sm:pt-32 lg:pt-40 pb-24 sm:pb-32">
            <div className="max-w-4xl">
              <p className="eyebrow mb-8">
                <span className="rose-underline" />{heroEyebrow}
              </p>
              <h1 className="serif text-5xl sm:text-6xl lg:text-7xl xl:text-[80px] leading-[1.02] font-medium" style={{ color: PALETTE.text }}>
                {heroTitle1}{" "}
                <span className="italic" style={{ color: PALETTE.rose }}>à l&apos;unité</span>,
                <br className="hidden sm:block" />
                {" "}{heroTitle2}
              </h1>
              <p className="mt-8 sm:mt-10 max-w-xl text-lg sm:text-xl leading-relaxed font-light" style={{ color: PALETTE.muted }}>
                {heroDesc}
              </p>

              <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <Link
                  href="/produits"
                  className="btn-rose inline-flex items-center gap-3 px-8 py-4 rounded-full text-[12px] tracking-[0.24em] uppercase font-medium"
                >
                  Découvrir la collection <span aria-hidden="true">→</span>
                </Link>
                <Link
                  href={heroCtaHref}
                  className="btn-outline-rose inline-flex items-center gap-3 px-8 py-4 rounded-full text-[12px] tracking-[0.24em] uppercase font-medium"
                >
                  {heroCtaLabel}
                </Link>
              </div>

              <div className="mt-16 flex items-center gap-6 text-xs tracking-[0.2em] uppercase" style={{ color: PALETTE.muted }}>
                <span>{productCount}+ références</span>
                <span style={{ color: PALETTE.border }}>·</span>
                <span>Paiement sécurisé</span>
                <span style={{ color: PALETTE.border }} className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">Livraison rapide</span>
              </div>
            </div>
          </div>
          <div className="hairline" />
        </section>

        {/* ─── NOUVEAUTÉS ───────────────────────────────────────────────── */}
        {newCards.length > 0 && (
          <section style={{ background: PALETTE.bg }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-14 sm:mb-16">
                <div>
                  <p className="eyebrow mb-4"><span className="rose-underline" />{t("newProductsEyebrow")}</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>
                    Les dernières <span className="italic" style={{ color: PALETTE.rose }}>nouveautés</span>.
                  </h2>
                </div>
                <Link href="/produits?new=1" className="link-rose text-[12px] tracking-[0.24em] uppercase self-start sm:self-end">
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
        <section style={{ background: PALETTE.bgAlt }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-32">
            <div className="max-w-3xl mb-16 sm:mb-20">
              <p className="eyebrow mb-5"><span className="rose-underline" />Notre engagement</p>
              <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>
                Pourquoi les boutiques <br className="hidden md:block" />
                nous <span className="italic" style={{ color: PALETTE.rose }}>choisissent</span>.
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
                  <p className="serif text-5xl sm:text-6xl font-medium leading-none" style={{ color: PALETTE.rose }}>{it.n}</p>
                  <span className="block w-8 h-[1px] mt-5" style={{ background: PALETTE.rose }} />
                  <h3 className="serif text-2xl mt-6" style={{ color: PALETTE.text }}>{it.title}</h3>
                  <p className="text-[15px] mt-3 font-light leading-relaxed" style={{ color: PALETTE.muted }}>{it.desc}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hairline" />
        </section>

        {/* ─── CATÉGORIES ───────────────────────────────────────────────── */}
        {categories.length > 0 && (
          <section style={{ background: PALETTE.bg }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="text-center max-w-2xl mx-auto mb-16">
                <p className="eyebrow mb-4">Explorer</p>
                <h2 className="serif text-4xl sm:text-5xl leading-tight" style={{ color: PALETTE.text }}>
                  Nos <span className="italic" style={{ color: PALETTE.rose }}>catégories</span>.
                </h2>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-6 sm:gap-8">
                {categories.map((c) => (
                  <Link key={c.id} href={`/categories/${c.slug}`} className="flex flex-col items-center gap-4 group">
                    <div
                      className="cat-circle w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden"
                      style={{ border: `1px solid ${PALETTE.border}`, background: PALETTE.card }}
                    >
                      {c.image ? (
                        <Image src={c.image} alt={c.name} width={200} height={200} className="w-full h-full object-cover opacity-90" />
                      ) : null}
                    </div>
                    <span className="serif text-lg text-center leading-tight" style={{ color: PALETTE.text }}>{c.name}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="hairline" />
          </section>
        )}

        {/* ─── COLLECTIONS ──────────────────────────────────────────────── */}
        {collections.length > 0 && (
          <section style={{ background: PALETTE.bgAlt }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-14 sm:mb-16">
                <div>
                  <p className="eyebrow mb-4"><span className="rose-underline" />À la une</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>
                    Nos <span className="italic" style={{ color: PALETTE.rose }}>collections</span>.
                  </h2>
                </div>
                <Link href="/collections" className="link-rose text-[12px] tracking-[0.24em] uppercase self-start sm:self-end">
                  Toutes les collections →
                </Link>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
                {/* Grande tuile = 1ère collection */}
                {collections[0] && (
                  <Link
                    href={collections[0].slug ? `/collections/${collections[0].slug}` : "/collections"}
                    className="collection-tile relative rounded-2xl overflow-hidden aspect-[4/5] lg:aspect-auto lg:h-[560px] block group"
                    style={{ background: PALETTE.card }}
                  >
                    {collections[0].image && (
                      <Image src={collections[0].image} alt={collections[0].name} fill className="object-cover" />
                    )}
                    <div className="overlay absolute inset-0" style={{ background: `linear-gradient(to top, ${PALETTE.bg}f2, ${PALETTE.bg}4d, transparent)` }} />
                    <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-10">
                      <p className="eyebrow mb-3">Collection</p>
                      <h3 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>{collections[0].name}</h3>
                      <p className="text-sm mt-3 font-light" style={{ color: PALETTE.muted }}>{collections[0]._count.products} pièces</p>
                    </div>
                  </Link>
                )}

                {/* 2 tuiles empilées à droite */}
                <div className="grid grid-cols-1 gap-6 lg:gap-8">
                  {collections.slice(1, 3).map((col) => (
                    <Link
                      key={col.id}
                      href={col.slug ? `/collections/${col.slug}` : "/collections"}
                      className="collection-tile relative rounded-2xl overflow-hidden aspect-[16/10] lg:h-[268px] block group"
                      style={{ background: PALETTE.card }}
                    >
                      {col.image && (
                        <Image src={col.image} alt={col.name} fill className="object-cover" />
                      )}
                      <div className="overlay absolute inset-0" style={{ background: `linear-gradient(to top, ${PALETTE.bg}f2, ${PALETTE.bg}4d, transparent)` }} />
                      <div className="absolute inset-0 flex flex-col justify-end p-8">
                        <p className="eyebrow mb-2">Collection</p>
                        <h3 className="serif text-3xl sm:text-4xl" style={{ color: PALETTE.text }}>{col.name}</h3>
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
          <section style={{ background: PALETTE.bg }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-14 sm:mb-16">
                <div>
                  <p className="eyebrow mb-4"><span className="rose-underline" />{t("bestsellersEyebrow")}</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>
                    Nos <span className="italic" style={{ color: PALETTE.rose }}>best sellers</span>.
                  </h2>
                </div>
                <Link href="/produits?bestseller=1" className="link-rose text-[12px] tracking-[0.24em] uppercase self-start sm:self-end">
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
          <section style={{ background: PALETTE.bgAlt }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-28">
              <div className="max-w-2xl mb-14 sm:mb-16">
                <p className="eyebrow mb-4"><span className="rose-underline" />{t("reviewsEyebrow")}</p>
                <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>
                  Paroles de <span className="italic" style={{ color: PALETTE.rose }}>boutiques</span>.
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
                {reviews.slice(0, 3).map((r) => (
                  <blockquote
                    key={r.id}
                    className="rounded-2xl p-8 sm:p-10"
                    style={{ background: PALETTE.card, border: `1px solid ${PALETTE.border}` }}
                  >
                    <span className="serif text-6xl leading-none block -mb-4" style={{ color: PALETTE.rose }}>&ldquo;</span>
                    <p className="serif italic text-lg leading-relaxed" style={{ color: PALETTE.text }}>
                      {r.text}
                    </p>
                    <footer className="mt-8 flex items-center justify-between">
                      <div className="text-xs tracking-[0.2em] uppercase" style={{ color: PALETTE.muted }}>
                        {r.name}
                      </div>
                      <div className="text-sm tracking-widest" style={{ color: PALETTE.rose }}>
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
          <section style={{ background: PALETTE.bg }}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-24 sm:py-32">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
                <div>
                  <p className="eyebrow mb-5"><span className="rose-underline" />{t("faqEyebrow")}</p>
                  <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight" style={{ color: PALETTE.text }}>
                    Avant de <span className="italic" style={{ color: PALETTE.rose }}>commander</span>.
                  </h2>
                  <p className="mt-6 max-w-lg font-light text-[15px] leading-relaxed" style={{ color: PALETTE.muted }}>
                    Nous avons rassemblé les questions les plus courantes des professionnels.
                    Prenez le temps de les parcourir — vous y trouverez sans doute votre réponse.
                  </p>

                  <div className="mt-10 rounded-2xl p-8" style={{ background: PALETTE.card, border: `1px solid ${PALETTE.border}` }}>
                    <p className="serif text-2xl leading-snug" style={{ color: PALETTE.text }}>
                      {t("faqContactTitle")}
                    </p>
                    <p className="mt-3 text-[15px] font-light" style={{ color: PALETTE.muted }}>
                      {t("faqContactDesc")}
                    </p>
                    <Link
                      href="/nous-contacter"
                      className="mt-6 inline-flex items-center gap-3 px-6 py-3 rounded-full text-[12px] tracking-[0.24em] uppercase font-medium transition hover:opacity-90"
                      style={{ background: PALETTE.roseSoft, color: PALETTE.bg }}
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
                          <span className="serif text-xl sm:text-2xl leading-snug" style={{ color: PALETTE.text }}>
                            {item.question}
                          </span>
                          <span className="plus text-2xl font-light shrink-0 leading-none mt-1" style={{ color: PALETTE.rose }} />
                        </summary>
                        <p className="pb-6 pr-10 font-light text-[15px] leading-relaxed" style={{ color: PALETTE.muted }}>
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

        {/* ─── CTA BANDEAU ROSE ─────────────────────────────────────────── */}
        <section style={{ background: PALETTE.roseCta }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-16 sm:py-20 flex flex-col md:flex-row md:items-center md:justify-between gap-10">
            <div className="max-w-2xl">
              <h2 className="serif text-4xl sm:text-5xl lg:text-6xl leading-tight text-white">
                Prêt à enrichir votre boutique ?
              </h2>
              <p className="text-white/85 mt-4 text-lg font-light">
                Rejoignez les boutiques qui ont choisi {shopName} pour leurs bijoux fantaisie.
              </p>
            </div>
            <Link
              href="/inscription"
              className="inline-flex items-center gap-3 px-10 py-5 bg-white text-[13px] tracking-[0.22em] uppercase font-medium shadow-sm transition hover:opacity-90 self-start md:self-auto"
              style={{ color: PALETTE.roseCta }}
            >
              Créer un compte professionnel <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        {/* ─── FOOTER ───────────────────────────────────────────────────── */}
        <footer style={{ background: PALETTE.bg }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-20">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
              <div>
                <p className="serif text-2xl tracking-[0.18em]" style={{ color: PALETTE.text }}>{shopName.toUpperCase()}</p>
                <p className="mt-5 text-sm font-light leading-relaxed max-w-xs" style={{ color: PALETTE.muted }}>
                  Grossiste bijoux fantaisie pour les boutiques exigeantes. Vente à l&apos;unité, expédition rapide, service dédié.
                </p>
              </div>
              <div>
                <p className="eyebrow mb-5">La maison</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: PALETTE.muted }}>
                  <li><Link href="/a-propos"      className="hover:opacity-80 transition">À propos</Link></li>
                  <li><Link href="/nous-contacter" className="hover:opacity-80 transition">Contact</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5">Boutique</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: PALETTE.muted }}>
                  <li><Link href="/produits?new=1"        className="hover:opacity-80 transition">Nouveautés</Link></li>
                  <li><Link href="/categories"            className="hover:opacity-80 transition">Catégories</Link></li>
                  <li><Link href="/collections"           className="hover:opacity-80 transition">Collections</Link></li>
                  <li><Link href="/produits?bestseller=1" className="hover:opacity-80 transition">Best sellers</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5">Aide</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: PALETTE.muted }}>
                  <li><Link href="/cgv"                className="hover:opacity-80 transition">CGV</Link></li>
                  <li><Link href="/mentions-legales"   className="hover:opacity-80 transition">Mentions légales</Link></li>
                  <li><Link href="/confidentialite"    className="hover:opacity-80 transition">Confidentialité</Link></li>
                </ul>
              </div>
            </div>

            <div className="hairline mt-16 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center">
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: PALETTE.muted }}>
                © {new Date().getFullYear()} {shopName} · Tous droits réservés
              </p>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: PALETTE.muted }}>
                Fabriqué avec soin en France
              </p>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
