import { existsSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { tenantScopedCacheWithTid } from "@/lib/cached-data";

/**
 * Nombre d'images à afficher dans le fond défilant du hero BJ.
 * 6 colonnes × 8 images = 48 tuiles, mais on veut de la diversité — on
 * tire plus large que 48 quand la boutique en a assez pour éviter les
 * répétitions trop rapides d'une colonne à l'autre.
 */
const HERO_IMAGES_COUNT = 60;

/**
 * Tire au sort une liste stable-par-jour d'images produit à afficher en
 * fond décoratif du hero de la home BJ. Le tirage est stable pour toute
 * une journée UTC (même liste pendant 24 h, nouvelle sélection à minuit
 * UTC) — comme `pickCategoryCoverImages` pour les tuiles de catégories.
 *
 * Ne remonte que des photos de couleurs actives en stock ONLINE (même
 * critère que la vitrine, cf. `PUBLIC_SELLABLE_COLORS_CLAUSE`). Les
 * paths sont vérifiés sur disque pour ignorer les rows orphelines.
 *
 * @returns Array de paths publics (`/uploads/{tenant}/produits/...`).
 *   Vide si la boutique n'a pas encore de photos utilisables.
 */
export async function pickHomeHeroImagesImpl(tid: string): Promise<string[]> {
  // 1) Récupère les produits vendables avec leurs couleurs actives.
  const products = await prisma.product.findMany({
    where: {
      ...(tid === "global" ? {} : { tenantId: tid }),
      status: "ONLINE",
      colors: { some: { disabled: false, stock: { gt: 0 } } },
    },
    select: {
      id: true,
      colors: {
        where: { disabled: false, stock: { gt: 0 } },
        select: { colorId: true },
      },
    },
  });

  if (products.length === 0) return [];

  // 2) Charge en une passe toutes les images de ces produits, ordre stable
  //    (product, color, order) — le tri par order remonte l'image principale
  //    en tête pour chaque (produit, couleur).
  const productIds = products.map((p) => p.id);
  const images = await prisma.productColorImage.findMany({
    where: { productId: { in: productIds } },
    orderBy: [{ productId: "asc" }, { colorId: "asc" }, { order: "asc" }],
    select: { productId: true, colorId: true, path: true },
  });

  // 3) Ne garde qu'UNE image par (produit, couleur) — la première de l'order —
  //    et uniquement pour les couleurs réellement vendables.
  const sellableKey = new Set<string>();
  for (const p of products) {
    for (const c of p.colors) {
      if (c.colorId) sellableKey.add(`${p.id}::${c.colorId}`);
    }
  }
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const img of images) {
    if (!img.colorId) continue;
    const key = `${img.productId}::${img.colorId}`;
    if (!sellableKey.has(key) || seen.has(key)) continue;
    seen.add(key);
    candidates.push(img.path);
  }

  if (candidates.length === 0) return [];

  // 4) Tirage stable par jour (UTC) via un Fisher-Yates seedé.
  const daySeed = new Date().toISOString().slice(0, 10);
  const seed = hashString(`${tid}::${daySeed}`);
  const shuffled = seededShuffle(candidates, seed);

  // 5) Vérifie l'existence disque et prend les N premières. Le filet évite
  //    les rows BDD orphelines (fichier retiré manuellement, dossier absent
  //    en dev, résidus après suppression produit).
  const picked: string[] = [];
  for (const path of shuffled) {
    if (imageFileExists(path)) {
      picked.push(path);
      if (picked.length >= HERO_IMAGES_COUNT) break;
    }
  }
  return picked;
}

/**
 * Version cachée 24 h (86 400 s), scopée tenant. Tag `home-hero-images`
 * pour permettre l'invalidation manuelle en cas de rebuild forcé (jamais
 * indispensable — la clé tourne toute seule à minuit UTC via le daySeed
 * qui change et fait miss le cache).
 */
export const getCachedHomeHeroImages = tenantScopedCacheWithTid(
  "home-hero-images",
  (tid) => pickHomeHeroImagesImpl(tid),
  ["home-hero-images"],
  { revalidate: 86_400, tags: ["home-hero-images", "products"] },
);

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

/**
 * Fisher-Yates seedé (LCG déterministe). Ne PAS remplacer par `Math.random`
 * — on veut que le même seed donne toujours le même ordre, sinon le tirage
 * changerait entre le SSR et le HMR local.
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
