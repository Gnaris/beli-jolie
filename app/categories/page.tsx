import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import FloatingShapes from "@/components/ui/FloatingShapes";
import ScatteredDecorations from "@/components/ui/ScatteredDecorations";
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
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: { orderBy: { name: "asc" } },
      _count:        { select: { products: true } },
    },
  });

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
      <FloatingShapes />
      <PublicSidebar shopName={shopName} />

      <div className="min-w-0 relative z-10">
        {/* Page header */}
        <div className="bg-bg-primary border-b border-border relative overflow-hidden">
          <ScatteredDecorations variant="sparse" seed={3} />
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
          <ScatteredDecorations variant="sparse" seed={300} />
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
