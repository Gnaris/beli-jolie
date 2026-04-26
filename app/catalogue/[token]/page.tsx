import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import { getCachedShopName } from "@/lib/cached-data";
import CatalogPageClient from "@/components/catalogue/CatalogPageClient";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const catalog = await prisma.catalog.findUnique({ where: { token } });
  if (!catalog) return { title: "Catalogue introuvable" };
  return { title: catalog.title, robots: { index: false, follow: false } };
}

export default async function PublicCatalogPage({ params }: Props) {
  const { token } = await params;

  const catalog = await prisma.catalog.findUnique({
    where: { token },
    include: {
      products: {
        orderBy: { position: "asc" },
        include: {
          product: {
            include: {
              colorImages: { orderBy: { order: "asc" } },
              colors: {
                where: { disabled: false },
                include: {
                  color: { select: { id: true, name: true, hex: true, patternImage: true } },
                  subColors: {
                    orderBy: { position: "asc" },
                    select: { color: { select: { name: true, hex: true, patternImage: true } } },
                  },
                  variantSizes: {
                    orderBy: { size: { position: "asc" } },
                    select: { size: { select: { name: true } }, quantity: true },
                  },
                },
              },
              category: true,
            },
          },
        },
      },
    },
  });

  if (!catalog || catalog.status !== "ACTIVE") notFound();

  const [shopName, session] = await Promise.all([
    getCachedShopName(),
    getServerSession(authOptions),
  ]);

  const isAuthenticated = !!session?.user;

  // Load user's favorites if authenticated
  let favoriteProductIds: string[] = [];
  if (session?.user?.id) {
    const favs = await prisma.favorite.findMany({
      where: { userId: session.user.id },
      select: { productId: true },
    });
    favoriteProductIds = favs.map((f) => f.productId);
  }

  const serializedProducts = catalog.products.map(({ product, selectedColorId, selectedImagePath }) => ({
    product: {
      ...product,
      colors: product.colors.map((c) => ({
        ...c,
        unitPrice: Number(c.unitPrice),
        stock: Number(c.stock),
        packQuantity: c.packQuantity != null ? Number(c.packQuantity) : null,
      })),
    },
    selectedColorId,
    selectedImagePath,
  }));

  return (
    <CatalogPageClient
      title={catalog.title}
      shopName={shopName}
      products={serializedProducts}
      isAuthenticated={isAuthenticated}
      catalogToken={token}
      favoriteProductIds={favoriteProductIds}
    />
  );
}
