import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Categories — Beli & Jolie",
  description: "Parcourez nos categories et sous-categories de bijoux en acier inoxydable.",
};

export default async function CategoriesPage() {
  const t = await getTranslations("categoriesPage");
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: { orderBy: { name: "asc" } },
      _count:        { select: { products: true } },
    },
  });

  return (
    <div className="min-h-screen">
      <PublicSidebar />

      <div className="min-w-0">
        {/* Page header */}
        <div className="bg-bg-primary border-b border-border">
          <div className="container-site py-8">
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-text-primary">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              {t("subtitle", { count: categories.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8">
          {categories.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-[family-name:var(--font-roboto)]">
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="card overflow-hidden"
                >
                  {/* Category header */}
                  <Link
                    href={`/produits?cat=${cat.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-bg-secondary transition-colors group"
                  >
                    <div>
                      <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-base text-text-primary group-hover:text-text-secondary transition-colors">
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
                          className="inline-flex items-center text-xs text-text-secondary bg-bg-tertiary hover:bg-bg-dark hover:text-text-inverse px-2.5 py-1 rounded-full transition-colors font-[family-name:var(--font-roboto)]"
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

        <Footer />
      </div>
    </div>
  );
}
