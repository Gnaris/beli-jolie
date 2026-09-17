import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Image from "@/components/ui/SmartImage";
import { buildProductHandle } from "@/lib/product-url";
import PublicSidebar from "@/components/layout/PublicSidebar";
import type { CarouselProduct } from "@/components/home/ProductCarousel";
import type { HomeLayoutProps } from "./HomeLayoutProps";

/* ─────────────────────────────────────────────────────────────────────────
   Home Issyma — variante « Bordeaux Showroom »
   Le hero reste 100 % bordeaux (identité maison, validée le 2026-09-16).
   Toutes les sections en dessous ont été rééquilibrées le 2026-09-17 sur
   du blanc / crème / rose poudré selon les 3 maquettes ChatGPT validées
   par Issyma. Modifier ici n'a AUCUN impact sur la home Beliandjolie
   (`HomeBeliandjolieLayout.tsx`).
   ───────────────────────────────────────────────────────────────────────── */

const PALETTE = {
  wine950: "#2a0f15",
  wine900: "#3d1620",
  wine800: "#4d1b28",
  wine700: "#5f2231",
  wine600: "#7a2a3c",
  wine500: "#8b3446",
  rose:    "#c98090",
  cream:   "#f4ead9",
  cream2:  "#e8d9c1",
  paper:     "#ffffff",
  blush50:   "#fbf1ee",
  blush100:  "#f5e0da",
  ink:       "#2a1418",
  inkSoft:   "#6b5d5d",
  muted:     "#8a7460",
  borderSoft:"#e9dcd6",
} as const;

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
  .issyma-home { background: ${PALETTE.paper}; color: ${PALETTE.ink}; font-family: var(--font-roboto), 'Inter', system-ui, sans-serif; font-weight: 400; }
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
  .issyma-home details > summary { list-style: none; cursor: pointer; }
  .issyma-home details > summary::-webkit-details-marker { display: none; }
  .issyma-home details .plus::before { content: "+"; }
  .issyma-home details[open] .plus::before { content: "−"; }
  .issyma-home .link-wine { color: ${PALETTE.wine700}; transition: color 200ms ease; }
  .issyma-home .link-wine:hover { color: ${PALETTE.wine500}; }

  .issyma-home .btn-cream {
    background: ${PALETTE.cream}; color: ${PALETTE.wine900};
    transition: transform 200ms ease, background 200ms ease;
    box-shadow: 0 1px 0 rgba(0,0,0,0.06);
  }
  .issyma-home .btn-cream:hover { background: #fff3dd; transform: translateY(-1px); }
  .issyma-home .btn-outline-cream {
    border: 1px solid rgba(244, 234, 217, 0.55); color: ${PALETTE.cream};
    transition: background 200ms ease, border-color 200ms ease;
  }
  .issyma-home .btn-outline-cream:hover { background: rgba(244, 234, 217, 0.08); border-color: rgba(244, 234, 217, 0.85); }
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

  .issyma-home .wine-panel {
    background: linear-gradient(135deg, ${PALETTE.wine900} 0%, ${PALETTE.wine700} 55%, ${PALETTE.wine600} 100%);
    position: relative;
    overflow: hidden;
  }

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
    border-top: 1px solid ${PALETTE.borderSoft};
    align-items: center;
  }
  .issyma-home .info-row:last-child { border-bottom: 1px solid ${PALETTE.borderSoft}; }
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

  .issyma-home .reassurance-row {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .issyma-home .reassurance-row > div {
    border-left: 1px solid ${PALETTE.borderSoft};
  }
  .issyma-home .reassurance-row > div:first-child { border-left: none; }
  @media (max-width: 768px) {
    .issyma-home .reassurance-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .issyma-home .reassurance-row > div:nth-child(3) { border-left: none; border-top: 1px solid ${PALETTE.borderSoft}; }
    .issyma-home .reassurance-row > div:nth-child(4) { border-top: 1px solid ${PALETTE.borderSoft}; }
  }

  .issyma-home .cat-chip {
    background: ${PALETTE.paper};
    border: 1px solid ${PALETTE.borderSoft};
    border-radius: 20px;
    transition: transform 300ms ease, border-color 300ms ease, box-shadow 300ms ease;
  }
  .issyma-home .cat-chip:hover {
    transform: translateY(-2px);
    border-color: #e2b8ae;
    box-shadow: 0 20px 40px -30px rgba(95, 34, 49, 0.35);
  }
  .issyma-home .cat-icon {
    background: linear-gradient(135deg, ${PALETTE.blush50}, #f2d9d3);
    color: ${PALETTE.wine700};
    border: 1px solid #efd6cf;
  }

  .issyma-home .pill-new {
    background: linear-gradient(135deg, ${PALETTE.wine700}, ${PALETTE.wine600});
    color: ${PALETTE.cream};
    padding: 6px 14px;
    border-radius: 9999px;
    font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; font-weight: 700;
    box-shadow: 0 8px 22px -12px rgba(95, 34, 49, 0.55);
  }

  .issyma-home .thumb-placeholder {
    background:
      radial-gradient(120% 90% at 100% 0%, rgba(197, 140, 140, 0.35), transparent 55%),
      radial-gradient(90% 80% at 0% 100%, rgba(244, 234, 217, 0.55), transparent 55%),
      linear-gradient(180deg, #f6ecea 0%, #eddad6 100%);
    display: flex; align-items: center; justify-content: center;
  }

  .issyma-home .product-card img { transition: transform 700ms ease; }
  .issyma-home .product-card:hover img { transform: scale(1.04); }

  /* Header Issyma bordeaux scopé strict */
  .issyma-home > header {
    background-color: rgba(42, 15, 21, 0.96) !important;
    border-color: rgba(244, 234, 217, 0.12) !important;
    backdrop-filter: blur(10px);
  }
  .issyma-home > header .border-neutral-100,
  .issyma-home > header .border-neutral-200 {
    border-color: rgba(244, 234, 217, 0.12) !important;
  }
  .issyma-home > header a.font-heading {
    color: #ffffff !important;
    letter-spacing: 0.14em;
    font-weight: 700 !important;
  }
  .issyma-home > header nav a { color: ${PALETTE.cream2} !important; }
  .issyma-home > header nav a:hover,
  .issyma-home > header nav a[data-nav-active="true"] { color: ${PALETTE.cream} !important; }

  /* Icônes du header (favoris, panier, user, connexion) : PublicSidebar les
     rend avec la classe .text-neutral-700 pensée pour un fond blanc — sur
     notre bandeau bordeaux elles disparaissent. On force le cream, hover
     blanc pur, pour rester lisible. */
  .issyma-home > header .text-neutral-700 { color: ${PALETTE.cream} !important; }
  .issyma-home > header a.text-neutral-700:hover,
  .issyma-home > header button.text-neutral-700:hover { color: #ffffff !important; }
  .issyma-home > header .cart-count { background-color: ${PALETTE.wine600} !important; color: ${PALETTE.cream} !important; }

  /* Dropdown utilisateur (déclenché par l'icône user) : fond clair posé
     par PublicSidebar (bg-bg-primary/95). Sans surcharge, les textes
     "Retour admin" et "Déconnexion" hériteraient du cream du header et
     deviendraient illisibles. On restaure du texte sombre à l'intérieur. */
  .issyma-home > header [class*="bg-bg-primary"] {
    color: ${PALETTE.ink} !important;
  }
  .issyma-home > header [class*="bg-bg-primary"] a,
  .issyma-home > header [class*="bg-bg-primary"] button,
  .issyma-home > header [class*="bg-bg-primary"] p,
  .issyma-home > header [class*="bg-bg-primary"] span {
    color: ${PALETTE.ink} !important;
  }
  .issyma-home > header [class*="bg-bg-primary"] .text-text-muted,
  .issyma-home > header [class*="bg-bg-primary"] .text-text-secondary {
    color: ${PALETTE.inkSoft} !important;
  }
  /* "Retour admin" utilise text-warning (ambre) — on garde le signal
     coloré mais avec un ton foncé qui reste lisible sur fond blanc. */
  .issyma-home > header [class*="bg-bg-primary"] .text-warning {
    color: #b45309 !important;
  }
`;

// Icônes — encapsulées pour ne pas encombrer le rendu
function IconTruck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>
  );
}
function IconBox() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="12" rx="1"/><path d="M8 8V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3"/><path d="M3 13h18"/></svg>
  );
}
function IconCard() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
  );
}
function IconStore() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v3h12V3"/><path d="M6 6l-2 3v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9l-2-3"/><path d="M9 12h6"/></svg>
  );
}
function IconGarment() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l4-3h8l4 3-3 3-2-1v11H9V9l-2 1z"/></svg>
  );
}

function ProductCardIssyma({ p, badge }: { p: CarouselProduct; badge?: string }) {
  const primary = p.colors.find((c) => c.isPrimary) ?? p.colors[0];
  const href = `/produits/${buildProductHandle(p.name, p.reference)}`;
  const image = primary?.firstImage ?? null;
  const price = primary ? primary.unitPrice : null;

  return (
    <Link href={href} className="product-card group block">
      <div className="relative aspect-square overflow-hidden rounded-2xl">
        {image ? (
          <Image src={image} alt={p.name} width={800} height={800} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 thumb-placeholder">
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                width: "38%", aspectRatio: "1/1",
                background: "radial-gradient(60% 60% at 50% 40%, #f6ede8 0%, #e6d1cb 70%, #dcc4be 100%)",
                boxShadow: "inset 0 -6px 20px rgba(122, 42, 60, 0.08)",
                color: "#c98a8a",
                opacity: 0.6,
              }}
            >
              <div style={{ width: "36%" }}>
                <IconGarment />
              </div>
            </div>
          </div>
        )}
        {badge && (
          <span className="pill-new absolute top-4 left-4">
            {badge}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className="text-[10px] tracking-[0.24em] uppercase font-semibold" style={{ color: PALETTE.muted }}>
          {p.reference} · {p.category}
        </p>
        <h3 className="serif text-base mt-1.5 font-semibold" style={{ color: PALETTE.ink }}>
          {p.name}
        </h3>
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

  // Tile bordeaux « Nouvelle collection » = 1re collection dispo. Si aucune,
  // la tile disparait et on montre une categorie de plus a la place.
  const featureCollection = collections[0] ?? null;
  const featureCatSlots = featureCollection ? 3 : 4;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ISSYMA_STYLES }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdBlocks) }} />

      <div className="issyma-home min-h-screen antialiased">

        <PublicSidebar shopName={shopName} />

        {/* HERO — inchange */}
        <section className="wine-panel relative overflow-hidden">
          <Image
            src="/issyma-hero-bg.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-left lg:object-center"
          />
          <div
            aria-hidden
            className="absolute inset-0 z-[1] pointer-events-none"
            style={{
              background: `linear-gradient(90deg, rgba(42, 15, 21, 0.55) 0%, rgba(42, 15, 21, 0.28) 22%, rgba(42, 15, 21, 0.08) 42%, transparent 58%)`,
            }}
          />
          <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10">
            <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 lg:gap-8 items-stretch py-10 sm:py-12 lg:py-14">
              <div className="p-2 sm:p-4 lg:p-6 flex flex-col min-h-[520px] lg:min-h-[600px]">
                <p className="eyebrow" style={{ color: `${PALETTE.cream2}cc` }}>
                  {t("issyma.eyebrow")}
                </p>
                <h1 className="serif mt-8"
                    style={{
                      color: PALETTE.cream,
                      fontSize: "clamp(2.4rem, 5.4vw, 4.6rem)",
                      lineHeight: 1.05,
                    }}>
                  {t("issyma.title1")}<br />
                  {t("issyma.title2")}
                </h1>
                <p className="mt-8 max-w-lg text-[15px] leading-[1.7] font-light"
                   style={{ color: `${PALETTE.cream}cc` }}>
                  {t("issyma.desc")}
                </p>
                <div className="mt-10 flex flex-wrap gap-3">
                  <Link
                    href="/produits"
                    className="btn-cream inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
                  >
                    {t("issyma.ctaCatalog")}
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link
                    href="/inscription"
                    className="btn-outline-cream inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
                  >
                    {t("issyma.ctaAccount")}
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
                      <span className="eyebrow" style={{ color: `${PALETTE.cream2}b3` }}>{t("issyma.showroomLabel")}</span>
                      <span className="text-[15px] mt-1 font-medium" style={{ color: PALETTE.cream }}>
                        {t("issyma.showroomAddress")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="paper-card p-8 sm:p-10 lg:p-11 flex flex-col">
                <h2 className="serif uppercase"
                    style={{
                      color: PALETTE.wine800,
                      fontSize: "clamp(1.5rem, 2.2vw, 1.9rem)",
                      letterSpacing: "0.02em",
                    }}>
                  {t("issyma.howToTitle")}
                </h2>
                <p className="mt-2 text-sm" style={{ color: "#8a7460" }}>
                  {t("issyma.howToSubtitle")}
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="pill btn-wine">{t("issyma.chipUnit")}</span>
                  <span className="pill btn-outline-wine">{t("issyma.chipMin")}</span>
                </div>

                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6">
                  {([1, 2, 3, 4] as const).map((n) => (
                    <div key={n} className="flex gap-4">
                      <span className="step-circle w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0">
                        {n}
                      </span>
                      <div>
                        <p className="text-[15px] font-semibold leading-tight" style={{ color: "#2a1418" }}>
                          {t(`issyma.step${n}Title` as "issyma.step1Title")}
                        </p>
                        <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "#8a7460" }}>
                          {t(`issyma.step${n}Desc` as "issyma.step1Desc")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex-1 min-h-[16px]" />

                <div className="mt-8">
                  <div className="info-row">
                    <span className="label">{t("issyma.tableShowroomLabel")}</span>
                    <span className="value">{t("issyma.tableShowroomValue")}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">{t("issyma.tableWebLabel")}</span>
                    <span className="value">{t("issyma.tableWebValue")}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">{t("issyma.tablePayLabel")}</span>
                    <span className="value">{t("issyma.tablePayValue")}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">{t("issyma.tableDeliveryLabel")}</span>
                    <span className="value">{t("issyma.tableDeliveryValue")}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 1) BANDEAU REASSURANCE */}
        <section
          style={{ background: PALETTE.paper, borderTop: `1px solid ${PALETTE.borderSoft}`, borderBottom: `1px solid ${PALETTE.borderSoft}` }}
        >
          <div className="max-w-[1440px] mx-auto reassurance-row">
            {([
              { key: 1, Icon: IconStore },
              { key: 2, Icon: IconBox },
              { key: 3, Icon: IconCard },
              { key: 4, Icon: IconTruck },
            ] as const).map(({ key, Icon }) => (
              <div key={key} className="flex items-center gap-4 px-6 py-8">
                <div className="w-11 h-11 rounded-full cat-icon flex items-center justify-center shrink-0">
                  <Icon />
                </div>
                <div>
                  <p className="text-[13px] font-semibold" style={{ color: PALETTE.ink }}>
                    {t(`issyma.stat${key}Title` as "issyma.stat1Title")}
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: PALETTE.inkSoft }}>
                    {t(`issyma.stat${key}Desc` as "issyma.stat1Desc")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 2) NOUVEAUTES */}
        {newCards.length > 0 && (
          <section style={{ background: PALETTE.paper }}>
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("newProductsEyebrow")}</p>
                  <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight" style={{ color: PALETTE.ink }}>
                    {t("issyma.newSimpleTitle")}
                  </h2>
                </div>
                <Link href="/produits?new=1" className="link-wine text-[12px] tracking-[0.24em] uppercase font-semibold self-start sm:self-end">
                  {t("issyma.newSeeAll")} →
                </Link>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                {newCards.slice(0, 4).map((p, i) => (
                  <ProductCardIssyma
                    key={p.id}
                    p={p}
                    badge={i < 2 ? t("issyma.badgeNew") : undefined}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 3) A EXPLORER — CATEGORIES + TILE COLLECTION */}
        {categories.length > 0 && (
          <section style={{ background: PALETTE.blush50 }}>
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("issyma.catEyebrow")}</p>
                  <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight" style={{ color: PALETTE.ink }}>
                    {t("issyma.catSimpleTitle")}
                  </h2>
                </div>
                <Link href="/categories" className="link-wine text-[12px] tracking-[0.24em] uppercase font-semibold self-start sm:self-end">
                  {t("issyma.catSeeAll")} →
                </Link>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                {categories.slice(0, featureCatSlots).map((c) => (
                  <Link
                    key={c.id}
                    href={`/categories/${c.slug}`}
                    className="cat-chip p-6 flex flex-col items-start gap-5 min-h-[220px] group"
                  >
                    <div className="cat-icon w-24 h-24 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                      {c.image ? (
                        <Image
                          src={c.image}
                          alt={c.name}
                          width={192}
                          height={192}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span
                          className="serif font-bold"
                          style={{ color: PALETTE.wine700, fontSize: "2rem", lineHeight: 1 }}
                          aria-hidden="true"
                        >
                          {c.name.trim().charAt(0).toUpperCase() || "?"}
                        </span>
                      )}
                    </div>
                    <div className="mt-auto">
                      <p className="serif text-lg font-semibold" style={{ color: PALETTE.ink }}>{c.name}</p>
                      <p className="text-[12px] mt-1" style={{ color: PALETTE.inkSoft }}>
                        {t("issyma.catProductsCount", { count: String(c._count.products) })}
                      </p>
                    </div>
                  </Link>
                ))}

                {featureCollection && (
                  <Link
                    href={featureCollection.slug ? `/collections/${featureCollection.slug}` : "/collections"}
                    className="rounded-2xl p-6 flex flex-col justify-between min-h-[220px] relative overflow-hidden"
                    style={{
                      background: `linear-gradient(135deg, ${PALETTE.wine900} 0%, ${PALETTE.wine700} 60%, ${PALETTE.wine600} 100%)`,
                      color: PALETTE.cream,
                    }}
                  >
                    {featureCollection.image && (
                      <Image
                        src={featureCollection.image}
                        alt=""
                        fill
                        sizes="(max-width: 768px) 50vw, 25vw"
                        className="object-cover opacity-25"
                      />
                    )}
                    <div className="relative z-10">
                      <p className="eyebrow" style={{ color: `${PALETTE.cream2}cc` }}>
                        {t("issyma.catFeatureEyebrow")}
                      </p>
                    </div>
                    <div className="relative z-10">
                      <p className="serif text-2xl leading-tight font-semibold" style={{ color: PALETTE.cream }}>
                        {featureCollection.name}
                      </p>
                      <p className="text-[12px] mt-2 font-light" style={{ color: `${PALETTE.cream2}cc` }}>
                        {t("issyma.catFeatureDesc")}
                      </p>
                    </div>
                    <div
                      aria-hidden
                      className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-30 pointer-events-none"
                      style={{ background: "radial-gradient(circle, #f4d4c4 0%, transparent 70%)" }}
                    />
                  </Link>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 4) BEST SELLERS */}
        {bestSellerCards.length > 0 && (
          <section style={{ background: PALETTE.blush100 }}>
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("issyma.bsSimpleEyebrow")}</p>
                  <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight" style={{ color: PALETTE.ink }}>
                    {t("issyma.bsSimpleTitle")}
                  </h2>
                </div>
                <Link href="/produits?bestseller=1" className="link-wine text-[12px] tracking-[0.24em] uppercase font-semibold self-start sm:self-end">
                  {t("issyma.bsSeeAll")} →
                </Link>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                {bestSellerCards.slice(0, 4).map((p) => <ProductCardIssyma key={p.id} p={p} />)}
              </div>
            </div>
          </section>
        )}

        {/* 5) AVIS CLIENTS */}
        {reviews.length > 0 && (
          <section style={{ background: PALETTE.paper }}>
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 mb-12">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("issyma.reviewsSimpleEyebrow")}</p>
                  <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight" style={{ color: PALETTE.ink }}>
                    {t("issyma.reviewsSimpleTitle")}
                  </h2>
                </div>
                {reviews.length > 3 && (
                  <Link href="/avis" className="link-wine text-[12px] tracking-[0.24em] uppercase font-semibold self-start sm:self-end">
                    {t("issyma.reviewsSeeAll")} →
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                {reviews.slice(0, 3).map((r) => (
                  <blockquote
                    key={r.id}
                    className="rounded-2xl p-8 flex flex-col h-full"
                    style={{ background: PALETTE.blush50, border: `1px solid ${PALETTE.borderSoft}` }}
                  >
                    <span className="serif text-6xl leading-none block -mb-4" style={{ color: PALETTE.wine700 }} aria-hidden="true">&ldquo;</span>
                    <p className="serif italic text-lg leading-relaxed" style={{ color: PALETTE.ink }}>
                      {r.text}
                    </p>
                    <div className="flex-1 min-h-[16px]" />
                    <footer className="mt-8 flex items-center justify-between">
                      <div className="text-xs tracking-[0.2em] uppercase font-semibold" style={{ color: PALETTE.muted }}>
                        {r.name}
                      </div>
                      <div className="text-sm tracking-widest" style={{ color: PALETTE.wine700 }} aria-label={`${r.rating} / 5`}>
                        {"★".repeat(Math.max(0, Math.min(5, r.rating)))}
                      </div>
                    </footer>
                  </blockquote>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 6) FAQ */}
        {faqItems.length > 0 && (
          <section style={{ background: PALETTE.blush50 }}>
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20 lg:py-24">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,340px)_1fr] gap-10 lg:gap-16">
                <div>
                  <p className="eyebrow mb-4"><span className="wine-underline" />{t("issyma.faqSimpleEyebrow")}</p>
                  <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight" style={{ color: PALETTE.ink }}>
                    {t("issyma.faqSimpleTitle")}
                  </h2>
                </div>

                <div style={{ borderTop: `1px solid ${PALETTE.borderSoft}`, borderBottom: `1px solid ${PALETTE.borderSoft}` }}>
                  {faqItems.map((item, idx) => (
                    <details
                      key={item.id}
                      open={idx === 0}
                      className="py-5"
                      style={{ borderTop: idx === 0 ? "none" : `1px solid ${PALETTE.borderSoft}` }}
                    >
                      <summary className="flex items-start justify-between gap-6">
                        <span className="serif text-lg sm:text-xl font-semibold" style={{ color: PALETTE.ink }}>
                          {item.question}
                        </span>
                        <span className="plus text-2xl font-light shrink-0 leading-none" style={{ color: PALETTE.wine700 }} />
                      </summary>
                      <p className="pt-3 pr-10 text-[14px] leading-relaxed" style={{ color: PALETTE.inkSoft }}>
                        {item.answer}
                      </p>
                    </details>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 7) CTA BORDEAUX */}
        <section className="wine-panel" style={{ borderRadius: 0 }}>
          <SilkTexture />
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-16 sm:py-20 text-center relative z-10">
            <h2 className="serif text-3xl sm:text-4xl lg:text-5xl leading-tight" style={{ color: PALETTE.cream }}>
              {t("issyma.ctaTitle")}
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed max-w-2xl mx-auto" style={{ color: `${PALETTE.cream2}cc` }}>
              {t("issyma.ctaSimpleDesc", { shopName })}
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Link
                href="/produits"
                className="btn-cream inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
              >
                {t("issyma.ctaSimpleBtn1")} <span aria-hidden="true">→</span>
              </Link>
              <Link
                href="/inscription"
                className="btn-outline-cream inline-flex items-center gap-3 px-7 py-3.5 rounded-full text-[11px] tracking-[0.22em] uppercase font-semibold"
              >
                {t("issyma.ctaSimpleBtn2")} <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ background: PALETTE.wine950 }}>
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-20">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
              <div>
                <p className="serif text-2xl tracking-[0.18em]" style={{ color: PALETTE.cream }}>{shopName.toUpperCase()}</p>
                <p className="mt-5 text-sm font-light leading-relaxed max-w-xs" style={{ color: `${PALETTE.cream}99` }}>
                  {t("issyma.footerAbout")}
                </p>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${PALETTE.cream2}cc` }}>{t("issyma.footerHouse")}</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${PALETTE.cream}99` }}>
                  <li><Link href="/a-propos"      className="hover:opacity-80 transition">{t("issyma.footerAboutLink")}</Link></li>
                  <li><Link href="/nous-contacter" className="hover:opacity-80 transition">{t("issyma.footerContact")}</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${PALETTE.cream2}cc` }}>{t("issyma.footerShop")}</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${PALETTE.cream}99` }}>
                  <li><Link href="/produits?new=1"        className="hover:opacity-80 transition">{t("issyma.footerNew")}</Link></li>
                  <li><Link href="/categories"            className="hover:opacity-80 transition">{t("issyma.footerCategories")}</Link></li>
                  <li><Link href="/collections"           className="hover:opacity-80 transition">{t("issyma.footerCollections")}</Link></li>
                  <li><Link href="/produits?bestseller=1" className="hover:opacity-80 transition">{t("issyma.footerBest")}</Link></li>
                </ul>
              </div>
              <div>
                <p className="eyebrow mb-5" style={{ color: `${PALETTE.cream2}cc` }}>{t("issyma.footerHelp")}</p>
                <ul className="space-y-3 text-sm font-light" style={{ color: `${PALETTE.cream}99` }}>
                  <li><Link href="/cgv"                className="hover:opacity-80 transition">{t("issyma.footerCgv")}</Link></li>
                  <li><Link href="/mentions-legales"   className="hover:opacity-80 transition">{t("issyma.footerLegal")}</Link></li>
                  <li><Link href="/confidentialite"    className="hover:opacity-80 transition">{t("issyma.footerPrivacy")}</Link></li>
                </ul>
              </div>
            </div>

            <div className="mt-16 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center"
                 style={{ borderTop: `1px solid ${PALETTE.wine800}` }}>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: `${PALETTE.cream}80` }}>
                © {new Date().getFullYear()} {shopName} · {t("issyma.footerRights")}
              </p>
              <p className="text-xs tracking-[0.2em] uppercase" style={{ color: `${PALETTE.cream}80` }}>
                {t("issyma.footerLocation")}
              </p>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
