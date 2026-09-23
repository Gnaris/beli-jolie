/**
 * Reshape des produits Prisma vers la forme attendue par <ProductCard/>.
 * Extrait de app/[locale]/produits/page.tsx pour être réutilisé par la page
 * catalogue partagé (/catalogue/[token]) — les deux vitrines doivent afficher
 * la même carte, donc la même reshape.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";

// Map<productId, Map<productColorId|colorId, imagePath>>
export type ProductImageMap = Map<string, Map<string, string>>;

export async function fetchImages(productIds: string[]): Promise<ProductImageMap> {
  const colorImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: { order: "asc" },
      })
    : [];
  const imageMap: ProductImageMap = new Map();
  for (const img of colorImages) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    const key = img.productColorId ?? img.colorId;
    if (!cm.has(key)) cm.set(key, img.path);
  }
  return imageMap;
}

/**
 * Reshape produits Prisma pour <ProductCard/> :
 *  - traduit `name` si une translation existe pour la locale (fallback FR)
 *  - regroupe les variantes par couleur (groupKey = colorId)
 *  - attache la 1ʳᵉ image trouvée pour chaque couleur (variant-level d'abord)
 *  - masque les couleurs sans image (pas d'aperçu = pas affiché)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeProducts(rawProducts: any[], imageMap: ProductImageMap) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rawProducts.map((p: any) => {
    const translatedName: string | undefined = p.translations?.[0]?.name;
    if (translatedName) p = { ...p, name: translatedName };
    const primaryColorId = getProductPrimaryColorId({
      primaryColorId: p.primaryColorId,
      colors: p.colors,
    });
    const colorMap = new Map<string, {
      groupKey: string; colorId: string; name: string; hex: string | null; patternImage?: string | null;
      firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; sizes: {name: string, quantity: number}[]; unitPrice: number; stock: number }[];
    }>();
    for (const v of p.colors) {
      if (!v.colorId) continue;
      const gk = v.colorId;
      if (!colorMap.has(gk)) {
        const rawFirst = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
        colorMap.set(gk, {
          groupKey: gk, colorId: v.colorId, name: v.color?.name, hex: v.color?.hex, patternImage: v.color?.patternImage,
          firstImage: rawFirst,
          unitPrice: Number(v.unitPrice),
          isPrimary: primaryColorId != null && v.colorId === primaryColorId,
          totalStock: 0,
          variants: [],
        });
      }
      const cd = colorMap.get(gk)!;
      if (!cd.firstImage) {
        const rawFirst = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
        cd.firstImage = rawFirst;
      }
      cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
      cd.totalStock += v.stock ?? 0;
      if (primaryColorId != null && v.colorId === primaryColorId) cd.isPrimary = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
    }
    const visibleColors = [...colorMap.values()].filter((cd) => cd.firstImage != null);
    return { ...p, colors: visibleColors };
  });
}
