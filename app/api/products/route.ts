import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDisplayConfig, getOrderedProductIds } from "@/lib/product-display";
import { getCachedSiteConfig } from "@/lib/cached-data";
import { getProductPrimaryColorId } from "@/lib/product-primary-color";
import { canSeePrices } from "@/lib/price-visibility";

import { VALID_LOCALES } from "@/i18n/locales";

const PER_PAGE = 20;

function buildProductInclude(locale: string) {
  return {
    category:      { select: { name: true } },
    subCategories: { select: { name: true }, take: 1 },
    tags:          { include: { tag: { select: { id: true, name: true } } } },
    colors: {
      where: { disabled: false },
      select: {
        id:            true,
        colorId:       true,
        unitPrice:     true,
        stock:         true,
        isPrimary:     true,
        saleType:      true,
        packQuantity:  true,
        color:         { select: { name: true, hex: true, patternImage: true } },
        variantSizes:  { orderBy: { size: { position: "asc" } }, include: { size: true } },
      },
    },
    ...(locale !== "fr" && {
      translations: { where: { locale }, select: { name: true }, take: 1 },
    }),
  } as const;
}

// Shape products: group variants by color group key (colorId) + attach first image
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeProducts(products: any[], imageMap: Map<string, Map<string, string>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return products.map((p: any) => {
    // Si une traduction existe pour la locale demandée, on remplace `name`.
    const translatedName: string | undefined = p.translations?.[0]?.name;
    if (translatedName) p = { ...p, name: translatedName };
    // Determine the primary color via the helper (reads Product.primaryColorId
    // with fallback on ProductColor.isPrimary for non-migrated products).
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
        colorMap.set(gk, {
          groupKey:      gk,
          colorId:       v.colorId,
          name:          v.color?.name,
          hex:           v.color?.hex,
          patternImage:  v.color?.patternImage,
          firstImage:    imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null,
          unitPrice:     Number(v.unitPrice),
          isPrimary:     primaryColorId != null && v.colorId === primaryColorId,
          totalStock:    0,
          variants:      [],
        });
      }
      const cd = colorMap.get(gk)!;
      if (!cd.firstImage) cd.firstImage = imageMap.get(p.id)?.get(v.id) ?? imageMap.get(p.id)?.get(v.colorId) ?? null;
      cd.unitPrice = Math.min(cd.unitPrice, Number(v.unitPrice));
      cd.totalStock += v.stock ?? 0;
      if (primaryColorId != null && v.colorId === primaryColorId) cd.isPrimary = true;
      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, sizes: (v.variantSizes ?? []).map((vs: any) => ({ name: vs.size.name, quantity: vs.quantity })), unitPrice: Number(v.unitPrice), stock: v.stock ?? 0 });
    }
    return { ...p, colors: [...colorMap.values()] };
  });
}

