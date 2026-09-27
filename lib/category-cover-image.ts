import { existsSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";

/**
 * Pour chaque catégorie fournie, tire au sort l'image d'un produit vendable
 * de la catégorie et la retourne comme « image de couverture ». Le tirage
 * est stable pour une même journée (UTC) : même image affichée toute la
 * journée sur la home et la page /categories, nouvelle image le lendemain.
 *
 * Le lookup part des produits (pas des images) pour rester robuste au champ
 * `ProductColorImage.productColorId` qui est nullable — beaucoup d'images
 * historiques ne pointent que sur `(productId, colorId)`. On croise ensuite
 * avec les vraies variantes vendables pour ne remonter que des photos de
 * couleurs actives en stock.
 *
 * @returns Map<categoryId, imagePath> — une catégorie sans photo utilisable
 *   est absente de la Map ; l'appelant applique son propre fallback
 *   (monogramme).
 */
export async function pickCategoryCoverImages(
  categoryIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (categoryIds.length === 0) return result;

  const products = await prisma.product.findMany({
    where: {
      status: "ONLINE",
      categoryId: { in: categoryIds },
      colors: { some: { disabled: false, stock: { gt: 0 } } },
    },
    select: {
      id: true,
      categoryId: true,
      primaryColorId: true,
      colors: {
        where: { disabled: false, stock: { gt: 0 } },
        select: { colorId: true },
      },
    },
  });

  if (products.length === 0) return result;

  const productIds = products.map((p) => p.id);
  const images = await prisma.productColorImage.findMany({
    where: { productId: { in: productIds } },
    orderBy: [{ productId: "asc" }, { colorId: "asc" }, { order: "asc" }],
    select: { productId: true, colorId: true, path: true },
  });

  // Index images : productId -> colorId -> premier path rencontré (order min
  // grâce au orderBy ci-dessus).
  const imgByProductColor = new Map<string, Map<string, string>>();
  for (const img of images) {
    if (!img.colorId) continue;
    let byColor = imgByProductColor.get(img.productId);
    if (!byColor) {
      byColor = new Map<string, string>();
      imgByProductColor.set(img.productId, byColor);
    }
    if (!byColor.has(img.colorId)) byColor.set(img.colorId, img.path);
  }

  // Pour chaque produit : cherche une image parmi ses couleurs vendables,
  // en privilégiant la couleur principale.
  const byCategory = new Map<string, string[]>();
  for (const p of products) {
    if (!p.categoryId) continue;
    const byColor = imgByProductColor.get(p.id);
    if (!byColor || byColor.size === 0) continue;

    let picked: string | null = null;
    if (p.primaryColorId) {
      picked = byColor.get(p.primaryColorId) ?? null;
    }
    if (!picked) {
      for (const c of p.colors) {
        if (!c.colorId) continue;
        const found = byColor.get(c.colorId);
        if (found) {
          picked = found;
          break;
        }
      }
    }
    if (!picked) continue;

    const list = byCategory.get(p.categoryId) ?? [];
    list.push(picked);
    byCategory.set(p.categoryId, list);
  }

  const daySeed = new Date().toISOString().slice(0, 10);
  for (const catId of categoryIds) {
    const list = byCategory.get(catId);
    if (!list || list.length === 0) continue;
    list.sort();
    // On part de l'index déterministe du jour puis on itère en rotation
    // jusqu'à trouver un fichier réellement présent sur disque. Filet contre
    // les rows BDD orphelines (fichier supprimé, dossier absent en dev…).
    const start = hashString(`${catId}::${daySeed}`) % list.length;
    for (let i = 0; i < list.length; i++) {
      const candidate = list[(start + i) % list.length];
      if (imageFileExists(candidate)) {
        result.set(catId, candidate);
        break;
      }
    }
  }

  return result;
}

function imageFileExists(publicPath: string): boolean {
  if (!publicPath.startsWith("/")) return false;
  try {
    return existsSync(join(process.cwd(), "public", publicPath));
  } catch {
    return false;
  }
}

function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
