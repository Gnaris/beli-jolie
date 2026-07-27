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
function buildBadgeSvg(reference: string, imageWidth: number): BadgeGeometry {
  const badgeWidth = Math.max(110, Math.min(420, Math.round(imageWidth * 0.28)));

  // Le header porte désormais « RÉFÉRENCE » en toutes lettres → on réduit la
  // taille de la police et le letter-spacing pour tenir sur une ligne sans
  // élargir la pilule.
  const headerFontSize = Math.max(8, Math.round(badgeWidth * 0.075));
  const codeFontSize = Math.max(12, Math.round(badgeWidth * 0.11));
  const headerPadY = Math.max(3, Math.round(headerFontSize * 0.40));
  const codePadY = Math.max(4, Math.round(codeFontSize * 0.35));
  const headerHeight = headerFontSize + headerPadY * 2;
  const codeHeight = codeFontSize + codePadY * 2;
  const badgeHeight = headerHeight + codeHeight;
  const cornerRadius = 4;

  const margin = Math.max(6, Math.round(imageWidth * 0.02));
  const x = Math.max(0, imageWidth - badgeWidth - margin);
  const y = margin;

  const safeRef = reference
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

  const target = SIZE_TARGETS[input.size];
  const effectiveTarget =
    input.size === "large" && smallSource ? MIN_LARGE_WIDTH : target;
  const withoutEnlargement = !(input.size === "large" && smallSource);

  const resized = await oriented
    .resize(effectiveTarget, effectiveTarget, {
      fit: "inside",
      withoutEnlargement,
    })
    .webp(WEBP_OPTS)
    .toBuffer();

  const rMeta = await sharp(resized).metadata();
  const actualW = rMeta.width ?? effectiveTarget;
  const badge = buildBadgeSvg(input.reference, actualW);

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
 *
 * Exposée pour que `buildBrandedUrl` inclue le suffixe `&v=…` dans l'URL —
 * les navigateurs revoient alors une URL différente au bump et refetch
 * immédiatement sans attendre l'expiration du Cache-Control.
 */
export const BADGE_TEMPLATE_VERSION = "v2";

/**
 * Hash tronqué qui identifie une combinaison (source, référence, size).
 * Sert de cache key HTTP + validation ETag pour le endpoint dynamique.
 */
export function computeBrandedHash(
  sourceDbPath: string,
  reference: string,
  size: BrandedSize,
): string {
  return crypto
    .createHash("sha256")
    .update(`${BADGE_TEMPLATE_VERSION}\n${sourceDbPath}\n${reference}\n${size}`)
    .digest("hex")
    .slice(0, 16);
}

// Exporté pour les tests unitaires
export const __TEST_ONLY = { buildBadgeSvg };