async function fetchImages(productIds: string[]) {
  const colorImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: productIds } }, orderBy: { order: "asc" }, select: { productId: true, colorId: true, productColorId: true, path: true } })
    : [];
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of colorImages) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    const key = img.productColorId ?? img.colorId;
    if (!cm.has(key)) cm.set(key, img.path);
  }
  return imageMap;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q           = searchParams.get("q")          ?? "";
  const cat         = searchParams.get("cat")        ?? "";
  const subcat      = searchParams.get("subcat")     ?? "";
  const collection  = searchParams.get("collection") ?? "";
  const colorParam  = searchParams.get("color")       ?? "";
  const colorIds    = colorParam ? colorParam.split(",").filter(Boolean) : [];
  const tagId       = searchParams.get("tag")        ?? "";
  const compositionId = searchParams.get("composition") ?? "";
  const bestseller  = searchParams.get("bestseller") === "1";
  const isNew       = searchParams.get("new")        === "1";
  const promo       = searchParams.get("promo")      === "1";
  const ordered     = searchParams.get("ordered")    === "1";
  const notOrdered  = searchParams.get("notOrdered") === "1";
  const hideOos     = searchParams.get("hideOos")    === "1";
  const minPrice    = searchParams.get("minPrice") ? parseFloat(searchParams.get("minPrice")!) : null;
  const maxPrice    = searchParams.get("maxPrice") ? parseFloat(searchParams.get("maxPrice")!) : null;
  const exactRef    = searchParams.get("exactRef") === "1";
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const localeParam = searchParams.get("locale") ?? "fr";
  const locale      = (VALID_LOCALES as readonly string[]).includes(localeParam) ? localeParam : "fr";
  const productInclude = buildProductInclude(locale);

  // Stock display config
  // Note : l'ancien reglage global "show_out_of_stock_products" a ete retire —
  // les produits dont toutes les variantes sont a 0 sont desormais archives
  // automatiquement et donc deja masques par le filtre status. On garde
  // uniquement le filtre per-request hideOos pour les usages UI ponctuels.
  const stockVariantsRow = await getCachedSiteConfig("show_out_of_stock_variants");
  const showOosVariants = stockVariantsRow?.value !== "false"; // default true
  const shouldHideOos = hideOos;

  // Session : on en a besoin pour ordered/notOrdered ET pour le gating prix.
  const session = await getServerSession(authOptions);
  const showPrices = canSeePrices(session);

  // Filtres minPrice / maxPrice : ignorés pour les visiteurs non APPROVED
  // (sinon on peut deviner les prix en binary-search via les filtres).
  const effectiveMinPrice = showPrices ? minPrice : null;
  const effectiveMaxPrice = showPrices ? maxPrice : null;

  /**
   * Zéroïse les prix avant de renvoyer le JSON quand la session ne peut pas
   * voir les prix. Le composant client garde sa structure (variants, sizes,
   * stock…) mais l'`unitPrice` est mis à 0 et les remises sont retirées.
   */
  function stripPricesIfNeeded<T>(payload: T): T {
    if (showPrices) return payload;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (payload as any).products as any[] | undefined;
    if (!list) return payload;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (payload as any).products = list.map((p: any) => ({
      ...p,
      discountPercent: null,
      colors: (p.colors ?? []).map((c: any) => ({
        ...c,
        unitPrice: 0,
        variants: (c.variants ?? []).map((v: any) => ({ ...v, unitPrice: 0 })),
      })),
    }));
    return payload;
  }

  // Fetch ordered product references for the current user
  let userOrderedRefs: string[] = [];
  if ((ordered || notOrdered) && session?.user?.id) {
    const orderItems = await prisma.orderItem.findMany({
      where: { order: { userId: session.user.id } },
      select: { productRef: true },
      distinct: ["productRef"],
    });
    userOrderedRefs = orderItems.map((oi) => oi.productRef);
  }

  const hasFilters = !!(q || cat || subcat || collection || colorIds.length > 0 || tagId || compositionId || bestseller || isNew || promo || ordered || notOrdered || hideOos || effectiveMinPrice !== null || effectiveMaxPrice !== null || exactRef);

  // ─── Custom ordering (no filters) ──────────────────────────────────────────
  if (!hasFilters) {
    const configRow = await getCachedSiteConfig("product_display_config");
    const displayConfig = parseDisplayConfig(configRow?.value);

    if (displayConfig.catalogMode === "custom" && displayConfig.sections.length > 0) {
      const orderedIds = await getOrderedProductIds(displayConfig);
      const totalCount = orderedIds.length;
      const pageIds = orderedIds.slice((page - 1) * PER_PAGE, page * PER_PAGE);

      if (pageIds.length === 0) {
        return NextResponse.json({ products: [], hasMore: false });
      }

      const products = await prisma.product.findMany({
        where: { id: { in: pageIds } },
        include: productInclude,
      });

      // Re-sort to match ordered IDs
      const idOrder = new Map(pageIds.map((id, i) => [id, i]));
      products.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

      const imageMap = await fetchImages(pageIds);
      let shaped = shapeProducts(products, imageMap);

      // Filter out OOS variants/colors if config says so
      if (!showOosVariants) {
        shaped = shaped.map((p: any) => ({
          ...p,
          colors: p.colors
            .map((c: any) => ({ ...c, variants: c.variants.filter((v: any) => v.stock > 0) }))
            .filter((c: any) => c.variants.length > 0),
        })).filter((p: any) => p.colors.length > 0);
      }
      if (shouldHideOos) {
        shaped = shaped.filter((p: any) => p.colors.some((c: any) => c.totalStock > 0));
      }

      return NextResponse.json(stripPricesIfNeeded({
        products: shaped,
        hasMore: page * PER_PAGE < totalCount,
      }));
    }
  }

  // ─── Default / filtered ordering ──────────────────────────────────────────
  // Use AND array to avoid key collisions (colors, NOT, etc.)
  const andConditions: Record<string, unknown>[] = [];
  if (shouldHideOos) andConditions.push({ NOT: { colors: { every: { stock: { equals: 0 } } } } });
  if (notOrdered && userOrderedRefs.length > 0) andConditions.push({ NOT: { reference: { in: userOrderedRefs } } });
  if (colorIds.length === 1) andConditions.push({ colors: { some: { colorId: colorIds[0] } } });
  else if (colorIds.length > 1) andConditions.push({ colors: { some: { colorId: { in: colorIds } } } });
  if (promo) andConditions.push({ discountPercent: { gt: 0 } });
  if (effectiveMinPrice !== null || effectiveMaxPrice !== null) {
    andConditions.push({ colors: { some: { unitPrice: { ...(effectiveMinPrice !== null && { gte: effectiveMinPrice }), ...(effectiveMaxPrice !== null && { lte: effectiveMaxPrice }) } } } });
  }

  const where: Record<string, unknown> = {
    status: "ONLINE",
    ...(andConditions.length > 0 && { AND: andConditions }),
    ...(q && exactRef
      ? { reference: { equals: q.toUpperCase() } }
      : q
        ? {
            OR: [
              { name:      { contains: q } },
              { reference: { contains: q } },
              { tags: { some: { tag: { name: { contains: q.toLowerCase() } } } } },
            ],
          }
        : {}),
    ...(cat            && { categoryId: cat }),
    ...(subcat         && { subCategories: { some: { id: subcat } } }),
    ...(collection     && { collections: { some: { collectionId: collection } } }),
    ...(tagId          && { tags: { some: { tagId } } }),
    ...(compositionId  && { compositions: { some: { compositionId } } }),
    ...(bestseller && { isBestSeller: true }),
    ...(isNew      && {
      OR: [
        { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
        { lastRefreshedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    }),
    ...(ordered && userOrderedRefs.length > 0 && { reference: { in: userOrderedRefs } }),
    ...(ordered && userOrderedRefs.length === 0 && { id: "___none___" }),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: isNew
      ? [{ lastRefreshedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
      : { createdAt: "desc" },
    skip:    (page - 1) * PER_PAGE,
    take:    PER_PAGE,
    include: productInclude,
  });

  const productIds = products.map((p) => p.id);
  const imageMap = await fetchImages(productIds);
  let shaped = shapeProducts(products, imageMap);

  // Filter out OOS variants/colors if config says so
  if (!showOosVariants) {
    shaped = shaped.map((p: any) => ({
      ...p,
      colors: p.colors
        .map((c: any) => ({ ...c, variants: c.variants.filter((v: any) => v.stock > 0) }))
        .filter((c: any) => c.variants.length > 0),
    })).filter((p: any) => p.colors.length > 0);
  }
  if (shouldHideOos) {
    shaped = shaped.filter((p: any) => p.colors.some((c: any) => c.totalStock > 0));
  }

  return NextResponse.json(stripPricesIfNeeded({
    products: shaped,
    hasMore: products.length === PER_PAGE,
  }));
}
