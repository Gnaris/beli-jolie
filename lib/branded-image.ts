/**
 * Composition d'un badge « Réf » sur l'image d'un produit.
 *
 * Pas d'I/O disque : on prend un buffer source, on compose le badge en
 * haut-droite via Sharp + un overlay SVG, on retourne un buffer WebP.
 * Le rendu final est servi à la volée via `/api/branded-image` (boutique et
 * marketplaces URL-based) ou uploadé en mémoire à PFS (multipart).
 */

import crypto from "node:crypto";
import sharp from "sharp";

export type BrandedSize = "large" | "medium" | "thumb";

/**
 * Profil de taille du badge « RÉFÉRENCE ».
 *
 * - `standard` : 40 % de la largeur d'image, texte moyen. Bon compromis pour
 *   la boutique publique, PFS, Faire (dont les vignettes descendent rarement
 *   sous ~180 px).
 * - `large` : 50 % de la largeur, texte plus gros. Réservé aux marketplaces
 *   qui affichent les vignettes très petites — Ankorstore descend à ~130 px
 *   dans ses listes, où le profil `standard` devient illisible.
 *
 * Les 4 tailles ont été validées visuellement dans la maquette
 * `badge-reference-tailles.html` (2026-07-30, choix cliente : Faire=B, Ankor=C).
 */
export type BadgeVariant = "standard" | "large";

interface BadgeParams {
  widthPct: number;
  minWidth: number;
  maxWidth: number;
  headerFontPct: number;
  codeFontPct: number;
  headerPadYPct: number;
  codePadYPct: number;
  cornerRadius: number;
}

const BADGE_VARIANTS: Record<BadgeVariant, BadgeParams> = {
  standard: {
    widthPct: 0.40,
    minWidth: 160,
    maxWidth: 560,
    headerFontPct: 0.085,
    codeFontPct: 0.135,
    headerPadYPct: 0.42,
    codePadYPct: 0.38,
    cornerRadius: 6,
  },
  large: {
    widthPct: 0.50,
    minWidth: 200,
    maxWidth: 700,
    headerFontPct: 0.09,
    codeFontPct: 0.15,
    headerPadYPct: 0.45,
    codePadYPct: 0.40,
    cornerRadius: 8,
  },
};

const SIZE_TARGETS: Record<BrandedSize, number> = {
  large: 1200,
  medium: 800,
  thumb: 400,
};

const MIN_LARGE_WIDTH = 600;

const WEBP_OPTS = { lossless: true, quality: 100, effort: 2 } as const;

interface BadgeGeometry {
  svg: Buffer;
  x: number;
  y: number;
}

/**
 * Construit un badge SVG proportionnel à la largeur de l'image cible.
 * Position : haut-droite, marge = 2 % de la largeur.
 */
