import NextImage, { type ImageProps } from "next/image";

// Détermine si une `src` doit bypass l'optimiseur `/_next/image`.
// L'optimiseur de Next.js indexe `public/` au démarrage du process et
// ignore les fichiers ajoutés ensuite — toute photo uploadée après le
// dernier `pm2 restart` (import PFS, upload manuel, etc.) renverrait
// alors « The requested resource isn't a valid image ». Comme nginx
// sert directement `/uploads/` et que ces fichiers sont déjà des WebP
// pré-optimisés (3 tailles via sharp), on shortcut l'optimiseur.
export function shouldBypassOptimizer(src: ImageProps["src"]): boolean {
  return typeof src === "string" && src.startsWith("/uploads/");
}

// Drop-in remplacement de `next/image`.
export default function SmartImage(props: ImageProps) {
  const { unoptimized, src } = props;
  return <NextImage {...props} unoptimized={unoptimized ?? shouldBypassOptimizer(src)} />;
}
