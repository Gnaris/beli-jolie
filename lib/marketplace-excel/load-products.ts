/**
 * Load products from DB and shape them into ExportProduct[] for marketplace Excel export.
 */

import { prisma } from "@/lib/prisma";
import { loadMarketplaceMarkupConfigs } from "@/lib/marketplace-pricing";
import type { ExportProduct, ExportContext, ExportVariant, SaleTypeKey } from "./types";

export async function loadExportContext(): Promise<ExportContext> {
  const [markups, company, vatRow] = await Promise.all([
    loadMarketplaceMarkupConfigs(),
    prisma.companyInfo.findFirst({ select: { shopName: true } }),
    prisma.siteConfig.findUnique({ where: { key: "ankorstore_default_vat_rate" } }),
  ]);

  const shopName = company?.shopName?.trim() || "";
  const ankorstoreVatRate = Number(vatRow?.value) || 20;
  const publicBaseUrl = (process.env.NEXTAUTH_URL || "").replace(/\/$/, "");

  return { shopName, markups, ankorstoreVatRate, publicBaseUrl };
}

export async function loadExportProducts(productIds: string[]): Promise<ExportProduct[]> {
  if (productIds.length === 0) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: {
      category: { select: { name: true, pfsGender: true, pfsFamilyName: true, pfsCategoryName: true } },
      season: { select: { pfsRef: true } },
      manufacturingCountry: { select: { name: true, isoCode: true, pfsCountryRef: true } },
      compositions: {
        include: { composition: { select: { name: true, pfsCompositionRef: true } } },
      },
      translations: { select: { locale: true, name: true, description: true } },
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
          images: {
            select: { path: true, order: true },
            orderBy: { order: "asc" },
          },
        },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });

  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = productIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  return ordered.map((p): ExportProduct => {
    const translations: ExportProduct["translations"] = {};
    for (const t of p.translations) {
      translations[t.locale] = { name: t.name, description: t.description };
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
        imagePaths: c.images.map((img) => img.path),
      };
    });

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
      seasonPfsRef: p.season?.pfsRef ?? null,
      manufacturingCountryName: (p.manufacturingCountry?.pfsCountryRef || p.manufacturingCountry?.name) ?? null,
      manufacturingCountryIso: p.manufacturingCountry?.isoCode ?? null,
      compositions: p.compositions.map((c) => ({
        name: c.composition.pfsCompositionRef || c.composition.name,
        percentage: c.percentage,
      })),
      translations,
      variants,
    };
  });
}