function buildBadgeSvg(
  reference: string,
  imageWidth: number,
  variant: BadgeVariant = "standard",
): BadgeGeometry {
  const p = BADGE_VARIANTS[variant];
  const badgeWidth = Math.max(
    p.minWidth,
    Math.min(p.maxWidth, Math.round(imageWidth * p.widthPct)),
  );

  const headerFontSize = Math.max(8, Math.round(badgeWidth * p.headerFontPct));
  // Police « naturelle » calculée à partir de la largeur du badge. Sert de
  // plafond ET de base pour la hauteur du bloc code — on garde la hauteur
  // constante quelle que soit la longueur de la référence pour que deux
  // vignettes côte à côte restent visuellement homogènes.
  const naturalCodeFontSize = Math.max(12, Math.round(badgeWidth * p.codeFontPct));
  const headerPadY = Math.max(3, Math.round(headerFontSize * p.headerPadYPct));
  const codePadY = Math.max(4, Math.round(naturalCodeFontSize * p.codePadYPct));
  const headerHeight = headerFontSize + headerPadY * 2;
  const codeHeight = naturalCodeFontSize + codePadY * 2;
  const badgeHeight = headerHeight + codeHeight;
  const cornerRadius = p.cornerRadius;

  const margin = Math.max(6, Math.round(imageWidth * 0.02));
  const x = Math.max(0, imageWidth - badgeWidth - margin);
  const y = margin;

  const safeRef = reference
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Auto-fit horizontal du code pour éviter le débordement sur les longues
  // références (« PRT-OREILLE174 »…). En monospace (Consolas/Courier New),
  // chaque glyphe occupe ~0.6 × font-size. On calcule la police max qui tient
  // dans la largeur disponible (badge moins padding horizontal de 4 %) et on
  // prend le min avec la police naturelle. Plancher à 9 px pour rester lisible.
  const padX = Math.max(8, Math.round(badgeWidth * 0.04));
  const availableTextWidth = Math.max(1, badgeWidth - 2 * padX);
  const MONO_CHAR_WIDTH_RATIO = 0.6;
  const maxCodeFontFromLength = Math.floor(
    availableTextWidth / (Math.max(1, reference.length) * MONO_CHAR_WIDTH_RATIO),
  );
  const codeFontSize = Math.max(
    9,
    Math.min(naturalCodeFontSize, maxCodeFontFromLength),
  );

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}" viewBox="0 0 ${badgeWidth} ${badgeHeight}">
  <defs>
    <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#334155"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="codeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#64748b"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="0.35"/>
    </filter>
    <clipPath id="badgeClip">
      <rect x="0" y="0" width="${badgeWidth}" height="${badgeHeight}" rx="${cornerRadius}" ry="${cornerRadius}"/>
    </clipPath>
  </defs>
  <g filter="url(#shadow)">
    <g clip-path="url(#badgeClip)">
      <rect x="0" y="0" width="${badgeWidth}" height="${headerHeight}" fill="url(#headerGrad)"/>
      <rect x="0" y="${headerHeight}" width="${badgeWidth}" height="${codeHeight}" fill="url(#codeGrad)"/>
    </g>
  </g>
  <text x="${badgeWidth / 2}" y="${headerHeight / 2 + headerFontSize * 0.36}" text-anchor="middle" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="${headerFontSize}" font-weight="700" letter-spacing="${(headerFontSize * 0.18).toFixed(2)}">RÉFÉRENCE</text>
  <text x="${badgeWidth / 2}" y="${headerHeight + codeHeight / 2 + codeFontSize * 0.36}" text-anchor="middle" fill="#ffffff" font-family="Consolas, 'Courier New', monospace" font-size="${codeFontSize}" font-weight="700">${safeRef}</text>
