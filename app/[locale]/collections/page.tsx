import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getCachedShopName } from "@/lib/cached-data";
import PublicSidebar from "@/components/layout/PublicSidebar";
import Footer from "@/components/layout/Footer";

export const revalidate = 7200; // ISR: revalidate every 2 hours

export async function generateMetadata(): Promise<Metadata> {
  const shopName = await getCachedShopName();
  return {
    title: `Collections — ${shopName}`,
    description: "Découvrez nos collections de produits. Sélections tendance pour revendeurs et professionnels.",
    alternates: { canonical: "/collections" },
  };
}

export default async function CollectionsPage() {
  const [t, shopName] = await Promise.all([
    getTranslations("collectionsPage"),
    getCachedShopName(),
  ]);
  const collections = await prisma.collection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          products: { where: { product: { status: "ONLINE" } } },
        },
      },
    },
  });

  return (
    <div className="min-h-screen relative">
      <PublicSidebar shopName={shopName} />

      <div className="min-w-0 relative z-10">
        {/* Header */}
        <div className="bg-bg-primary border-b border-border relative overflow-hidden">
          <div className="container-site py-8 relative">
            <h1 className="font-heading text-2xl font-semibold text-text-primary">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-text-muted font-body">
              {collections.length <= 1
                ? t("available", { count: collections.length })
                : t("available_plural", { count: collections.length })}
            </p>
          </div>
        </div>

        <main className="container-site py-8 relative overflow-hidden">
          {collections.length === 0 ? (
            <div className="text-center py-20 text-text-muted font-body">
              {t("empty")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {collections.map((col) => (
                <Link
                  key={col.id}
                  href={`/collections/${col.id}`}
                  className="group card overflow-hidden transition-all duration-300 hover:shadow-[0_12px_32px_rgba(0,0,0,0.12)] hover:-translate-y-1 hover:border-accent/30"
                >
                  {/* Image */}
                  <div className="aspect-[16/9] bg-gradient-to-br from-bg-tertiary to-bg-secondary overflow-hidden relative">
                    {col.image ? (
                      <Image
                        src={col.image}
                        alt={col.name}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
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
                      <h2 className="font-heading font-semibold text-text-primary text-base group-hover:text-accent transition-colors">
                        {col.name}
                      </h2>
                      <p className="text-xs text-text-muted font-body mt-0.5">
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

        <Footer shopName={shopName} />
      </div>
    </div>
  );
}
