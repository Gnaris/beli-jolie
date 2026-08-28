import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import { buildAlternates } from "@/lib/seo";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import CategoriesGrid from "@/components/produits/CategoriesGrid";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const [shopName, tMeta, alternates] = await Promise.all([
    getCachedShopName(),
    getTranslations({ locale, namespace: "meta" }),
    buildAlternates("/categories", locale),
  ]);
  return {
    title: tMeta("categoriesTitle", { shopName }),
    description: tMeta("categoriesDescription"),
    alternates,
  };
}

export default async function CategoriesPage() {
  const [t, shopName] = await Promise.all([
    getTranslations("categoriesPage"),
    getCachedShopName(),
  ]);
  const allCategories = await prisma.category.findMany({
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      image: true,
      subCategories: {
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      },
      _count: { select: { products: { where: { status: "ONLINE" } } } },
    },
  });

  // Only keep categories that have at least 1 ONLINE product
  const categories = allCategories
    .filter((c) => c._count.products > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
      productCount: c._count.products,
      subCategories: c.subCategories,
    }));

  return (
    <div className="min-h-screen relative">
      <PublicSidebar shopName={shopName} />

      <div className="min-w-0 relative z-10">
        {/* Page header */}
        <div className="bg-bg-primary border-b border-border relative overflow-hidden">
          <div className="container-site py-8 relative">
            <h1 className="font-heading text-2xl font-semibold text-text-primary">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-body">
              {t("subtitle", { count: categories.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-12 lg:py-16 relative overflow-hidden">
          {categories.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-body">
              {t("empty")}
            </div>
          ) : (
            <CategoriesGrid categories={categories} />
          )}
        </main>

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
