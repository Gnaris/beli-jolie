import NextImage, { type ImageProps } from "next/image";

// Détermine si une `src` doit bypass l'optimiseur `/_next/image`.
// L'optimiseur de Next.js indexe `public/` au démarrage du process et
// ignore les fichiers ajoutés ensuite — toute photo uploadée après le
// dernier `pm2 restart` (import PFS, upload manuel, etc.) renverrait
// alors « The requested resource isn't a valid image ». Comme nginx
// sert directement `/uploads/` et que ces fichiers sont déjà des WebP
// pré-optimisés (3 tailles via sharp), on shortcut l'optimiseur.
export function shouldBypassOptimizer(src: ImageProps["src"]): boolean {
  if (typeof src !== "string") return false;
  // Fichiers uploadés : nginx sert directement, pas besoin de l'optimiseur.
  if (src.startsWith("/uploads/")) return true;
  // Endpoint dynamique du badge « Réf » : Sharp compose déjà en WebP/JPEG,
  // Next.js n'a rien à optimiser (et refuserait les URLs à query string sans
  // config `images.localPatterns`).
  if (src.startsWith("/api/branded-image")) return true;
  return false;
}

// Drop-in remplacement de `next/image`.
export default function SmartImage(props: ImageProps) {
  const { unoptimized, src } = props;
  return <NextImage {...props} unoptimized={unoptimized ?? shouldBypassOptimizer(src)} />;
}
