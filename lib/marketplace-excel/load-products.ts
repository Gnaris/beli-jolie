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
  const r2PublicUrl = (process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_URL || "").replace(/\/$/, "");

  return { shopName, markups, ankorstoreVatRate, r2PublicUrl };
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
          color: { select: { name: true, pfsColorRef: true } },
          subColors: {
            include: { color: { select: { name: true, pfsColorRef: true } } },
            orderBy: { position: "asc" },
          },
          variantSizes: {
            include: { size: { select: { name: true } } },
          },
          packColorLines: {
            include: {
              colors: {
                include: { color: { select: { name: true, pfsColorRef: true } } },
                orderBy: { position: "asc" },
              },
              sizes: {
                include: { size: { select: { name: true } } },
              },
            },
            orderBy: { position: "asc" },
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

  // Preserve the input order
  const byId = new Map(products.map((p) => [p.id, p]));
  const ordered = productIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  return ordered.map((p): ExportProduct => {
    const translations: ExportProduct["translations"] = {};
    for (const t of p.translations) {
      translations[t.locale] = { name: t.name, description: t.description };
    }

    const variants: ExportVariant[] = p.colors.map((c) => {
      const colorNames: string[] = [];
      const subColorNames: string[] = [];
      if (c.saleType === "UNIT") {
        // Prefer PFS ref over local name for export
        const pfsName = c.color?.pfsColorRef || c.color?.name;
        if (pfsName) colorNames.push(pfsName);
        for (const sc of c.subColors) {
          const scName = sc.color?.pfsColorRef || sc.color?.name;
          if (scName) subColorNames.push(scName);
        }
      }

      return {
        variantId: c.id,
        saleType: c.saleType as SaleTypeKey,
        colorNames,
        subColorNames,
        packColorLines: c.packColorLines.map((line) => ({
          colors: line.colors.map((lc) => lc.color?.pfsColorRef || lc.color?.name).filter((n): n is string => !!n),
          sizes: line.sizes.map((ls) => ({ name: ls.size.name, quantity: ls.quantity })),
        })),
        packQuantity: c.packQuantity,
        sizes: c.variantSizes.map((vs) => ({ name: vs.size.name, quantity: vs.quantity })),
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
