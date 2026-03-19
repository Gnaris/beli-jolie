import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseDisplayConfig, getOrderedProductIds } from "@/lib/product-display";
import { getCachedSiteConfig } from "@/lib/cached-data";

const PER_PAGE = 20;

const PRODUCT_INCLUDE = {
  category:      { select: { name: true } },
  subCategories: { select: { name: true }, take: 1 },
  tags:          { include: { tag: { select: { id: true, name: true } } } },
  colors: {
    select: {
      id:            true,
      colorId:       true,
      unitPrice:     true,
      stock:         true,
      isPrimary:     true,
      saleType:      true,
      packQuantity:  true,
      size:          true,
      discountType:  true,
      discountValue: true,
      color:         { select: { name: true, hex: true } },
    },
  },
} as const;

// Shape products: group variants by colorId + attach first image
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeProducts(products: any[], imageMap: Map<string, Map<string, string>>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return products.map((p: any) => {
    const colorMap = new Map<string, {
      colorId: string; name: string; hex: string | null;
      firstImage: string | null; unitPrice: number; isPrimary: boolean; totalStock: number;
      variants: { id: string; saleType: "UNIT" | "PACK"; packQuantity: number | null; size: string | null; unitPrice: number; stock: number; discountType: "PERCENT" | "AMOUNT" | null; discountValue: number | null }[];
    }>();
    for (const v of p.colors) {
      if (!colorMap.has(v.colorId)) {
        colorMap.set(v.colorId, {
          colorId:    v.colorId,
          name:       v.color.name,
          hex:        v.color.hex,
          firstImage: imageMap.get(p.id)?.get(v.colorId) ?? null,
          unitPrice:  v.unitPrice,
          isPrimary:  v.isPrimary,
          totalStock: 0,
          variants:   [],
        });
      }
      const cd = colorMap.get(v.colorId)!;
      cd.unitPrice = Math.min(cd.unitPrice, v.unitPrice);
      cd.totalStock += v.stock ?? 0;
      if (v.isPrimary) cd.isPrimary = true;
      cd.variants.push({ id: v.id, saleType: v.saleType, packQuantity: v.packQuantity, size: v.size ?? null, unitPrice: v.unitPrice, stock: v.stock ?? 0, discountType: v.discountType ?? null, discountValue: v.discountValue ?? null });
    }
    return { ...p, colors: [...colorMap.values()] };
  });
}

async function fetchImages(productIds: string[]) {
  const colorImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({ where: { productId: { in: productIds } }, orderBy: { order: "asc" }, select: { productId: true, colorId: true, path: true } })
    : [];
  const imageMap = new Map<string, Map<string, string>>();
  for (const img of colorImages) {
    if (!imageMap.has(img.productId)) imageMap.set(img.productId, new Map());
    const cm = imageMap.get(img.productId)!;
    if (!cm.has(img.colorId)) cm.set(img.colorId, img.path);
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

  // Stock display config
  const [stockProductsRow, stockVariantsRow] = await Promise.all([
    getCachedSiteConfig("show_out_of_stock_products"),
    getCachedSiteConfig("show_out_of_stock_variants"),
  ]);
  const showOosProducts = stockProductsRow?.value !== "false"; // default true
  const showOosVariants = stockVariantsRow?.value !== "false"; // default true
  const shouldHideOos = !showOosProducts || hideOos;

  // Fetch session for ordered/notOrdered filters
  const session = (ordered || notOrdered) ? await getServerSession(authOptions) : null;

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

  const hasFilters = !!(q || cat || subcat || collection || colorIds.length > 0 || tagId || bestseller || isNew || promo || ordered || notOrdered || hideOos || minPrice !== null || maxPrice !== null || exactRef);

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
        include: PRODUCT_INCLUDE,
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

      return NextResponse.json({
        products: shaped,
        hasMore: page * PER_PAGE < totalCount,
      });
    }
  }

  // ─── Default / filtered ordering ──────────────────────────────────────────
  // Use AND array to avoid key collisions (colors, NOT, etc.)
  const andConditions: Record<string, unknown>[] = [];
  if (shouldHideOos) andConditions.push({ NOT: { colors: { every: { stock: { equals: 0 } } } } });
  if (notOrdered && userOrderedRefs.length > 0) andConditions.push({ NOT: { reference: { in: userOrderedRefs } } });
  if (colorIds.length === 1) andConditions.push({ colors: { some: { colorId: colorIds[0] } } });
  else if (colorIds.length > 1) andConditions.push({ colors: { some: { colorId: { in: colorIds } } } });
  if (promo) andConditions.push({ colors: { some: { discountValue: { gt: 0 } } } });
  if (minPrice !== null || maxPrice !== null) {
    andConditions.push({ colors: { some: { unitPrice: { ...(minPrice !== null && { gte: minPrice }), ...(maxPrice !== null && { lte: maxPrice }) } } } });
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
    ...(cat        && { categoryId: cat }),
    ...(subcat     && { subCategories: { some: { id: subcat } } }),
    ...(collection && { collections: { some: { collectionId: collection } } }),
    ...(tagId      && { tags: { some: { tagId } } }),
    ...(bestseller && { isBestSeller: true }),
    ...(isNew      && { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }),
    ...(ordered && userOrderedRefs.length > 0 && { reference: { in: userOrderedRefs } }),
    ...(ordered && userOrderedRefs.length === 0 && { id: "___none___" }),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: isNew ? { updatedAt: "desc" } : { createdAt: "desc" },
    skip:    (page - 1) * PER_PAGE,
    take:    PER_PAGE,
    include: PRODUCT_INCLUDE,
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

  return NextResponse.json({
    products: shaped,
    hasMore: products.length === PER_PAGE,
  });
}
