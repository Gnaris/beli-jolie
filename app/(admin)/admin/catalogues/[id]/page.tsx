import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCachedCategories } from "@/lib/cached-data";
import CatalogEditor from "@/components/admin/catalogues/CatalogEditor";

export const metadata: Metadata = { title: "Modifier le catalogue — Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminCatalogEditPage({ params }: Props) {
  const { id } = await params;

  const [catalog, categories] = await Promise.all([
    prisma.catalog.findUnique({
      where: { id },
      include: {
        products: {
          orderBy: { position: "asc" },
          include: {
            product: {
              include: {
                colorImages: { orderBy: { order: "asc" } },
                colors: {
                  where: { saleType: "UNIT" },
                  include: {
                    color: { select: { id: true, name: true, hex: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    getCachedCategories(),
  ]);

  if (!catalog) notFound();

  // Deduplicate products (same productId may appear multiple times from prior bug)
  const seen = new Set<string>();
  catalog.products = catalog.products.filter((p) => {
    if (seen.has(p.productId)) return false;
    seen.add(p.productId);
    return true;
  });

  // Serialize Decimal fields to plain numbers for Client Component
  const serialized = JSON.parse(
    JSON.stringify(catalog, (_key, value) =>
      value !== null && typeof value === "object" && typeof value.toNumber === "function"
        ? value.toNumber()
        : value,
    ),
  );

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return <CatalogEditor catalog={serialized} categories={categoryOptions} />;
}
