import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Collections — Beli & Jolie",
  description: "Decouvrez nos collections de bijoux en acier inoxydable.",
};

export default async function CollectionsPage() {
  const t = await getTranslations("collectionsPage");
  const collections = await prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true } } },
  });

  return (
    <div className="min-h-screen">
      <PublicSidebar />

      <div className="min-w-0">
        {/* Header */}
        <div className="bg-bg-primary border-b border-border">
          <div className="container-site py-8">
            <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-semibold text-text-primary">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-[family-name:var(--font-roboto)]">
              {collections.length <= 1
                ? t("available", { count: collections.length })
                : t("available_plural", { count: collections.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8">
          {collections.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-[family-name:var(--font-roboto)]">
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {collections.map((col) => (
                <Link
                  key={col.id}
                  href={`/collections/${col.id}`}
                  className="group card card-hover overflow-hidden"
                >
                  {/* Image */}
                  <div className="aspect-[16/9] bg-bg-tertiary overflow-hidden">
                    {col.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={col.image}
                        alt={col.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-12 h-12 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                            d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <h2 className="font-[family-name:var(--font-poppins)] font-semibold text-text-primary text-base group-hover:text-text-secondary transition-colors">
                        {col.name}
                      </h2>
                      <p className="text-xs text-text-muted font-[family-name:var(--font-roboto)] mt-0.5">
                        {col._count.products <= 1
                          ? t("products", { count: col._count.products })
                          : t("products_plural", { count: col._count.products })}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>

        <Footer />
      </div>
    </div>
  );
}