</svg>`;

  return { svg: Buffer.from(svg), x, y };
}

interface ComposeInput {
  sourceBuffer: Buffer;
  reference: string;
  size: BrandedSize;
  /**
   * Largeur minimale (px) que doit atteindre le rendu final. Utilisé pour
   * respecter les contraintes de chaque marketplace (Faire ≥ 1000, Ankorstore
   * ≥ 500). Si la source est plus petite, elle est upscalée à cette largeur
   * (`withoutEnlargement: false`). Sans effet si la source est déjà ≥ minWidth.
   */
  minWidth?: number;
  /**
   * Profil de taille du badge (voir `BadgeVariant`). Défaut : `standard`.
   * Ankorstore push `large` car ses vignettes sont plus petites.
   */
  variant?: BadgeVariant;
}

/**
 * Compose l'image source + badge en mémoire. Retourne le WebP final prêt à
 * être servi (HTTP) ou uploadé (multipart PFS).
 */
export async function composeBrandedBuffer(
  input: ComposeInput,
): Promise<Buffer> {
  const oriented = sharp(input.sourceBuffer).rotate();
  const meta = await oriented.metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  const smallSource =
    srcW > 0 && srcH > 0 && Math.min(srcW, srcH) < MIN_LARGE_WIDTH;

  const baseTarget = SIZE_TARGETS[input.size];
  const requestedMinWidth = input.minWidth && input.minWidth > 0 ? input.minWidth : 0;

  // Contrainte marketplace explicite : la LARGEUR finale doit être ≥ minWidth.
  // On passe alors resize(minWidth, null) — Sharp ajuste la hauteur pour
  // préserver le ratio. `fit:"inside"` sur (1200,1200) ne suffit pas :
  // une image portrait 800×1200 « tient déjà » dans la boîte et Sharp la
  // laisse à 800 de large même avec `withoutEnlargement:false`. C'était le
  // bug 2026-07-28 (Faire refusait les images 800px alors qu'on pensait
  // envoyer 1000px+).
  if (requestedMinWidth > 0 && srcW > 0 && srcW < requestedMinWidth) {
    const upscaled = await oriented
      .resize(requestedMinWidth, null, { withoutEnlargement: false })
      .webp(WEBP_OPTS)
      .toBuffer();
    const uMeta = await sharp(upscaled).metadata();
    const badgeU = buildBadgeSvg(
      input.reference,
      uMeta.width ?? requestedMinWidth,
      input.variant,
    );
    return sharp(upscaled)
      .composite([{ input: badgeU.svg, top: badgeU.y, left: badgeU.x }])
      .webp(WEBP_OPTS)
      .toBuffer();
  }

  // Cible = max(taille demandée, largeur minimale marketplace).
  const target = Math.max(baseTarget, requestedMinWidth);

  // Petite source & size=large : ancien comportement (upscale à MIN_LARGE_WIDTH).
  const effectiveTarget =
    input.size === "large" && smallSource && requestedMinWidth < MIN_LARGE_WIDTH
      ? MIN_LARGE_WIDTH
      : target;

  // On désactive l'anti-enlargement dès qu'une contrainte minWidth est active
  // (petite source ou minWidth explicite) — sinon Sharp respecte la source et
  // le marketplace refuse.
  const needsUpscale =
    (input.size === "large" && smallSource) ||
    (requestedMinWidth > 0 && srcW > 0 && srcW < requestedMinWidth);
  const withoutEnlargement = !needsUpscale;

  const resized = await oriented
    .resize(effectiveTarget, effectiveTarget, {
      fit: "inside",
      withoutEnlargement,
    })
    .webp(WEBP_OPTS)
    .toBuffer();

  const rMeta = await sharp(resized).metadata();
  const actualW = rMeta.width ?? effectiveTarget;
  const badge = buildBadgeSvg(input.reference, actualW, input.variant);

  return sharp(resized)
    .composite([{ input: badge.svg, top: badge.y, left: badge.x }])
    .webp(WEBP_OPTS)
    .toBuffer();
}

/**
 * Version du template SVG. À bumper à chaque modification du rendu du badge
 * (texte, tailles, couleurs, marges…). Sans ça, les caches HTTP (navigateur,
 * CDN) continueraient de servir l'ancien rendu car l'URL et le ETag ne
 * changeraient pas.
 *
 * Historique :
 *   v1 → « RÉF » (initial, retiré)
 *   v2 → « RÉFÉRENCE » en toutes lettres (2026-07-27)
 *   v3 → param minWidth (respect dimensions marketplace Faire/Ankorstore, 2026-07-28)
 *   v4 → minWidth force réellement la LARGEUR via resize(minWidth,null) — v3
 *        gardait la largeur source si l'image portrait tenait dans la boîte
 *        carrée (bug Faire refusant 800px). (2026-07-28)
 *   v5 → badge agrandi + profils "standard"/"large" : Ankorstore push "large"
 *        car ses vignettes de liste descendent à ~130px où le badge historique
 *        (28% width) devenait illisible. (2026-07-30)
 *   v6 → auto-fit horizontal du code : la police du bloc référence se réduit
 *        automatiquement pour tenir dans la largeur du badge quand la
 *        référence est longue (fix débordement « PRT-OREILLE174 »). Hauteur
 *        du badge inchangée pour rester homogène entre vignettes.
 *        (2026-08-06)
 *
 * Exposée pour que `buildBrandedUrl` inclue le suffixe `&v=…` dans l'URL —
 * les navigateurs revoient alors une URL différente au bump et refetch
 * immédiatement sans attendre l'expiration du Cache-Control.
 */
export const BADGE_TEMPLATE_VERSION = "v6";

/**
 * Hash tronqué qui identifie une combinaison
 * (source, référence, size, minWidth, variant).
 * Sert de cache key HTTP + validation ETag pour le endpoint dynamique.
 */
export function computeBrandedHash(
  sourceDbPath: string,
  reference: string,
  size: BrandedSize,
  minWidth: number = 0,
  variant: BadgeVariant = "standard",
): string {
  return crypto
    .createHash("sha256")
    .update(
      `${BADGE_TEMPLATE_VERSION}\n${sourceDbPath}\n${reference}\n${size}\n${minWidth}\n${variant}`,
    )
    .digest("hex")
    .slice(0, 16);
}

// Exporté pour les tests unitaires
export const __TEST_ONLY = { buildBadgeSvg, BADGE_VARIANTS };
