import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";
import FloatingShapes from "@/components/ui/FloatingShapes";
import ScatteredDecorations from "@/components/ui/ScatteredDecorations";

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

  return (
    <div className="min-h-screen relative">
      <FloatingShapes />
      <PublicSidebar shopName={shopName} />

      <div className="min-w-0 relative z-10">
        {/* Page header */}
        <div className="bg-bg-primary border-b border-border relative overflow-hidden">
          <ScatteredDecorations variant="sparse" seed={3} />
          <div className="container-site py-8 relative">
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-text-primary">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              {t("subtitle", { count: categories.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8 relative overflow-hidden">
          <ScatteredDecorations variant="sparse" seed={300} />
          {categories.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-[family-name:var(--font-roboto)]">
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="card overflow-hidden transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.1)] hover:border-accent/30"
                >
                  {/* Category header */}
                  <Link
                    href={`/produits?cat=${cat.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-bg-secondary transition-colors group"
                  >
                    <div>
                      <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-base text-text-primary group-hover:text-accent transition-colors">
                        {cat.name}
                      </h2>
                      <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
                        {cat._count.products <= 1
                          ? t("products", { count: cat._count.products })
                          : t("products_plural", { count: cat._count.products })}
                      </p>
                    </div>
                    <svg
                      className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>

                  {/* Sub-categories */}
                  {cat.subCategories.length > 0 && (
                    <div className="border-t border-border px-5 py-3 flex flex-wrap gap-2">
                      {cat.subCategories.map((sub) => (
                        <Link
                          key={sub.id}
                          href={`/produits?cat=${cat.id}&subcat=${sub.id}`}
                          className="inline-flex items-center text-xs text-text-secondary bg-gradient-to-r from-bg-tertiary to-bg-secondary border border-border hover:bg-accent hover:text-text-inverse hover:border-accent px-3 py-1.5 rounded-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm font-[family-name:var(--font-roboto)]"
                        >
                          {sub.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
