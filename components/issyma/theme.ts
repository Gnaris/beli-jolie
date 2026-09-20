/**
 * Palette + styles CSS partagés par toutes les pages Issyma (accueil,
 * catalogue, catégories, collections, fiche produit).
 *
 * Une seule source de vérité — modifier ici propage à toutes les pages
 * Issyma. AUCUN impact sur Beli & Jolie (chaque page a son propre aiguilleur
 * qui rend le layout du tenant courant).
 *
 * Le nom de la classe racine `.issyma-page` est identique à `.issyma-home`
 * historique pour compat visuelle : à terme, les 2 pointent la même chose.
 */

export const ISSYMA_PALETTE = {
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

const P = ISSYMA_PALETTE;

/**
 * CSS scopé strict sur `.issyma-page` (et `.issyma-home` pour compat historique
 * — le sélecteur combiné évite d'avoir à refactorer la home tout de suite).
 * Aucun style ne peut fuiter vers Beliandjolie.
 */
export const ISSYMA_STYLES = `
  .issyma-page, .issyma-home { background: ${P.paper}; color: ${P.ink}; font-family: var(--font-roboto), 'Inter', system-ui, sans-serif; font-weight: 400; }
  .issyma-page .serif, .issyma-home .serif { font-family: var(--font-poppins), 'Inter', system-ui, sans-serif; font-weight: 700; letter-spacing: -0.02em; }
  .issyma-page .eyebrow, .issyma-home .eyebrow {
    font-family: var(--font-roboto), Inter, system-ui, sans-serif;
    font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase;
    color: ${P.wine700}; font-weight: 600;
  }
  .issyma-page .eyebrow-muted, .issyma-home .eyebrow-muted {
    font-family: var(--font-roboto), Inter, system-ui, sans-serif;
    font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase;
    color: ${P.muted}; font-weight: 500;
  }
  .issyma-page .wine-underline, .issyma-home .wine-underline {
    display: inline-block; width: 32px; height: 1px;
    background: ${P.wine700}; vertical-align: middle; margin-right: 12px;
  }
  .issyma-page details > summary, .issyma-home details > summary { list-style: none; cursor: pointer; }
  .issyma-page details > summary::-webkit-details-marker,
  .issyma-home details > summary::-webkit-details-marker { display: none; }
  .issyma-page details .plus::before, .issyma-home details .plus::before { content: "+"; }
  .issyma-page details[open] .plus::before, .issyma-home details[open] .plus::before { content: "−"; }
  .issyma-page .link-wine, .issyma-home .link-wine { color: ${P.wine700}; transition: color 200ms ease; }
  .issyma-page .link-wine:hover, .issyma-home .link-wine:hover { color: ${P.wine500}; }

  .issyma-page .btn-cream, .issyma-home .btn-cream {
    background: ${P.cream}; color: ${P.wine900};
    transition: transform 200ms ease, background 200ms ease;
    box-shadow: 0 1px 0 rgba(0,0,0,0.06);
  }
  .issyma-page .btn-cream:hover, .issyma-home .btn-cream:hover { background: #fff3dd; transform: translateY(-1px); }
  .issyma-page .btn-outline-cream, .issyma-home .btn-outline-cream {
    border: 1px solid rgba(244, 234, 217, 0.55); color: ${P.cream};
    transition: background 200ms ease, border-color 200ms ease;
  }
  .issyma-page .btn-outline-cream:hover, .issyma-home .btn-outline-cream:hover { background: rgba(244, 234, 217, 0.08); border-color: rgba(244, 234, 217, 0.85); }
  .issyma-page .btn-wine, .issyma-home .btn-wine {
    background: ${P.wine700}; color: #fff;
    transition: background 200ms ease;
  }
  .issyma-page .btn-wine:hover, .issyma-home .btn-wine:hover { background: ${P.wine800}; }
  .issyma-page .btn-outline-wine, .issyma-home .btn-outline-wine {
    background: transparent; border: 1px solid ${P.wine700}; color: ${P.wine700};
    transition: background 200ms ease;
  }
  .issyma-page .btn-outline-wine:hover, .issyma-home .btn-outline-wine:hover { background: rgba(122, 42, 60, 0.06); }

  .issyma-page .wine-panel, .issyma-home .wine-panel {
    background: linear-gradient(135deg, ${P.wine900} 0%, ${P.wine700} 55%, ${P.wine600} 100%);
    position: relative;
    overflow: hidden;
  }

  .issyma-page .paper-card, .issyma-home .paper-card {
    background: ${P.paper};
    border-radius: 20px;
    box-shadow:
      0 30px 60px -30px rgba(50, 15, 25, 0.25),
      0 8px 20px -12px rgba(50, 15, 25, 0.15);
  }

  .issyma-page .pill, .issyma-home .pill {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 18px; border-radius: 999px;
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600;
  }

  .issyma-page .cat-chip, .issyma-home .cat-chip {
    background: ${P.paper};
    border: 1px solid ${P.borderSoft};
    border-radius: 20px;
    transition: transform 300ms ease, border-color 300ms ease, box-shadow 300ms ease;
  }
  .issyma-page .cat-chip:hover, .issyma-home .cat-chip:hover {
    transform: translateY(-2px);
    border-color: #e2b8ae;
    box-shadow: 0 20px 40px -30px rgba(95, 34, 49, 0.35);
  }
  .issyma-page .cat-icon, .issyma-home .cat-icon {
    background: linear-gradient(135deg, ${P.blush50}, #f2d9d3);
    color: ${P.wine700};
    border: 1px solid #efd6cf;
  }

  .issyma-page .pill-new, .issyma-home .pill-new {
    background: linear-gradient(135deg, ${P.wine700}, ${P.wine600});
    color: ${P.cream};
    padding: 6px 14px;
    border-radius: 9999px;
    font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; font-weight: 700;
    box-shadow: 0 8px 22px -12px rgba(95, 34, 49, 0.55);
  }

  .issyma-page .thumb-placeholder, .issyma-home .thumb-placeholder {
    background:
      radial-gradient(120% 90% at 100% 0%, rgba(197, 140, 140, 0.35), transparent 55%),
      radial-gradient(90% 80% at 0% 100%, rgba(244, 234, 217, 0.55), transparent 55%),
      linear-gradient(180deg, #f6ecea 0%, #eddad6 100%);
    display: flex; align-items: center; justify-content: center;
  }

  .issyma-page .product-card img, .issyma-home .product-card img { transition: transform 700ms ease; }
  .issyma-page .product-card:hover img, .issyma-home .product-card:hover img { transform: scale(1.04); }

  /* Header Issyma bordeaux scopé strict — s'applique aussi au layout de page. */
  .issyma-page > header, .issyma-home > header {
    background-color: rgba(42, 15, 21, 0.96) !important;
    border-color: rgba(244, 234, 217, 0.12) !important;
    backdrop-filter: blur(10px);
  }
  .issyma-page > header .border-neutral-100,
  .issyma-page > header .border-neutral-200,
  .issyma-home > header .border-neutral-100,
  .issyma-home > header .border-neutral-200 {
    border-color: rgba(244, 234, 217, 0.12) !important;
  }
  .issyma-page > header a.font-heading,
  .issyma-home > header a.font-heading {
    color: #ffffff !important;
    letter-spacing: 0.14em;
    font-weight: 700 !important;
  }
  .issyma-page > header nav a,
  .issyma-home > header nav a { color: ${P.cream2} !important; }
  .issyma-page > header nav a:hover,
  .issyma-page > header nav a[data-nav-active="true"],
  .issyma-home > header nav a:hover,
  .issyma-home > header nav a[data-nav-active="true"] { color: ${P.cream} !important; }

  .issyma-page > header .text-neutral-700,
  .issyma-home > header .text-neutral-700 { color: ${P.cream} !important; }
  .issyma-page > header a.text-neutral-700:hover,
  .issyma-page > header button.text-neutral-700:hover,
  .issyma-home > header a.text-neutral-700:hover,
  .issyma-home > header button.text-neutral-700:hover { color: #ffffff !important; }

  .issyma-page > header button[aria-label="Menu"],
  .issyma-home > header button[aria-label="Menu"] { color: ${P.cream} !important; }
  .issyma-page > header button[aria-label="Menu"]:hover,
  .issyma-home > header button[aria-label="Menu"]:hover { color: #ffffff !important; }

  .issyma-page > header [class*="bg-bg-primary"],
  .issyma-home > header [class*="bg-bg-primary"] {
    color: ${P.ink} !important;
  }
  .issyma-page > header [class*="bg-bg-primary"] a,
  .issyma-page > header [class*="bg-bg-primary"] button,
  .issyma-page > header [class*="bg-bg-primary"] p,
  .issyma-page > header [class*="bg-bg-primary"] span,
  .issyma-home > header [class*="bg-bg-primary"] a,
  .issyma-home > header [class*="bg-bg-primary"] button,
  .issyma-home > header [class*="bg-bg-primary"] p,
  .issyma-home > header [class*="bg-bg-primary"] span {
    color: ${P.ink} !important;
  }
  .issyma-page > header [class*="bg-bg-primary"] .text-text-muted,
  .issyma-page > header [class*="bg-bg-primary"] .text-text-secondary,
  .issyma-home > header [class*="bg-bg-primary"] .text-text-muted,
  .issyma-home > header [class*="bg-bg-primary"] .text-text-secondary {
    color: ${P.inkSoft} !important;
  }
  .issyma-page > header [class*="bg-bg-primary"] .text-warning,
  .issyma-home > header [class*="bg-bg-primary"] .text-warning {
    color: #b45309 !important;
  }

  /* ─── Overrides globaux pour les composants BJ réutilisés dans une page
     Issyma (wizard panier, tunnel commande, étape livraison, paiement).
     Portée strictement scopée à .issyma-page pour ne jamais fuiter chez BJ. ─── */

  /* Boutons primaires noir/dark → bordeaux */
  .issyma-page .bg-black,
  .issyma-page .bg-slate-900,
  .issyma-page .bg-slate-800,
  .issyma-page .bg-zinc-900,
  .issyma-page .bg-neutral-900,
  .issyma-page .bg-gray-900 {
    background-color: ${P.wine700} !important;
  }
  .issyma-page .hover\\:bg-black:hover,
  .issyma-page .hover\\:bg-slate-900:hover,
  .issyma-page .hover\\:bg-slate-800:hover,
  .issyma-page .hover\\:bg-zinc-900:hover,
  .issyma-page .hover\\:bg-neutral-900:hover {
    background-color: ${P.wine800} !important;
  }

  /* Texte primaire → wine700 (accents décisifs) */
  .issyma-page .text-black,
  .issyma-page .text-slate-900,
  .issyma-page .text-zinc-900,
  .issyma-page .text-neutral-900,
  .issyma-page .text-gray-900 {
    color: ${P.ink} !important;
  }

  /* Fond secondaire gris (sections, alt rows) → blush50 */
  .issyma-page .bg-slate-50,
  .issyma-page .bg-zinc-50,
  .issyma-page .bg-neutral-50,
  .issyma-page .bg-gray-50 {
    background-color: ${P.blush50} !important;
  }

  /* Bordures grises → bordure crème Issyma */
  .issyma-page .border-slate-200,
  .issyma-page .border-slate-300,
  .issyma-page .border-zinc-200,
  .issyma-page .border-neutral-200,
  .issyma-page .border-gray-200 {
    border-color: ${P.borderSoft} !important;
  }

  /* Anneaux focus / rings → wine700 */
  .issyma-page .ring-slate-900,
  .issyma-page .ring-slate-800,
  .issyma-page .ring-black {
    --tw-ring-color: ${P.wine700} !important;
  }
  .issyma-page .focus\\:ring-slate-900:focus,
  .issyma-page .focus\\:ring-black:focus {
    --tw-ring-color: ${P.wine700} !important;
  }

  /* Accent classes projet BJ */
  .issyma-page .text-accent,
  .issyma-page .text-text-primary {
    color: ${P.ink} !important;
  }
  .issyma-page .bg-accent {
    background-color: ${P.wine700} !important;
    color: ${P.cream} !important;
  }
  .issyma-page .border-accent {
    border-color: ${P.wine700} !important;
  }
  .issyma-page .hover\\:text-accent:hover {
    color: ${P.wine700} !important;
  }
  .issyma-page .hover\\:border-accent:hover {
    border-color: ${P.wine700} !important;
  }

  /* Wizard stepper (pastilles étapes) : la pastille active devient bordeaux */
  .issyma-page [class*="rounded-full"][class*="bg-slate-900"],
  .issyma-page [class*="rounded-full"][class*="bg-black"] {
    background-color: ${P.wine700} !important;
    color: ${P.cream} !important;
  }
`;
