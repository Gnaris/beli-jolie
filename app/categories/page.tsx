import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Catégories — Beli & Jolie",
  description: "Parcourez nos catégories et sous-catégories de bijoux en acier inoxydable.",
};

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      subCategories: { orderBy: { name: "asc" } },
      _count:        { select: { products: true } },
    },
  });

  return (
    <div className="flex min-h-screen">
      <PublicSidebar />

      <div className="flex-1 lg:ml-60 pt-14 lg:pt-0 min-w-0">
        {/* Page header */}
        <div className="bg-white border-b border-[#E5E5E5]">
          <div className="container-site py-8">
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-[#1A1A1A]">
              Catégories
            </h1>
            <p className="mt-1 text-sm text-[#999999] font-[family-name:var(--font-roboto)]">
              Explorez nos {categories.length} catégories de bijoux.
            </p>
          </div>
        </div>

        <main className="container-site py-8">
          {categories.length === 0 ? (
            <div className="text-center py-20 text-[#999999] font-[family-name:var(--font-roboto)]">
              Aucune catégorie disponible pour l&apos;instant.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden"
                >
                  {/* Category header */}
                  <Link
                    href={`/produits?cat=${cat.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-[#F5F5F5] transition-colors group"
                  >
                    <div>
                      <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-base text-[#1A1A1A] group-hover:underline">
                        {cat.name}
                      </h2>
                      <p className="text-xs text-[#999999] font-[family-name:var(--font-roboto)] mt-0.5">
                        {cat._count.products} produit{cat._count.products !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <svg
                      className="w-4 h-4 text-[#999999] group-hover:text-[#1A1A1A] transition-colors shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>

                  {/* Sub-categories */}
                  {cat.subCategories.length > 0 && (
                    <div className="border-t border-[#F5F5F5] px-5 py-3 flex flex-wrap gap-2">
                      {cat.subCategories.map((sub) => (
                        <Link
                          key={sub.id}
                          href={`/produits?cat=${cat.id}&subcat=${sub.id}`}
                          className="inline-flex items-center text-xs text-[#555555] bg-[#F5F5F5] hover:bg-[#EEEEEE] px-2.5 py-1 rounded-full transition-colors font-[family-name:var(--font-roboto)]"
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
