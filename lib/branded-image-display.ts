/**
 * Helper de transformation : injecte virtuellement l'image « marquée » en
 * position 0 de la couleur principale quand le toggle est activé, sans
 * dupliquer aucun fichier sur disque.
 *
 * L'image virtuelle pointe vers `/api/branded-image?src=…&ref=…&size=…` qui
 * compose le badge à la volée. Le reste du site (fiche produit, cartes,
 * marketplaces URL-based) utilise donc naturellement cette URL comme une
 * image normale — pas de branchement particulier côté rendu.
 *
 * Comportement :
 *   - Toggle OFF ou pas de couleur principale → passthrough (aucun changement)
 *   - Toggle ON + couleur principale a ≥ 1 image → insert virtuel en position 0,
 *     photos réelles décalées de +1 sur cette couleur uniquement, cap à 5.
 *   - Les autres couleurs ne sont jamais touchées.
 */

import { getImagePaths } from "@/lib/image-utils";
import {
  BADGE_TEMPLATE_VERSION,
  type BadgeVariant,
  type BrandedSize,
} from "@/lib/branded-image";

export const MAX_IMAGES_PER_COLOR = 5;
const BRANDED_VIRTUAL_ID_PREFIX = "__branded__";

/** Construit une URL relative vers l'endpoint de composition dynamique (usage boutique / admin). */
export function buildBrandedUrl(
  sourceDbPath: string,
  reference: string,
  size: BrandedSize,
  variant?: BadgeVariant,
): string {
  const p = new URLSearchParams({
    src: sourceDbPath,
    ref: reference,
    size,
    v: BADGE_TEMPLATE_VERSION,
  });
  if (variant && variant !== "standard") p.set("bv", variant);
  return `/api/branded-image?${p.toString()}`;
}

/**
 * Construit une URL absolue vers l'endpoint de composition dynamique, à
 * envoyer aux marketplaces (Ankor / Faire / eFashion). Le baseOverride doit
 * être fourni pour rester tenant-safe.
 */
export function buildBrandedMarketplaceUrl(
  sourceDbPath: string,
  reference: string,
  opts: {
    baseUrl: string;
    size?: BrandedSize;
    format?: "webp" | "jpeg";
    /**
     * Largeur minimale exigée par le marketplace de destination.
     * Faire = 1000, Ankorstore = 500. Si la source est plus petite, le
     * endpoint upscale à cette largeur avant d'apposer le badge.
     */
    minWidth?: number;
    /**
     * Profil de taille du badge « RÉFÉRENCE ». Défaut = `standard`.
     * Ankorstore push `large` pour rester lisible sur ses très petites
     * vignettes de liste (~130 px).
     */
    variant?: BadgeVariant;
  },
): string {
  const params = new URLSearchParams({
    src: sourceDbPath,
    ref: reference,
    size: opts.size ?? "large",
    v: BADGE_TEMPLATE_VERSION,
  });
  if (opts.format) params.set("format", opts.format);
  if (opts.minWidth && opts.minWidth > 0) {
    params.set("minWidth", String(Math.round(opts.minWidth)));
  }
  if (opts.variant && opts.variant !== "standard") {
    params.set("bv", opts.variant);
  }
  const base = opts.baseUrl.replace(/\/$/, "");
  return `${base}/api/branded-image?${params.toString()}`;
}

export interface InputImage {
  id: string;
  colorId: string;
  productColorId: string | null;
  order: number;
  path: string;
}

export interface DisplayImage {
  /** Id de la row réelle, ou `__branded__` si virtuel. */
  id: string;
  colorId: string;
  productColorId: string | null;
  order: number;
  path: string;
  urlMedium: string;
  urlThumb: string;
  /** true si c'est l'image virtuelle générée par /api/branded-image. */
  isBranded: boolean;
}

export function isBrandedVirtualId(id: string): boolean {
  return id.startsWith(BRANDED_VIRTUAL_ID_PREFIX);
}

/**
 * Helper léger pour un usage « je remplace juste l'URL de la 1ère image
 * de la couleur principale » (cartes produits, thumbnails favoris, cover
 * admin…). Retourne l'URL originale si le toggle est OFF ou si la couleur
 * n'est pas la principale.
 */
export function maybeBrandifyPath(
  path: string | null | undefined,
  colorId: string | null | undefined,
  primaryColorId: string | null | undefined,
  reference: string,
  brandedEnabled: boolean,
  size: BrandedSize = "medium",
): string | null {
  if (!path) return path ?? null;
  if (!brandedEnabled) return path;
  if (!primaryColorId || colorId !== primaryColorId) return path;
  return buildBrandedUrl(path, reference, size);
}

/**
 * Transforme la liste `colorImages` d'un produit en liste « à afficher ».
 * Voir la doc de tête pour le comportement complet.
 */
export function computeDisplayImages(opts: {
  images: InputImage[];
  primaryColorId: string | null;
  reference: string;
  brandedEnabled: boolean;
}): DisplayImage[] {
  const { images, primaryColorId, reference, brandedEnabled } = opts;

  // Grouper par couleur, trier par order
  const byColor = new Map<string, InputImage[]>();
  for (const img of images) {
    if (!byColor.has(img.colorId)) byColor.set(img.colorId, []);
    byColor.get(img.colorId)!.push(img);
  }
  for (const list of byColor.values()) {
    list.sort((a, b) => a.order - b.order);
  }

  const toDisplay = (img: InputImage, orderOverride?: number): DisplayImage => {
    const paths = getImagePaths(img.path);
    return {
      id: img.id,
      colorId: img.colorId,
      productColorId: img.productColorId,
      order: orderOverride ?? img.order,
      path: paths.large,
      urlMedium: paths.medium,
      urlThumb: paths.thumb,
      isBranded: false,
    };
  };

  const result: DisplayImage[] = [];

  for (const [colorId, list] of byColor.entries()) {
    const shouldBrand =
      brandedEnabled &&
      primaryColorId !== null &&
      colorId === primaryColorId &&
      list.length > 0;

    if (shouldBrand) {
      const source = list[0]!;
      result.push({
        id: `${BRANDED_VIRTUAL_ID_PREFIX}${source.id}`,
        colorId,
        productColorId: source.productColorId,
        order: 0,
        path: buildBrandedUrl(source.path, reference, "large"),
        urlMedium: buildBrandedUrl(source.path, reference, "medium"),
        urlThumb: buildBrandedUrl(source.path, reference, "thumb"),
        isBranded: true,
      });
      const capped = list.slice(0, MAX_IMAGES_PER_COLOR - 1);
      capped.forEach((img, i) => result.push(toDisplay(img, i + 1)));
    } else {
      list.forEach((img) => result.push(toDisplay(img)));
    }
  }

  return result;
}
