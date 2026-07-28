/**
 * Load products from DB and shape them into ExportProduct[] for marketplace Excel export.
 *
 * Used for the 4 marketplaces (PFS, Efashion, Microstore, Ankorstore).
 * For Efashion specifically, the 3-level category path is resolved by joining
 * `Category.efashionCategorieId` against the eFashion categories annexes
 * (`EfashionCategoryNode.path` = "Top > Sub > Leaf").
 */

import { prisma } from "@/lib/prisma";
import { loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";
import { getEfashionAnnexes } from "@/lib/efashion-annexes";
import { getCachedShopName } from "@/lib/cached-data";
import { getCountryByIso } from "@/lib/countries";
import type {
  ExportProduct,
  ExportContext,
  ExportVariant,
  SaleTypeKey,
} from "./types";

export async function loadExportContext(): Promise<ExportContext> {
  const [markups, shopName] = await Promise.all([
    loadMarketplaceMarkupConfigs(),
    getCachedShopName(),
  ]);

  const publicBaseUrl = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");

  return { shopName: shopName.trim(), markups, publicBaseUrl };
}

/**
 * Parse an eFashion category path ("Top > Sub > Leaf") into 3 levels.
 * If less than 3 segments, leaf takes the last, sub the middle, top the first.
 * Missing levels are filled with empty strings.
 */
function parseEfashionPath(
  path: string | undefined,
): { top: string; sub: string; leaf: string } | null {
  if (!path) return null;
  const parts = path
    .split(">")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  // Prendre les 3 derniers (au cas où le chemin a plus de 3 niveaux)
  const last3 = parts.slice(-3);
  while (last3.length < 3) last3.unshift("");
  return { top: last3[0]!, sub: last3[1]!, leaf: last3[2]! };
}

export async function loadExportProducts(productIds: string[]): Promise<ExportProduct[]> {
  if (productIds.length === 0) return [];

  // Charge en parallèle : produits + annexes eFashion (pour résoudre les paths catégorie).
  // Si l'API eFashion plante (kill switch off, identifiants manquants), on continue sans
  // les paths (les produits seront marqués non-éligibles par le validateur Efashion).
  const [products, efashionAnnexes] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        category: {
          select: {
            name: true,
            pfsGender: true,
            pfsFamilyName: true,
            pfsCategoryName: true,
            efashionCategorieId: true,
          },
        },
        // Sous-catégorie choisie comme étiquette d'export Microstore (peut être
        // null = catégorie principale par défaut).
        microstoreSubCategory: { select: { name: true } },
        hsCode: { select: { code: true } },
        season: {
          select: { name: true, pfsRef: true, efashionCollectionId: true },
        },
        compositions: {
          include: {
            composition: {
              select: { name: true, pfsCompositionRef: true, efashionId: true },
            },
          },
        },
        translations: { select: { locale: true, name: true, description: true } },
        // Toutes les images du produit, indexées plus bas par colorId.
        // Important : les images sont liées à la **couleur** (productId + colorId)
        // et non à une `ProductColor` en particulier. La relation
        // `ProductColor.images` filtre via `productColorId` qui peut être null
        // ou absent — on ne s'en sert donc PAS pour ne rater aucune image.
        colorImages: {
          select: { path: true, order: true, colorId: true },
          orderBy: { order: "asc" },
        },
        colors: {
          include: {
            color: { select: { name: true } },
            variantSizes: {
              include: { size: { select: { name: true, pfsSizeRef: true } } },
            },
            packLines: {
              orderBy: { position: "asc" },
              include: {
                color: { select: { name: true } },
                sizes: {
                  include: { size: { select: { name: true, pfsSizeRef: true } } },
                },
              },
            },
          },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
    }),
    getEfashionAnnexes().catch(() => null),
  ]);

  // Index id catégorie eFashion → path (sera utilisé pour résoudre top/sub/leaf).
  const efashionPathById = new Map<number, string>();
  for (const node of efashionAnnexes?.categories ?? []) {
    efashionPathById.set(node.id, node.path);
  }

  // Index id collection eFashion → label.
  const efashionCollectionLabelById = new Map<number, string>();
  for (const c of efashionAnnexes?.collections ?? []) {
    efashionCollectionLabelById.set(c.id, c.label);
  }

  // Index id composition eFashion → label.
  const efashionCompositionLabelById = new Map<number, string>();
  for (const c of efashionAnnexes?.compositions ?? []) {
    efashionCompositionLabelById.set(c.id, c.label);
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = productIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  return ordered.map((p): ExportProduct => {
    const translations: ExportProduct["translations"] = {};
    for (const t of p.translations) {
      translations[t.locale] = { name: t.name, description: t.description };
    }

    // Index colorId → liste de paths d'images, triés par `order`.
    // Une variante (ProductColor) récupère ses images via son `colorId` plutôt
    // que via la relation directe `ProductColor.images` : cela garantit que
    // l'UNIT Doré et le PACK Doré voient les mêmes photos (elles partagent
    // la même `Color`), même si l'admin n'a uploadé qu'une fois.
    const imagesByColorId = new Map<string, string[]>();
    for (const img of p.colorImages) {
      const list = imagesByColorId.get(img.colorId) ?? [];
      list.push(img.path);
      imagesByColorId.set(img.colorId, list);
    }

    const variants: ExportVariant[] = p.colors.map((c) => {
      const isMultiPack = c.saleType === "PACK" && c.packLines.length > 0;

      const colorNames: string[] = [];
      if (isMultiPack) {
        for (const line of c.packLines) {
          if (line.color?.name) colorNames.push(line.color.name);
        }
      } else if (c.color?.name) {
        colorNames.push(c.color.name);
      }

      const aggregatedSizes = isMultiPack
        ? (() => {
            const map = new Map<string, { name: string; quantity: number; pfsSizeRef?: string | null }>();
            for (const line of c.packLines) {
              for (const ls of line.sizes) {
                const k = ls.sizeId;
                const cur = map.get(k);
                if (cur) cur.quantity += ls.quantity;
                else map.set(k, { name: ls.size.name, quantity: ls.quantity, pfsSizeRef: ls.size.pfsSizeRef ?? null });
              }
            }
            return [...map.values()];
          })()
        : c.variantSizes.map((vs) => ({ name: vs.size.name, quantity: vs.quantity, pfsSizeRef: vs.size.pfsSizeRef ?? null }));

      const packLines = isMultiPack
        ? c.packLines.map((line) => ({
            colorName: line.color?.name || "",
            sizes: line.sizes.map((ls) => ({ name: ls.size.name, quantity: ls.quantity, pfsSizeRef: ls.size.pfsSizeRef ?? null })),
          }))
        : undefined;

      // Images = celles attachées à la couleur (colorId) de la variante.
      // Pour PACK multi-couleurs : on agrège les images de chaque couleur
      // composant le pack (rare en pratique).
      const imagePaths: string[] = [];
      if (isMultiPack) {
        const seen = new Set<string>();
        for (const line of c.packLines) {
          const lineColorId = line.colorId;
          if (!lineColorId) continue;
          for (const path of imagesByColorId.get(lineColorId) ?? []) {
            if (!seen.has(path)) {
              seen.add(path);
              imagePaths.push(path);
            }
          }
        }
      } else if (c.colorId) {
        imagePaths.push(...(imagesByColorId.get(c.colorId) ?? []));
      }

      return {
        variantId: c.id,
        saleType: c.saleType as SaleTypeKey,
        colorNames,
        packQuantity: c.packQuantity,
        sizes: aggregatedSizes,
        packLines,
        unitPrice: Number(c.unitPrice),
        weight: c.weight,
        stock: c.stock,
        sku: c.sku,
        imagePaths,
      };
    });

    const efashionCategorieId = p.category.efashionCategorieId ?? null;
    const efashionPath = efashionCategorieId
      ? efashionPathById.get(efashionCategorieId)
      : undefined;

    return {
      id: p.id,
      reference: p.reference,
      name: p.name,
      description: p.description,
      dimensionLength: p.dimensionLength,
      dimensionWidth: p.dimensionWidth,
      dimensionHeight: p.dimensionHeight,
      dimensionDiameter: p.dimensionDiameter,
      dimensionCircumference: p.dimensionCircumference,
      pfsGenderCode: p.category.pfsGender,
      pfsFamilyName: p.category.pfsFamilyName,
      pfsCategoryName: p.category.pfsCategoryName ?? null,
      categoryName: p.category.name,
      microstoreCategoryOverride: p.microstoreSubCategory?.name ?? null,
      hsCode: p.hsCode?.code ?? null,
      efashionCategorieId,
      efashionCategoryPath: parseEfashionPath(efashionPath),
      seasonPfsRef: p.season?.pfsRef ?? null,
      seasonEfashionCollectionId: p.season?.efashionCollectionId ?? null,
      seasonEfashionLabel: p.season?.efashionCollectionId
        ? efashionCollectionLabelById.get(p.season.efashionCollectionId) ?? null
        : null,
      seasonName: p.season?.name ?? null,
      manufacturingCountryName: (() => {
        const c = getCountryByIso(p.countryIsoCode);
        return c?.pfsCountryRef ?? c?.name ?? null;
      })(),
      manufacturingCountryIso: p.countryIsoCode ?? null,
      manufacturingCountryEfashionProvenanceId: (() => {
        const c = getCountryByIso(p.countryIsoCode);
        return c?.efashionProvenanceId ?? null;
      })(),
      compositions: p.compositions.map((cc) => ({
        name: cc.composition.pfsCompositionRef || cc.composition.name,
        percentage: cc.percentage,
        localName: cc.composition.name,
        pfsRef: cc.composition.pfsCompositionRef ?? null,
        efashionId: cc.composition.efashionId ?? null,
        efashionLabel: cc.composition.efashionId
          ? efashionCompositionLabelById.get(cc.composition.efashionId) ?? null
          : null,
      })),
      translations,
      variants,
    };
  });
}
