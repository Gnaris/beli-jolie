import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import CategoriesAccordion from "@/components/produits/CategoriesAccordion";

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Catégories — ${shopName}`,
    description: "Parcourez nos catégories de produits. Prix grossiste professionnel.",
    alternates: { canonical: "/categories" },
  };
}

export default async function CategoriesPage() {
  const [t, shopName] = await Promise.all([
    getTranslations("categoriesPage"),
    getCachedShopName(),
  ]);
  const allCategories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: { orderBy: { name: "asc" } },
      _count: { select: { products: { where: { status: "ONLINE" } } } },
    },
  });

  // Only keep categories that have at least 1 ONLINE product
  const categories = allCategories.filter(c => c._count.products > 0);

  const serialized = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    productCount: cat._count.products,
    subCategories: cat.subCategories.map((sub) => ({
      id: sub.id,
      name: sub.name,
    })),
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

        <main className="container-site py-8 relative overflow-hidden">
          {categories.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-body">
              {t("empty")}
            </div>
          ) : (
            <CategoriesAccordion categories={serialized} />
          )}
        </main>

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
