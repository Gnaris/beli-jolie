import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { Metadata } from "next";
import AdminProductsFilters from "@/components/admin/products/AdminProductsFilters";
import AdminProductsTable from "@/components/admin/products/AdminProductsTable";
import AdminPagination from "@/components/admin/products/AdminPagination";

export const metadata: Metadata = {
  title: "Produits",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    exactRef?: string;
    page?: string;
    perPage?: string;
    cat?: string;
    status?: string;
    minPrice?: string;
    maxPrice?: string;
    dateFrom?: string;
    dateTo?: string;
    stockBelow?: string;
  }>;
}

export default async function ProduitsPage({ searchParams }: PageProps) {
  const {
    q = "",
    exactRef: exactRefParam,
    page: pageParam = "1",
    perPage: perPageParam = "20",
    cat = "",
    status: statusFilter = "",
    minPrice: minPriceParam = "",
    maxPrice: maxPriceParam = "",
    dateFrom = "",
    dateTo = "",
    stockBelow: stockBelowParam = "",
  } = await searchParams;

  const exactRef   = exactRefParam === "1";
  const currentPage = Math.max(1, parseInt(pageParam));
  const perPage     = Math.max(1, parseInt(perPageParam) || 20);
  const minPrice    = minPriceParam ? parseFloat(minPriceParam) : null;
  const maxPrice    = maxPriceParam ? parseFloat(maxPriceParam) : null;

  // ─── Build where clause ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};

  if (q) {
    if (exactRef) {
      where.reference = { equals: q.toUpperCase() };
    } else {
      where.OR = [
        { name:      { contains: q } },
        { reference: { contains: q } },
      ];
    }
  }

  if (cat) where.categoryId = cat;
  if (statusFilter === "ONLINE" || statusFilter === "OFFLINE" || statusFilter === "ARCHIVED") where.status = statusFilter;

  if (minPrice !== null || maxPrice !== null) {
    where.colors = {
      some: {
        unitPrice: {
          ...(minPrice !== null && { gte: minPrice }),
          ...(maxPrice !== null && { lte: maxPrice }),
        },
      },
    };
  }

  if (dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(dateFrom) };
  if (dateTo) {
    const end = new Date(dateTo);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { ...where.createdAt, lte: end };
  }

  const stockBelow = stockBelowParam ? parseInt(stockBelowParam) : null;
  if (stockBelow !== null && !isNaN(stockBelow)) {
    // Products that have at least one variant with stock <= threshold
    where.colors = { ...where.colors, some: { ...where.colors?.some, stock: { lte: stockBelow } } };
  }

  // ─── Fetch data ─────────────────────────────────────────────────────────────
  const [products, totalCount, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (currentPage - 1) * perPage,
      take:    perPage,
      include: {
        category:      { select: { name: true } },
        subCategories: { select: { name: true }, take: 1 },
        colors: {
          select: {
            id:            true,
            colorId:       true,
            unitPrice:     true,
            weight:        true,
            stock:         true,
            isPrimary:     true,
            saleType:      true,
            packQuantity:  true,
            size:          true,
            discountType:  true,
            discountValue: true,
            color:         { select: { name: true, hex: true, patternImage: true } },
            subColors:     { orderBy: { position: "asc" }, select: { color: { select: { name: true, hex: true, patternImage: true } } } },
          },
        },
        translations: { select: { locale: true } },
      },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // First images for each product
  const productIds = products.map((p) => p.id);
  const firstImages = productIds.length > 0
    ? await prisma.productColorImage.findMany({
        where:   { productId: { in: productIds } },
        orderBy: { order: "asc" },
        select:  { productId: true, path: true },
      })
    : [];
  const firstImageMap = new Map<string, string>();
  for (const img of firstImages) {
    if (!firstImageMap.has(img.productId)) firstImageMap.set(img.productId, img.path);
  }

  const totalPages = Math.ceil(totalCount / perPage);

  // Serialize for client component
  const serializedProducts = products.map((p) => ({
    id:              p.id,
    reference:       p.reference,
    name:            p.name,
    status:          p.status as "ONLINE" | "OFFLINE",
    categoryName:    p.category.name,
    subCategoryName: p.subCategories[0]?.name ?? null,
    createdAt:       p.createdAt.toISOString(),
    firstImage:      firstImageMap.get(p.id) ?? null,
    colors:          p.colors.map((c) => ({
      id:            c.id,
      colorId:       c.colorId,
      unitPrice:     c.unitPrice,
      weight:        c.weight,
      stock:         c.stock,
      isPrimary:     c.isPrimary,
      saleType:      c.saleType as "UNIT" | "PACK",
      packQuantity:  c.packQuantity,
      size:          c.size,
      discountType:  c.discountType as "PERCENT" | "AMOUNT" | null,
      discountValue: c.discountValue,
      color:         c.color,
      subColors:     c.subColors,
    })),
    translations:    p.translations,
  }));

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Produits</h1>
          <p className="page-subtitle font-[family-name:var(--font-roboto)]">
            {totalCount} produit{totalCount > 1 ? "s" : ""} au catalogue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/produits/importer" className="btn-secondary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Importer
          </Link>
          <Link href="/admin/produits/nouveau" className="btn-primary flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nouveau produit
          </Link>
        </div>
      </div>

      {/* Filtres + quantité par page */}
      <div className="card px-4 py-3">
        <Suspense>
          <AdminProductsFilters totalCount={totalCount} categories={categories} />
        </Suspense>
      </div>

      {/* Tableau interactif */}
      <AdminProductsTable products={serializedProducts} totalCount={totalCount} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)]">
            {(currentPage - 1) * perPage + 1}–{Math.min(currentPage * perPage, totalCount)} sur {totalCount}
          </p>
          <Suspense>
            <AdminPagination currentPage={currentPage} totalPages={totalPages} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
