import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCachedCategories } from "@/lib/cached-data";
import CollectionEditor from "@/components/admin/collections/CollectionEditor";

export const metadata: Metadata = { title: "Modifier la collection — Admin" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditCollectionPage({ params }: Props) {
  const { id } = await params;

  const [collection, categories] = await Promise.all([
    prisma.collection.findUnique({
      where: { id },
      include: {
        translations: true,
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

  if (!collection) notFound();

  // Build translations map
  const translationsMap: Record<string, string> = {};
  for (const t of collection.translations) {
    translationsMap[t.locale] = t.name;
  }

  // Serialize for client (Decimal → number, Date → string)
  const serialized = JSON.parse(
    JSON.stringify(
      {
        id: collection.id,
        name: collection.name,
        image: collection.image,
        translations: translationsMap,
        products: collection.products.map((cp) => ({
          productId: cp.productId,
          colorId: cp.colorId,
          position: cp.position,
          product: {
            id: cp.product.id,
            name: cp.product.name,
            reference: cp.product.reference,
            colorImages: cp.product.colorImages.map((img) => ({
              path: img.path,
              colorId: img.colorId,
            })),
            colors: cp.product.colors.map((pc) => ({
              colorId: pc.colorId,
              isPrimary: pc.isPrimary,
              unitPrice: pc.unitPrice,
              color: pc.color,
            })),
          },
        })),
      },
      (_key, value) =>
        value !== null && typeof value === "object" && typeof value.toNumber === "function"
          ? value.toNumber()
          : value,
    ),
  );

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));

  return <CollectionEditor collection={serialized} categories={categoryOptions} />;
}
